import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import type { MensajeSala } from "../../src/shared/api";
import type { Palo } from "../../src/shared/cartas";
import { CARRERA, carrera, type AccionCarrera, type VistaCarrera } from "../../src/shared/juegos/carrera";
import {
  abrir,
  ayudasMesa,
  cerrarAbiertas,
  contiene,
  cs,
  enviar,
  fichas,
  hasta as hastaMensaje,
  pendientesDe,
  rngFijo,
  T,
  type Conexion,
  type EstadoMesa,
} from "../ayudas";

type Estado = EstadoMesa<VistaCarrera>;

const { mesa, estadoMesa, alarmaDe, reloj, vencer, nuevaMesa: nuevaMesaCon, sentarse, vigilarEscrituras } = ayudasMesa(env.MesaCarrera, "mesa-carrera");

/** Recibe mensajes `t` hasta el primero que cumpla `cumple` (por defecto, estados de carrera); los que llegan se añaden a `vistos`. */
const hasta = <M = Estado>(conexion: Conexion, cumple: (m: M) => boolean, t = "estado", vistos: M[] = []) =>
  hastaMensaje<M>(conexion, cumple, t, vistos);

afterEach(cerrarAbiertas);

/** Las siete cartas de la pista: ningún caballo se queda atrás de ellas en estas pruebas, así que no se gira ninguna. */
const TRAMOS = "10C JC QC KC 10D JD QD";
/**
 * Mazo de una carrera de 11 pasos: H avanza ocho veces y gana en la última carta; S y D se quedan atrás y C no sale, así
 * que el caballo más rezagado nunca pasa del primer tramo.
 */
const MAZO = "2H 2S 3H 3S 4H 2D 5H 6H 7H 8H 9H";
const CARTAS = cs(MAZO);
const PASOS = CARTAS.length;
/** Instante en que se cierran las apuestas (y sale la carrera), con el reloj de la mesa llevado al fin de la ventana. */
const SALIDA = T + CARRERA.APUESTAS_MS;
/** El instante del paso `n` (desde 1). */
const PASO = (n: number) => SALIDA + n * CARRERA.PASO_MS;
/** Instante en que acaba la carrera (y empieza `resultado`): el último paso, la meta. */
const FIN_CARRERA = PASO(PASOS);

const apostar = (caballo: Palo, cantidad: number): AccionCarrera => ({ t: "apostar", caballo, cantidad });
const CEROS: Record<Palo, number> = { H: 0, D: 0, C: 0, S: 0 };

/** Registra `n` jugadores, abre una partida del primero y prepara su mesa con la pista y el mazo fijos de arriba. */
const nuevaMesa = (n: number) => nuevaMesaCon(n, { ...carrera.crear(T, rngFijo(0.5)), tramos: cs(TRAMOS), mazo: CARTAS });

/** Cierra las apuestas y deja que la carrera llegue a la meta: dos alarmas, la de la ventana y la de la meta. */
async function correr(codigo: string): Promise<void> {
  await vencer(codigo);
  await vencer(codigo);
}

describe("MesaCarrera: carrera y fichas", () => {
  it("carrera completa con mazo fijo: 50 a H y 50 a S (dos cobros), gana H → fichas = 1000 - 100 + 200", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    const inicial: Estado = await conexion.recibir();
    // `ahora` es la hora del reloj de la mesa (aquí fijo en T): con ella los clientes calculan las cuentas atrás.
    expect(inicial).toMatchObject({
      t: "estado",
      ahora: T,
      eventos: [],
      vista: { ronda: 1, fase: "apuestas", finFase: T + CARRERA.APUESTAS_MS, misApuestas: [], sentados: [ana.apodo], ganador: null },
    });

    enviar(conexion, apostar("H", 50));
    const primera: Estado = await conexion.recibir();
    expect(primera.version).toBe(inicial.version + 1);
    expect(primera.vista.misApuestas).toEqual([{ caballo: "H", cantidad: 50 }]);
    expect(await fichas(ana.id)).toBe(950);
    expect(await pendientesDe(codigo)).toBe(1);

    enviar(conexion, apostar("S", 50));
    const segunda: Estado = await conexion.recibir();
    expect(segunda.vista.misApuestas).toEqual([
      { caballo: "H", cantidad: 50 },
      { caballo: "S", cantidad: 50 },
    ]);
    expect(segunda.vista.totalesPorCaballo).toEqual({ ...CEROS, H: 50, S: 50 });
    expect(await fichas(ana.id)).toBe(900);
    expect(await pendientesDe(codigo)).toBe(2); // cada apuesta es un cobro aparte

    await vencer(codigo); // se cierran las apuestas: empieza la carrera, sin carta todavía
    const salida: Estado = await conexion.recibir();
    expect(salida.vista).toMatchObject({ fase: "carrera", finFase: PASO(1), posiciones: CEROS, ultimaCarta: null });
    expect(salida.eventos).toEqual([]);
    // La carrera ya está sorteada y la única alarma es la de la meta.
    expect(await alarmaDe(codigo)).toBe(FIN_CARRERA);
    expect(await pendientesDe(codigo)).toBe(2);

    // La alarma de la meta: llegan todos los pasos, uno por mensaje y en orden; el último liquida.
    await vencer(codigo);
    const posiciones = { ...CEROS };
    for (const [i, carta] of CARTAS.entries()) {
      const paso: Estado = await conexion.recibir();
      posiciones[carta.palo] += 1;
      const ultimo = i === PASOS - 1;
      expect(paso.vista).toMatchObject({ fase: ultimo ? "resultado" : "carrera", posiciones, ultimaCarta: carta });
      expect(paso.eventos[0]).toEqual({ tipo: "caballo_avanza", palo: carta.palo, carta });
      if (ultimo) {
        expect(paso.eventos.slice(1)).toEqual([
          { tipo: "ganador", palo: "H" },
          { tipo: "pago", jugadorId: ana.id, neto: 100 },
        ]);
        expect(paso.vista).toMatchObject({ ganador: "H", finFase: FIN_CARRERA + CARRERA.RESULTADO_MS });
      } else {
        expect(paso.eventos).toHaveLength(1);
        expect(paso.vista).toMatchObject({ ganador: null, finFase: PASO(i + 2) });
      }
    }
    expect(posiciones).toEqual({ ...CEROS, H: 8, S: 2, D: 1 });
    expect(await fichas(ana.id)).toBe(1000 - 100 + 200);
    expect(await pendientesDe(codigo)).toBe(0);
  });

  it("varios jugadores reciben los mismos eventos caballo_avanza, en orden, y ven solo sus apuestas y las cartas ya giradas", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const conexionA = await sentarse(codigo, ana.token);
    const conexionB = await sentarse(codigo, beto.token);
    const vistosA: Estado[] = [];
    const vistosB: Estado[] = [];
    await hasta(conexionA, (m) => m.vista.sentados.length === 2, "estado", vistosA);
    await hasta(conexionB, (m) => m.vista.sentados.length === 2, "estado", vistosB);

    enviar(conexionA, apostar("H", 50));
    await hasta(conexionB, (m) => m.vista.totalesPorCaballo.H === 50, "estado", vistosB);
    enviar(conexionB, apostar("S", 50));
    await hasta(conexionA, (m) => m.vista.totalesPorCaballo.S === 50, "estado", vistosA);

    await correr(codigo);
    const finalA = await hasta(conexionA, (m) => m.vista.fase === "resultado", "estado", vistosA);
    const finalB = await hasta(conexionB, (m) => m.vista.fase === "resultado", "estado", vistosB);

    const avances = (vistos: Estado[]) => vistos.flatMap((m) => m.eventos).filter((e) => e.tipo === "caballo_avanza");
    const esperados = CARTAS.map((carta) => ({ tipo: "caballo_avanza", palo: carta.palo, carta }));
    expect(avances(vistosA)).toEqual(esperados);
    expect(avances(vistosB)).toEqual(esperados);

    // Lo que cambia entre ellos es solo lo suyo: sus apuestas.
    expect(finalA.vista).toEqual({ ...finalB.vista, misApuestas: [{ caballo: "H", cantidad: 50 }] });
    expect(finalB.vista.misApuestas).toEqual([{ caballo: "S", cantidad: 50 }]);
    expect(finalA.vista).toMatchObject({ ganador: "H", totalesPorCaballo: { ...CEROS, H: 50, S: 50 } });
    expect(finalA.eventos.filter((e) => e.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: ana.id, neto: 150 },
      { tipo: "pago", jugadorId: beto.id, neto: -50 },
    ]);
    expect(await fichas(ana.id)).toBe(1150);
    expect(await fichas(beto.id)).toBe(950);
    expect(await pendientesDe(codigo)).toBe(0);

    // Los tramos sin girar no salen del servidor (y la comprobación sí los habría encontrado: están en el estado).
    const tramos = cs(TRAMOS);
    expect(contiene(await estadoMesa(codigo), tramos[0])).toBe(true);
    for (const vistos of [vistosA, vistosB]) {
      for (const mensaje of vistos) for (const tramo of tramos) expect(contiene(mensaje, tramo)).toBe(false);
    }
  });

  it("tras el resultado empieza una ronda nueva de apuestas, con la pista limpia, y se puede apostar en ella", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    enviar(conexion, apostar("H", 50));
    await hasta(conexion, (m) => m.vista.misApuestas.length === 1);
    await correr(codigo);
    const resultado = await hasta(conexion, (m) => m.vista.fase === "resultado");
    expect(resultado.vista).toMatchObject({ ronda: 1, ganador: "H", misApuestas: [{ caballo: "H", cantidad: 50 }] });
    expect(await fichas(ana.id)).toBe(1150);
    expect(await alarmaDe(codigo)).toBe(FIN_CARRERA + CARRERA.RESULTADO_MS);

    await vencer(codigo);
    const nueva: Estado = await conexion.recibir();
    expect(nueva.eventos).toEqual([]);
    expect(nueva.vista).toEqual({
      ronda: 2,
      fase: "apuestas",
      finFase: FIN_CARRERA + CARRERA.RESULTADO_MS + CARRERA.APUESTAS_MS,
      posiciones: CEROS,
      tramos: Array(CARRERA.TRAMOS).fill(null),
      ultimaCarta: null,
      misApuestas: [],
      totalesPorCaballo: CEROS,
      sentados: [ana.apodo],
      ganador: null,
    });
    expect(await alarmaDe(codigo)).toBe(nueva.vista.finFase);

    enviar(conexion, apostar("D", 20));
    expect(((await conexion.recibir()) as Estado).vista).toMatchObject({ ronda: 2, misApuestas: [{ caballo: "D", cantidad: 20 }] });
    expect(await fichas(ana.id)).toBe(1130);
    expect(await pendientesDe(codigo)).toBe(1); // solo la de la ronda 2: la 1 ya se liquidó
  });

  it("el máximo por caballo es acumulado: pasarse → apuesta_invalida sin cobrar; otro caballo sí entra", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const conexion = await sentarse(codigo, ana.token);
    await conexion.recibir();

    enviar(conexion, apostar("H", 300));
    await conexion.recibir();
    enviar(conexion, apostar("H", 300)); // 600 > 500
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "apuesta_invalida" });
    expect(await fichas(ana.id)).toBe(700);
    expect(await pendientesDe(codigo)).toBe(1);

    enviar(conexion, apostar("H", 200)); // 500: justo el máximo
    expect(((await conexion.recibir()) as Estado).vista.misApuestas).toEqual([{ caballo: "H", cantidad: 500 }]);
    enviar(conexion, apostar("H", 10));
    expect(await conexion.recibir()).toEqual({ t: "error", codigo: "apuesta_invalida" });
    enviar(conexion, apostar("S", 10));
    expect(((await conexion.recibir()) as Estado).vista.misApuestas).toEqual([
      { caballo: "H", cantidad: 500 },
      { caballo: "S", cantidad: 10 },
    ]);
    expect(await fichas(ana.id)).toBe(490);
    expect(await pendientesDe(codigo)).toBe(3);
  });
});

describe("MesaCarrera: los pasos de la carrera", () => {
  it("llegan solos, uno cada 800 ms, con el reloj: sin escribir nada, sin alarmas y sin avisar a la sala", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
    const conexion = await sentarse(codigo, ana.token);
    enviar(conexion, apostar("H", 50));
    await hasta(conexion, (m) => m.vista.misApuestas.length === 1);
    await vencer(codigo);
    await hasta(conexion, (m) => m.vista.fase === "carrera");
    await hasta<MensajeSala>(sala, (m) => m.mesas.carrera.fase === "carrera", "sala");

    // Desde aquí el reloj de la mesa corre de verdad, desde la salida.
    const escrituras = await vigilarEscrituras(codigo);
    await runInDurableObject(mesa(codigo), (m) => {
      const inicio = Date.now();
      m.ahora = () => SALIDA + (Date.now() - inicio);
    });
    const posiciones = { ...CEROS };
    for (const [i, carta] of CARTAS.slice(0, 3).entries()) {
      const paso: Estado = await conexion.recibir();
      posiciones[carta.palo] += 1;
      expect(paso.eventos).toEqual([{ tipo: "caballo_avanza", palo: carta.palo, carta }]);
      expect(paso.vista).toMatchObject({ fase: "carrera", posiciones, ultimaCarta: carta, finFase: PASO(i + 2) });
      expect(paso.ahora).toBeGreaterThanOrEqual(PASO(i + 1));
    }
    expect(escrituras).toEqual([]);
    expect(await alarmaDe(codigo)).toBe(FIN_CARRERA);
    expect(await pendientesDe(codigo)).toBe(1);

    // La meta llega con su alarma, después de los pasos que aún falten: cada uno una vez, en orden.
    const vistos: Estado[] = [];
    await vencer(codigo);
    await hasta(conexion, (m) => m.vista.fase === "resultado", "estado", vistos);
    const avances = vistos.flatMap((m) => m.eventos).filter((e) => e.tipo === "caballo_avanza");
    expect(avances).toEqual(CARTAS.slice(3).map((carta) => ({ tipo: "caballo_avanza", palo: carta.palo, carta })));
    expect(vistos.at(-1)!.eventos).toContainEqual({ tipo: "ganador", palo: "H" });
    expect(await fichas(ana.id)).toBe(1150);
    // La sala no ha sabido nada de los pasos: lo siguiente que recibe es el resultado.
    expect(((await sala.recibir("sala")) as MensajeSala).mesas.carrera.fase).toBe("resultado");
  });

  it("quien entra a mitad de carrera ve la pista a la hora de la mesa, sin eventos; los demás reciben antes los pasos vencidos", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    const conexionA = await sentarse(codigo, ana.token);
    enviar(conexionA, apostar("H", 50));
    await hasta(conexionA, (m) => m.vista.misApuestas.length === 1);
    await vencer(codigo);
    await hasta(conexionA, (m) => m.vista.fase === "carrera");

    await reloj(codigo, PASO(3) + 100);
    const conexionB = await sentarse(codigo, beto.token);
    const entrada: Estado = await conexionB.recibir();
    expect(entrada.eventos).toEqual([]);
    expect(entrada.vista).toMatchObject({ fase: "carrera", posiciones: { ...CEROS, H: 2, S: 1 }, ultimaCarta: CARTAS[2], finFase: PASO(4), misApuestas: [] });
    for (const contiene3 of [CARTAS[3], ...cs(TRAMOS)]) expect(contiene(entrada, contiene3)).toBe(false);

    const vistosA: Estado[] = [];
    await hasta(conexionA, (m) => m.vista.sentados.length === 2, "estado", vistosA);
    expect(vistosA.map((m) => m.eventos)).toEqual([
      ...CARTAS.slice(0, 3).map((carta) => [{ tipo: "caballo_avanza", palo: carta.palo, carta }]),
      [],
    ]);
  });

  it("si la mesa sale de memoria a mitad de carrera sigue desde la hora: no repite pasos y la meta liquida igual", async () => {
    const {
      codigo,
      js: [ana, beto],
    } = await nuevaMesa(2);
    // Con el reloj quieto, el temporizador de los pasos no dejaría salir de memoria a la mesa (como en producción mientras
    // corre una carrera): aquí no se pone.
    await runInDurableObject(mesa(codigo), (m) => {
      m.temporizar = () => () => {};
    });
    const conexionA = await sentarse(codigo, ana.token);
    enviar(conexionA, apostar("H", 50));
    await hasta(conexionA, (m) => m.vista.misApuestas.length === 1);
    await vencer(codigo);
    await reloj(codigo, PASO(2));
    // Beto entra en el paso 2: Ana recibe los pasos 1 y 2 antes que su llegada.
    const conexionB = await sentarse(codigo, beto.token);
    await hasta(conexionA, (m) => m.vista.sentados.length === 2);
    await conexionB.recibir();

    await evictDurableObject(mesa(codigo));
    await reloj(codigo, PASO(5));
    // Al despertar (Beto sale de la mesa) no se anuncian los pasos 3 a 5: se sigue desde ahora.
    enviar(conexionB, { t: "salir" });
    const tras: Estado = await hasta(conexionA, (m) => m.vista.sentados.length === 1);
    expect(tras.eventos).toEqual([]);
    expect(tras.vista).toMatchObject({ fase: "carrera", posiciones: { ...CEROS, H: 3, S: 2 }, ultimaCarta: CARTAS[4] });

    const vistos: Estado[] = [];
    await vencer(codigo);
    await hasta(conexionA, (m) => m.vista.fase === "resultado", "estado", vistos);
    expect(vistos.flatMap((m) => m.eventos).filter((e) => e.tipo === "caballo_avanza")).toEqual(
      CARTAS.slice(5).map((carta) => ({ tipo: "caballo_avanza", palo: carta.palo, carta })),
    );
    expect(await fichas(ana.id)).toBe(1150);
    expect(await pendientesDe(codigo)).toBe(0);
  });
});

describe("MesaCarrera: la sala", () => {
  it("la sala recibe el resumen de la carrera (no el del blackjack) y el ranking de la noche tras liquidar", async () => {
    const {
      codigo,
      js: [ana],
    } = await nuevaMesa(1);
    const sala = await abrir(`/parties/partida/${codigo}`, ana.token);
    expect(((await sala.recibir("sala")) as MensajeSala).rankingNoche).toEqual([]);

    const conexion = await sentarse(codigo, ana.token);
    const sentada = await hasta<MensajeSala>(sala, (m) => m.mesas.carrera.jugadores.length === 1, "sala");
    expect(sentada.mesas.carrera).toEqual({ jugadores: [ana.apodo], fase: "apuestas", finFase: T + CARRERA.APUESTAS_MS });
    expect(sentada.mesas.blackjack).toEqual({ jugadores: [], fase: "esperando", finFase: null });

    enviar(conexion, apostar("H", 50));
    await hasta(conexion, (m) => m.vista.misApuestas.length === 1);
    await vencer(codigo);
    // La apuesta no cambia el resumen: lo siguiente que ve la sala es la salida, sin cuenta atrás (no hay nada que contar).
    expect(((await sala.recibir("sala")) as MensajeSala).mesas.carrera).toEqual({ jugadores: [ana.apodo], fase: "carrera", finFase: null });
    await vencer(codigo);
    const liquidada = await hasta<MensajeSala>(sala, (m) => m.mesas.carrera.fase === "resultado", "sala");
    expect(liquidada.mesas.carrera).toEqual({ jugadores: [ana.apodo], fase: "resultado", finFase: FIN_CARRERA + CARRERA.RESULTADO_MS });
    expect(liquidada.mesas.blackjack).toEqual({ jugadores: [], fase: "esperando", finFase: null });
    expect(liquidada.rankingNoche).toEqual([{ apodo: ana.apodo, neto: 150 }]);
  });
});
