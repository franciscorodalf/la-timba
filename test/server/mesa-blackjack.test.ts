import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PAUSA_SIN_FICHAS_MS } from "../../src/server/mesa-base";
import type { MensajeSala } from "../../src/shared/api";
import { crearBaraja } from "../../src/shared/cartas";
import { BJ, blackjack, type EstadoBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import {
  abrir,
  ayudasMesa,
  c,
  cerrarAbiertas,
  contiene,
  cs,
  ESPERA_MS,
  enviar,
  fichas,
  hasta as hastaMensaje,
  jugadores,
  pendientesDe,
  rngFijo,
  T,
  type Conexion,
  type EstadoMesa,
} from "../ayudas";

type Estado = EstadoMesa<VistaBJ>;

const {
  mesa,
  estadoMesa,
  guardado,
  alarmaDe,
  reloj,
  vencer,
  nuevaMesa: nuevaMesaCon,
  preparar,
  sentarse,
  vigilarEscrituras,
  avisosManuales,
  avisoProgramado,
  avisar,
} = ayudasMesa(env.MesaBlackjack, "mesa-blackjack");
const pendientesGuardados = async (codigo: string) => (await guardado(codigo))?.pendientes;
/** El cobro a medias que guarda la mesa mientras espera a Jugadores (`null` si no hay ninguno). */
const cobroGuardado = async (codigo: string) => (await guardado(codigo))?.cobro ?? null;

const ponerFichas = (jugadorId: number, cantidad: number) =>
  runInDurableObject(jugadores(), (_j, state) => {
    state.storage.sql.exec("UPDATE jugadores SET fichas = ? WHERE id = ?", cantidad, jugadorId);
  });

/** Recibe mensajes `t` hasta el primero que cumpla `cumple` (por defecto, estados de blackjack); los que llegan se añaden a `vistos`. */
const hasta = <M = Estado>(conexion: Conexion, cumple: (m: M) => boolean, t = "estado", vistos: M[] = []) =>
  hastaMensaje<M>(conexion, cumple, t, vistos);

const cerrada = (conexion: Conexion) => new Promise<CloseEvent>((resolver) => conexion.ws.addEventListener("close", resolver));

afterEach(() => {
  vi.restoreAllMocks();
  cerrarAbiertas();
});

/**
 * Registra `n` jugadores, abre una partida del primero y prepara su mesa; si se dan cartas, con un estado inicial cuyo
 * zapato empieza por ellas (`zapato[0]` es la siguiente) seguidas de relleno.
 */
const nuevaMesa = (n: number, cartas?: string) =>
  nuevaMesaCon(n, cartas === undefined ? undefined : { ...blackjack.crear(T, rngFijo(0.5)), zapato: [...cs(cartas), ...crearBaraja(2)] });

/** Espera (hasta `ESPERA_MS`) a que se cumpla una condición que depende de algo asíncrono en el servidor. */
async function esperar(condicion: () => boolean | Promise<boolean>, que: string): Promise<void> {
  const limite = Date.now() + ESPERA_MS;
  while (!(await condicion())) {
    if (Date.now() > limite) throw new Error(`Nunca se cumplió: ${que}`);
    await new Promise((resolver) => setTimeout(resolver, 10));
  }
}

/** Devuelve una función `(n)` que resuelve cuando la mesa ha terminado de atender `n` cierres de conexión. */
async function vigilarCierres(codigo: string): Promise<(n: number) => Promise<void>> {
  const atendidos: Promise<unknown>[] = [];
  await runInDurableObject(mesa(codigo), (m) => {
    const original = m.onClose.bind(m);
    m.onClose = (...argumentos: Parameters<typeof original>) => {
      const hecho = Promise.resolve(original(...argumentos));
      atendidos.push(hecho);
      return hecho;
    };
  });
  return async (n) => {
    await esperar(() => atendidos.length >= n, `${n} cierres atendidos`);
    await Promise.all(atendidos);
  };
}

type ConEnv = { env: typeof env };

/**
 * Cambia bindings del `env` de esta mesa y devuelve `arreglar()`. Se sustituye el objeto `env` de la instancia, sin
 * tocar el original: lo comparten el Worker, las demás instancias y las pruebas.
 */
async function cambiarEnv(codigo: string, cambios: (real: typeof env) => Record<string, unknown>) {
  const real = await runInDurableObject(mesa(codigo), (m) => {
    const instancia = m as unknown as ConEnv;
    const original = instancia.env;
    instancia.env = Object.assign(Object.create(original), cambios(original));
    return original;
  });
  return () =>
    runInDurableObject(mesa(codigo), (m) => {
      (m as unknown as ConEnv).env = real;
    });
}

type StubJugadores = ReturnType<typeof jugadores>;

/**
 * Cambia, solo para esta mesa, `apostar`, `anular` y/o `liquidar` de Jugadores por lo que devuelva `cambios(stub)` (el
 * stub real, para poder delegar en él); lo demás va al de verdad. Devuelve `arreglar()`.
 */
const cambiarJugadores = (
  codigo: string,
  cambios: (stub: StubJugadores) => {
    apostar?: (...a: Parameters<StubJugadores["apostar"]>) => Promise<unknown>;
    anular?: (...a: Parameters<StubJugadores["anular"]>) => Promise<unknown>;
    liquidar?: (...a: Parameters<StubJugadores["liquidar"]>) => Promise<unknown>;
  },
) =>
  cambiarEnv(codigo, (real) => ({
    Jugadores: {
      idFromName: (nombre: string) => real.Jugadores.idFromName(nombre),
      get: (id: DurableObjectId) => {
        const stub = real.Jugadores.get(id);
        return {
          apostar: (...a: Parameters<StubJugadores["apostar"]>) => stub.apostar(...a),
          anular: (...a: Parameters<StubJugadores["anular"]>) => stub.anular(...a),
          liquidar: (...a: Parameters<StubJugadores["liquidar"]>) => stub.liquidar(...a),
          ...cambios(stub),
        };
      },
    },
  }));

const caido = async (): Promise<never> => {
  throw new Error("Jugadores caído");
};

/** `apostar` que cobra de verdad pero cuya respuesta no llega a la mesa. */
const cobraYFalla =
  (stub: StubJugadores) =>
  async (...a: Parameters<StubJugadores["apostar"]>): Promise<never> => {
    await stub.apostar(...a);
    throw new Error("se perdió la respuesta");
  };

/**
 * Deja en la mesa un cobro a medias, como si la instancia hubiera caído tras cobrar en Jugadores y antes de guardar la
 * jugada: cobro hecho en Jugadores, intención guardada en "cobro" y la mesa fuera de memoria (reloj de vuelta en `T`).
 */
async function dejarCobroAMedias(codigo: string, jugadorId: number, cantidad: number): Promise<void> {
  const cobro = { cobroId: crypto.randomUUID(), jugadorId, cantidad, rondaId: `${codigo}:blackjack:1` };
  expect(await jugadores().apostar(jugadorId, cantidad, cobro.rondaId, cobro.cobroId)).toBe("ok");
  const registro = await guardado(codigo);
  await runInDurableObject(mesa(codigo), (_m, state) => state.storage.put("mesa", { ...registro, cobro }));
  await evictDurableObject(mesa(codigo));
  await reloj(codigo, T);
}

describe("MesaBlackjack: rondas y fichas", () => {
  it("ronda completa: apostar 50 → repartir → plantarse → banca → fichas = 1000 - 50 + pago", async () => {
    // ana 10♠ 8♥ = 18; banca 9♣ y 7♦ tapada = 16, pide K♠ y se pasa: ana cobra 100.
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "10S 9C 8H 7D KS");
    const conexion = await sentarse(codigo, ana.token);
    const inicial: Estado = await conexion.recibir();
    // `ahora` es la hora del reloj de la mesa (aquí fijo en T): con ella los clientes calculan las cuentas atrás.
    expect(inicial).toMatchObject({
      t: "estado",
      ahora: T,
      eventos: [],
      vista: { ronda: 1, fase: "apuestas", finFase: T + BJ.APUESTAS_MS, manos: [], sentados: [ana.apodo], yo: ana.id },
    });

    enviar(conexion, { t: "apostar", cantidad: 50 });
    const apostado: Estado = await conexion.recibir();
    expect(apostado.version).toBe(inicial.version + 1);
    expect(apostado.vista.manos).toEqual([
      { jugadorId: ana.id, apodo: ana.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: [], estado: "jugando", doblada: false, dividida: false, total: 0 },
    ]);
    expect(await fichas(ana.id)).toBe(950);
    expect(await pendientesDe(codigo)).toBe(1);

    await vencer(codigo); // se cierran las apuestas: reparto
    const repartido: Estado = await conexion.recibir();
    expect(repartido.vista).toMatchObject({ fase: "decisiones", banca: [c("9C"), null], totalBanca: 9 });
    expect(repartido.vista.manos[0]).toMatchObject({ cartas: cs("10S 8H"), total: 18, estado: "jugando" });
    expect(repartido.eventos).toEqual([
      { tipo: "carta_repartida", a: ana.id, mano: 0, oculta: false, carta: c("10S") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("9C") },
      { tipo: "carta_repartida", a: ana.id, mano: 0, oculta: false, carta: c("8H") },
      { tipo: "carta_repartida", a: "banca", oculta: true },
    ]);

    enviar(conexion, { t: "plantarse" });
    expect(((await conexion.recibir()) as Estado).vista.fase).toBe("banca");

    await vencer(codigo); // la banca juega y se liquida
    const resultado: Estado = await conexion.recibir();
    expect(resultado.vista).toMatchObject({ fase: "resultado", banca: cs("9C 7D KS"), totalBanca: 26 });
    expect(resultado.eventos).toEqual([
      { tipo: "carta_girada", carta: c("7D") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("KS") },
      { tipo: "pago", jugadorId: ana.id, neto: 50 },
    ]);
    expect(await fichas(ana.id)).toBe(1000 - 50 + 100);
    expect(await pendientesDe(codigo)).toBe(0);

    await vencer(codigo); // otra ronda
    expect(((await conexion.recibir()) as Estado).vista).toMatchObject({ ronda: 2, fase: "apuestas", banca: [], manos: [] });
  });

  it("doblar cobra la apuesta original (no el doble) y paga sobre la apuesta doblada", async () => {
    // ana 5♠ 6♥ = 11, dobla y recibe K♥ = 21; banca 9♣ 7♦ = 16, pide 2♣ = 18.
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "5S 9C 6H 7D KH 2C");
    const conexion = await sentarse(codigo, ana.token);
    enviar(conexion, { t: "apostar", cantidad: 50 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    await vencer(codigo);
    await hasta(conexion, (m) => m.vista.fase === "decisiones");

    enviar(conexion, { t: "doblar" });
    const doblado: Estado = await conexion.recibir();
    expect(doblado.vista.manos[0]).toMatchObject({ apuesta: 100, doblada: true, cartas: cs("5S 6H KH"), total: 21 });
    expect(await fichas(ana.id)).toBe(1000 - 50 - 50);

    await vencer(codigo);
    expect((await hasta(conexion, (m) => m.vista.fase === "resultado")).eventos).toContainEqual({ tipo: "pago", jugadorId: ana.id, neto: 100 });
    expect(await fichas(ana.id)).toBe(1000 - 100 + 200);
  });

  it("salir con la apuesta en juego la pierde; si era el último, la mesa se duerme sin alarma", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    enviar(conexion, { t: "apostar", cantidad: 50 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    expect(await alarmaDe(codigo)).toBe(T + BJ.APUESTAS_MS);

    enviar(conexion, { t: "salir" });
    const salida: Estado = await conexion.recibir();
    expect(salida.vista).toMatchObject({ fase: "esperando", finFase: null, sentados: [], manos: [] });
    expect(salida.eventos).toContainEqual({ tipo: "pago", jugadorId: ana.id, neto: -50 });
    expect(await fichas(ana.id)).toBe(950);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await alarmaDe(codigo)).toBeNull();
  });

  it("apostar más fichas de las que tienes → sin_fichas y no cambia nada", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    await ponerFichas(ana.id, 30);
    const conexion = await sentarse(codigo, ana.token);
    const inicial: Estado = await conexion.recibir();
    const antes = await estadoMesa(codigo);

    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "sin_fichas" });
    expect(await fichas(ana.id)).toBe(30);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await estadoMesa(codigo)).toEqual(antes);

    // Pasada la pausa tras el sin_fichas, lo que sí tiene, sí puede apostarlo; y la versión no avanzó con el intento fallido.
    await reloj(codigo, T + PAUSA_SIN_FICHAS_MS);
    enviar(conexion, { t: "apostar", cantidad: 30 });
    const apostado: Estado = await conexion.recibir();
    expect(apostado.version).toBe(inicial.version + 1);
    expect(apostado.vista.manos).toMatchObject([{ jugadorId: ana.id, apuesta: 30 }]);
    expect(await fichas(ana.id)).toBe(0);
  });

  it("dos pestañas del mismo jugador: un asiento, misma vista, una acción aplicada una vez; cerrar una no planta", async () => {
    // ana 10♠ 2♥ = 12 (pide 5♣ → 17); banca 9♣ 7♦.
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "10S 9C 2H 7D 5C");
    const cierres = await vigilarCierres(codigo);
    const pestana1 = await sentarse(codigo, ana.token);
    const pestana2 = await sentarse(codigo, ana.token);
    const entrada1: Estado = await pestana1.recibir();
    expect(entrada1.vista.sentados).toEqual([ana.apodo]);
    expect(await pestana2.recibir()).toEqual(entrada1);
    expect((await estadoMesa(codigo)).asientos).toHaveLength(1);

    enviar(pestana1, { t: "apostar", cantidad: 50 });
    const apostado: Estado = await pestana1.recibir();
    expect(apostado.vista.manos).toHaveLength(1);
    expect(await pestana2.recibir()).toEqual(apostado);
    enviar(pestana2, { t: "apostar", cantidad: 50 }); // la misma apuesta desde la otra pestaña no se cobra otra vez
    expect(await pestana2.recibir()).toEqual({ t: "error", codigo: "accion_invalida" });
    expect(await fichas(ana.id)).toBe(950);

    await vencer(codigo);
    const repartido: Estado = await pestana1.recibir();
    expect(repartido.vista.manos[0]).toMatchObject({ cartas: cs("10S 2H"), estado: "jugando" });
    expect(await pestana2.recibir()).toEqual(repartido);

    pestana1.cerrar();
    await cierres(1);
    const tras = await estadoMesa(codigo);
    expect(tras.asientos).toEqual([{ jugadorId: ana.id, apodo: ana.apodo, conectado: true }]);
    expect(tras.manos[0].estado).toBe("jugando");
    enviar(pestana2, { t: "pedir" });
    expect(((await pestana2.recibir()) as Estado).vista.manos[0]).toMatchObject({ cartas: cs("10S 2H 5C"), total: 17, estado: "jugando" });

    // Al cerrar la última pestaña, sí: queda desconectado y plantado.
    pestana2.cerrar();
    await cierres(2);
    const fin = await estadoMesa(codigo);
    expect(fin.asientos[0].conectado).toBe(false);
    expect(fin.manos[0].estado).toBe("plantado");
  });

  it("entrar con la ronda empezada: vista sin mano propia; apuesta en la ronda siguiente", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 9C 8H 7D KS");
    const conexionA = await sentarse(codigo, ana.token);
    await conexionA.recibir();
    enviar(conexionA, { t: "apostar", cantidad: 50 });
    await conexionA.recibir();
    await vencer(codigo);
    expect(((await conexionA.recibir()) as Estado).vista.fase).toBe("decisiones");

    const conexionB = await sentarse(codigo, beto.token);
    const entrada: Estado = await conexionB.recibir();
    expect(entrada).toMatchObject({ t: "estado", eventos: [], vista: { fase: "decisiones", sentados: [ana.apodo, beto.apodo], yo: beto.id } });
    expect(entrada.vista.manos.map((m) => m.jugadorId)).toEqual([ana.id]);
    expect(((await conexionA.recibir()) as Estado).vista.sentados).toEqual([ana.apodo, beto.apodo]);

    enviar(conexionB, { t: "apostar", cantidad: 50 });
    expect(await conexionB.recibir()).toEqual({ t: "error", codigo: "fase_incorrecta" });
    expect(await fichas(beto.id)).toBe(1000);

    enviar(conexionA, { t: "plantarse" });
    await hasta(conexionA, (m) => m.vista.fase === "banca");
    await vencer(codigo); // la banca ya jugó al plantarse: vence el resultado y empieza la ronda nueva
    const nueva = await hasta(conexionB, (m) => m.vista.ronda === 2);
    expect(nueva.vista).toMatchObject({ fase: "apuestas", manos: [], sentados: [ana.apodo, beto.apodo] });

    enviar(conexionB, { t: "apostar", cantidad: 20 });
    expect(((await conexionB.recibir()) as Estado).vista.manos).toMatchObject([{ jugadorId: beto.id, apuesta: 20, cartas: [] }]);
    expect(await fichas(beto.id)).toBe(980);
  });

  it("todos se van a mitad de ronda: se liquida (sin apuestas_pendientes) y no queda alarma", async () => {
    // ana 10♠ 8♠ = 18, beto 10♥ 9♥ = 19; banca 9♣ 7♦ = 16, pide K♠ y se pasa.
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 10H 9C 8S 9H 7D KS");
    const cierres = await vigilarCierres(codigo);
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    enviar(conexionA, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 1);
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    await hasta(conexionA, (m) => m.vista.manos.length === 2);
    await vencer(codigo);
    await hasta(conexionA, (m) => m.vista.fase === "decisiones");
    expect(await pendientesDe(codigo)).toBe(2);

    conexionA.cerrar();
    conexionB.cerrar();
    await cierres(2);

    // Sin nadie, la ronda acaba sola con las alarmas que le queden (como mucho 3).
    for (let i = 0; i < 3 && (await alarmaDe(codigo)) !== null; i++) await vencer(codigo);
    expect(await alarmaDe(codigo)).toBeNull();
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await estadoMesa(codigo)).toMatchObject({ fase: "esperando", finFase: null, asientos: [], manos: [] });
    expect(await fichas(ana.id)).toBe(1050);
    expect(await fichas(beto.id)).toBe(1050);
  });

  it("reconexión a mitad de decisiones recibe la vista completa con su mano", async () => {
    // ana 10♠ 2♠ = 12, beto 10♥ 9♥ = 19; banca 9♣ 7♦.
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 10H 9C 2S 9H 7D");
    const cierres = await vigilarCierres(codigo);
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    enviar(conexionA, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 1);
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 2);
    await vencer(codigo);
    await hasta(conexionB, (m) => m.vista.fase === "decisiones");

    conexionA.cerrar(); // la desconexión la planta; beto sigue decidiendo
    await cierres(1);

    const vuelta = await sentarse(codigo, ana.token);
    const entrada: Estado = await vuelta.recibir();
    expect(entrada).toMatchObject({
      t: "estado",
      eventos: [],
      vista: { ronda: 1, fase: "decisiones", banca: [c("9C"), null], totalBanca: 9, sentados: [ana.apodo, beto.apodo], yo: ana.id },
    });
    expect(entrada.vista.manos).toEqual([
      { jugadorId: ana.id, apodo: ana.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: cs("10S 2S"), estado: "plantado", doblada: false, dividida: false, total: 12 },
      { jugadorId: beto.id, apodo: beto.apodo, casilla: 1, indice: 0, apuesta: 50, cartas: cs("10H 9H"), estado: "jugando", doblada: false, dividida: false, total: 19 },
    ]);
    expect((await estadoMesa(codigo)).asientos.find((a) => a.jugadorId === ana.id)?.conectado).toBe(true);
  });

  it("la vista enviada a otro jugador no contiene la carta tapada", async () => {
    // ana 10♠ 8♠, beto 10♥ 9♥; banca 9♣ y la tapada Q♠ (la única Q♠ repartida).
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 10H 9C 8S 9H QS");
    const tapada = c("QS");
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    enviar(conexionA, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 1);
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    await hasta(conexionA, (m) => m.vista.manos.length === 2);
    await hasta(conexionB, (m) => m.vista.manos.length === 2);
    await vencer(codigo);

    const vistos: Estado[] = [];
    for (const conexion of [conexionA, conexionB]) {
      const repartido = await hasta(conexion, (m) => m.vista.fase === "decisiones", "estado", vistos);
      expect(repartido.vista.banca).toEqual([c("9C"), null]);
      expect(repartido.vista.totalBanca).toBe(9);
      expect(repartido.eventos).toContainEqual({ tipo: "carta_repartida", a: "banca", oculta: true });
    }
    enviar(conexionA, { t: "plantarse" });
    enviar(conexionB, { t: "plantarse" });
    for (const conexion of [conexionA, conexionB]) await hasta(conexion, (m) => m.vista.fase === "banca", "estado", vistos);
    for (const mensaje of vistos) expect(contiene(mensaje, tapada)).toBe(false);

    // Al girarla, llega a todos (y la comprobación de arriba sí la habría encontrado).
    await vencer(codigo);
    for (const conexion of [conexionA, conexionB]) {
      const girada = await hasta(conexion, (m) => m.vista.fase === "resultado");
      expect(girada.eventos[0]).toEqual({ tipo: "carta_girada", carta: tapada });
      expect(contiene(girada.vista, tapada)).toBe(true);
    }
  });

  it("estado sobrevive a evictDurableObject a mitad de ronda", async () => {
    // ana 10♠ 2♥ = 12, pide 5♣ = 17; banca 9♣ 7♦ = 16, pide K♠ y se pasa.
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "10S 9C 2H 7D 5C KS");
    const conexion = await sentarse(codigo, ana.token);
    enviar(conexion, { t: "apostar", cantidad: 50 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    await vencer(codigo);
    const repartido = await hasta(conexion, (m) => m.vista.fase === "decisiones");
    const alarma = await alarmaDe(codigo);
    expect(alarma).toBe(T + BJ.APUESTAS_MS + BJ.DECISIONES_MS);

    await evictDurableObject(mesa(codigo));
    await reloj(codigo, T + BJ.APUESTAS_MS);

    enviar(conexion, { t: "pedir" });
    const pedido: Estado = await conexion.recibir();
    expect(pedido.vista).toMatchObject({ ronda: 1, fase: "decisiones", banca: [c("9C"), null] });
    expect(pedido.vista.manos).toMatchObject([{ jugadorId: ana.id, apuesta: 50, cartas: cs("10S 2H 5C"), total: 17, estado: "jugando" }]);
    expect(await alarmaDe(codigo)).toBe(alarma);

    enviar(conexion, { t: "plantarse" });
    await hasta(conexion, (m) => m.vista.fase === "banca");
    await vencer(codigo);
    expect((await hasta(conexion, (m) => m.vista.fase === "resultado")).vista.totalBanca).toBe(26);
    expect(await fichas(ana.id)).toBe(1050);
    expect(await pendientesDe(codigo)).toBe(0);
  });

  it("una apuesta que llega con la ventana ya vencida (alarma retrasada) no entra: primero se reparte", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 9C 8H 7D");
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    enviar(conexionA, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 1);

    await reloj(codigo, T + BJ.APUESTAS_MS); // la ventana ha vencido pero su alarma aún no ha saltado
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    const repartido: Estado = await conexionB.recibir();
    expect(repartido.vista.fase).toBe("decisiones");
    expect(repartido.vista.manos.map((m) => m.jugadorId)).toEqual([ana.id]);
    expect(await conexionB.recibir()).toEqual({ t: "error", codigo: "fase_incorrecta" });
    expect(await fichas(beto.id)).toBe(1000);
    expect(await alarmaDe(codigo)).toBe(T + BJ.APUESTAS_MS + BJ.DECISIONES_MS);
  });

  it("mesa dormida tras 3 ventanas vacías: apostar la despierta y se cobra", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    for (let i = 0; i < 3; i++) await vencer(codigo);
    const dormida = await hasta(conexion, (m) => m.vista.fase === "esperando");
    expect(dormida.vista.sentados).toEqual([ana.apodo]);
    expect(await alarmaDe(codigo)).toBeNull();

    enviar(conexion, { t: "apostar", cantidad: 50 });
    const despierta: Estado = await conexion.recibir();
    const ahora = T + 3 * BJ.APUESTAS_MS;
    expect(despierta.ahora).toBe(ahora); // el reloj de la mesa ya avanzó: cada estado lleva su hora, no la de la conexión
    expect(despierta.vista).toMatchObject({ fase: "apuestas", finFase: ahora + BJ.APUESTAS_MS, manos: [{ jugadorId: ana.id, apuesta: 50 }] });
    expect(await fichas(ana.id)).toBe(950);
    expect(await alarmaDe(codigo)).toBe(ahora + BJ.APUESTAS_MS);
  });
});

describe("MesaBlackjack: conexiones y mensajes", () => {
  it("séptimo jugador → error mesa_llena y cierre 4003", async () => {
    const { codigo, js } = await nuevaMesa(7);
    for (const j of js.slice(0, 6)) await (await sentarse(codigo, j.token)).recibir("estado");

    const septimo = await sentarse(codigo, js[6].token);
    const cierre = cerrada(septimo);
    expect(await septimo.recibir()).toEqual({ t: "error", codigo: "mesa_llena" });
    expect((await cierre).code).toBe(4003);
    expect((await estadoMesa(codigo)).asientos.map((a) => a.jugadorId)).toEqual(js.slice(0, 6).map((j) => j.id));
  });

  it("21 mensajes en un segundo → el 21º recibe demasiados_mensajes", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();

    // En apuestas no se puede pedir: cada uno de los 20 primeros tiene su error. El 21º se descarta sin aplicarse.
    for (let i = 0; i < 20; i++) enviar(conexion, { t: "pedir" });
    enviar(conexion, { t: "apostar", cantidad: 50 });
    const respuestas = [];
    for (let i = 0; i < 21; i++) respuestas.push(await conexion.recibir());
    expect(respuestas.slice(0, 20)).toEqual(Array(20).fill({ t: "error", codigo: "fase_incorrecta" }));
    expect(respuestas[20]).toEqual({ t: "error", codigo: "demasiados_mensajes" });
    expect(await fichas(ana.id)).toBe(1000);
    expect((await estadoMesa(codigo)).manos).toEqual([]);
    expect(conexion.ws.readyState).toBe(WebSocket.OPEN);

    // Al segundo siguiente vuelve a atender.
    await reloj(codigo, T + 1000);
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(((await conexion.recibir()) as Estado).vista.manos).toHaveLength(1);
  });

  it("más de 60 mensajes en un segundo → cierre 4008", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    const cierre = cerrada(conexion);
    for (let i = 0; i < 61; i++) enviar(conexion, { t: "pedir" });
    expect((await cierre).code).toBe(4008);
  });

  it("un mensaje que no es JSON, o sin `t` de texto, recibe mensaje_invalido", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    const malos = ["hola", "{", "42", "null", '"apostar"', JSON.stringify({ cantidad: 50 }), JSON.stringify({ t: 7 }), JSON.stringify([{ t: "pedir" }])];
    for (const crudo of malos) {
      conexion.ws.send(crudo);
      expect(await conexion.recibir(), crudo).toEqual({ t: "error", codigo: "mensaje_invalido" });
    }
    conexion.ws.send(new Uint8Array([1, 2, 3]));
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "mensaje_invalido" });
    enviar(conexion, { t: "trampa" });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "mensaje_invalido" });
  });

  it("una conexión que llega a la mesa sin las cabeceras de confianza se cierra con 4401 y no se sienta", async () => {
    const { codigo } = await nuevaMesa(1);
    const res = await mesa(codigo).fetch(`http://x/parties/mesa-blackjack/${codigo}`, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket!;
    const cierre = new Promise<CloseEvent>((resolver) => ws.addEventListener("close", resolver));
    ws.accept();
    expect((await cierre).code).toBe(4401);
    expect((await estadoMesa(codigo)).asientos).toEqual([]);
  });
});

describe("MesaBlackjack: Jugadores y la sala", () => {
  it("la sala recibe el resumen de la mesa y el ranking de la noche tras liquidar", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "10S 9C 8H 7D KS");
    const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
    expect(((await sala.recibir("sala")) as MensajeSala).rankingNoche).toEqual([]);

    const conexion = await sentarse(codigo, ana.token);
    const sentada = await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.jugadores.length === 1, "sala");
    expect(sentada.mesas.blackjack).toEqual({ jugadores: [ana.apodo], fase: "apuestas", finFase: T + BJ.APUESTAS_MS });

    enviar(conexion, { t: "apostar", cantidad: 50 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    await vencer(codigo);
    await avisosManuales(codigo);
    const decisiones = await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.fase === "decisiones", "sala");
    expect(decisiones.mesas.blackjack).toEqual({ jugadores: [ana.apodo], fase: "decisiones", finFase: T + BJ.APUESTAS_MS + BJ.DECISIONES_MS });
    enviar(conexion, { t: "plantarse" });
    await hasta(conexion, (m) => m.vista.fase === "banca");

    // La banca dura un instante y la sala no se entera: lo siguiente que recibe es el resultado, cuando se ve (y se paga).
    const revela = await avisar(codigo);
    expect(revela).toBe(T + BJ.APUESTAS_MS + BJ.BANCA_MS);
    const liquidada: MensajeSala = await sala.recibir("sala");
    expect(liquidada.mesas.blackjack).toEqual({ jugadores: [ana.apodo], fase: "resultado", finFase: revela + BJ.RESULTADO_MS });
    expect(liquidada.rankingNoche).toEqual([{ apodo: ana.apodo, neto: 50 }]);
    await avisar(codigo);
    const nueva = await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.fase === "apuestas", "sala");
    expect(nueva.mesas.blackjack).toEqual({ jugadores: [ana.apodo], fase: "apuestas", finFase: revela + BJ.RESULTADO_MS + BJ.APUESTAS_MS });
  });

  it("si la sala sale de memoria, no se queda con un resumen falso: se lo pregunta a la mesa (también en la banca)", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "10S 9C 8H 7D KS");
    const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
    const conexion = await sentarse(codigo, ana.token);
    const apuestas = await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.jugadores.length === 1, "sala");

    // La mesa ya avisó de su resumen y no lo repetirá; la sala lo pierde, y la mesa tampoco está en memoria.
    await evictDurableObject(env.Partida.get(env.Partida.idFromName(codigo)));
    await evictDurableObject(mesa(codigo));
    await reloj(codigo, T);
    const escrituras = await vigilarEscrituras(codigo);
    const otra = await abrir(`/parties/partida/${codigo}`, ana.token);
    expect(((await otra.recibir("sala")) as MensajeSala).mesas.blackjack).toEqual(apuestas.mesas.blackjack);
    expect(escrituras).toEqual([]); // la mesa contesta leyendo su registro, sin arrancar ni escribir

    // En la banca no hay resumen nuevo: la mesa contesta con el último que mandó (el de las decisiones).
    enviar(conexion, { t: "apostar", cantidad: 50 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    await vencer(codigo);
    const decisiones = await hasta<MensajeSala>(otra, (m) => m.mesas.blackjack.fase === "decisiones", "sala");
    await avisosManuales(codigo);
    enviar(conexion, { t: "plantarse" });
    await hasta(conexion, (m) => m.vista.fase === "banca");
    await evictDurableObject(env.Partida.get(env.Partida.idFromName(codigo)));
    const tercera = await abrir(`/parties/partida/${codigo}`, ana.token);
    expect(((await tercera.recibir("sala")) as MensajeSala).mesas.blackjack).toEqual(decisiones.mesas.blackjack);

    // Y cuando se ve el resultado, la mesa avisa como siempre.
    await avisar(codigo);
    expect(((await hasta<MensajeSala>(tercera, (m) => m.mesas.blackjack.fase === "resultado", "sala")) as MensajeSala).rankingNoche).toEqual([
      { apodo: ana.apodo, neto: 50 },
    ]);
  });

  it("los cambios se atienden de uno en uno aunque Jugadores tarde: ni se cobra dos veces ni se pisan", async () => {
    const {
      codigo,
      js: [ana, beto, carla],
    } = await nuevaMesa(3);
    const cierres = await vigilarCierres(codigo);
    const pestana1 = await sentarse(codigo, ana.token);
    const pestana2 = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    const conexionC = await sentarse(codigo, carla.token);
    // Jugadores lento: mientras cobra la primera apuesta llegan las otras dos y el cierre de carla.
    const arreglar = await cambiarJugadores(codigo, (stub) => ({
      apostar: async (...a: Parameters<StubJugadores["apostar"]>) => {
        await new Promise((resolver) => setTimeout(resolver, 50));
        return stub.apostar(...a);
      },
    }));

    enviar(pestana1, { t: "apostar", cantidad: 50 });
    enviar(pestana2, { t: "apostar", cantidad: 50 });
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    conexionC.cerrar();
    expect(await Promise.any([pestana1.recibir("error"), pestana2.recibir("error")])).toEqual({ t: "error", codigo: "accion_invalida" });
    await cierres(1);
    const final = await estadoMesa(codigo);
    expect(final.manos.map((m) => m.jugadorId).sort()).toEqual([ana.id, beto.id].sort());
    expect(final.asientos.find((a) => a.jugadorId === carla.id)?.conectado).toBe(false);
    expect(await fichas(ana.id)).toBe(950);
    expect(await fichas(beto.id)).toBe(950);
    expect(await pendientesDe(codigo)).toBe(2);
    await arreglar();
  });

  it("si Jugadores falla al cobrar, la acción se descarta con no_disponible", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const arreglar = await cambiarJugadores(codigo, () => ({ apostar: caido }));

    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    expect((await estadoMesa(codigo)).manos).toEqual([]);
    expect(await fichas(ana.id)).toBe(1000);
    expect(log).toHaveBeenCalled();

    await arreglar();
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(((await conexion.recibir()) as Estado).vista.manos).toHaveLength(1);
    expect(await fichas(ana.id)).toBe(950);
  });

  it("una liquidación que falla se guarda en pendientes y se reintenta en el siguiente cambio", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "10S 9C 8H 7D KS");
    const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
    const conexion = await sentarse(codigo, ana.token);
    enviar(conexion, { t: "apostar", cantidad: 50 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    await vencer(codigo);
    await avisosManuales(codigo);
    enviar(conexion, { t: "plantarse" });
    await hasta(conexion, (m) => m.vista.fase === "banca");
    // La ronda ya está guardada para pagarla, pero no se paga hasta que se vea.
    expect(await pendientesGuardados(codigo)).toHaveLength(1);
    expect(await fichas(ana.id)).toBe(950);

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let intentos = 0;
    const arreglar = await cambiarJugadores(codigo, () => ({
      liquidar: () => {
        intentos++;
        return caido();
      },
    }));
    await avisar(codigo); // se ve la jugada de la banca; la liquidación falla
    expect((await hasta(conexion, (m) => m.vista.fase === "resultado")).eventos).toContainEqual({ tipo: "pago", jugadorId: ana.id, neto: 50 });
    expect(intentos).toBe(3);
    expect(log).toHaveBeenCalled();
    expect(await fichas(ana.id)).toBe(950);
    expect(await pendientesDe(codigo)).toBe(1);
    expect(await pendientesGuardados(codigo)).toHaveLength(1);
    // Sin pago no hay nada nuevo en el ranking de la noche.
    expect((await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.fase === "resultado", "sala")).rankingNoche).toEqual([]);

    await arreglar();
    await vencer(codigo); // ronda nueva: se reintenta
    await hasta(conexion, (m) => m.vista.ronda === 2);
    expect(await fichas(ana.id)).toBe(1050);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await pendientesGuardados(codigo)).toEqual([]);
    // El pago tardío sí refresca el ranking de la sala.
    const refrescada = await hasta<MensajeSala>(sala, (m) => m.rankingNoche.length > 0, "sala");
    expect(refrescada.mesas.blackjack.fase).toBe("apuestas");
    expect(refrescada.rankingNoche).toEqual([{ apodo: ana.apodo, neto: 50 }]);
  });

  it("si el último se va y la liquidación falla, la mesa dormida programa un reintento y después no deja alarma", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
    const conexion = await sentarse(codigo, ana.token);
    enviar(conexion, { t: "apostar", cantidad: 50 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);

    vi.spyOn(console, "error").mockImplementation(() => {});
    const arreglar = await cambiarJugadores(codigo, () => ({ liquidar: caido }));
    enviar(conexion, { t: "salir" }); // pierde la apuesta; la mesa se queda vacía y se duerme
    expect(((await conexion.recibir()) as Estado).vista).toMatchObject({ fase: "esperando", finFase: null, sentados: [] });
    expect(await pendientesDe(codigo)).toBe(1);
    expect(await alarmaDe(codigo)).not.toBeNull();

    await arreglar();
    expect(await runDurableObjectAlarm(mesa(codigo))).toBe(true);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await pendientesGuardados(codigo)).toEqual([]);
    expect(await alarmaDe(codigo)).toBeNull();
    expect(await fichas(ana.id)).toBe(950);
    // La alarma que pagó avisa a la sala para que refresque el ranking.
    expect((await hasta<MensajeSala>(sala, (m) => m.rankingNoche.length > 0, "sala")).rankingNoche).toEqual([{ apodo: ana.apodo, neto: -50 }]);
  });

  it("si la sala no responde, la mesa sigue funcionando", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const arreglar = await cambiarEnv(codigo, () => ({
      Partida: {
        idFromName: () => "sala",
        get: () => ({
          actualizarMesa: async () => {
            throw new Error("sala caída");
          },
        }),
      },
    }));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const conexion = await sentarse(codigo, ana.token);
    expect(((await conexion.recibir()) as Estado).vista.sentados).toEqual([ana.apodo]);
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(((await conexion.recibir()) as Estado).vista.manos).toHaveLength(1);
    expect(await fichas(ana.id)).toBe(950);
    expect(log).toHaveBeenCalled();
    await arreglar();
  });
});

describe("MesaBlackjack: lo que se escribe y a quién se avisa", () => {
  it("una apuesta escribe dos veces el registro de la mesa (intención y jugada), sin alarma y sin avisar a la sala", async () => {
    // Zapato sembrado: con cartas al azar, un as visible de la banca abre el seguro y un blackjack de ana o de beto los deja
    // sin decisiones, y la prueba se colgaba esperando un «plantado» que no llegaba (~20 % de las veces).
    // ana 10♠ 8♥ = 18, beto 9♠ 7♥ = 16; banca 9♣ 7♦.
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 9S 9C 8H 7H 7D");
    const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.jugadores.length === 2, "sala");
    await hasta(conexionA, (m) => m.vista.sentados.length === 2);
    await avisosManuales(codigo);

    const escrituras = await vigilarEscrituras(codigo);
    enviar(conexionA, { t: "apostar", cantidad: 50 });
    await hasta(conexionA, (m) => m.vista.manos.length === 1);
    expect(escrituras).toEqual(["put:mesa", "put:mesa"]);
    // Además del registro, solo está el nombre que guarda partyserver la primera vez.
    expect(await runInDurableObject(mesa(codigo), async (_m, state) => [...(await state.storage.list()).keys()])).toEqual(["__ps_name", "mesa"]);
    expect(await cobroGuardado(codigo)).toBeNull();

    // Ni la apuesta ni las decisiones cambian lo que enseña la sala: lo siguiente que recibe es el reparto.
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 2);
    await vencer(codigo);
    expect(((await sala.recibir("sala")) as MensajeSala).mesas.blackjack.fase).toBe("decisiones");
    enviar(conexionA, { t: "plantarse" });
    await hasta(conexionA, (m) => m.vista.manos[0].estado === "plantado");
    enviar(conexionB, { t: "plantarse" });
    await hasta(conexionB, (m) => m.vista.fase === "banca");
    // Tampoco la banca: dura un instante. Lo siguiente es el resultado, cuando el reloj lo enseña.
    await avisar(codigo);
    expect(((await sala.recibir("sala")) as MensajeSala).mesas.blackjack).toMatchObject({ fase: "resultado" });
  });

  it("la alarma solo se programa cuando cambia su hora", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "2S 3S 9C 2H 3H 7D 4C");
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    enviar(conexionA, { t: "apostar", cantidad: 50 });
    await hasta(conexionA, (m) => m.vista.manos.length === 1);
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    await hasta(conexionA, (m) => m.vista.manos.length === 2);
    await vencer(codigo);
    await hasta(conexionA, (m) => m.vista.fase === "decisiones");

    const escrituras = await vigilarEscrituras(codigo);
    enviar(conexionA, { t: "pedir" }); // ana pide (2♠ 2♥ 4♣) y sigue jugando: la fase no cambia
    await hasta(conexionA, (m) => m.vista.manos[0].cartas.length === 3);
    expect(escrituras).toEqual(["put:mesa"]);
    enviar(conexionA, { t: "plantarse" });
    await hasta(conexionA, (m) => m.vista.manos[0].estado === "plantado");
    expect(escrituras).toEqual(["put:mesa", "put:mesa"]);
    enviar(conexionB, { t: "plantarse" }); // la última decisión: la banca juega ya y se ve en 1 s
    await hasta(conexionA, (m) => m.vista.fase === "banca");
    expect(escrituras).toEqual(["put:mesa", "put:mesa", "put:mesa", "setAlarm"]);
    // La jugada de la banca y la ronda nueva las enseña el reloj sin alarma: la siguiente es la del fin de la próxima ventana.
    expect(await alarmaDe(codigo)).toBe(T + BJ.APUESTAS_MS + BJ.BANCA_MS + BJ.RESULTADO_MS + BJ.APUESTAS_MS);
  });

  it("tras salir de memoria sabe qué alarma tiene: un cambio que la deja igual no la vuelve a programar", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const conexionA = await sentarse(codigo, ana.token);
    await conexionA.recibir();
    expect(await alarmaDe(codigo)).toBe(T + BJ.APUESTAS_MS);
    await evictDurableObject(mesa(codigo));
    await reloj(codigo, T + 1_000);

    const conexionB = await sentarse(codigo, beto.token); // despierta la mesa
    await conexionB.recibir();
    const escrituras = await vigilarEscrituras(codigo);
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 1);
    expect(escrituras).toEqual(["put:mesa", "put:mesa"]);
    expect(await alarmaDe(codigo)).toBe(T + BJ.APUESTAS_MS);
  });
});

/**
 * Hace fallar las escrituras de la mesa (como al agotarse la cuota diaria de filas escritas) hasta `arreglar()`. Se
 * restaura sola al acabar la prueba.
 */
async function romperAlmacen(codigo: string) {
  const roto = { activo: true };
  await runInDurableObject(mesa(codigo), (_m, state) => {
    const almacen = state.storage as unknown as Record<string, (...a: unknown[]) => unknown>;
    for (const nombre of ["put", "setAlarm"]) {
      const original = almacen[nombre].bind(state.storage);
      almacen[nombre] = (...a: unknown[]) => {
        if (roto.activo) throw new Error("Exceeded allowed rows written in Durable Objects free tier.");
        return original(...a);
      };
    }
  });
  return { arreglar: () => (roto.activo = false) };
}

describe("MesaBlackjack: fallos inesperados", () => {
  it("si guardar falla, quien actúa recibe no_disponible (no se queda esperando) y, si sigue fallando, descansando", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { arreglar } = await romperAlmacen(codigo);

    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "descansando" });
    expect(log).toHaveBeenCalled();
    // No se cobró nada: la intención no llegó a guardarse.
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);

    arreglar();
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(((await conexion.recibir()) as Estado).vista.manos).toHaveLength(1);
    expect(await fichas(ana.id)).toBe(950);
  });

  it("si falla al sentarse, quien llega recibe no_disponible en vez de quedarse sin mesa", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    await (await sentarse(codigo, ana.token)).recibir();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { arreglar } = await romperAlmacen(codigo);
    const conexionB = await sentarse(codigo, beto.token);
    expect(await conexionB.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    arreglar();
  });
});

describe("MesaBlackjack: cobro en dos fases", () => {
  it("si Jugadores cobra pero la respuesta se pierde, se anula: fichas como estaban, sin fila pendiente y el rescate libre", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    await ponerFichas(ana.id, 50);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const arreglar = await cambiarJugadores(codigo, (stub) => ({ apostar: cobraYFalla(stub) }));

    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    expect(await fichas(ana.id)).toBe(50);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await cobroGuardado(codigo)).toBeNull();
    expect((await estadoMesa(codigo)).manos).toEqual([]);

    await arreglar();
    await ponerFichas(ana.id, 0);
    expect(await jugadores().rescate(ana.id)).toEqual({ ok: true, fichas: 200 });
  });

  it("si Jugadores contesta anulado, la apuesta no entra (no_disponible) y no queda cobro a medias", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    const arreglar = await cambiarJugadores(codigo, () => ({ apostar: async () => "anulado" }));

    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    expect((await estadoMesa(codigo)).manos).toEqual([]);
    expect(await cobroGuardado(codigo)).toBeNull();
    expect(await fichas(ana.id)).toBe(1000);
    await arreglar();
  });

  it("un cobro a medias de una instancia caída se anula en el siguiente evento", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    await dejarCobroAMedias(codigo, ana.id, 50);
    expect(await fichas(ana.id)).toBe(950);

    enviar(conexion, { t: "pedir" });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "fase_incorrecta" });
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await cobroGuardado(codigo)).toBeNull();
    expect((await estadoMesa(codigo)).manos).toEqual([]);
  });

  it("un cobro a medias de una instancia caída se anula en la siguiente alarma", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    await (await sentarse(codigo, ana.token)).recibir();
    await dejarCobroAMedias(codigo, ana.id, 50);

    expect(await runDurableObjectAlarm(mesa(codigo))).toBe(true);
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await cobroGuardado(codigo)).toBeNull();
  });

  it("si tampoco se puede anular, el cobro se guarda, una alarma lo reintenta en ≤ 60 s y entretanto no se cobra otro", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    for (let i = 0; i < 3; i++) await vencer(codigo); // mesa dormida: el juego no tiene alarma
    await hasta(conexion, (m) => m.vista.fase === "esperando");
    expect(await alarmaDe(codigo)).toBeNull();

    vi.spyOn(console, "error").mockImplementation(() => {});
    let anulaciones = 0;
    const arreglar = await cambiarJugadores(codigo, (stub) => ({
      apostar: cobraYFalla(stub),
      anular: () => {
        anulaciones++;
        return caido();
      },
    }));
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    expect(anulaciones).toBe(1);
    expect(await fichas(ana.id)).toBe(950); // cobrado y aún sin anular
    expect(await cobroGuardado(codigo)).toMatchObject({ jugadorId: ana.id, cantidad: 50, rondaId: `${codigo}:blackjack:1` });
    const ahora = T + 3 * BJ.APUESTAS_MS;
    expect(await alarmaDe(codigo)).toBe(ahora + 60_000);

    // Mientras quede uno a medias no se cobra otro.
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    expect(anulaciones).toBe(2);
    expect(await fichas(ana.id)).toBe(950);

    await arreglar();
    expect(await runDurableObjectAlarm(mesa(codigo))).toBe(true);
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await cobroGuardado(codigo)).toBeNull();
    expect(await alarmaDe(codigo)).toBeNull();
    expect((await estadoMesa(codigo)).manos).toEqual([]);
  });

  it("la liquidación de la ronda espera a anular un cobro a medias: beto recupera lo cobrado y la ronda se paga", async () => {
    // ana 10♠ 8♥ = 18; banca 9♣ 7♦ = 16, pide K♠ y se pasa. beto no llega a tener mano.
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 9C 8H 7D KS");
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    enviar(conexionA, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 1);

    vi.spyOn(console, "error").mockImplementation(() => {});
    let anularCaido = true;
    let liquidaciones = 0;
    const arreglar = await cambiarJugadores(codigo, (stub) => ({
      // A beto se le cobra pero la respuesta se pierde; anular no responde hasta que se arregle. liquidar funciona.
      apostar: async (...a: Parameters<StubJugadores["apostar"]>) => {
        const r = await stub.apostar(...a);
        if (a[0] === beto.id) throw new Error("se perdió la respuesta");
        return r;
      },
      anular: (...a: Parameters<StubJugadores["anular"]>) => (anularCaido ? caido() : stub.anular(...a)),
      liquidar: (...a: Parameters<StubJugadores["liquidar"]>) => {
        liquidaciones++;
        return stub.liquidar(...a);
      },
    }));
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    expect(await conexionB.recibir()).toEqual({ t: "error", codigo: "no_disponible" });
    expect(await fichas(beto.id)).toBe(950);
    expect(await cobroGuardado(codigo)).toMatchObject({ jugadorId: beto.id, cantidad: 50 });

    await vencer(codigo); // reparto (solo ana)
    enviar(conexionA, { t: "plantarse" });
    await hasta(conexionA, (m) => m.vista.fase === "banca");
    await vencer(codigo); // la banca juega y cierra la ronda: la liquidación espera
    await hasta(conexionA, (m) => m.vista.fase === "resultado");
    expect(liquidaciones).toBe(0);
    expect(await pendientesDe(codigo)).toBe(2); // la apuesta de ana y el cobro a medias de beto
    expect(await pendientesGuardados(codigo)).toHaveLength(1);
    expect(await fichas(ana.id)).toBe(950);
    expect(await fichas(beto.id)).toBe(950);

    anularCaido = false;
    await vencer(codigo); // primero se anula el cobro de beto; después se liquida
    await hasta(conexionA, (m) => m.vista.ronda === 2);
    expect(liquidaciones).toBe(1);
    expect(await fichas(beto.id)).toBe(1000);
    expect(await fichas(ana.id)).toBe(1050);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await pendientesGuardados(codigo)).toEqual([]);
    expect(await cobroGuardado(codigo)).toBeNull();
    await arreglar();
  });

  it("una acción que no cambia nada (Paso sin cambios) no se cobra", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    // Reglas falsas para ana: su apuesta es un no-op (devuelve el mismo estado) aunque cueste 50.
    const aplicar = blackjack.aplicar;
    vi.spyOn(blackjack, "aplicar").mockImplementation((e, jugadorId, accion, ahora, rng) =>
      jugadorId === ana.id && accion.t === "apostar" ? { ok: true, estado: e, eventos: [] } : aplicar(e, jugadorId, accion, ahora, rng),
    );

    enviar(conexion, { t: "apostar", cantidad: 50 });
    enviar(conexion, { t: "pedir" });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "fase_incorrecta" }); // nada antes por la apuesta
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
  });
});

describe("MesaBlackjack: robustez", () => {
  it("una alarma que falla rechaza (para que el runtime la reintente) y la cola sigue atendiendo", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const tick = blackjack.tick;
    const roto = vi.spyOn(blackjack, "tick");
    const resultado = await runInDurableObject(mesa(codigo), (m) => {
      const estado = m.estado;
      roto.mockImplementation((e, ahora, rng) => {
        if (e === estado) throw new Error("tick roto");
        return tick(e, ahora, rng);
      });
      return m.onAlarm().then(
        () => "resuelta",
        (e: Error) => e.message,
      );
    });
    expect(resultado).toBe("tick roto");
    expect(log).toHaveBeenCalled();

    roto.mockRestore();
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(((await conexion.recibir()) as Estado).vista.manos).toHaveLength(1);
  });

  it("las dos pestañas de un jugador se cierran a la vez: un solo desconectar y su mano se resuelve", async () => {
    // ana 10♠ 8♠ = 18, beto 10♥ 9♥ = 19; banca 9♣ 7♦ = 16, pide K♠ y se pasa.
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 10H 9C 8S 9H 7D KS");
    const cierres = await vigilarCierres(codigo);
    const pestana1 = await sentarse(codigo, ana.token);
    const pestana2 = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    enviar(pestana1, { t: "apostar", cantidad: 50 });
    await hasta(conexionB, (m) => m.vista.manos.length === 1);

    const desconectar = vi.spyOn(blackjack, "desconectar");
    // Mientras Jugadores cobra (lento) la apuesta de beto, se cierran las dos pestañas de ana: ambos cierres esperan en la cola.
    const arreglar = await cambiarJugadores(codigo, (stub) => ({
      apostar: async (...a: Parameters<StubJugadores["apostar"]>) => {
        await new Promise((resolver) => setTimeout(resolver, 50));
        return stub.apostar(...a);
      },
    }));
    enviar(conexionB, { t: "apostar", cantidad: 50 });
    pestana1.cerrar();
    pestana2.cerrar();
    await cierres(2);
    await arreglar();
    expect(desconectar.mock.calls.filter(([, jugadorId]) => jugadorId === ana.id)).toHaveLength(1);
    const tras = await estadoMesa(codigo);
    expect(tras.asientos.find((a) => a.jugadorId === ana.id)?.conectado).toBe(false);
    expect(tras.manos).toHaveLength(2);

    await vencer(codigo); // reparto: la mano de ana, desconectada, se planta sola
    const repartido = await hasta(conexionB, (m) => m.vista.fase === "decisiones");
    expect(repartido.vista.manos.find((m) => m.jugadorId === ana.id)).toMatchObject({ cartas: cs("10S 8S"), estado: "plantado" });
    enviar(conexionB, { t: "plantarse" });
    await hasta(conexionB, (m) => m.vista.fase === "banca");
    await vencer(codigo);
    await hasta(conexionB, (m) => m.vista.fase === "resultado");
    expect(await fichas(ana.id)).toBe(1050);
    expect(await pendientesDe(codigo)).toBe(0);
  });
});

/** Las filas del historial (`resultados`) de las rondas de esta partida: una por jugador y ronda, en el orden en que se pagaron. */
const resultadosDe = (codigo: string) =>
  runInDurableObject(jugadores(), (_j, state) =>
    state.storage.sql
      .exec<{ jugador_id: number; ronda_id: string; apuesta: number; neto: number; resultado: string }>(
        "SELECT jugador_id, ronda_id, apuesta, neto, resultado FROM resultados WHERE codigo_partida = ? ORDER BY id",
        codigo,
      )
      .toArray(),
  );

/** Apuesta `cantidad` (en la segunda casilla si `segunda`) y espera a que la vista de esa conexión tenga `manos` manos. */
async function apostarYEsperar(conexion: Conexion, cantidad: number, manos: number, segunda = false): Promise<Estado> {
  enviar(conexion, segunda ? { t: "apostar", cantidad, segunda: true } : { t: "apostar", cantidad });
  return hasta(conexion, (m) => m.vista.manos.length === manos);
}

describe("MesaBlackjack: las jugadas nuevas y las fichas", () => {
  it("segunda casilla, dividir, doblar y seguro cobran cada uno con su cobro en dos fases", async () => {
    // ana: 8♠ 8♥ en la casilla 0 y 5♠ 6♥ en la 1; banca A♦ y 6♦ tapada (sin blackjack). Dividir reparte 3♦ y K♣; doblar, 10♥.
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "8S 5S AD 8H 6H 6D 3D KC 10H");
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    const escrituras = await vigilarEscrituras(codigo);

    /** Una jugada que cuesta fichas: dos escrituras del registro (la intención y la jugada), ningún cobro a medias y un cobro más pendiente. */
    const cobra = async (accion: object, cumple: (m: Estado) => boolean, fichasTras: number, pendientesTras: number) => {
      const desde = escrituras.length;
      enviar(conexion, accion);
      const mensaje = await hasta(conexion, cumple);
      const que = JSON.stringify(accion);
      expect(escrituras.slice(desde).filter((e) => e === "put:mesa"), que).toHaveLength(2);
      expect(await cobroGuardado(codigo), que).toBeNull();
      expect(await fichas(ana.id), que).toBe(fichasTras);
      expect(await pendientesDe(codigo), que).toBe(pendientesTras);
      return mensaje;
    };

    await cobra({ t: "apostar", cantidad: 50 }, (m) => m.vista.manos.length === 1, 950, 1);
    const segunda = await cobra({ t: "apostar", cantidad: 30, segunda: true }, (m) => m.vista.manos.length === 2, 920, 2);
    expect(segunda.vista.casillasLibres).toBe(BJ.CASILLAS - 2);
    expect(segunda.vista.manos.map((m) => [m.casilla, m.indice, m.apuesta])).toEqual([
      [0, 0, 50],
      [1, 1, 30],
    ]);

    await vencer(codigo);
    const repartido = await hasta(conexion, (m) => m.vista.fase === "seguro");
    expect(repartido.vista.opciones).toMatchObject({ seguro: 40 }); // la mitad de 50 + 30

    const asegurado = await cobra({ t: "seguro", tomar: true }, (m) => m.vista.fase === "decisiones", 880, 3);
    expect(asegurado.vista.miSeguro).toBe(40);
    expect(asegurado.eventos).toContainEqual({ tipo: "banca_mira", blackjack: false });

    const dividido = await cobra({ t: "dividir" }, (m) => m.vista.manos.length === 3, 830, 4);
    expect(dividido.eventos).toContainEqual({ tipo: "mano_dividida", jugadorId: ana.id, casilla: 0, indice: 0 });
    expect(dividido.vista.manos).toMatchObject([
      { casilla: 0, indice: 0, apuesta: 50, cartas: cs("8S 3D"), dividida: true },
      { casilla: 0, indice: 1, apuesta: 50, cartas: cs("8H KC"), dividida: true },
      { casilla: 1, indice: 2, apuesta: 30, cartas: cs("5S 6H"), dividida: false },
    ]);

    // Doblar cuesta la apuesta de la mano activa (la primera mitad, 50), no la del tapete entero.
    const doblado = await cobra({ t: "doblar" }, (m) => m.vista.manos[0].doblada, 780, 5);
    expect(doblado.vista.manos[0]).toMatchObject({ apuesta: 100, doblada: true, cartas: cs("8S 3D 10H"), total: 21, estado: "plantado" });
  });

  it("sin fichas para dividir → sin_fichas, sin cobro y sin cambios en la mesa", async () => {
    // ana 8♠ 8♥ contra 9♣: con 100 fichas apuesta 60 y le quedan 40, que no llegan a dividir ni a doblar (60).
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "8S 9C 8H 7D 3D KC");
    await ponerFichas(ana.id, 100);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    enviar(conexion, { t: "apostar", cantidad: 60 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    await vencer(codigo);
    const repartido = await hasta(conexion, (m) => m.vista.fase === "decisiones");
    // Las reglas no miran las fichas: las opciones ofrecen dividir y doblar, y es el cobro el que las rechaza.
    expect(repartido.vista.opciones).toMatchObject({ dividir: true, doblar: true });
    expect(await fichas(ana.id)).toBe(40);
    const registro = await guardado(codigo);
    const alarma = await alarmaDe(codigo);
    let cobros = 0;
    await cambiarJugadores(codigo, (stub) => ({
      apostar: (...a: Parameters<StubJugadores["apostar"]>) => {
        cobros++;
        return stub.apostar(...a);
      },
    }));

    for (const accion of ["dividir", "doblar"]) {
      enviar(conexion, { t: accion });
      expect(await conexion.recibir(), accion).toEqual({ t: "error", codigo: "sin_fichas" });
    }
    // Doblar llega en la pausa tras el sin_fichas de dividir: se rechaza sin preguntar a Jugadores.
    expect(cobros).toBe(1);
    expect(await fichas(ana.id)).toBe(40);
    expect(await pendientesDe(codigo)).toBe(1); // solo la apuesta
    expect(await guardado(codigo)).toEqual(registro); // ni estado, ni cobros, ni pendientes
    expect(await alarmaDe(codigo)).toBe(alarma);

    // Sigue pudiendo jugar con lo que tiene, y los intentos fallidos no gastaron versión.
    enviar(conexion, { t: "plantarse" });
    const plantado = await conexion.recibir();
    expect(plantado).toMatchObject({ t: "estado", vista: { fase: "banca" } });
    expect(plantado.version).toBe(repartido.version + 1);
  });

  it("tras un sin_fichas, insistir durante la pausa no escribe ni pregunta a Jugadores; pasada la pausa se cobra con normalidad", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    await ponerFichas(ana.id, 30);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    let cobros = 0;
    await cambiarJugadores(codigo, (stub) => ({
      apostar: (...a: Parameters<StubJugadores["apostar"]>) => {
        cobros++;
        return stub.apostar(...a);
      },
    }));
    const escrituras = await vigilarEscrituras(codigo);
    const alarma = await alarmaDe(codigo);

    // El primer intento pregunta a Jugadores, como siempre: guarda la intención y la olvida.
    enviar(conexion, { t: "apostar", cantidad: 50 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "sin_fichas" });
    expect(escrituras).toEqual(["put:mesa", "put:mesa"]);
    expect(cobros).toBe(1);

    // Durante la pausa, cualquier jugada con coste (aunque ahora le llegara) se rechaza sin escribir ni preguntar.
    for (const cantidad of [40, 30]) {
      enviar(conexion, { t: "apostar", cantidad });
      expect(await conexion.recibir()).toEqual({ t: "error", codigo: "sin_fichas" });
    }
    await reloj(codigo, T + PAUSA_SIN_FICHAS_MS - 1);
    enviar(conexion, { t: "apostar", cantidad: 30 });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "sin_fichas" });
    expect(escrituras).toEqual(["put:mesa", "put:mesa"]);
    expect(cobros).toBe(1);
    expect(await alarmaDe(codigo)).toBe(alarma);
    // Lo que no cuesta nada no espera: las reglas lo atienden como siempre.
    enviar(conexion, { t: "pedir" });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "fase_incorrecta" });

    // Pasada la pausa, se pregunta otra vez y se cobra.
    await reloj(codigo, T + PAUSA_SIN_FICHAS_MS);
    enviar(conexion, { t: "apostar", cantidad: 30 });
    expect(((await conexion.recibir()) as Estado).vista.manos).toMatchObject([{ jugadorId: ana.id, apuesta: 30 }]);
    expect(cobros).toBe(2);
    expect(await fichas(ana.id)).toBe(0);
    expect(await pendientesDe(codigo)).toBe(1);
  });

  it("sin fichas para el seguro → sin_fichas y se puede contestar que no", async () => {
    // ana apuesta 60 con 70 fichas; el seguro cuesta 30 y le quedan 10. Banca A♦ 6♦.
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "8S AD 8H 6D");
    await ponerFichas(ana.id, 70);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    enviar(conexion, { t: "apostar", cantidad: 60 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    await vencer(codigo);
    expect((await hasta(conexion, (m) => m.vista.fase === "seguro")).vista.opciones).toMatchObject({ seguro: 30 });
    const registro = await guardado(codigo);

    enviar(conexion, { t: "seguro", tomar: true });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "sin_fichas" });
    expect(await fichas(ana.id)).toBe(10);
    expect(await pendientesDe(codigo)).toBe(1);
    expect(await guardado(codigo)).toEqual(registro);

    enviar(conexion, { t: "seguro", tomar: false });
    expect((await hasta(conexion, (m) => m.vista.fase === "decisiones")).vista.miSeguro).toBeNull();
    expect(await fichas(ana.id)).toBe(10);
  });

  it("dos jugadores a por la última casilla: uno sin_casilla y una sola apuesta cobrada", async () => {
    const { codigo, js } = await nuevaMesa(6);
    const conexiones: Conexion[] = [];
    for (const j of js) conexiones.push(await sentarse(codigo, j.token));
    // Cinco primeras apuestas (casillas 0-4) y la segunda de la primera jugadora (casilla 5): solo queda la 6.
    for (const [i, conexion] of conexiones.slice(0, 5).entries()) await apostarYEsperar(conexion, 20, i + 1);
    await apostarYEsperar(conexiones[0], 20, 6, true);
    expect((await estadoMesa(codigo)).manos.map((m) => m.casilla)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(await pendientesDe(codigo)).toBe(6);
    const antes = await Promise.all(js.map((j) => fichas(j.id)));

    // La sexta jugadora (primera apuesta de 40) y la segunda jugadora (segunda de 30) piden la casilla 6 a la vez.
    enviar(conexiones[5], { t: "apostar", cantidad: 40 });
    enviar(conexiones[1], { t: "apostar", cantidad: 30, segunda: true });
    await esperar(async () => (await estadoMesa(codigo)).manos.length === 7, "la séptima apuesta");

    const ganadora = (await estadoMesa(codigo)).manos.find((m) => m.casilla === 6)!.jugadorId;
    const [quien, quienPierde, costo] = ganadora === js[5].id ? [5, 1, 40] : [1, 5, 30];
    expect(await conexiones[quienPierde].recibir("error")).toEqual({ t: "error", codigo: "sin_casilla" });
    expect(await fichas(js[quien].id)).toBe(antes[quien] - costo);
    expect(await fichas(js[quienPierde].id)).toBe(antes[quienPierde]);
    expect(await pendientesDe(codigo)).toBe(7);
    expect((await estadoMesa(codigo)).manos).toHaveLength(7);
    expect(await cobroGuardado(codigo)).toBeNull();
  });

  it("un doble envío de la segunda apuesta cobra una vez", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    await apostarYEsperar(conexion, 50, 1);

    // Dos clics seguidos en «segunda apuesta» y, ya con las dos casillas, un tercero: solo entra el primero.
    enviar(conexion, { t: "apostar", cantidad: 30, segunda: true });
    enviar(conexion, { t: "apostar", cantidad: 30, segunda: true });
    enviar(conexion, { t: "apostar", cantidad: 30, segunda: true });
    expect(((await conexion.recibir()) as Estado).vista.manos).toHaveLength(2);
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "accion_invalida" });
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "accion_invalida" });
    expect(await fichas(ana.id)).toBe(920);
    expect(await pendientesDe(codigo)).toBe(2);
    expect((await estadoMesa(codigo)).manos.map((m) => m.apuesta)).toEqual([50, 30]);
  });

  it("la liquidación con manos divididas y seguro deja las fichas exactas", async () => {
    // Apuestas: ana 50 (casilla 0), beto 40 (casilla 1) y la segunda de ana, 30 (casilla 2). Reparto por casillas:
    // ana 8♠ 8♥, beto 10♠ 9♥, ana 5♠ 6♥; banca A♦ y 6♦ (17 blando, se planta). Dividir: 3♦ y K♣; doblar: 10♥.
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "8S 10S 5S AD 8H 9H 6H 6D 3D KC 10H");
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    await apostarYEsperar(conexionA, 50, 1);
    await apostarYEsperar(conexionB, 40, 2);
    await apostarYEsperar(conexionA, 30, 3, true);
    expect([await fichas(ana.id), await fichas(beto.id), await pendientesDe(codigo)]).toEqual([920, 960, 3]);

    await vencer(codigo);
    await hasta(conexionA, (m) => m.vista.fase === "seguro");
    enviar(conexionA, { t: "seguro", tomar: true }); // 40 = la mitad de 50 + 30
    await hasta(conexionA, (m) => m.vista.miSeguro === 40);
    enviar(conexionB, { t: "seguro", tomar: false });
    await hasta(conexionA, (m) => m.vista.fase === "decisiones");
    expect([await fichas(ana.id), await fichas(beto.id), await pendientesDe(codigo)]).toEqual([880, 960, 4]);

    enviar(conexionA, { t: "dividir" }); // 50
    await hasta(conexionA, (m) => m.vista.manos.length === 4);
    enviar(conexionA, { t: "doblar" }); // 50: 8♠ 3♦ 10♥ = 21
    await hasta(conexionA, (m) => m.vista.manos[0].doblada);
    expect([await fichas(ana.id), await pendientesDe(codigo)]).toEqual([780, 6]);
    enviar(conexionA, { t: "plantarse" }); // 8♥ K♣ = 18
    await hasta(conexionA, (m) => m.vista.manos[1].estado === "plantado");
    enviar(conexionA, { t: "rendirse" }); // la mano de la segunda casilla (5♠ 6♥): devuelve la mitad de 30
    await hasta(conexionA, (m) => m.vista.manos.some((mano) => mano.estado === "rendido"));
    enviar(conexionB, { t: "plantarse" }); // 19
    await hasta(conexionB, (m) => m.vista.fase === "banca");
    expect([await fichas(ana.id), await fichas(beto.id)]).toEqual([780, 960]); // hasta liquidar no se mueve nada más

    await vencer(codigo);
    const resultado = await hasta(conexionA, (m) => m.vista.fase === "resultado");
    expect(resultado.vista.banca).toEqual(cs("AD 6D"));
    // ana: 21 doblado (200) + 18 (100) + rendida (15) = 315 por 100 + 50 + 30 + 40 de seguro = 220 → +95. beto: 19 gana 80 de 40 → +40.
    expect(resultado.eventos.filter((e) => e.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: ana.id, neto: 95 },
      { tipo: "pago", jugadorId: beto.id, neto: 40 },
    ]);
    expect(resultado.eventos.some((e) => e.tipo === "seguro_pagado")).toBe(false); // la banca no tenía blackjack
    expect(await fichas(ana.id)).toBe(1095);
    expect(await fichas(beto.id)).toBe(1040);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await resultadosDe(codigo)).toEqual([
      { jugador_id: ana.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 220, neto: 95, resultado: "gana" },
      { jugador_id: beto.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 40, neto: 40, resultado: "gana" },
    ]);
  });

  it("el seguro con blackjack de la banca y dos casillas devuelve el triple de lo asegurado y la ronda acaba al momento", async () => {
    // ana: 9♠ 8♥ (50) y 5♠ 6♥ (50) contra A♦ K♦.
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "9S 5S AD 8H 6H KD");
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    await apostarYEsperar(conexion, 50, 1);
    await apostarYEsperar(conexion, 50, 2, true);
    await vencer(codigo);
    expect((await hasta(conexion, (m) => m.vista.fase === "seguro")).vista.opciones).toMatchObject({ seguro: 50 });
    expect(await fichas(ana.id)).toBe(900);

    enviar(conexion, { t: "seguro", tomar: true });
    const resultado = await hasta(conexion, (m) => m.vista.fase === "resultado");
    expect(resultado.vista.banca).toEqual(cs("AD KD"));
    expect(resultado.eventos).toEqual([
      { tipo: "banca_mira", blackjack: true },
      { tipo: "carta_girada", carta: c("KD") },
      { tipo: "seguro_pagado", jugadorId: ana.id, cantidad: 150 },
      { tipo: "pago", jugadorId: ana.id, neto: 0 },
    ]);
    // Las dos manos pierden (100) y el seguro (50) paga 150: 1000 - 100 - 50 + 150.
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await resultadosDe(codigo)).toEqual([{ jugador_id: ana.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 150, neto: 0, resultado: "empata" }]);
  });

  it("desalojo con manos divididas: al reconectar, la vista trae las mismas manos y la ronda sigue", async () => {
    // ana 8♠ 8♥ contra A♦ 6♦: toma el seguro (25), divide (3♦ y K♣) y la mesa sale de memoria.
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "8S AD 8H 6D 3D KC");
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    await apostarYEsperar(conexion, 50, 1);
    await vencer(codigo);
    await hasta(conexion, (m) => m.vista.fase === "seguro");
    enviar(conexion, { t: "seguro", tomar: true });
    await hasta(conexion, (m) => m.vista.fase === "decisiones");
    enviar(conexion, { t: "dividir" });
    const dividido = await hasta(conexion, (m) => m.vista.manos.length === 2);
    expect(dividido.vista.manos).toMatchObject([{ cartas: cs("8S 3D"), dividida: true }, { cartas: cs("8H KC"), dividida: true }]);
    expect(await fichas(ana.id)).toBe(875);
    const registro = await guardado(codigo);

    await evictDurableObject(mesa(codigo));
    await reloj(codigo, T + BJ.APUESTAS_MS);

    const vuelta = await sentarse(codigo, ana.token);
    const entrada: Estado = await vuelta.recibir();
    expect(entrada.eventos).toEqual([]);
    expect(entrada.vista).toEqual(dividido.vista);
    expect(entrada.vista.miSeguro).toBe(25);
    expect(await guardado(codigo)).toEqual(registro);

    // La ronda sigue donde estaba: se juegan las dos mitades, la banca (A♦ 6♦ = 17 blando) se planta y se liquida.
    enviar(vuelta, { t: "plantarse" }); // 8♠ 3♦ = 11
    await hasta(vuelta, (m) => m.vista.manos[0].estado === "plantado");
    enviar(vuelta, { t: "plantarse" }); // 8♥ K♣ = 18
    await hasta(vuelta, (m) => m.vista.fase === "banca");
    await vencer(codigo);
    const resultado = await hasta(vuelta, (m) => m.vista.fase === "resultado");
    // Apostó 50 + 50 (dividir) + 25 (seguro perdido); la mitad de 18 gana 100 y la de 11 pierde.
    expect(resultado.eventos).toContainEqual({ tipo: "pago", jugadorId: ana.id, neto: -25 });
    expect(await fichas(ana.id)).toBe(975);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await resultadosDe(codigo)).toEqual([{ jugador_id: ana.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 125, neto: -25, resultado: "pierde" }]);
  });

  it("salir con dos manos y seguro: se pierde todo y la liquidación cuadra", async () => {
    // ana 8♠ 8♥ y beto 10♠ 9♥ contra A♦ 6♦ (17 blando). ana toma el seguro (25), divide (3♦ y K♣) y se va; beto se planta con 19.
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "8S 10S AD 8H 9H 6D 3D KC");
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    await apostarYEsperar(conexionA, 50, 1);
    await apostarYEsperar(conexionB, 40, 2);
    await vencer(codigo);
    await hasta(conexionA, (m) => m.vista.fase === "seguro");
    enviar(conexionA, { t: "seguro", tomar: true });
    await hasta(conexionA, (m) => m.vista.miSeguro === 25);
    enviar(conexionB, { t: "seguro", tomar: false });
    await hasta(conexionA, (m) => m.vista.fase === "decisiones");
    enviar(conexionA, { t: "dividir" });
    await hasta(conexionA, (m) => m.vista.manos.length === 3);
    expect([await fichas(ana.id), await fichas(beto.id), await pendientesDe(codigo)]).toEqual([875, 960, 4]);

    enviar(conexionA, { t: "salir" });
    await hasta(conexionB, (m) => m.vista.sentados.length === 1);
    const tras = await estadoMesa(codigo);
    expect(tras.asientos.map((a) => a.jugadorId)).toEqual([beto.id]);
    expect(tras.manos.filter((m) => m.jugadorId === ana.id).map((m) => [m.abandonada, m.estado])).toEqual([
      [true, "plantado"],
      [true, "plantado"],
    ]);
    expect(await fichas(ana.id)).toBe(875); // no recupera nada de lo cobrado

    enviar(conexionB, { t: "plantarse" });
    await hasta(conexionB, (m) => m.vista.fase === "banca");
    await vencer(codigo);
    const resultado = await hasta(conexionB, (m) => m.vista.fase === "resultado");
    expect(resultado.eventos.filter((e) => e.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: ana.id, neto: -125 }, // 50 + 50 + 25 de seguro, sin cobrar nada
      { tipo: "pago", jugadorId: beto.id, neto: 40 },
    ]);
    expect(await fichas(ana.id)).toBe(875);
    expect(await fichas(beto.id)).toBe(1040);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await resultadosDe(codigo)).toEqual([
      { jugador_id: ana.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 125, neto: -125, resultado: "pierde" },
      { jugador_id: beto.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 40, neto: 40, resultado: "gana" },
    ]);
  });

  it("salir con dos manos y seguro siendo el último: se liquida al momento, la mesa se duerme y no queda nada pendiente", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1, "8S AD 8H 6D 3D KC");
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();
    await apostarYEsperar(conexion, 50, 1);
    await vencer(codigo);
    await hasta(conexion, (m) => m.vista.fase === "seguro");
    enviar(conexion, { t: "seguro", tomar: true });
    await hasta(conexion, (m) => m.vista.fase === "decisiones");
    enviar(conexion, { t: "dividir" });
    await hasta(conexion, (m) => m.vista.manos.length === 2);
    expect(await fichas(ana.id)).toBe(875);

    enviar(conexion, { t: "salir" });
    const salida = await hasta(conexion, (m) => m.vista.fase === "esperando");
    expect(salida.eventos).toContainEqual({ tipo: "pago", jugadorId: ana.id, neto: -125 });
    expect(await fichas(ana.id)).toBe(875);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await alarmaDe(codigo)).toBeNull();
    expect(await resultadosDe(codigo)).toEqual([{ jugador_id: ana.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 125, neto: -125, resultado: "pierde" }]);
  });
});

describe("MesaBlackjack: la banca y la ronda siguiente llegan con el reloj, sin escribir", () => {
  /**
   * ana sola, 10♠ 8♥ = 18, contra 9♣ y 7♦ tapada (16), que pide K♠ y se pasa: ana cobra 100. Se reparte en `T + APUESTAS_MS`,
   * los avisos del reloj los dirige la prueba y ana se planta en `CIERRE`, lo que cierra la ronda.
   */
  const CIERRE = T + BJ.APUESTAS_MS;
  const REVELA = CIERRE + BJ.BANCA_MS;
  const NUEVA = REVELA + BJ.RESULTADO_MS;
  async function rondaCerrada() {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 9C 8H 7D KS");
    const conexion = await sentarse(codigo, ana.token);
    enviar(conexion, { t: "apostar", cantidad: 50 });
    await hasta(conexion, (m) => m.vista.manos.length === 1);
    await vencer(codigo);
    await hasta(conexion, (m) => m.vista.fase === "decisiones");
    await avisosManuales(codigo);
    enviar(conexion, { t: "plantarse" });
    const cierre = await hasta(conexion, (m) => m.vista.fase === "banca");
    return { codigo, ana, beto, conexion, cierre };
  }

  it("al cerrarse, la banca juega y la ronda queda guardada para pagarla, pero solo se ve su carta visible", async () => {
    const { codigo, ana, cierre } = await rondaCerrada();
    expect(cierre.vista).toMatchObject({ fase: "banca", finFase: REVELA, banca: [c("9C"), null], totalBanca: 9 });
    expect(cierre.eventos).toEqual([]);
    for (const carta of cs("7D KS")) expect(contiene(cierre, carta)).toBe(false);
    // Una sola escritura con la jugada, la banca y la ronda a pagar; nada se paga hasta que se vea.
    const registro = await guardado(codigo);
    expect(registro?.estado).toMatchObject({ fase: "resultado", finFase: NUEVA, banca: cs("9C 7D KS") });
    expect(registro?.pendientes).toMatchObject([{ rondaId: `${codigo}:blackjack:1`, visibleEn: REVELA }]);
    expect(await fichas(ana.id)).toBe(950);
    expect(await pendientesDe(codigo)).toBe(1);
    // La única alarma, de respaldo, es la del fin de la ventana de apuestas siguiente.
    expect(await alarmaDe(codigo)).toBe(NUEVA + BJ.APUESTAS_MS);
    expect(await avisoProgramado(codigo)).toBe(REVELA);
  });

  it("la jugada de la banca y la ronda siguiente las anuncia el reloj: sin escrituras, sin alarmas y sin reprogramarla", async () => {
    const { codigo, ana, conexion } = await rondaCerrada();
    const escrituras = await vigilarEscrituras(codigo);

    expect(await avisar(codigo)).toBe(REVELA);
    const resultado: Estado = await conexion.recibir();
    expect(resultado.vista).toMatchObject({ ronda: 1, fase: "resultado", finFase: NUEVA, banca: cs("9C 7D KS"), totalBanca: 26 });
    expect(resultado.eventos).toEqual([
      { tipo: "carta_girada", carta: c("7D") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("KS") },
      { tipo: "pago", jugadorId: ana.id, neto: 50 },
    ]);
    // Se paga al verse, y la ronda pagada solo se quita en memoria: la borra la siguiente escritura.
    expect(await fichas(ana.id)).toBe(1050);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await pendientesGuardados(codigo)).toHaveLength(1);

    expect(await avisar(codigo)).toBe(NUEVA);
    const nueva: Estado = await conexion.recibir();
    expect(nueva.eventos).toEqual([]);
    expect(nueva.vista).toMatchObject({ ronda: 2, fase: "apuestas", finFase: NUEVA + BJ.APUESTAS_MS, manos: [], banca: [], totalBanca: null });
    expect(await avisoProgramado(codigo)).toBeNull();
    expect(escrituras).toEqual([]);
    expect(await alarmaDe(codigo)).toBe(NUEVA + BJ.APUESTAS_MS);
    // Lo guardado sigue siendo la ronda 1: la ronda nueva aún no ha hecho falta escribirla.
    expect((await guardado(codigo))?.estado).toMatchObject({ ronda: 1, fase: "resultado" });

    // La primera apuesta de la ronda nueva la guarda con sus dos escrituras de siempre, y borra la ronda ya pagada.
    enviar(conexion, { t: "apostar", cantidad: 20 });
    const apostado: Estado = await conexion.recibir();
    expect(apostado.vista).toMatchObject({ ronda: 2, fase: "apuestas", finFase: NUEVA + BJ.APUESTAS_MS, manos: [{ jugadorId: ana.id, apuesta: 20 }] });
    expect(escrituras).toEqual(["put:mesa", "put:mesa"]);
    expect(await guardado(codigo)).toMatchObject({ estado: { ronda: 2, fase: "apuestas", finFase: NUEVA + BJ.APUESTAS_MS, banca: [] }, pendientes: [], cobro: null });
    expect(await alarmaDe(codigo)).toBe(NUEVA + BJ.APUESTAS_MS);
    expect(await fichas(ana.id)).toBe(1030);
    expect(await pendientesDe(codigo)).toBe(1);
  });

  it("quien llega con la banca a la vista la ve tapada; si la mesa sale de memoria, el reloj sigue y se paga una vez", async () => {
    const { codigo, ana, beto, conexion } = await rondaCerrada();
    await evictDurableObject(mesa(codigo));
    await reloj(codigo, CIERRE + 500);
    await avisosManuales(codigo);

    // Beto despierta la mesa a mitad de la banca: la ve como los demás, sin la tapada ni lo que ha pedido.
    const conexionB = await sentarse(codigo, beto.token);
    const entrada: Estado = await conexionB.recibir();
    expect(entrada.vista).toMatchObject({ ronda: 1, fase: "banca", finFase: REVELA, banca: [c("9C"), null] });
    for (const carta of cs("7D KS")) expect(contiene(entrada, carta)).toBe(false);

    // Al despertar se volvió a programar el aviso: llega a su hora y la ronda se paga.
    expect(await avisar(codigo)).toBe(REVELA);
    const vistoA = await hasta(conexion, (m) => m.vista.fase === "resultado");
    expect(vistoA.eventos).toContainEqual({ tipo: "pago", jugadorId: ana.id, neto: 50 });
    expect(await fichas(ana.id)).toBe(1050);

    // Sale de memoria otra vez, ya en la ronda siguiente y con la ronda pagada aún guardada: se vuelve a pagar sin efecto.
    await evictDurableObject(mesa(codigo));
    await reloj(codigo, NUEVA + 1_000);
    enviar(conexionB, { t: "apostar", cantidad: 40 });
    const apuesta = await hasta(conexionB, (m) => m.vista.ronda === 2 && m.vista.manos.length === 1);
    expect(apuesta.vista).toMatchObject({ ronda: 2, fase: "apuestas", finFase: NUEVA + BJ.APUESTAS_MS });
    expect(await fichas(ana.id)).toBe(1050);
    expect(await fichas(beto.id)).toBe(960);
    expect(await pendientesGuardados(codigo)).toEqual([]);
    expect(await resultadosDe(codigo)).toEqual([{ jugador_id: ana.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 50, neto: 50, resultado: "gana" }]);
  });

  it("salir durante la banca no cambia el pago: la ronda ya estaba decidida y se paga al verse", async () => {
    // ana 10♠ 8♠ = 18 y beto 10♥ 9♥ = 19 contra 9♣ 7♦, que pide K♠ y se pasa: los dos cobran 100.
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2, "10S 10H 9C 8S 9H 7D KS");
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    await apostarYEsperar(conexionA, 50, 1);
    await apostarYEsperar(conexionB, 50, 2);
    await vencer(codigo);
    await hasta(conexionA, (m) => m.vista.fase === "decisiones");
    await avisosManuales(codigo);
    enviar(conexionA, { t: "plantarse" });
    await hasta(conexionA, (m) => m.vista.manos[0].estado === "plantado");
    enviar(conexionB, { t: "plantarse" });
    await hasta(conexionB, (m) => m.vista.fase === "banca");

    await reloj(codigo, CIERRE + 300);
    enviar(conexionA, { t: "salir" });
    const sinAna = await hasta(conexionB, (m) => m.vista.sentados.length === 1);
    expect(sinAna.vista).toMatchObject({ fase: "banca", sentados: [beto.apodo] });
    expect(sinAna.eventos).toEqual([]);

    await avisar(codigo);
    const resultado = await hasta(conexionB, (m) => m.vista.fase === "resultado");
    expect(resultado.eventos.filter((e) => e.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: ana.id, neto: 50 },
      { tipo: "pago", jugadorId: beto.id, neto: 50 },
    ]);
    expect(await fichas(ana.id)).toBe(1050);
    expect(await fichas(beto.id)).toBe(1050);
  });

  it("si el último se va durante la banca, la ronda se paga al momento (sin esperar al reintento) con una sola fila", async () => {
    const { codigo, ana, conexion } = await rondaCerrada();
    await reloj(codigo, CIERRE + 300);
    enviar(conexion, { t: "salir" });
    expect(((await conexion.recibir()) as Estado).vista).toMatchObject({ ronda: 2, fase: "esperando", sentados: [], manos: [] });
    expect(await fichas(ana.id)).toBe(1050);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await pendientesGuardados(codigo)).toEqual([]);
    expect(await alarmaDe(codigo)).toBeNull();
    expect(await resultadosDe(codigo)).toEqual([{ jugador_id: ana.id, ronda_id: `${codigo}:blackjack:1`, apuesta: 50, neto: 50, resultado: "gana" }]);
  });

  it("si nadie apuesta en la ronda siguiente, la alarma de respaldo salta al acabar su ventana y abre otra", async () => {
    const { codigo, conexion } = await rondaCerrada();
    await avisar(codigo);
    await avisar(codigo);
    await hasta(conexion, (m) => m.vista.ronda === 2);
    const escrituras = await vigilarEscrituras(codigo);

    await reloj(codigo, NUEVA + BJ.APUESTAS_MS);
    expect(await runDurableObjectAlarm(mesa(codigo))).toBe(true);
    const otra: Estado = await conexion.recibir();
    expect(otra.vista).toMatchObject({ ronda: 2, fase: "apuestas", finFase: NUEVA + 2 * BJ.APUESTAS_MS, manos: [] });
    expect(await guardado(codigo)).toMatchObject({ estado: { ronda: 2, ventanasVacias: 1 }, pendientes: [] });
    // El `deleteAlarm` lo hace la propia prueba al disparar la alarma; la mesa escribe la ventana nueva y su alarma.
    expect(escrituras).toEqual(["deleteAlarm", "put:mesa", "setAlarm"]);
  });
});

describe("MesaBlackjack: mesas guardadas por una versión anterior", () => {
  it("el estado con la forma antigua (manos sin casilla, sin seguros) se normaliza al arrancar, sin escribir, y la ronda sigue", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesaCon(2);
    // Como la dejó una mesa desplegada antes de las casillas, el seguro y dividir: en decisiones, con las apuestas ya cobradas.
    const rondaId = `${codigo}:blackjack:1`;
    expect(await jugadores().apostar(ana.id, 50, rondaId, crypto.randomUUID())).toBe("ok");
    expect(await jugadores().apostar(beto.id, 20, rondaId, crypto.randomUUID())).toBe("ok");
    const { seguros: _seguros, bancaMirada: _bancaMirada, ...base } = blackjack.crear(T, rngFijo(0.5));
    const antiguo = {
      ...base,
      fase: "decisiones",
      finFase: T + BJ.DECISIONES_MS,
      zapato: [...cs("3C KS"), ...crearBaraja(2)],
      banca: cs("9C 7D"),
      asientos: [
        { jugadorId: ana.id, apodo: ana.apodo, conectado: true },
        { jugadorId: beto.id, apodo: beto.apodo, conectado: true },
      ],
      manos: [
        { jugadorId: ana.id, apodo: ana.apodo, apuesta: 50, cartas: cs("10S 8H"), estado: "jugando", doblada: false, abandonada: false },
        { jugadorId: beto.id, apodo: beto.apodo, apuesta: 20, cartas: cs("10H 9H"), estado: "jugando", doblada: false, abandonada: false },
      ],
    };
    await preparar(codigo, antiguo as unknown as EstadoBJ);
    expect(await pendientesDe(codigo)).toBe(2);
    const escrituras = await vigilarEscrituras(codigo);

    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    const entrada: Estado = await conexionA.recibir();
    await conexionB.recibir();
    // Normalizar es solo en memoria: arrancar y sentar a quien ya estaba sentado no escribe el registro.
    expect(escrituras.filter((e) => e === "put:mesa")).toEqual([]);
    expect(entrada.vista).toMatchObject({ fase: "decisiones", banca: [c("9C"), null], miSeguro: null, casillasLibres: BJ.CASILLAS - 2, yo: ana.id });
    expect(entrada.vista.opciones).toEqual({ pedir: true, plantarse: true, doblar: true, dividir: false, rendirse: true, seguro: null });
    expect(entrada.vista.manos).toEqual([
      { jugadorId: ana.id, apodo: ana.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: cs("10S 8H"), estado: "jugando", doblada: false, dividida: false, total: 18 },
      { jugadorId: beto.id, apodo: beto.apodo, casilla: 1, indice: 0, apuesta: 20, cartas: cs("10H 9H"), estado: "jugando", doblada: false, dividida: false, total: 19 },
    ]);

    // ana dobla (10♠ 8♥ 3♣ = 21, cobra 50 más), beto se planta (19) y la banca (9♣ 7♦ = 16) pide K♠ y se pasa.
    enviar(conexionA, { t: "doblar" });
    await hasta(conexionA, (m) => m.vista.manos[0].doblada);
    expect(await fichas(ana.id)).toBe(900);
    // La primera escritura ya guarda el estado normalizado.
    expect((await guardado(codigo))?.estado).toMatchObject({ seguros: [], bancaMirada: false, manos: [{ casilla: 0, indice: 0, dividida: false }, { casilla: 1, indice: 0, dividida: false }] });
    enviar(conexionB, { t: "plantarse" });
    await hasta(conexionB, (m) => m.vista.fase === "banca");
    await vencer(codigo);
    const resultado = await hasta(conexionB, (m) => m.vista.fase === "resultado");
    expect(resultado.eventos.filter((e) => e.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: ana.id, neto: 100 },
      { tipo: "pago", jugadorId: beto.id, neto: 20 },
    ]);
    expect(await fichas(ana.id)).toBe(1100);
    expect(await fichas(beto.id)).toBe(1020);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await resultadosDe(codigo)).toEqual([
      { jugador_id: ana.id, ronda_id: rondaId, apuesta: 100, neto: 100, resultado: "gana" },
      { jugador_id: beto.id, ronda_id: rondaId, apuesta: 20, neto: 20, resultado: "gana" },
    ]);
  });
});
