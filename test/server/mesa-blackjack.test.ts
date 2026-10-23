import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MensajeSala } from "../../src/shared/api";
import { crearBaraja } from "../../src/shared/cartas";
import { BJ, blackjack, type VistaBJ } from "../../src/shared/juegos/blackjack";
import {
  abrir,
  ayudasMesa,
  c,
  cerrarAbiertas,
  contiene,
  cs,
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
  sentarse,
  vigilarEscrituras,
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

/** Espera (hasta 2 s) a que se cumpla una condición que depende de algo asíncrono en el servidor. */
async function esperar(condicion: () => boolean | Promise<boolean>, que: string): Promise<void> {
  const limite = Date.now() + 2000;
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
      { jugadorId: ana.id, apodo: ana.apodo, apuesta: 50, cartas: [], estado: "jugando", doblada: false, total: 0 },
    ]);
    expect(await fichas(ana.id)).toBe(950);
    expect(await pendientesDe(codigo)).toBe(1);

    await vencer(codigo); // se cierran las apuestas: reparto
    const repartido: Estado = await conexion.recibir();
    expect(repartido.vista).toMatchObject({ fase: "decisiones", banca: [c("9C"), null], totalBanca: 9 });
    expect(repartido.vista.manos[0]).toMatchObject({ cartas: cs("10S 8H"), total: 18, estado: "jugando" });
    expect(repartido.eventos).toEqual([
      { tipo: "carta_repartida", a: ana.id, oculta: false, carta: c("10S") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("9C") },
      { tipo: "carta_repartida", a: ana.id, oculta: false, carta: c("8H") },
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

    // Lo que sí tiene, sí puede apostarlo; y la versión no avanzó con el intento fallido.
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
    await vencer(codigo); // banca
    await vencer(codigo); // resultado → ronda nueva
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
      { jugadorId: ana.id, apodo: ana.apodo, apuesta: 50, cartas: cs("10S 2S"), estado: "plantado", doblada: false, total: 12 },
      { jugadorId: beto.id, apodo: beto.apodo, apuesta: 50, cartas: cs("10H 9H"), estado: "jugando", doblada: false, total: 19 },
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
    enviar(conexion, { t: "plantarse" });
    await hasta(conexion, (m) => m.vista.fase === "banca");
    const antes = await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.fase === "banca", "sala");
    expect(antes.rankingNoche).toEqual([]); // hasta liquidar, la sala no vuelve a pedir el ranking
    // La banca dura un instante: la sala no enseña cuenta atrás.
    expect(antes.mesas.blackjack).toEqual({ jugadores: [ana.apodo], fase: "banca", finFase: null });

    await vencer(codigo);
    const liquidada = await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.fase === "resultado", "sala");
    expect(liquidada.mesas.blackjack).toEqual({ jugadores: [ana.apodo], fase: "resultado", finFase: T + BJ.APUESTAS_MS + BJ.BANCA_MS + BJ.RESULTADO_MS });
    expect(liquidada.rankingNoche).toEqual([{ apodo: ana.apodo, neto: 50 }]);
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
    enviar(conexion, { t: "plantarse" });
    await hasta(conexion, (m) => m.vista.fase === "banca");

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let intentos = 0;
    const arreglar = await cambiarJugadores(codigo, () => ({
      liquidar: () => {
        intentos++;
        return caido();
      },
    }));
    await vencer(codigo); // la banca juega; la liquidación falla
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
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    await hasta<MensajeSala>(sala, (m) => m.mesas.blackjack.jugadores.length === 2, "sala");
    await hasta(conexionA, (m) => m.vista.sentados.length === 2);

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
    expect(((await sala.recibir("sala")) as MensajeSala).mesas.blackjack).toMatchObject({ fase: "banca", finFase: null });
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
    enviar(conexionB, { t: "plantarse" }); // la última decisión: la banca juega en 1 s
    await hasta(conexionA, (m) => m.vista.fase === "banca");
    expect(escrituras).toEqual(["put:mesa", "put:mesa", "put:mesa", "setAlarm"]);
    expect(await alarmaDe(codigo)).toBe(T + BJ.APUESTAS_MS + BJ.BANCA_MS);
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
