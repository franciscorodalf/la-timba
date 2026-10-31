import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { MensajeSala } from "../../src/shared/api";
import { POKER, type AccionPoker, type Calle, type VistaPoker } from "../../src/shared/juegos/poker";
import type { JugadorId } from "../../src/shared/juegos/tipos";
import { abrir, ayudasMesa, cerrarAbiertas, contiene, cs, enviar, fichas, hasta as hastaMensaje, jugadores, pendientesDe, T, type Conexion, type EstadoMesa } from "../ayudas";

type Estado = EstadoMesa<VistaPoker>;

const { mesa, estadoMesa, guardado, alarmaDe, reloj, vencer, nuevaMesa, sentarse: entrar, vigilarEscrituras } = ayudasMesa(env.MesaPoker, "mesa-poker");

const hasta = (conexion: Conexion, cumple: (m: Estado) => boolean) => hastaMensaje<Estado>(conexion, cumple);

afterEach(cerrarAbiertas);

/** Se sienta con `cantidad` fichas y devuelve la primera vista en la que ya tiene asiento. */
function sentar(conexion: Conexion, jugadorId: JugadorId, cantidad: number): Promise<Estado> {
  enviar(conexion, { t: "sentarse", fichas: cantidad });
  return hasta(conexion, (m) => m.vista.asientos.some((a) => a.jugadorId === jugadorId));
}

/** Espera a que a `jugadorId` le toque hablar en `calle` y hace `accion`. */
async function habla(conexion: Conexion, jugadorId: JugadorId, calle: Calle, accion: AccionPoker): Promise<void> {
  await hasta(conexion, (m) => m.vista.calle === calle && m.vista.turno === jugadorId);
  enviar(conexion, accion);
}

/** Lo sentado, según la vista. */
const asientoEn = (m: Estado, jugadorId: JugadorId) => m.vista.asientos.find((a) => a.jugadorId === jugadorId);

/**
 * Fija las cartas de la mano en curso: las de cada jugador y la baraja que queda (quemada, flop, quemada, turn, quemada y
 * river). Solo en memoria: la siguiente jugada las guarda.
 */
const fijarCartas = (codigo: string, manos: Record<JugadorId, string>) =>
  runInDurableObject(mesa(codigo), (m) => {
    m.estado = {
      ...m.estado,
      baraja: cs("3C KD QD 9S 3S 4H 3H 5C"),
      asientos: m.estado.asientos.map((a) => (manos[a.jugadorId] === undefined ? a : { ...a, cartas: cs(manos[a.jugadorId]) })),
    };
  });

/** Los cobros de esta partida aún sin liquidar. */
const cobrosDe = (codigo: string) =>
  runInDurableObject(jugadores(), (_j, state) =>
    state.storage.sql
      .exec<{ ronda_id: string; jugador_id: number; cantidad: number }>("SELECT ronda_id, jugador_id, cantidad FROM apuestas_pendientes WHERE ronda_id LIKE ? ORDER BY cantidad DESC", `${codigo}:%`)
      .toArray(),
  );

/** Las filas del historial de esta partida: una por cada sesión liquidada. */
const resultadosDe = (codigo: string) =>
  runInDurableObject(jugadores(), (_j, state) =>
    state.storage.sql
      .exec<{ ronda_id: string; jugador_id: number; juego: string; apuesta: number; neto: number }>(
        "SELECT ronda_id, jugador_id, juego, apuesta, neto FROM resultados WHERE codigo_partida = ? ORDER BY ronda_id",
        codigo,
      )
      .toArray(),
  );

/**
 * Cuatro sentados con 100. Ana se retira en la primera mano (la juegan los dos primeros) y en la segunda sube a 20 con Beto,
 * Caro y Dani desconectados: se les acaba el tiempo uno a uno y se retiran. La mesa queda en `resultado`, con los tres por
 * levantar: Ana con 110, Beto con 105, Caro con 95 (puso la ciega pequeña) y Dani con 90 (la grande).
 */
async function tresPorLevantar() {
  const { codigo, js } = await nuevaMesa(4);
  const [ana, beto, caro, dani] = js;
  const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
  const conexiones = await Promise.all(js.map((j) => entrar(codigo, j.token)));
  const [conexionA] = conexiones;
  for (const [i, j] of js.entries()) await sentar(conexiones[i], j.id, 100);

  await habla(conexionA, ana.id, "preflop", { t: "retirarse" });
  await hasta(conexionA, (m) => m.vista.fase === "resultado");
  await vencer(codigo);
  await hasta(conexionA, (m) => m.vista.ronda === 2 && m.vista.turno === ana.id);

  enviar(conexionA, { t: "subir", hasta: 20 });
  await hasta(conexionA, (m) => m.vista.turno === beto.id);
  for (const conexion of conexiones.slice(1)) conexion.cerrar();
  await hasta(conexionA, (m) => m.vista.asientos.filter((a) => a.conectado).length === 1);

  for (let i = 0; i < 3; i++) await vencer(codigo);
  const resultado = await hasta(conexionA, (m) => m.vista.fase === "resultado");
  expect(resultado.vista.asientos.map((a) => a.fichas)).toEqual([110, 105, 95, 90]);
  return { codigo, sala, conexionA, ana, beto, caro, dani };
}

describe("MesaPoker: sentarse, añadir y levantarse", () => {
  it("sentarse cobra en dos fases a cuenta de la sesión y levantarse paga", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await entrar(codigo, ana.token);

    const sentada = await sentar(conexion, ana.id, 300);
    expect(asientoEn(sentada, ana.id)).toMatchObject({ asiento: 0, apodo: ana.apodo, fichas: 300, conectado: true });
    expect(sentada.vista).toMatchObject({ fase: "esperando", finFase: T + POKER.SOLO_MS, yo: ana.id });
    expect(await fichas(ana.id)).toBe(700);
    expect(await cobrosDe(codigo)).toEqual([{ ronda_id: `${codigo}:poker:1`, jugador_id: ana.id, cantidad: 300 }]);
    expect((await guardado(codigo))!.cobro).toBeNull();
    expect(await alarmaDe(codigo)).toBe(T + POKER.SOLO_MS);

    enviar(conexion, { t: "levantarse" });
    await hasta(conexion, (m) => m.vista.asientos.length === 0);
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await resultadosDe(codigo)).toEqual([{ ronda_id: `${codigo}:poker:1`, jugador_id: ana.id, juego: "poker", apuesta: 300, neto: 0 }]);
    // Sin nadie sentado la mesa duerme, sin alarmas.
    expect(await alarmaDe(codigo)).toBeNull();
  });

  it("añadir cobra otra vez en la misma sesión y la liquidación suma las dos compras", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await entrar(codigo, ana.token);
    await sentar(conexion, ana.id, 300);

    enviar(conexion, { t: "anadir", fichas: 200 });
    const anadido = await hasta(conexion, (m) => m.vista.porEntrar === 200);
    expect(asientoEn(anadido, ana.id)!.fichas).toBe(300);
    expect(await fichas(ana.id)).toBe(500);
    const sesion = `${codigo}:poker:1`;
    expect(await cobrosDe(codigo)).toEqual([
      { ronda_id: sesion, jugador_id: ana.id, cantidad: 300 },
      { ronda_id: sesion, jugador_id: ana.id, cantidad: 200 },
    ]);

    enviar(conexion, { t: "levantarse" });
    await hasta(conexion, (m) => m.vista.asientos.length === 0);
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await resultadosDe(codigo)).toEqual([{ ronda_id: sesion, jugador_id: ana.id, juego: "poker", apuesta: 500, neto: 0 }]);
  });

  it("sin fichas para sentarse: sin_fichas, sin asiento y sin cobro", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await entrar(codigo, ana.token);

    enviar(conexion, { t: "sentarse", fichas: 1001 });
    expect(await conexion.recibir("error")).toEqual({ t: "error", codigo: "sin_fichas" });
    expect((await estadoMesa(codigo)).asientos).toEqual([]);
    expect((await guardado(codigo))!.cobro).toBeNull();
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
  });

  it("doble sentarse cobra una vez", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await entrar(codigo, ana.token);

    enviar(conexion, { t: "sentarse", fichas: 100 });
    enviar(conexion, { t: "sentarse", fichas: 100 });
    expect(await conexion.recibir("error")).toEqual({ t: "error", codigo: "accion_invalida" });
    expect((await estadoMesa(codigo)).asientos).toHaveLength(1);
    expect(await fichas(ana.id)).toBe(900);
    expect(await pendientesDe(codigo)).toBe(1);
  });

  it("dos a por el último asiento: uno sin_asiento y un solo cobro", async () => {
    const { codigo, js } = await nuevaMesa(POKER.MAX_JUGADORES + 1);
    const conexiones = await Promise.all(js.map((j) => entrar(codigo, j.token)));
    for (let i = 0; i < POKER.MAX_JUGADORES - 1; i++) await sentar(conexiones[i], js[i].id, 100);

    /** Lo que le pasa a cada aspirante: se sienta o recibe un error. */
    async function intentar(i: number): Promise<string> {
      enviar(conexiones[i], { t: "sentarse", fichas: 100 });
      for (;;) {
        const mensaje = await conexiones[i].recibir();
        if (mensaje.t === "error") return mensaje.codigo;
        if (asientoEn(mensaje, js[i].id) !== undefined) return "sentado";
      }
    }
    const respuestas = await Promise.all([intentar(POKER.MAX_JUGADORES - 1), intentar(POKER.MAX_JUGADORES)]);
    expect([...respuestas].sort()).toEqual(["sentado", "sin_asiento"]);

    expect((await estadoMesa(codigo)).asientos).toHaveLength(POKER.MAX_JUGADORES);
    expect(await pendientesDe(codigo)).toBe(POKER.MAX_JUGADORES);
    const aspirantes = await Promise.all(js.slice(-2).map((j) => fichas(j.id)));
    expect(aspirantes.reduce((total, n) => total + n, 0)).toBe(1900);
  });

  it("el rescate responde apuestas_pendientes mientras estás sentado y va al levantarte", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const conexionA = await entrar(codigo, ana.token);
    const conexionB = await entrar(codigo, beto.token);
    await sentar(conexionA, ana.id, 1000);
    expect(await jugadores().rescate(ana.id)).toEqual({ ok: false, error: "apuestas_pendientes" });

    await sentar(conexionB, beto.id, 1000);
    await fijarCartas(codigo, { [ana.id]: "7C 2D", [beto.id]: "AS AH" });
    await habla(conexionA, ana.id, "preflop", { t: "subir", hasta: 1000 });
    await habla(conexionB, beto.id, "preflop", { t: "igualar" });
    const perdida = await hasta(conexionA, (m) => m.vista.fase === "resultado");
    expect(asientoEn(perdida, ana.id)!.fichas).toBe(0);
    // Ha perdido todo, pero se levanta al cerrar `resultado`: su sesión sigue abierta.
    expect(await jugadores().rescate(ana.id)).toEqual({ ok: false, error: "apuestas_pendientes" });

    await vencer(codigo);
    await hasta(conexionB, (m) => m.vista.asientos.length === 1);
    expect(await fichas(ana.id)).toBe(0);
    expect(await jugadores().rescate(ana.id)).toEqual({ ok: true, fichas: 200 });
  });

  it("quien solo mira no escribe nada, ni al entrar ni con salir, que le manda useSalirDeMesa", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const conexionA = await entrar(codigo, ana.token);
    await conexionA.recibir();

    const escrituras = await vigilarEscrituras(codigo);
    const conexionB = await entrar(codigo, beto.token);
    expect(((await conexionB.recibir()) as Estado).vista).toMatchObject({ yo: beto.id, misCartas: null, asientos: [] });
    enviar(conexionB, { t: "salir" });
    // La cola atiende en orden: cuando esto responde, `salir` ya se ha atendido.
    enviar(conexionB, { t: "pasar" });
    expect(await conexionB.recibir("error")).toEqual({ t: "error", codigo: "no_sentado" });
    expect(escrituras).toEqual([]);
  });
});

describe("MesaPoker: una mano", () => {
  it("una mano completa entre dos jugadores: cuadran las fichas al levantarse", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const conexionA = await entrar(codigo, ana.token);
    const conexionB = await entrar(codigo, beto.token);
    await sentar(conexionA, ana.id, 100);
    const empezada = await sentar(conexionB, beto.id, 100);
    // La mano empieza en el acto: Ana lleva el botón, pone la pequeña y habla primero.
    expect(empezada.vista).toMatchObject({ ronda: 1, fase: "mano", calle: "preflop", turno: ana.id, finFase: T + POKER.TURNO_MS });
    expect(await alarmaDe(codigo)).toBe(T + POKER.TURNO_MS);

    await fijarCartas(codigo, { [ana.id]: "AS AH", [beto.id]: "7C 2D" });
    await habla(conexionA, ana.id, "preflop", { t: "igualar" });
    await habla(conexionB, beto.id, "preflop", { t: "pasar" });
    await habla(conexionB, beto.id, "flop", { t: "pasar" });
    await habla(conexionA, ana.id, "flop", { t: "subir", hasta: 20 });
    await habla(conexionB, beto.id, "flop", { t: "igualar" });
    await habla(conexionB, beto.id, "turn", { t: "pasar" });
    await habla(conexionA, ana.id, "turn", { t: "pasar" });
    await habla(conexionB, beto.id, "river", { t: "pasar" });
    await habla(conexionA, ana.id, "river", { t: "pasar" });

    const resultado = await hasta(conexionA, (m) => m.vista.fase === "resultado");
    expect(asientoEn(resultado, ana.id)!.fichas).toBe(130);
    expect(asientoEn(resultado, beto.id)!.fichas).toBe(70);
    // Lo que pasa en la mesa no toca el libro de fichas: se liquida al levantarse.
    expect(await fichas(ana.id)).toBe(900);
    expect(await fichas(beto.id)).toBe(900);
    expect(await pendientesDe(codigo)).toBe(2);

    enviar(conexionA, { t: "levantarse" });
    await hasta(conexionB, (m) => m.vista.asientos.length === 1);
    expect(await fichas(ana.id)).toBe(1030);
    expect(await fichas(beto.id)).toBe(900);

    enviar(conexionB, { t: "levantarse" });
    await hasta(conexionA, (m) => m.vista.asientos.length === 0);
    expect(await fichas(beto.id)).toBe(970);
    expect(await pendientesDe(codigo)).toBe(0);
    expect(await resultadosDe(codigo)).toEqual([
      { ronda_id: `${codigo}:poker:1`, jugador_id: ana.id, juego: "poker", apuesta: 100, neto: 30 },
      { ronda_id: `${codigo}:poker:2`, jugador_id: beto.id, juego: "poker", apuesta: 100, neto: -30 },
    ]);
    expect((await jugadores().perfil(ana.id))!.porJuego.poker).toEqual({ partidas: 1, victorias: 1 });
  });

  it("tres se levantan en el mismo tick: tres pagos y el ranking de la noche suma los tres", async () => {
    const { codigo, sala, conexionA, ana, beto, caro, dani } = await tresPorLevantar();
    const finFase = (await estadoMesa(codigo)).finFase;
    // La sala solo cuenta atrás en `resultado`, no en cada turno.
    expect((await hastaMensaje<MensajeSala>(sala, (m) => m.mesas.poker.fase === "mano", "sala")).mesas.poker.finFase).toBeNull();
    const enResultado = await hastaMensaje<MensajeSala>(sala, (m) => m.mesas.poker.finFase === finFase, "sala");
    expect(enResultado.mesas.poker.fase).toBe("resultado");

    await vencer(codigo);
    const quedaAna = await hasta(conexionA, (m) => m.vista.asientos.length === 1);
    expect(quedaAna.vista).toMatchObject({ fase: "esperando", finFase: finFase! + POKER.SOLO_MS });
    expect(await fichas(beto.id)).toBe(1005);
    expect(await fichas(caro.id)).toBe(995);
    expect(await fichas(dani.id)).toBe(990);
    // Ana sigue sentada: su sesión sigue abierta.
    expect(await fichas(ana.id)).toBe(900);
    expect(await pendientesDe(codigo)).toBe(1);
    expect((await guardado(codigo))!.pendientes).toEqual([]);

    const liquidada = await hastaMensaje<MensajeSala>(sala, (m) => m.rankingNoche.length > 0, "sala");
    expect(liquidada.rankingNoche).toEqual([
      { apodo: beto.apodo, neto: 5 },
      { apodo: caro.apodo, neto: -5 },
      { apodo: dani.apodo, neto: -10 },
    ]);
    expect(liquidada.mesas.poker).toEqual({ jugadores: [ana.apodo], fase: "esperando", finFase: null });
  });

  it("desalojo en resultado con varios por levantar: la alarma paga cada sesión una vez", async () => {
    const { codigo, conexionA, beto, caro, dani } = await tresPorLevantar();
    const antes = (await guardado(codigo))!;
    const fin = antes.estado.finFase!;

    await evictDurableObject(mesa(codigo));
    await reloj(codigo, fin);
    expect(await runDurableObjectAlarm(mesa(codigo))).toBe(true);
    await hasta(conexionA, (m) => m.vista.asientos.length === 1);
    const pagos = async () => [await fichas(beto.id), await fichas(caro.id), await fichas(dani.id)];
    expect(await pagos()).toEqual([1005, 995, 990]);
    expect((await guardado(codigo))!.pendientes).toEqual([]);
    expect(await resultadosDe(codigo)).toHaveLength(3);

    // El runtime repite la alarma sobre lo guardado antes de pagar: cada sesión ya está liquidada y no vuelve a contar.
    await runInDurableObject(mesa(codigo), async (_m, state) => {
      await state.storage.put("mesa", antes);
      await state.storage.setAlarm(fin);
    });
    await evictDurableObject(mesa(codigo));
    await reloj(codigo, fin);
    expect(await runDurableObjectAlarm(mesa(codigo))).toBe(true);
    await hasta(conexionA, (m) => m.vista.asientos.length === 1);
    expect(await pagos()).toEqual([1005, 995, 990]);
    expect((await guardado(codigo))!.pendientes).toEqual([]);
    expect(await resultadosDe(codigo)).toHaveLength(3);
  });

  it("desalojo a mitad de mano: al reconectar, tus cartas y tu turno siguen", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const conexionA = await entrar(codigo, ana.token);
    const conexionB = await entrar(codigo, beto.token);
    await sentar(conexionA, ana.id, 100);
    await sentar(conexionB, beto.id, 100);
    const antes = await estadoMesa(codigo);
    const misCartas = antes.asientos[0].cartas;
    expect(misCartas).toHaveLength(2);

    conexionA.cerrar();
    await hasta(conexionB, (m) => asientoEn(m, ana.id)!.conectado === false);
    await evictDurableObject(mesa(codigo));
    await reloj(codigo, T + 1000);

    const vuelta = await entrar(codigo, ana.token);
    const reconectada: Estado = await vuelta.recibir();
    expect(reconectada.eventos).toEqual([]);
    expect(reconectada.vista).toMatchObject({
      ronda: 1,
      fase: "mano",
      turno: ana.id,
      finFase: antes.finFase,
      misCartas,
      opciones: { retirarse: true, pasar: false, igualar: 5 },
    });
    expect(asientoEn(reconectada, ana.id)!.conectado).toBe(true);

    // Beto la ve volver, sin las cartas de Ana.
    const deBeto = await hasta(conexionB, (m) => asientoEn(m, ana.id)!.conectado);
    for (const carta of misCartas) expect(contiene(deBeto, carta)).toBe(false);

    enviar(vuelta, { t: "igualar" });
    await hasta(conexionB, (m) => m.vista.turno === beto.id);
    expect((await estadoMesa(codigo)).asientos[0].fichas).toBe(90);
  });

  it("al desconectarse entre manos se levanta y cobra", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const conexionA = await entrar(codigo, ana.token);
    const conexionB = await entrar(codigo, beto.token);
    await sentar(conexionA, ana.id, 300);
    await hasta(conexionB, (m) => m.vista.asientos.length === 1);
    expect(await fichas(ana.id)).toBe(700);

    conexionA.cerrar();
    await hasta(conexionB, (m) => m.vista.asientos.length === 0);
    expect(await fichas(ana.id)).toBe(1000);
    expect(await pendientesDe(codigo)).toBe(0);
  });
});
