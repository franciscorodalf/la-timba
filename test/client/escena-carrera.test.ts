import { describe, expect, it } from "vitest";
import {
  aplicarMarco,
  type Escena,
  escenaDeVista,
  GANADOR_MS,
  GIRO_TRAMO_MS,
  PASO_COMPRIMIDO_MS,
  planDeLote,
  RETROCESO_MS,
} from "../../src/client/pantallas/carrera/escena";
import type { Carta, Palo } from "../../src/shared/cartas";
import type { VistaCarrera } from "../../src/shared/juegos/carrera";

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Palo, valor: texto.slice(0, -1) as Carta["valor"] });
const pos = (H: number, D: number, C: number, S: number): Record<Palo, number> => ({ H, D, C, S });

/** Las seis cartas de los tramos (`n` = cuántas se ven giradas). */
const tramosDe = (n: number): VistaCarrera["tramos"] => Array.from({ length: 6 }, (_, i) => (i < n ? c("5H") : null));

function vista(resto: Partial<VistaCarrera> = {}): VistaCarrera {
  return {
    ronda: 4,
    fase: "carrera",
    finFase: 0,
    posiciones: pos(0, 0, 0, 0),
    tramos: Array.from({ length: 6 }, () => null),
    ultimaCarta: null,
    misApuestas: [],
    totalesPorCaballo: pos(0, 0, 0, 0),
    sentados: [],
    ganador: null,
    ...resto,
  };
}

describe("escenaDeVista", () => {
  it("la foto de una vista: casillas, tramos girados, última carta y ganador; sin pagos ni festejo", () => {
    const e = escenaDeVista(vista({ posiciones: pos(3, 2, 4, 1), tramos: [c("5H"), c("KD"), null, null, null, null], ultimaCarta: c("2S"), ganador: null }));
    expect(e).toMatchObject({ ronda: 4, posiciones: pos(3, 2, 4, 1), girados: 2, ganador: null, festejo: 0, festejoDe: null, reparto: true, pagos: null, epoca: 0, origen: null });
    expect(e.cartas).toEqual([{ id: e.n, carta: c("2S") }]);
  });

  it("sin última carta no hay cartas junto al mazo", () => {
    expect(escenaDeVista(vista()).cartas).toEqual([]);
  });
});

describe("planDeLote", () => {
  it("la primera vista que llega se enseña tal cual, sin animar ni sonar", () => {
    const v = vista({ posiciones: pos(2, 1, 1, 1), ultimaCarta: c("3H") });
    const plan = planDeLote(null, [], v);
    expect(plan.marcos).toHaveLength(1);
    expect(plan.marcos[0]).toMatchObject({ en: 0, salto: true });
    expect(aplicarMarco(escenaDeVista(vista()), plan.marcos[0]).posiciones).toEqual(pos(2, 1, 1, 1));
    expect(plan.sonidos).toEqual([]);
  });

  it("un paso sin giros: el caballo avanza al llegar el mensaje, la carta sale junto al mazo y suena una vez", () => {
    const previa = escenaDeVista(vista({ posiciones: pos(1, 1, 1, 0) }));
    const v = vista({ posiciones: pos(1, 1, 1, 1), ultimaCarta: c("9S") });
    const plan = planDeLote(previa, [{ tipo: "caballo_avanza", palo: "S", carta: c("9S") }], v);
    expect(plan.marcos).toHaveLength(1);
    const [m] = plan.marcos;
    expect(m.en).toBe(0);
    const despues = aplicarMarco(previa, m);
    expect(despues.posiciones).toEqual(pos(1, 1, 1, 1));
    expect(despues.n).toBe(previa.n + 1);
    expect(despues.cartas.at(-1)).toEqual({ id: previa.n + 1, carta: c("9S") });
    expect(plan.sonidos).toEqual([0]);
  });

  it("de la carta de antes solo queda una debajo de la nueva", () => {
    let e = escenaDeVista(vista({ ultimaCarta: c("2S") }));
    for (const carta of ["3H", "4D"].map(c)) {
      const plan = planDeLote(e, [{ tipo: "caballo_avanza", palo: carta.palo, carta }], vista({ posiciones: { ...e.posiciones, [carta.palo]: e.posiciones[carta.palo] + 1 }, ultimaCarta: carta }));
      e = aplicarMarco(e, plan.marcos[0]);
    }
    expect(e.cartas.map((x) => x.carta)).toEqual([c("3H"), c("4D")]);
  });

  it("un paso con giro del mismo palo: avanza, después se gira el tramo y, ya visto, el caballo retrocede", () => {
    const previa = escenaDeVista(vista({ posiciones: pos(0, 1, 1, 1) }));
    // Sale un corazón: todos están en la casilla 1, se gira el tramo 0 (un corazón) y ese caballo vuelve a la 0.
    const v = vista({ posiciones: pos(0, 1, 1, 1), tramos: [c("5H"), null, null, null, null, null], ultimaCarta: c("7H") });
    const plan = planDeLote(previa, [{ tipo: "caballo_avanza", palo: "H", carta: c("7H") }, { tipo: "tramo_girado", indice: 0, palo: "H" }], v);
    expect(plan.marcos.map((m) => m.en)).toEqual([0, GIRO_TRAMO_MS, RETROCESO_MS]);
    expect(GIRO_TRAMO_MS).toBeLessThan(RETROCESO_MS);
    const [avanza, gira, retrocede] = plan.marcos;
    let e = aplicarMarco(previa, avanza);
    expect(e.posiciones).toEqual(pos(1, 1, 1, 1));
    expect(e.girados).toBe(0);
    e = aplicarMarco(e, gira);
    expect(e.girados).toBe(1);
    expect(e.posiciones.H).toBe(1);
    e = aplicarMarco(e, retrocede);
    expect(e.posiciones).toEqual(pos(0, 1, 1, 1));
    // Una vez al llegar el mensaje, una al girarse el tramo.
    expect(plan.sonidos).toEqual([0, GIRO_TRAMO_MS]);
  });

  it("un giro de otro palo: el caballo que retrocede no es el que avanzó", () => {
    const previa = escenaDeVista(vista({ posiciones: pos(1, 1, 0, 1) }));
    const v = vista({ posiciones: pos(0, 1, 1, 1), tramos: [c("5H"), null, null, null, null, null], ultimaCarta: c("4C") });
    const plan = planDeLote(previa, [{ tipo: "caballo_avanza", palo: "C", carta: c("4C") }, { tipo: "tramo_girado", indice: 0, palo: "H" }], v);
    let e = previa;
    for (const m of plan.marcos) e = aplicarMarco(e, m);
    expect(e.posiciones).toEqual(pos(0, 1, 1, 1));
    expect(plan.marcos).toHaveLength(3);
  });

  it("varios giros en un paso se escalonan y cada uno devuelve a su caballo", () => {
    const previa = escenaDeVista(vista({ posiciones: pos(2, 2, 1, 2) }));
    const v = vista({
      posiciones: pos(1, 1, 2, 2),
      tramos: [c("5H"), c("6D"), null, null, null, null, null],
      ultimaCarta: c("8C"),
    });
    const plan = planDeLote(
      previa,
      [
        { tipo: "caballo_avanza", palo: "C", carta: c("8C") },
        { tipo: "tramo_girado", indice: 0, palo: "H" },
        { tipo: "tramo_girado", indice: 1, palo: "D" },
      ],
      v,
    );
    let e = previa;
    const girados: number[] = [];
    for (const m of plan.marcos) {
      e = aplicarMarco(e, m);
      girados.push(e.girados);
    }
    expect(girados).toEqual([0, 1, 1, 2, 2]);
    const tiempos = plan.marcos.map((m) => m.en);
    expect([...tiempos].sort((a, b) => a - b)).toEqual(tiempos);
    expect(e.posiciones).toEqual(pos(1, 1, 2, 2));
  });

  it("el ganador: tras el último avance se anuncia, se festeja una vez y, un momento después, llegan los pagos", () => {
    const previa = escenaDeVista(vista({ posiciones: pos(3, 7, 2, 1), ultimaCarta: c("2D") }));
    const v = vista({ fase: "resultado", posiciones: pos(3, 8, 2, 1), ultimaCarta: c("9D"), ganador: "D" });
    const plan = planDeLote(
      previa,
      [
        { tipo: "caballo_avanza", palo: "D", carta: c("9D") },
        { tipo: "ganador", palo: "D" },
        { tipo: "pago", jugadorId: 7, neto: 150 },
        { tipo: "pago", jugadorId: 8, neto: -50 },
      ],
      v,
    );
    expect(plan.marcos.map((m) => m.en)[0]).toBe(0);
    let e = previa;
    const pasos: Escena[] = [];
    for (const m of plan.marcos) {
      e = aplicarMarco(e, m);
      pasos.push(e);
    }
    const iGanador = pasos.findIndex((p) => p.ganador === "D");
    expect(plan.marcos[iGanador].en).toBe(GANADOR_MS);
    expect(pasos[iGanador].festejo).toBe(previa.festejo + 1);
    expect(pasos[iGanador].festejoDe).toBe("D");
    expect(pasos[iGanador].pagos).toBeNull();
    const iPagos = pasos.findIndex((p) => p.pagos !== null);
    expect(iPagos).toBeGreaterThan(iGanador);
    expect(plan.marcos[iPagos].en).toBeGreaterThan(GANADOR_MS);
    expect([...(e.pagos?.netos ?? [])]).toEqual([
      [7, 150],
      [8, -50],
    ]);
    expect(e.posiciones.D).toBe(8);
  });

  it("al volver la conexión con la carrera en marcha (sin eventos), las casillas se enseñan de golpe y la pista se vuelve a montar", () => {
    const previa = escenaDeVista(vista({ posiciones: pos(1, 1, 0, 0) }));
    const v = vista({ posiciones: pos(4, 3, 3, 2), tramos: [c("5H"), c("6D"), null, null, null, null, null], ultimaCarta: c("KS") });
    const plan = planDeLote(previa, [], v);
    expect(plan.marcos).toHaveLength(1);
    expect(plan.marcos[0]).toMatchObject({ en: 0, salto: true });
    const e = aplicarMarco(previa, plan.marcos[0]);
    expect(e.posiciones).toEqual(pos(4, 3, 3, 2));
    expect(e.girados).toBe(2);
    expect(e.epoca).toBe(previa.epoca + 1);
    expect(e.origen).toBeNull();
    expect(plan.sonidos).toEqual([]);
  });

  it("al volver de una desconexión no se vuelven a colocar los tramos ni hay destellos aunque se hubiera festejado otra carrera", () => {
    // Antes de caerse la conexión se había festejado una victoria (el contador sigue en la escena).
    const previa = { ...escenaDeVista(vista({ fase: "apuestas", ronda: 6 })), festejo: 3, festejoDe: "H" as const, reparto: false };
    const v = vista({ fase: "resultado", ronda: 6, posiciones: pos(3, 8, 2, 4), ganador: "D", ultimaCarta: c("JD"), tramos: tramosDe(7) });
    const plan = planDeLote(previa, [], v);
    expect(plan.marcos).toHaveLength(1);
    const e = aplicarMarco(previa, plan.marcos[0]);
    // Ya con el ganador a la vista, pero sin nadie a quien festejar: los destellos solo salen en el instante de ganar.
    expect(e.ganador).toBe("D");
    expect(e.festejoDe).toBeNull();
    expect(e.festejo).toBe(3);
    expect(e.reparto).toBe(false);
  });

  it("un lote sin carrera ni cambios (otro jugador apuesta) no toca la escena", () => {
    const previa = escenaDeVista(vista({ fase: "apuestas", posiciones: pos(0, 0, 0, 0) }));
    expect(planDeLote(previa, [], vista({ fase: "apuestas", totalesPorCaballo: pos(50, 0, 0, 0) })).marcos).toEqual([]);
  });

  it("una ronda nueva devuelve los caballos a la salida sin recargar la pista y limpia cartas y ganador", () => {
    const previa = escenaDeVista(vista({ fase: "resultado", ronda: 4, posiciones: pos(3, 8, 2, 1), ultimaCarta: c("9D"), ganador: "D", tramos: [c("5H"), c("6D"), c("7C"), null, null, null, null] }));
    const plan = planDeLote(previa, [], vista({ fase: "apuestas", ronda: 5 }));
    expect(plan.marcos).toHaveLength(1);
    expect(plan.marcos[0].salto).toBeFalsy();
    const e = aplicarMarco(previa, plan.marcos[0]);
    expect(e).toMatchObject({ ronda: 5, posiciones: pos(0, 0, 0, 0), girados: 0, cartas: [], ganador: null, festejoDe: null, reparto: true, pagos: null, epoca: previa.epoca });
  });

  it("si lo que se animó no cuadra con la vista (se perdió un paso), al final las casillas son las de la vista", () => {
    const previa = escenaDeVista(vista({ posiciones: pos(1, 1, 1, 1) }));
    const v = vista({ posiciones: pos(3, 1, 1, 1), ultimaCarta: c("4H") });
    const plan = planDeLote(previa, [{ tipo: "caballo_avanza", palo: "H", carta: c("4H") }], v);
    let e = previa;
    for (const m of plan.marcos) e = aplicarMarco(e, m);
    expect(e.posiciones).toEqual(pos(3, 1, 1, 1));
  });

  it("dos pasos juntos (React juntó dos mensajes): el segundo sale tras el primero y suenan los dos", () => {
    const previa = escenaDeVista(vista({ posiciones: pos(0, 0, 0, 0) }));
    const v = vista({ posiciones: pos(1, 0, 0, 1), ultimaCarta: c("6S") });
    const plan = planDeLote(
      previa,
      [
        { tipo: "caballo_avanza", palo: "H", carta: c("3H") },
        { tipo: "caballo_avanza", palo: "S", carta: c("6S") },
      ],
      v,
    );
    expect(plan.marcos.map((m) => m.en)).toEqual([0, PASO_COMPRIMIDO_MS]);
    expect(plan.sonidos).toEqual([0, PASO_COMPRIMIDO_MS]);
    let e = previa;
    for (const m of plan.marcos) e = aplicarMarco(e, m);
    expect(e.posiciones).toEqual(pos(1, 0, 0, 1));
    expect(e.cartas.map((x) => x.carta)).toEqual([c("3H"), c("6S")]);
  });

  it("los pagos de quien deja la mesa sin carrera (todos pierden) también llegan", () => {
    const previa = escenaDeVista(vista({ fase: "apuestas", ronda: 4 }));
    const plan = planDeLote(previa, [{ tipo: "pago", jugadorId: 7, neto: -50 }], vista({ fase: "esperando", ronda: 5 }));
    let e = previa;
    for (const m of plan.marcos) e = aplicarMarco(e, m);
    expect(e.ronda).toBe(5);
    expect([...(e.pagos?.netos ?? [])]).toEqual([[7, -50]]);
  });
});
