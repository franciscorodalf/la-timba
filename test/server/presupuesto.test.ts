import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import type { Mesa } from "../../src/server/mesa-base";
import type { Rng } from "../../src/shared/cartas";
import { blackjack, puntuacion, type AccionBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import { carrera, type AccionCarrera, type VistaCarrera } from "../../src/shared/juegos/carrera";
import { abrir, ayudasMesa, cerrarAbiertas, cs, enviar, hasta, jugadores, T, type Conexion, type EstadoMesa } from "../ayudas";

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
const OBJETIVO = 0.3;
/** Mensajes WebSocket entrantes que Cloudflare factura como una petición. */
const MENSAJES_POR_PETICION = 20;
const RONDAS_MEDIDAS = 3;

/**
 * Lo que puede gastar cada ronda medida (la media de las tres), como mucho. Las filas escritas son las de hoy: cinco por
 * cada cobro (apuesta, segunda casilla, seguro, dividir, doblar: la intención y la jugada en la mesa; la apuesta
 * pendiente, las fichas y su borrado en Jugadores), dos por jugador al liquidar (sus fichas y estadísticas, y su
 * resultado), la de la ronda liquidada, una por cada otra jugada que cambie la mesa y por cada alarma nueva, y una en la
 * sala por ronda (su ranking). Lo que trae el reloj sin decisiones (la banca, la ronda siguiente, los pasos de la carrera)
 * no escribe, y los resúmenes de las mesas viven en la memoria de la sala.
 */
const TECHO = {
  blackjack: { escritas: 49, leidas: 38, peticionesDO: 25, peticionesWorker: 13 },
  carrera: { escritas: 47, leidas: 42, peticionesDO: 28, peticionesWorker: 14 },
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
  /** Filas escritas y peticiones a Durable Objects de cada ronda medida, por separado. */
  rondas: { escritas: number; peticionesDO: number }[];
}
const gastoVacio = (): Gasto => ({ porObjeto: {}, escritas: 0, leidas: 0, peticionesDO: 0, peticionesWorker: 0, alarmas: 0, mensajes: 0, borradosDeLaPrueba: 0, rondas: [] });

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
/** Un aviso del reloj que la mesa ha dejado programado (`temporizar`): la prueba lo dispara a su hora. */
type AvisoPendiente = { cuando: number; tarea: () => void };
/** Lo de una mesa que la prueba toca por dentro (también su cola, para esperar a que acabe lo que tenga en marcha). */
type MesaPorDentro = {
  rng: Rng;
  ahora: () => number;
  estado: { ronda: number };
  cola: Promise<void>;
  juego: { vista(e: unknown, jugador: null, ahora: number): unknown };
  temporizar: (tarea: () => void, ms: number) => () => void;
  avisoPendiente: AvisoPendiente | null;
};
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
    const i = porDentro(m);
    i.rng = rngSemilla(semilla);
    // El reloj de la mesa no corre solo: los avisos que programe los dispara la prueba a su hora (`avanzar`).
    i.avisoPendiente = null;
    i.temporizar = (tarea, ms) => {
      const aviso: AvisoPendiente = { cuando: i.ahora() + ms, tarea };
      i.avisoPendiente = aviso;
      return () => {
        if (i.avisoPendiente === aviso) i.avisoPendiente = null;
      };
    };
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
  /** Apunta lo que ha gastado la ronda que acaba (las filas del SQL, de los cursores ya recorridos). */
  const finDeRonda = () => {
    const escritas = gasto.escritas + cursores.reduce((suma, [, c]) => suma + c.rowsWritten, 0);
    const peticiones = gasto.peticionesDO + gasto.mensajes / MENSAJES_POR_PETICION;
    const antes = gasto.rondas.reduce((suma, r) => ({ escritas: suma.escritas + r.escritas, peticionesDO: suma.peticionesDO + r.peticionesDO }), { escritas: 0, peticionesDO: 0 });
    gasto.rondas.push({ escritas: escritas - antes.escritas, peticionesDO: peticiones - antes.peticionesDO });
  };
  const cerrar = async (): Promise<Gasto> => {
    for (const [objeto, c] of cursores) {
      gasto.escritas += c.rowsWritten;
      gasto.leidas += c.rowsRead;
      gasto.porObjeto[objeto] = (gasto.porObjeto[objeto] ?? 0) + c.rowsWritten;
    }
    const total = { ...gasto, porObjeto: { ...gasto.porObjeto }, rondas: [...gasto.rondas] };
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
  /** Lo siguiente que trae el reloj: el aviso que la mesa tenga programado en memoria, a su hora, o si no, su alarma. */
  const avanzar = async () => {
    const hayAviso = await runInDurableObject(mesa, async (m) => {
      const i = porDentro(m);
      const aviso = i.avisoPendiente;
      if (aviso === null) return false;
      i.avisoPendiente = null;
      i.ahora = () => aviso.cuando;
      aviso.tarea();
      await i.cola;
      return true;
    });
    if (!hayAviso) await alarma();
  };
  const ronda = () => runInDurableObject(mesa, (m) => porDentro(m).estado.ronda);
  /** La ronda que enseña la mesa a su hora (puede ir por delante del estado guardado). */
  const rondaVisible = () => runInDurableObject(mesa, (m) => (porDentro(m).juego.vista(porDentro(m).estado, null, porDentro(m).ahora()) as { ronda: number }).ronda);
  return { js: jugadoresMesa, refrescar, mandar, alarma, avanzar, finDeRonda, cerrar, ronda, rondaVisible };
}

afterEach(cerrarAbiertas);

type EstadoBJ = EstadoMesa<VistaBJ>;
type EstadoCarrera = EstadoMesa<VistaCarrera>;

/**
 * La ronda con las jugadas nuevas: el primer jugador apuesta en dos casillas, la banca enseña un as (todos contestan al
 * seguro y él lo coge) y divide su pareja de ochos. Zapato: una carta a cada casilla (0 y 1 del primero, 2, 3 y 4), la
 * banca (as), otra vuelta y la tapada (7, sin blackjack); después, las cartas de la división.
 */
const RONDA_ESPECIAL = 1;
const ZAPATO_ESPECIAL = "8S 10S 9C 10D 10H AS 8H 6H 7C 5D 9H 7D 3C 2C";

/** Lo que cambia de un jugador cuando actúa: la fase, su seguro y sus manos. */
const firmaDe = (v: VistaBJ, id: number) => JSON.stringify([v.ronda, v.fase, v.miSeguro, v.manos.filter((x) => x.jugadorId === id).map((x) => [x.cartas.length, x.estado, x.apuesta])]);

/**
 * Rondas de blackjack: cada uno apuesta y pide hasta 17 en cada mano (y en la ronda especial, dos casillas, seguro y una
 * división); refresca sus fichas al apostar o pagar algo, al cobrar y al cambiar de ronda.
 */
async function medirBlackjack(): Promise<Gasto> {
  const inicial = blackjack.crear(T, rngSemilla(7));
  const m = await preparar<VistaBJ>(
    ayudasMesa(env.MesaBlackjack, "mesa-blackjack") as unknown as AyudasMesa,
    { ...inicial, zapato: [...cs(ZAPATO_ESPECIAL), ...inicial.zapato] },
    11,
  );
  for (let ronda = 1; ronda <= RONDAS_MEDIDAS; ronda++) {
    const especial = ronda === RONDA_ESPECIAL;
    for (const [i, j] of m.js.entries()) {
      m.mandar(j, { t: "apostar", cantidad: 50 } satisfies AccionBJ);
      await hasta<EstadoBJ>(j.conexion, (e) => e.vista.ronda === ronda && e.vista.manos.some((mano) => mano.jugadorId === j.id));
      await m.refrescar(j);
      if (especial && i === 0) {
        m.mandar(j, { t: "apostar", cantidad: 50, segunda: true } satisfies AccionBJ);
        await hasta<EstadoBJ>(j.conexion, (e) => e.vista.manos.filter((mano) => mano.jugadorId === j.id).length === 2);
        await m.refrescar(j);
      }
    }
    await m.alarma(); // reparto
    // Lo último que ha visto cada uno tras el reparto.
    const vistas = new Map<number, VistaBJ>();
    for (const j of m.js) vistas.set(j.id, (await hasta<EstadoBJ>(j.conexion, (e) => e.vista.ronda === ronda && e.vista.fase !== "apuestas")).vista);
    // Con un as de la banca, todos contestan al seguro (en la ronda especial, el primero lo coge).
    for (const [i, j] of m.js.entries()) {
      const vista = vistas.get(j.id)!;
      if (vista.fase !== "seguro" || vista.opciones?.seguro == null) continue;
      const tomar = especial && i === 0;
      m.mandar(j, { t: "seguro", tomar } satisfies AccionBJ);
      vistas.set(j.id, (await hasta<EstadoBJ>(j.conexion, (e) => e.vista.fase !== "seguro" || e.vista.opciones?.seguro === null)).vista);
      if (tomar) await m.refrescar(j);
    }
    for (const [i, j] of m.js.entries()) {
      let vista = vistas.get(j.id)!;
      if (vista.fase === "seguro") vista = (await hasta<EstadoBJ>(j.conexion, (e) => e.vista.fase !== "seguro")).vista;
      for (;;) {
        const activa = vista.manos.find((mano) => mano.jugadorId === j.id && mano.estado === "jugando");
        if (vista.fase !== "decisiones" || activa === undefined) break;
        const dividir = especial && i === 0 && vista.opciones?.dividir === true;
        const antes = firmaDe(vista, j.id);
        m.mandar(j, { t: dividir ? "dividir" : puntuacion(activa.cartas).total < 17 ? "pedir" : "plantarse" } satisfies AccionBJ);
        vista = (await hasta<EstadoBJ>(j.conexion, (e) => firmaDe(e.vista, j.id) !== antes)).vista;
        if (dividir) await m.refrescar(j);
      }
    }
    // La banca, el resultado y la ronda siguiente: lo que trae el reloj.
    while ((await m.rondaVisible()) === ronda) await m.avanzar();
    for (const j of m.js) await m.refrescar(j); // cobro
    for (const j of m.js) await m.refrescar(j); // ronda nueva
    m.finDeRonda();
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
    m.finDeRonda();
  }
  return await m.cerrar();
}

type Cantidad = Exclude<keyof Gasto, "porObjeto" | "rondas">;
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
      .join(", ")}; ${(g.mensajes / RONDAS_MEDIDAS).toFixed(1)} mensajes; ` +
    `ronda a ronda: ${g.rondas.map((r) => `${r.escritas} escritas y ${r.peticionesDO.toFixed(1)} peticiones DO`).join(" / ")})`;
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
  expect(escritas).toBeLessThanOrEqual(OBJETIVO * LIMITE.escritas);
  expect(leidas).toBeLessThanOrEqual(OBJETIVO * LIMITE.leidas);
  expect(peticiones).toBeLessThanOrEqual(OBJETIVO * LIMITE.peticiones);
  expect(peticionesWorker).toBeLessThanOrEqual(OBJETIVO * LIMITE.peticiones);
});
