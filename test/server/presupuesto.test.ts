import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import type { Mesa } from "../../src/server/mesa-base";
import type { Rng } from "../../src/shared/cartas";
import { blackjack, puntuacion, type AccionBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import { carrera, type AccionCarrera, type VistaCarrera } from "../../src/shared/juegos/carrera";
import { opcionesDe, type AccionPoker, type Calle, type EstadoPoker, type OpcionesPoker, type VistaPoker } from "../../src/shared/juegos/poker";
import { abrir, ayudasMesa, cerrarAbiertas, cs, enviar, fichas, hasta, jugadores, pendientesDe, T, type Conexion, type EstadoMesa } from "../ayudas";

// ---------------------------------------------------------------------------
// Presupuesto de una noche típica en el plan gratuito de Cloudflare.
//
// Se juegan rondas de verdad (4 jugadores por mesa, por las mesas reales) y se cuenta lo que factura Cloudflare:
// - filas escritas: cada clave de `put`/`delete`, cada `setAlarm`/`deleteAlarm` y las `rowsWritten` del SQL;
// - filas leídas: cada clave de `get` y las `rowsRead` del SQL;
// - peticiones a Durable Objects: cada RPC entre objetos, cada alarma, cada petición del cliente que llega a uno y los
//   mensajes WebSocket entrantes (20 por petición);
// - peticiones al Worker: las de la API que hace el cliente (las fichas: al apostar, al cobrar y al cambiar de ronda).
// - el póker se mide por mano, con 4 sentados y el reloj de la mesa avanzando en cada decisión (si no, todos los turnos
//   compartirían alarma y la mesa no escribiría la de cada uno); sentarse y levantarse se reparten entre las manos de una sesión.
// Con lo medido por ronda se extrapola la noche típica (spec §1): 8 jugadores 3 h, 4 en el blackjack (≈ 330 rondas) y
// 4 en la carrera (≈ 240 carreras) o en el póker (≈ 150 manos), y se imprimen las dos noches. Lo que se mide por ronda no
// puede pasar de su techo (`TECHO`).
// ---------------------------------------------------------------------------

const LIMITE = { escritas: 100_000, leidas: 5_000_000, peticiones: 100_000 } as const;
const NOCHE = { blackjack: 330, carrera: 240, poker: 150 } as const;
/** Las dos noches típicas: quien juega al póker deja de jugar a la carrera (spec §4.4). */
const NOCHES = { "blackjack + carrera": ["blackjack", "carrera"], "blackjack + póker": ["blackjack", "poker"] } as const;
type JuegoMedido = keyof typeof NOCHE;
/** La parte de cada límite diario que puede gastar una noche típica (spec §1). */
const OBJETIVO = 0.3;
/** Mensajes WebSocket entrantes que Cloudflare factura como una petición. */
const MENSAJES_POR_PETICION = 20;
const RONDAS_MEDIDAS = 3;

/**
 * Lo que puede gastar cada ronda medida (la media de las tres), como mucho. Las filas escritas del blackjack y la carrera son las de hoy: cinco por
 * cada cobro (apuesta, segunda casilla, seguro, dividir, doblar: la intención y la jugada en la mesa; la apuesta
 * pendiente, las fichas y su borrado en Jugadores), dos por jugador al liquidar (sus fichas y estadísticas, y su
 * resultado), la de la ronda liquidada, una por cada otra jugada que cambie la mesa y por cada alarma nueva, y una en la
 * sala por ronda (su ranking). Lo que trae el reloj sin decisiones (la banca, la ronda siguiente, los pasos de la carrera)
 * no escribe, y los resúmenes de las mesas viven en la memoria de la sala.
 *
 * En el póker la ronda es una mano. Sus filas escritas son dos por cada decisión (la jugada en la mesa y la alarma de su turno,
 * que vence en un instante distinto cada vez), una más si enseñas, dos al cerrar la mano (la alarma del `resultado` reparte la
 * siguiente) y, por sentarse y levantarse de los cuatro (el cobro en dos fases con sus alarmas, la liquidación, las fichas y el
 * ranking de la sala), unas 53 en total repartidas en 30 manos. Sus peticiones son la alarma del `resultado`, los dos avisos a la
 * sala de cada mano (empieza y acaba el `resultado`), las jugadas de los clientes (20 por petición) y la que hace la sala al
 * despertar. Las fichas solo se piden al sentarse y al levantarse.
 */
const TECHO = {
  blackjack: { escritas: 49, leidas: 38, peticionesDO: 25, peticionesWorker: 13 },
  carrera: { escritas: 47, leidas: 42, peticionesDO: 28, peticionesWorker: 14 },
  poker: { escritas: 25, leidas: 2, peticionesDO: 6, peticionesWorker: 1 },
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

const CAMPOS_DE_GASTO = ["escritas", "leidas", "peticionesDO", "peticionesWorker", "alarmas", "mensajes"] as const;
/** La suma de varios gastos, cada uno multiplicado por su factor. */
function mezclar(terminos: [Gasto, number][]): Gasto {
  const suma = gastoVacio();
  for (const [g, factor] of terminos) {
    for (const campo of CAMPOS_DE_GASTO) suma[campo] += factor * g[campo];
    for (const [objeto, n] of Object.entries(g.porObjeto)) suma.porObjeto[objeto] = (suma.porObjeto[objeto] ?? 0) + factor * n;
  }
  return suma;
}
/** Lo gastado entre dos fotos de la misma medición. */
const diferencia = (despues: Gasto, antes: Gasto): Gasto =>
  mezclar([
    [despues, 1],
    [antes, -1],
  ]);

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
  nuevaMesa(n: number, estado?: never): Promise<{ codigo: string; js: { id: number; token: string }[] }>;
  mesa(codigo: string): DurableObjectStub;
  sentarse(codigo: string, token: string): Promise<Conexion>;
}

/**
 * Prepara una mesa de 4 con la medición puesta. `estado` es el inicial de la mesa (sin él, el de `crear`); `listos` dice
 * cuándo ha visto cada conexión a los cuatro en la mesa (en el póker entrar no sienta, así que basta su primer mensaje).
 */
async function preparar<V>(ayudas: AyudasMesa, estado: unknown, semilla: number, listos: (vista: V) => boolean) {
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
  // Todos en la mesa: cada conexión ha visto a los cuatro.
  for (const j of jugadoresMesa) await hasta<EstadoMesa<V>>(j.conexion, (m) => listos(m.vista));

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
  /** Lo gastado hasta ahora, con las filas del SQL de los cursores ya recorridos. */
  const foto = (): Gasto => {
    const actual: Gasto = { ...gasto, porObjeto: { ...gasto.porObjeto }, rondas: [...gasto.rondas] };
    for (const [objeto, c] of cursores) {
      actual.escritas += c.rowsWritten;
      actual.leidas += c.rowsRead;
      actual.porObjeto[objeto] = (actual.porObjeto[objeto] ?? 0) + c.rowsWritten;
    }
    return actual;
  };
  const cerrar = async (): Promise<Gasto> => {
    const total = foto();
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
  /**
   * Adelanta el reloj de la mesa: en una noche de verdad cada turno empieza en un instante distinto y por eso cada turno
   * programa su alarma. Con el reloj quieto todos vencerían a la vez y la mesa no escribiría ninguna.
   */
  const avanzarReloj = (ms: number) =>
    runInDurableObject(mesa, (m) => {
      const i = porDentro(m);
      const antes = i.ahora();
      i.ahora = () => antes + ms;
    });
  /** Una copia del estado de la mesa, para que la prueba decida como lo haría quien juega. */
  const estadoDeLaMesa = <E>() => runInDurableObject(mesa, (m) => structuredClone(porDentro(m).estado) as unknown as E);
  const ronda = () => runInDurableObject(mesa, (m) => porDentro(m).estado.ronda);
  /** La ronda que enseña la mesa a su hora (puede ir por delante del estado guardado). */
  const rondaVisible = () => runInDurableObject(mesa, (m) => (porDentro(m).juego.vista(porDentro(m).estado, null, porDentro(m).ahora()) as { ronda: number }).ronda);
  return { codigo, js: jugadoresMesa, refrescar, mandar, alarma, avanzar, avanzarReloj, estadoDeLaMesa, finDeRonda, foto, cerrar, ronda, rondaVisible };
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
    (vista) => vista.sentados.length === 4,
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
  const m = await preparar<VistaCarrera>(ayudasMesa(env.MesaCarrera, "mesa-carrera") as unknown as AyudasMesa, carrera.crear(T, rngSemilla(5)), 13, (vista) => vista.sentados.length === 4);
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

type EstadoPk = EstadoMesa<VistaPoker>;

/** Fichas con las que se sienta cada uno: de sobra para el all-in de la mano especial. */
const COMPRA_POKER = 500;
/** Lo que tarda cada jugador en decidir. Hace que cada turno venza en un instante distinto, como en una noche de verdad. */
const PENSAR_MS = 2_000;
/** Manos que juega de media quien se sienta: sentarse y levantarse se reparten entre ellas (spec §4.4). */
const MANOS_POR_SESION = 30;
/** Al despertar, la sala pregunta su resumen a las tres mesas; como mucho una vez por mano, y una petición más a la del póker. */
const DESPERTARES_DE_SALA_POR_MANO = 1;

/** Lo que hace quien tiene la palabra: la calle, cuántas decisiones lleva ya esa calle y lo que permiten las reglas. */
type Guion = (calle: Calle, n: number, opciones: OpcionesPoker) => AccionPoker;
const pasarOIgualar = (o: OpcionesPoker): AccionPoker => (o.pasar ? { t: "pasar" } : o.igualar !== null ? { t: "igualar" } : { t: "retirarse" });
const subirAlMinimo = (o: OpcionesPoker): AccionPoker => (o.subir === null ? pasarOIgualar(o) : { t: "subir", hasta: o.subir.min });
const todasLasFichas = (o: OpcionesPoker): AccionPoker => (o.subir === null ? pasarOIgualar(o) : { t: "subir", hasta: o.subir.max });

/** Tres manos distintas de cuatro: una larga hasta el final, un all-in en el river que nadie sigue y una que acaba antes del flop. */
const MANOS_POKER: { nombre: string; guion: Guion; ensenaElAllIn?: boolean }[] = [
  {
    nombre: "hasta el final",
    guion: (calle, n, o) => {
      if (calle === "preflop") return n === 0 ? subirAlMinimo(o) : n === 1 ? pasarOIgualar(o) : { t: "retirarse" };
      return calle === "flop" && n === 1 ? subirAlMinimo(o) : pasarOIgualar(o);
    },
  },
  { nombre: "all-in en el river y enseñar", guion: (calle, n, o) => (calle !== "river" ? pasarOIgualar(o) : n === 0 ? todasLasFichas(o) : { t: "retirarse" }), ensenaElAllIn: true },
  { nombre: "sin flop", guion: (_calle, n, o) => (n === 0 ? subirAlMinimo(o) : { t: "retirarse" }) },
];

/**
 * Póker: los cuatro se sientan (cada uno refresca sus fichas al cobrar) y juegan tres manos de verdad, con el reloj
 * avanzando en cada decisión. Una lleva un all-in y enseñar. Al final se levantan (y refrescan sus fichas al cobrar). Lo
 * que cuesta sentarse y levantarse se reparte entre las manos de una sesión (`MANOS_POR_SESION`). Devuelve el gasto de
 * `RONDAS_MEDIDAS` manos, con ese reparto y los despertares de la sala.
 */
async function medirPoker(): Promise<Gasto> {
  const m = await preparar<VistaPoker>(ayudasMesa(env.MesaPoker, "mesa-poker") as unknown as AyudasMesa, undefined, 19, () => true);
  const [observador] = m.js;
  const vistos: EstadoPk[] = [];
  let version = 0;
  /** El siguiente mensaje de estado que ve el observador: el resultado del último cambio. Todos los eventos quedan en `vistos`. */
  const siguiente = async (): Promise<EstadoPk> => {
    const e = await hasta<EstadoPk>(observador.conexion, (x) => x.version > version, "estado", vistos);
    version = e.version;
    return e;
  };
  const actuar = async (j: Jugador, accion: AccionPoker) => {
    await m.avanzarReloj(PENSAR_MS);
    m.mandar(j, accion);
    return await siguiente();
  };
  const jugador = (id: number) => m.js.find((j) => j.id === id)!;
  /** Lo que vence en la mesa (el `resultado`, que da paso a la mano siguiente). */
  const vence = async () => {
    await m.alarma();
    return await siguiente();
  };

  // Se sientan: la mano empieza al sentarse el segundo, con los dos primeros. Esa mano de calentamiento acaba con una retirada
  // y la alarma de su `resultado` reparte la primera mano medida, ya con los cuatro.
  for (const j of m.js) {
    await actuar(j, { t: "sentarse", fichas: COMPRA_POKER });
    await m.refrescar(j);
  }
  let e = vistos.at(-1)!;
  expect(e.vista.fase).toBe("mano");
  e = await actuar(jugador(e.vista.turno!), { t: "retirarse" });
  expect(e.vista.fase).toBe("resultado");
  e = await vence();
  expect(e.vista.fase).toBe("mano");
  expect(e.vista.asientos.filter((a) => a.tieneCartas)).toHaveLength(4);
  const sentados = m.foto();

  const porMano: Gasto["rondas"] = [];
  const hubo = { allin: false, ensenar: false };
  for (const { nombre, guion, ensenaElAllIn } of MANOS_POKER) {
    const antes = m.foto();
    const desde = vistos.length;
    const decisiones = new Map<Calle, number>();
    const primeroEnCalle = new Map<Calle, number>();
    while (e.vista.fase === "mano") {
      const calle = e.vista.calle!;
      const n = decisiones.get(calle) ?? 0;
      decisiones.set(calle, n + 1);
      const quien = e.vista.turno!;
      if (n === 0) primeroEnCalle.set(calle, quien);
      const opciones = opcionesDe(await m.estadoDeLaMesa<EstadoPoker>(), quien)!;
      e = await actuar(jugador(quien), guion(calle, n, opciones));
    }
    expect(e.vista.fase, nombre).toBe("resultado");
    const eventos = () => vistos.slice(desde).flatMap((x) => x.eventos);
    if (ensenaElAllIn) {
      const id = primeroEnCalle.get("river")!;
      expect(eventos().filter((ev) => ev.tipo === "accion" && ev.accion === "allin" && ev.jugadorId === id), `${nombre}: el all-in`).toHaveLength(1);
      expect(eventos().filter((ev) => ev.tipo === "cartas_ensenadas"), `${nombre}: nadie ha enseñado aún`).toHaveLength(0);
      hubo.allin = true;
      e = await actuar(jugador(id), { t: "ensenar" });
      expect(e.eventos.filter((ev) => ev.tipo === "cartas_ensenadas" && ev.jugadorId === id), `${nombre}: enseñar`).toHaveLength(1);
      hubo.ensenar = true;
    }
    // La alarma del `resultado` cierra la mano y reparte la siguiente: es parte de lo que cuesta esta.
    e = await vence();
    expect(e.vista.fase, `${nombre}: la mano siguiente`).toBe("mano");
    const despues = m.foto();
    porMano.push({ escritas: despues.escritas - antes.escritas, peticionesDO: despues.peticionesDO + despues.mensajes / MENSAJES_POR_PETICION - antes.peticionesDO - antes.mensajes / MENSAJES_POR_PETICION });
  }
  expect(hubo, "la prueba juega un all-in y un enseñar").toEqual({ allin: true, ensenar: true });
  const jugadas = m.foto();

  // Se levantan en plena mano (la siguiente a las medidas), el caso más caro: cada uno se retira y cobra.
  for (const j of m.js) {
    await actuar(j, { t: "levantarse" });
    await m.refrescar(j);
  }
  const total = await m.cerrar();

  // Todo vuelve a su sitio: nada pendiente y las fichas de los cuatro suman lo que había.
  expect(await pendientesDe(m.codigo)).toBe(0);
  expect((await Promise.all(m.js.map((j) => fichas(j.id)))).reduce((suma, n) => suma + n, 0)).toBe(4 * 1000);

  const sesion = RONDAS_MEDIDAS / MANOS_POR_SESION;
  const gasto = mezclar([
    [diferencia(jugadas, sentados), 1],
    [sentados, sesion],
    [diferencia(total, jugadas), sesion],
  ]);
  gasto.peticionesDO += RONDAS_MEDIDAS * DESPERTARES_DE_SALA_POR_MANO;
  gasto.rondas = porMano;
  return gasto;
}

type Cantidad = Exclude<keyof Gasto, "porObjeto" | "rondas">;
const porRonda = (g: Gasto, campo: Cantidad) => g[campo] / RONDAS_MEDIDAS;
const pct = (valor: number, limite: number) => `${((100 * valor) / limite).toFixed(1)} %`;

const peticionesDO = (g: Gasto) => porRonda(g, "peticionesDO") + porRonda(g, "mensajes") / MENSAJES_POR_PETICION;

const UNIDAD: Record<JuegoMedido, string> = { blackjack: "rondas de blackjack", carrera: "carreras", poker: "manos de póker" };

it("una ronda de cada juego no pasa de su techo, y las dos noches típicas extrapoladas se imprimen", { timeout: 60_000 }, async () => {
  const medido: Record<JuegoMedido, Gasto> = { blackjack: await medirBlackjack(), carrera: await medirCarrera(), poker: await medirPoker() };
  /** Lo que gasta una noche con esos juegos, por cada límite. */
  const noche = (juegos: readonly JuegoMedido[]) => {
    const suma = (valor: (g: Gasto) => number) => juegos.reduce((total, juego) => total + valor(medido[juego]) * NOCHE[juego], 0);
    return {
      escritas: suma((g) => porRonda(g, "escritas")),
      leidas: suma((g) => porRonda(g, "leidas")),
      peticiones: suma(peticionesDO),
      peticionesWorker: suma((g) => porRonda(g, "peticionesWorker")),
    };
  };
  const noches = Object.entries(NOCHES).map(([nombre, juegos]) => ({ nombre, juegos, ...noche(juegos) }));
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
      `  ${fila(`póker (por mano; sentarse y levantarse, repartidos entre ${MANOS_POR_SESION} manos)`, medido.poker)}`,
      ...noches.flatMap((n) => [
        `Noche típica (${n.juegos.map((juego) => `${NOCHE[juego]} ${UNIDAD[juego]}`).join(" + ")}), objetivo ≤ ${OBJETIVO * 100} % de cada límite:`,
        `  filas escritas ${Math.round(n.escritas)} (${pct(n.escritas, LIMITE.escritas)} de ${LIMITE.escritas})`,
        `  filas leídas ${Math.round(n.leidas)} (${pct(n.leidas, LIMITE.leidas)} de ${LIMITE.leidas})`,
        `  peticiones a Durable Objects ${Math.round(n.peticiones)} (${pct(n.peticiones, LIMITE.peticiones)} de ${LIMITE.peticiones})`,
        `  peticiones al Worker ${Math.round(n.peticionesWorker)} (${pct(n.peticionesWorker, LIMITE.peticiones)} de ${LIMITE.peticiones})`,
      ]),
    ].join("\n"),
  );

  for (const juego of ["blackjack", "carrera", "poker"] as const) {
    const g = medido[juego];
    expect(porRonda(g, "escritas"), `${juego}: filas escritas por ronda`).toBeLessThanOrEqual(TECHO[juego].escritas);
    expect(porRonda(g, "leidas"), `${juego}: filas leídas por ronda`).toBeLessThanOrEqual(TECHO[juego].leidas);
    expect(peticionesDO(g), `${juego}: peticiones a Durable Objects por ronda`).toBeLessThanOrEqual(TECHO[juego].peticionesDO);
    expect(porRonda(g, "peticionesWorker"), `${juego}: peticiones al Worker por ronda`).toBeLessThanOrEqual(TECHO[juego].peticionesWorker);
  }
  for (const n of noches) {
    expect(n.escritas, `${n.nombre}: filas escritas`).toBeLessThanOrEqual(OBJETIVO * LIMITE.escritas);
    expect(n.leidas, `${n.nombre}: filas leídas`).toBeLessThanOrEqual(OBJETIVO * LIMITE.leidas);
    expect(n.peticiones, `${n.nombre}: peticiones a Durable Objects`).toBeLessThanOrEqual(OBJETIVO * LIMITE.peticiones);
    expect(n.peticionesWorker, `${n.nombre}: peticiones al Worker`).toBeLessThanOrEqual(OBJETIVO * LIMITE.peticiones);
  }
});
