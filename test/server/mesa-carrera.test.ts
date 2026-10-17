import { env } from "cloudflare:workers";
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

const { estadoMesa, alarmaDe, vencer, nuevaMesa: nuevaMesaCon, sentarse } = ayudasMesa(env.MesaCarrera, "mesa-carrera");

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
/** Instante en que acaba la carrera (y empieza `resultado`), con el reloj de la mesa llevado siempre al fin de cada fase. */
const FIN_CARRERA = T + CARRERA.APUESTAS_MS + PASOS * CARRERA.PASO_MS;

const apostar = (caballo: Palo, cantidad: number): AccionCarrera => ({ t: "apostar", caballo, cantidad });
const CEROS: Record<Palo, number> = { H: 0, D: 0, C: 0, S: 0 };

/** Registra `n` jugadores, abre una partida del primero y prepara su mesa con la pista y el mazo fijos de arriba. */
const nuevaMesa = (n: number) => nuevaMesaCon(n, { ...carrera.crear(T, rngFijo(0.5)), tramos: cs(TRAMOS), mazo: CARTAS });

/** Cierra las apuestas y deja que la carrera avance hasta la meta: una alarma por la ventana y otra por cada carta. */
async function correr(codigo: string): Promise<void> {
  for (let i = 0; i <= PASOS; i++) await vencer(codigo);
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
    expect(salida.vista).toMatchObject({ fase: "carrera", finFase: T + CARRERA.APUESTAS_MS + CARRERA.PASO_MS, posiciones: CEROS, ultimaCarta: null });
    expect(salida.eventos).toEqual([]);

    // Una carta por alarma; su caballo avanza una casilla.
    const posiciones = { ...CEROS };
    for (const [i, carta] of CARTAS.entries()) {
      await vencer(codigo);
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
        expect(await pendientesDe(codigo)).toBe(2); // hasta la meta, las dos apuestas siguen sin liquidar
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
    await correr(codigo);
    const liquidada = await hasta<MensajeSala>(sala, (m) => m.mesas.carrera.fase === "resultado", "sala");
    expect(liquidada.mesas.carrera).toEqual({ jugadores: [ana.apodo], fase: "resultado", finFase: FIN_CARRERA + CARRERA.RESULTADO_MS });
    expect(liquidada.mesas.blackjack).toEqual({ jugadores: [], fase: "esperando", finFase: null });
    expect(liquidada.rankingNoche).toEqual([{ apodo: ana.apodo, neto: 150 }]);
  });
});
