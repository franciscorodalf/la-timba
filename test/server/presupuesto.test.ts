import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import type { Mesa } from "../../src/server/mesa-base";
import type { Rng } from "../../src/shared/cartas";
import { blackjack, puntuacion, type AccionBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import { carrera, type AccionCarrera, type VistaCarrera } from "../../src/shared/juegos/carrera";
import { abrir, ayudasMesa, cerrarAbiertas, enviar, hasta, jugadores, T, type Conexion, type EstadoMesa } from "../ayudas";

// ---------------------------------------------------------------------------
// Presupuesto de una noche típica en el plan gratuito de Cloudflare.
//
// Se juegan rondas de verdad (4 jugadores por mesa, por las mesas reales) y se cuenta lo que factura Cloudflare:
// - filas escritas: cada clave de `put`/`delete`, cada `setAlarm`/`deleteAlarm` y las `rowsWritten` del SQL;
// - filas leídas: cada clave de `get` y las `rowsRead` del SQL;
// - peticiones a Durable Objects: cada RPC entre objetos, cada alarma, cada petición del cliente que llega a uno y los
//   mensajes WebSocket entrantes (20 por petición);
// - peticiones al Worker: las de la API que hace el cliente (las fichas: al apostar, al cobrar y al cambiar de ronda).
// Con lo medido por ronda se extrapola la noche típica (spec §1): 8 jugadores 3 h, 4 en el blackjack (≈ 330 rondas) y
// 4 en la carrera (≈ 240 carreras), y se imprime. Lo que se mide por ronda no puede pasar de su techo (`TECHO`).
// ---------------------------------------------------------------------------

const LIMITE = { escritas: 100_000, leidas: 5_000_000, peticiones: 100_000 } as const;
const NOCHE = { blackjack: 330, carrera: 240 } as const;
/** La parte de cada límite diario que puede gastar una noche típica (spec §1). */
const OBJETIVO = 0.25;
/** Mensajes WebSocket entrantes que Cloudflare factura como una petición. */
const MENSAJES_POR_PETICION = 20;
const RONDAS_MEDIDAS = 3;

/**
 * Lo que puede gastar cada ronda medida, como mucho. Las filas escritas son las de hoy: cinco por apuesta (la intención y
 * la jugada en la mesa; la apuesta pendiente, las fichas y su borrado en Jugadores), dos por jugador al liquidar (sus
 * fichas y estadísticas, y su resultado), la de la ronda liquidada, una por cada otro cambio de la mesa y por cada
 * alarma nueva, y una por aviso a la sala.
 */
const TECHO = {
  blackjack: { escritas: 47, leidas: 50, peticionesDO: 25, peticionesWorker: 12 },
  carrera: { escritas: 49, leidas: 60, peticionesDO: 28, peticionesWorker: 14 },
} as const;

interface Gasto {
  /** Filas escritas por cada Durable Object (mesa, sala, jugadores). */
  porObjeto: Record<string, number>;
  escritas: number;
  leidas: number;
  peticionesDO: number;
  peticionesWorker: number;
  alarmas: number;
  mensajes: number;
  /** `deleteAlarm` que hace la propia prueba al disparar una alarma (`runDurableObjectAlarm`): no es de la mesa y no cuenta. */
  borradosDeLaPrueba: number;
}
const gastoVacio = (): Gasto => ({ porObjeto: {}, escritas: 0, leidas: 0, peticionesDO: 0, peticionesWorker: 0, alarmas: 0, mensajes: 0, borradosDeLaPrueba: 0 });

/** Generador determinista (mulberry32): las rondas medidas son siempre las mismas. */
function rngSemilla(semilla: number): Rng {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Almacen = Record<string, (...a: unknown[]) => unknown>;
const claves = (a: unknown[]) => (typeof a[0] === "string" ? 1 : Array.isArray(a[0]) ? a[0].length : Object.keys(a[0] as object).length);

/**
 * Cuenta lo que factura el almacenamiento de un Durable Object (KV, alarmas y SQL) mientras siga en memoria. Las filas
 * del SQL se suman al final (`cerrar`), cuando los cursores ya se han recorrido.
 */
async function medirAlmacen(stub: DurableObjectStub, gasto: Gasto, cursores: [string, SqlStorageCursor<Record<string, SqlStorageValue>>][], objeto: string) {
  await runInDurableObject(stub, (_i, state) => {
    const s = state.storage as unknown as Almacen;
    const envolver = (nombre: string, cuenta: (a: unknown[]) => Partial<Gasto>) => {
      const original = s[nombre].bind(state.storage);
      s[nombre] = (...a: unknown[]) => {
        const c = cuenta(a);
        gasto.escritas += c.escritas ?? 0;
        gasto.porObjeto[objeto] = (gasto.porObjeto[objeto] ?? 0) + (c.escritas ?? 0);
        gasto.leidas += c.leidas ?? 0;
        return original(...a);
      };
    };
    envolver("put", (a) => ({ escritas: claves(a) }));
    envolver("delete", (a) => ({ escritas: claves(a) }));
    envolver("get", (a) => ({ leidas: claves(a) }));
    envolver("setAlarm", () => ({ escritas: 1 }));
    envolver("deleteAlarm", () => {
      if (gasto.borradosDeLaPrueba === 0) return { escritas: 1 };
      gasto.borradosDeLaPrueba -= 1;
      return {};
    });
    const sql = state.storage.sql as unknown as Almacen;
    const exec = sql.exec.bind(state.storage.sql);
    sql.exec = (...a: unknown[]) => {
      const cursor = exec(...a) as SqlStorageCursor<Record<string, SqlStorageValue>>;
      cursores.push([objeto, cursor]);
      return cursor;
    };
  });
}

/** Un stub que cuenta una petición por cada llamada RPC. */
function contarRpc<S extends object>(stub: S, gasto: Gasto): S {
  return new Proxy(stub, {
    get(objetivo, nombre) {
      const valor = Reflect.get(objetivo, nombre);
      if (typeof valor !== "function" || nombre === "fetch") return valor;
      return (...a: unknown[]) => {
        gasto.peticionesDO += 1;
        return (objetivo as Record<string | symbol, (...a: unknown[]) => unknown>)[nombre](...a);
      };
    },
  });
}

/** Cambia el `env` de una instancia por uno cuyos stubs de Jugadores y Partida cuentan sus RPC (instancia, no el `env` compartido). */
async function contarRpcDe(stub: DurableObjectStub, gasto: Gasto) {
  await runInDurableObject(stub, (instancia) => {
    type Espacio = { idFromName(nombre: string): DurableObjectId; get(id: DurableObjectId): object };
    const i = instancia as unknown as { env: { Jugadores: Espacio; Partida: Espacio } };
    const original = i.env;
    const contado = (ns: Espacio): Espacio => ({ idFromName: (nombre) => ns.idFromName(nombre), get: (id) => contarRpc(ns.get(id), gasto) });
    i.env = Object.assign(Object.create(original), { Jugadores: contado(original.Jugadores), Partida: contado(original.Partida) });
  });
}

type Jugador = { id: number; token: string; conexion: Conexion };
/** Lo de una mesa que la prueba toca por dentro (también su cola, para esperar a que acabe lo que tenga en marcha). */
type MesaPorDentro = { rng: Rng; ahora: () => number; estado: { ronda: number }; cola: Promise<void> };
const porDentro = (m: unknown) => m as MesaPorDentro;

/** Lo que usa la medición de las ayudas de una mesa (`ayudasMesa`). */
interface AyudasMesa {
  nuevaMesa(n: number, estado: never): Promise<{ codigo: string; js: { id: number; token: string }[] }>;
  mesa(codigo: string): DurableObjectStub;
  sentarse(codigo: string, token: string): Promise<Conexion>;
}

async function preparar<V>(ayudas: AyudasMesa, estado: unknown, semilla: number) {
  const { codigo, js } = await ayudas.nuevaMesa(4, estado as never);
  const mesa = ayudas.mesa(codigo);
  await runInDurableObject(mesa, (m) => {
    porDentro(m).rng = rngSemilla(semilla);
  });
  const salas: Conexion[] = [];
  for (const j of js) salas.push(await abrir(`/parties/partida/${codigo}`, j.token));
  const jugadoresMesa: Jugador[] = [];
  for (const j of js) jugadoresMesa.push({ id: j.id, token: j.token, conexion: await ayudas.sentarse(codigo, j.token) });
  // Todos sentados: cada conexión ha visto a los cuatro.
  for (const j of jugadoresMesa) await hasta<EstadoMesa<V & { sentados: string[] }>>(j.conexion, (m) => m.vista.sentados.length === 4);

  const gasto = gastoVacio();
  const cursores: [string, SqlStorageCursor<Record<string, SqlStorageValue>>][] = [];
  const sala = env.Partida.get(env.Partida.idFromName(codigo));
  await medirAlmacen(mesa, gasto, cursores, "mesa");
  await medirAlmacen(sala, gasto, cursores, "sala");
  await medirAlmacen(jugadores(), gasto, cursores, "jugadores");
  await contarRpcDe(mesa, gasto);
  await contarRpcDe(sala, gasto);
  /**
   * Suma las filas del SQL y devuelve lo gastado; después cierra las conexiones y espera a que la mesa y la sala hayan
   * atendido los cierres (lo que hagan ya no cuenta): la prueba no acaba con trabajo suyo a medias.
   */
  const cerrar = async (): Promise<Gasto> => {
    for (const [objeto, c] of cursores) {
      gasto.escritas += c.rowsWritten;
      gasto.leidas += c.rowsRead;
      gasto.porObjeto[objeto] = (gasto.porObjeto[objeto] ?? 0) + c.rowsWritten;
    }
    const total = { ...gasto, porObjeto: { ...gasto.porObjeto } };
    for (const conexion of [...jugadoresMesa.map((j) => j.conexion), ...salas]) conexion.cerrar();
    await vi.waitFor(async () => {
      expect(await runInDurableObject(mesa, (m) => [...(m as unknown as Mesa<any, any>).getConnections()].length)).toBe(0);
      expect(await runInDurableObject(sala, (p) => [...p.getConnections()].length)).toBe(0);
    });
    await runInDurableObject(mesa, (m) => porDentro(m).cola);
    return total;
  };

  /** El cliente vuelve a leer sus fichas (una petición al Worker, que hace una RPC a Jugadores). */
  const refrescar = async (j: Jugador) => {
    gasto.peticionesWorker += 1;
    gasto.peticionesDO += 1;
    const r = await exports.default.fetch("http://x/api/fichas", { headers: { authorization: `Bearer ${j.token}` } });
    expect(r.status).toBe(200);
  };
  const mandar = (j: Jugador, accion: object) => {
    gasto.mensajes += 1;
    enviar(j.conexion, accion);
  };
  /** Ejecuta la alarma programada de la mesa con su reloj en la hora de la alarma. */
  const alarma = async () => {
    await runInDurableObject(mesa, async (m, state) => {
      const cuando = await state.storage.getAlarm();
      if (cuando === null) throw new Error("la mesa no tiene alarma");
      porDentro(m).ahora = () => cuando;
    });
    gasto.alarmas += 1;
    gasto.peticionesDO += 1;
    gasto.borradosDeLaPrueba += 1;
    expect(await runDurableObjectAlarm(mesa)).toBe(true);
  };
  const ronda = () => runInDurableObject(mesa, (m) => porDentro(m).estado.ronda);
  return { js: jugadoresMesa, refrescar, mandar, alarma, cerrar, ronda };
}

afterEach(cerrarAbiertas);

type EstadoBJ = EstadoMesa<VistaBJ>;
type EstadoCarrera = EstadoMesa<VistaCarrera>;

/** Rondas de blackjack: cada uno apuesta y pide hasta 17; refresca sus fichas al apostar, al cobrar y al cambiar de ronda. */
async function medirBlackjack(): Promise<Gasto> {
  const m = await preparar<VistaBJ>(ayudasMesa(env.MesaBlackjack, "mesa-blackjack") as unknown as AyudasMesa, blackjack.crear(T, rngSemilla(7)), 11);
  for (let ronda = 1; ronda <= RONDAS_MEDIDAS; ronda++) {
    for (const j of m.js) {
      m.mandar(j, { t: "apostar", cantidad: 50 } satisfies AccionBJ);
      await hasta<EstadoBJ>(j.conexion, (e) => e.vista.ronda === ronda && e.vista.manos.some((mano) => mano.jugadorId === j.id));
      await m.refrescar(j);
    }
    await m.alarma(); // reparto
    for (const j of m.js) {
      let vista = (await hasta<EstadoBJ>(j.conexion, (e) => e.vista.ronda === ronda && e.vista.fase !== "apuestas")).vista;
      for (;;) {
        const mia = vista.manos.find((mano) => mano.jugadorId === j.id)!;
        if (vista.fase !== "decisiones" || mia.estado !== "jugando") break;
        const antes = mia.cartas.length;
        m.mandar(j, { t: puntuacion(mia.cartas).total < 17 ? "pedir" : "plantarse" } satisfies AccionBJ);
        vista = (
          await hasta<EstadoBJ>(j.conexion, (e) => {
            const nueva = e.vista.manos.find((mano) => mano.jugadorId === j.id);
            if (e.vista.ronda !== ronda || nueva === undefined) return false;
            return nueva.estado !== "jugando" || nueva.cartas.length !== antes;
          })
        ).vista;
      }
    }
    // La banca, el resultado y la ronda siguiente.
    while ((await m.ronda()) === ronda) await m.alarma();
    for (const j of m.js) await m.refrescar(j); // cobro
    for (const j of m.js) await m.refrescar(j); // ronda nueva
  }
  return await m.cerrar();
}

/** Carreras: seis apuestas entre los cuatro; cada uno refresca sus fichas al apostar, al cobrar y al cambiar de ronda. */
async function medirCarrera(): Promise<Gasto> {
  const m = await preparar<VistaCarrera>(ayudasMesa(env.MesaCarrera, "mesa-carrera") as unknown as AyudasMesa, carrera.crear(T, rngSemilla(5)), 13);
  const apuestas: [number, AccionCarrera][] = [
    [0, { t: "apostar", caballo: "H", cantidad: 50 }],
    [0, { t: "apostar", caballo: "D", cantidad: 30 }],
    [1, { t: "apostar", caballo: "S", cantidad: 100 }],
    [2, { t: "apostar", caballo: "C", cantidad: 20 }],
    [2, { t: "apostar", caballo: "H", cantidad: 20 }],
    [3, { t: "apostar", caballo: "D", cantidad: 50 }],
  ];
  const total = (v: VistaCarrera) => Object.values(v.totalesPorCaballo).reduce((a, b) => a + b, 0);
  for (let ronda = 1; ronda <= RONDAS_MEDIDAS; ronda++) {
    let apostado = 0;
    for (const [i, accion] of apuestas) {
      const j = m.js[i];
      apostado += accion.t === "apostar" ? accion.cantidad : 0;
      m.mandar(j, accion);
      await hasta<EstadoCarrera>(j.conexion, (e) => e.vista.ronda === ronda && total(e.vista) === apostado);
      await m.refrescar(j);
    }
    while ((await m.ronda()) === ronda) await m.alarma();
    for (const j of m.js) await m.refrescar(j); // cobro
    for (const j of m.js) await m.refrescar(j); // ronda nueva
  }
  return await m.cerrar();
}

type Cantidad = Exclude<keyof Gasto, "porObjeto">;
const porRonda = (g: Gasto, campo: Cantidad) => g[campo] / RONDAS_MEDIDAS;
const pct = (valor: number, limite: number) => `${((100 * valor) / limite).toFixed(1)} %`;

const peticionesDO = (g: Gasto) => porRonda(g, "peticionesDO") + porRonda(g, "mensajes") / MENSAJES_POR_PETICION;

it("una ronda de cada juego no pasa de su techo, y la noche típica extrapolada se imprime", { timeout: 60_000 }, async () => {
  const medido = { blackjack: await medirBlackjack(), carrera: await medirCarrera() };
  const noche = (valor: (g: Gasto) => number) => valor(medido.blackjack) * NOCHE.blackjack + valor(medido.carrera) * NOCHE.carrera;
  const escritas = noche((g) => porRonda(g, "escritas"));
  const leidas = noche((g) => porRonda(g, "leidas"));
  const peticiones = noche(peticionesDO);
  const peticionesWorker = noche((g) => porRonda(g, "peticionesWorker"));
  const fila = (nombre: string, g: Gasto) =>
    `${nombre}: ${porRonda(g, "escritas").toFixed(1)} filas escritas, ${porRonda(g, "leidas").toFixed(1)} leídas, ` +
    `${peticionesDO(g).toFixed(1)} peticiones DO, ${porRonda(g, "peticionesWorker").toFixed(1)} al Worker, ${porRonda(g, "alarmas").toFixed(1)} alarmas ` +
    `(escritas: ${Object.entries(g.porObjeto)
      .map(([objeto, n]) => `${objeto} ${(n / RONDAS_MEDIDAS).toFixed(1)}`)
      .join(", ")}; ${(g.mensajes / RONDAS_MEDIDAS).toFixed(1)} mensajes)`;
  console.log(
    [
      "Presupuesto por ronda:",
      `  ${fila("blackjack", medido.blackjack)}`,
      `  ${fila("carrera", medido.carrera)}`,
      `Noche típica (${NOCHE.blackjack} rondas de blackjack + ${NOCHE.carrera} carreras), objetivo ≤ ${OBJETIVO * 100} % de cada límite:`,
      `  filas escritas ${Math.round(escritas)} (${pct(escritas, LIMITE.escritas)} de ${LIMITE.escritas})`,
      `  filas leídas ${Math.round(leidas)} (${pct(leidas, LIMITE.leidas)} de ${LIMITE.leidas})`,
      `  peticiones a Durable Objects ${Math.round(peticiones)} (${pct(peticiones, LIMITE.peticiones)} de ${LIMITE.peticiones})`,
      `  peticiones al Worker ${Math.round(peticionesWorker)} (${pct(peticionesWorker, LIMITE.peticiones)} de ${LIMITE.peticiones})`,
    ].join("\n"),
  );

  for (const juego of ["blackjack", "carrera"] as const) {
    const g = medido[juego];
    expect(porRonda(g, "escritas"), `${juego}: filas escritas por ronda`).toBeLessThanOrEqual(TECHO[juego].escritas);
    expect(porRonda(g, "leidas"), `${juego}: filas leídas por ronda`).toBeLessThanOrEqual(TECHO[juego].leidas);
    expect(peticionesDO(g), `${juego}: peticiones a Durable Objects por ronda`).toBeLessThanOrEqual(TECHO[juego].peticionesDO);
    expect(porRonda(g, "peticionesWorker"), `${juego}: peticiones al Worker por ronda`).toBeLessThanOrEqual(TECHO[juego].peticionesWorker);
  }
  expect(leidas).toBeLessThanOrEqual(OBJETIVO * LIMITE.leidas);
  expect(peticiones).toBeLessThanOrEqual(OBJETIVO * LIMITE.peticiones);
  expect(peticionesWorker).toBeLessThanOrEqual(OBJETIVO * LIMITE.peticiones);
});
