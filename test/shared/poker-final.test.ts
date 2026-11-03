import { describe, expect, it } from "vitest";
import { POKER, opcionesDe, poker, type EstadoPoker } from "../../src/shared/juegos/poker";
import type { Evento, JugadorId } from "../../src/shared/juegos/tipos";
import { cs } from "../ayudas";
import { T0, aplicar, asiento, conBaraja, error, intentar, mesaCon, rng, turno, vistaDe } from "./ayudas-poker";

/** Fija las cartas de los jugadores y las cinco de la mesa, con una carta quemada antes de cada grupo. */
function conCartas(e: EstadoPoker, manos: Record<JugadorId, string>, mesa: string): EstadoPoker {
  const [flop1, flop2, flop3, turn, river] = cs(mesa);
  const [quemada] = cs("2C");
  const asientos = e.asientos.map((a) => (manos[a.jugadorId] === undefined ? a : { ...a, cartas: cs(manos[a.jugadorId]) }));
  return { ...conBaraja(e, [quemada, flop1, flop2, flop3, quemada, turn, quemada, river]), asientos };
}

/** Quien tenga el turno pasa o iguala hasta que sale la calle `hasta`. */
function jugarHasta(e: EstadoPoker, hasta: "turn" | "river"): EstadoPoker {
  let s = e;
  while (s.fase === "mano" && s.calle !== hasta) {
    const id = turno(s)!;
    s = aplicar(s, id, { t: opcionesDe(s, id)!.pasar ? "pasar" : "igualar" }).estado;
  }
  return s;
}

/** Quien tenga el turno pasa o iguala hasta que acaba la mano. Devuelve la última acción: sus eventos son los de cerrarla. */
function ultimaAccion(e: EstadoPoker) {
  let s = e;
  for (;;) {
    const id = turno(s)!;
    const p = aplicar(s, id, { t: opcionesDe(s, id)!.pasar ? "pasar" : "igualar" });
    if (p.estado.fase !== "mano") return p;
    s = p.estado;
  }
}

const tick = (e: EstadoPoker, ahora = T0) => {
  const p = poker.tick(e, ahora, rng);
  if (!p.ok) throw new Error(p.error);
  return p;
};

const delTipo = (eventos: Evento[], tipo: string) => eventos.filter((x) => x.tipo === tipo);
const quienesEnsenan = (eventos: Evento[]) => delTipo(eventos, "cartas_ensenadas").map((x) => x.jugadorId);
const fichas = (e: EstadoPoker) => e.asientos.map((a) => a.fichas);

function comprobarPagado(e: EstadoPoker) {
  expect(e.asientos.map((a) => a.aportado)).toEqual(e.asientos.map(() => 0));
  expect(e.asientos.map((a) => a.apostado)).toEqual(e.asientos.map(() => 0));
  expect(e.abandonos).toEqual([]);
}

describe("póker: el final de la mano", () => {
  it("si todos se retiran, el último gana sin enseñar", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 1, { t: "retirarse" }).estado;
    const { estado, eventos } = aplicar(e, 2, { t: "retirarse" }, T0 + 2);
    expect(eventos).toEqual([
      { tipo: "accion", jugadorId: 2, accion: "retirarse", cantidad: 0 },
      { tipo: "bote_devuelto", jugadorId: 3, cantidad: 5 },
      { tipo: "bote_ganado", jugadorId: 3, cantidad: 10, indiceBote: 0 },
    ]);
    expect(fichas(estado)).toEqual([100, 95, 105]);
    expect(estado).toMatchObject({ fase: "resultado", turno: null, finFase: T0 + 2 + POKER.RESULTADO_MS, mesa: [] });
    expect(estado.botes).toEqual([{ cantidad: 10, jugadores: [3] }]);
    expect(asiento(estado, 3).ensenadas).toBe(false);
    comprobarPagado(estado);
  });

  it("con 2 jugadores, retirarse da el bote al otro", () => {
    const { estado } = aplicar(mesaCon([100, 100]), 1, { t: "retirarse" });
    expect(fichas(estado)).toEqual([95, 105]);
    expect(estado.fase).toBe("resultado");
    comprobarPagado(estado);
  });

  it("quien se levanta a mitad deja lo aportado en el bote de los demás", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 1, { t: "subir", hasta: 40 }).estado;
    e = aplicar(e, 2, { t: "levantarse" }).estado;
    expect(e.abandonos).toEqual([{ jugadorId: 2, aportado: 5 }]);
    const { estado, eventos } = aplicar(e, 3, { t: "retirarse" });
    expect(eventos).toContainEqual({ tipo: "bote_devuelto", jugadorId: 1, cantidad: 30 });
    expect(eventos).toContainEqual({ tipo: "bote_ganado", jugadorId: 1, cantidad: 25, indiceBote: 0 });
    expect(fichas(estado)).toEqual([115, 90]);
    comprobarPagado(estado);
  });

  it("si solo se quedan quienes no pusieron nada, se llevan lo que dejaron los demás", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 2, { t: "levantarse" }).estado;
    const { estado, eventos } = aplicar(e, 3, { t: "levantarse" });
    expect(eventos).toContainEqual({ tipo: "bote_ganado", jugadorId: 1, cantidad: 15, indiceBote: 0 });
    expect(fichas(estado)).toEqual([115]);
    comprobarPagado(estado);
  });

  it("en el enfrentamiento enseña primero el último que subió", () => {
    let e = conCartas(mesaCon([100, 100]), { 1: "2H 7D", 2: "AH AD" }, "3S 8C 9D JH KC");
    e = jugarHasta(e, "river");
    e = aplicar(e, 2, { t: "pasar" }).estado;
    e = aplicar(e, 1, { t: "subir", hasta: 20 }).estado;
    const { estado, eventos } = aplicar(e, 2, { t: "igualar" });
    expect(eventos.slice(1)).toEqual([
      { tipo: "cartas_ensenadas", jugadorId: 1, cartas: cs("2H 7D") },
      { tipo: "cartas_ensenadas", jugadorId: 2, cartas: cs("AH AD") },
      { tipo: "bote_ganado", jugadorId: 2, cantidad: 60, indiceBote: 0 },
    ]);
    expect(fichas(estado)).toEqual([70, 130]);
  });

  it("si gana quien subió, el otro no enseña", () => {
    let e = conCartas(mesaCon([100, 100]), { 1: "AH AD", 2: "2H 7D" }, "3S 8C 9D JH KC");
    e = jugarHasta(e, "river");
    e = aplicar(e, 2, { t: "pasar" }).estado;
    e = aplicar(e, 1, { t: "subir", hasta: 20 }).estado;
    const { estado, eventos } = aplicar(e, 2, { t: "igualar" });
    expect(quienesEnsenan(eventos)).toEqual([1]);
    expect(vistaDe(estado, 1).asientos[1].cartas).toBeNull();
  });

  it("sin subidas, el primero a la izquierda del botón", () => {
    const e = conCartas(mesaCon([100, 100, 100]), { 1: "4H 7D", 2: "QH QD", 3: "AH AD" }, "3S 8C 9D JH KC");
    const { estado, eventos } = ultimaAccion(e);
    // Enseña el 2, le mejora el 3, y el 1, el botón, habla el último y pierde.
    expect(quienesEnsenan(eventos)).toEqual([2, 3]);
    expect(fichas(estado)).toEqual([90, 90, 120]);
    expect(vistaDe(estado, 3).asientos.map((a) => a.cartas !== null)).toEqual([false, true, true]);
  });

  it("un empate con la mejor enseñada también se enseña", () => {
    const e = conCartas(mesaCon([100, 100, 100]), { 1: "2H 3D", 2: "AH KD", 3: "AD KH" }, "AS KS 9D 9H 4C");
    const { estado, eventos } = ultimaAccion(e);
    expect(quienesEnsenan(eventos)).toEqual([2, 3]);
    expect(fichas(estado)).toEqual([90, 105, 105]);
  });

  it("quien pierde no enseña y quien gana un bote paralelo sí", () => {
    let e = conCartas(mesaCon([100, 20, 100]), { 1: "4H 7D", 2: "AH AD", 3: "QH QD" }, "3S 8C 9D JH 2S");
    // El 2 va all-in por 20 y el 1 y el 3 siguen en un bote paralelo.
    e = aplicar(e, 1, { t: "subir", hasta: 20 }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    e = aplicar(e, 3, { t: "igualar" }).estado;
    e = aplicar(e, 3, { t: "subir", hasta: 30 }).estado;
    e = aplicar(e, 1, { t: "igualar" }).estado;
    const { estado, eventos } = ultimaAccion(e);
    // El 2 gana el bote principal; el 3 enseña porque gana el paralelo aunque no llegue a los ases; el 1 no gana nada.
    expect(quienesEnsenan(eventos)).toEqual([2, 3]);
    expect(delTipo(eventos, "bote_ganado")).toEqual([
      { tipo: "bote_ganado", jugadorId: 2, cantidad: 60, indiceBote: 0 },
      { tipo: "bote_ganado", jugadorId: 3, cantidad: 60, indiceBote: 1 },
    ]);
    expect(estado.botes).toEqual([
      { cantidad: 60, jugadores: [1, 2, 3] },
      { cantidad: 60, jugadores: [1, 3] },
    ]);
    expect(fichas(estado)).toEqual([50, 60, 110]);
  });

  it("dos all-in y un tercero: cada uno cobra lo que le toca", () => {
    let e = conCartas(mesaCon([50, 20, 100]), { 1: "4H 7D", 2: "AH AD", 3: "QH QD" }, "3S 8C 9D JH 2S");
    e = aplicar(e, 1, { t: "subir", hasta: 50 }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    const { estado } = aplicar(e, 3, { t: "igualar" });
    expect(fichas(estado)).toEqual([0, 60, 110]);
    comprobarPagado(estado);
  });

  it("empate con ficha impar: va al primero a la izquierda del botón", () => {
    // Las cartas de la mesa juegan solas: empatan el 1 y el 3 y el bote es de 25, impar. El 1 es el botón: la ficha va al 3.
    let e = conCartas(mesaCon([100, 100, 100]), { 1: "2C 3D", 2: "4H 5H", 3: "2D 3C" }, "10S JS QS KS AS");
    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "retirarse" }).estado;
    const { estado, eventos } = ultimaAccion(e);
    expect(delTipo(eventos, "bote_ganado")).toEqual([
      { tipo: "bote_ganado", jugadorId: 3, cantidad: 13, indiceBote: 0 },
      { tipo: "bote_ganado", jugadorId: 1, cantidad: 12, indiceBote: 0 },
    ]);
    expect(fichas(estado)).toEqual([102, 95, 103]);
  });

  it("lo que nadie iguala vuelve antes de comparar", () => {
    let e = conCartas(mesaCon([100, 30]), { 1: "4H 7D", 2: "AH AD" }, "3S 8C 9D JH 2S");
    e = aplicar(e, 1, { t: "subir", hasta: 100 }).estado;
    const { estado, eventos } = aplicar(e, 2, { t: "igualar" });
    expect(eventos.map((x) => x.tipo)).toEqual(["accion", "bote_devuelto", "cartas_ensenadas", "cartas_ensenadas", "calle_abierta", "calle_abierta", "calle_abierta", "bote_ganado"]);
    expect(eventos[1]).toEqual({ tipo: "bote_devuelto", jugadorId: 1, cantidad: 70 });
    expect(estado.botes).toEqual([{ cantidad: 60, jugadores: [1, 2] }]);
    expect(fichas(estado)).toEqual([70, 60]);
  });

  it("lo que nadie iguala en el river también vuelve antes de enseñar", () => {
    let e = conCartas(mesaCon([100, 100, 40]), { 1: "4H 7D", 2: "4C 5C", 3: "AH AD" }, "3S 8C 9D JH 2S");
    e = jugarHasta(e, "river");
    e = aplicar(e, 2, { t: "subir", hasta: 60 }).estado;
    e = aplicar(e, 3, { t: "igualar" }).estado;
    expect(asiento(e, 3).estado).toBe("allin");
    const { estado, eventos } = aplicar(e, 1, { t: "retirarse" });
    expect(eventos.map((x) => x.tipo)).toEqual(["accion", "bote_devuelto", "cartas_ensenadas", "cartas_ensenadas", "bote_ganado"]);
    expect(eventos[1]).toEqual({ tipo: "bote_devuelto", jugadorId: 2, cantidad: 30 });
    expect(fichas(estado)).toEqual([90, 60, 90]);
    expect(estado.botes).toEqual([{ cantidad: 90, jugadores: [2, 3] }]);
  });

  it("todos all-in: se destapan antes de abrir la mesa y resultado se alarga", () => {
    let e = conCartas(mesaCon([100, 100, 100]), { 1: "AH AD", 2: "QH QD", 3: "KH KD" }, "3S 8C 9D JH 2S");
    e = aplicar(e, 1, { t: "subir", hasta: 100 }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    const { estado, eventos } = aplicar(e, 3, { t: "igualar" }, T0 + 7);
    expect(eventos).toEqual([
      { tipo: "accion", jugadorId: 3, accion: "allin", cantidad: 90 },
      { tipo: "cartas_ensenadas", jugadorId: 1, cartas: cs("AH AD") },
      { tipo: "cartas_ensenadas", jugadorId: 2, cartas: cs("QH QD") },
      { tipo: "cartas_ensenadas", jugadorId: 3, cartas: cs("KH KD") },
      { tipo: "calle_abierta", calle: "flop", cartas: cs("3S 8C 9D") },
      { tipo: "calle_abierta", calle: "turn", cartas: cs("JH") },
      { tipo: "calle_abierta", calle: "river", cartas: cs("2S") },
      { tipo: "bote_ganado", jugadorId: 1, cantidad: 300, indiceBote: 0 },
    ]);
    expect(estado).toMatchObject({ fase: "resultado", turno: null, finFase: T0 + 7 + POKER.RESULTADO_MS + 3 * POKER.CALLE_MS });
    expect(fichas(estado)).toEqual([300, 0, 0]);
  });

  it("all-in en el turn: solo se alarga por la carta que falta", () => {
    let e = conCartas(mesaCon([100, 100]), { 1: "AH AD", 2: "QH QD" }, "3S 8C 9D JH 2S");
    e = jugarHasta(e, "turn");
    e = aplicar(e, 2, { t: "subir", hasta: 90 }).estado;
    const { estado, eventos } = aplicar(e, 1, { t: "igualar" });
    expect(eventos.map((x) => x.tipo)).toEqual(["accion", "cartas_ensenadas", "cartas_ensenadas", "calle_abierta", "bote_ganado"]);
    expect(estado.finFase).toBe(T0 + POKER.RESULTADO_MS + POKER.CALLE_MS);
  });

  it("all-in en el river: no queda nada por abrir y enseña solo quien alcanza a la mejor", () => {
    let e = conCartas(mesaCon([100, 100]), { 1: "2H 7D", 2: "AH AD" }, "3S 8C 9D JH KC");
    e = jugarHasta(e, "river");
    e = aplicar(e, 2, { t: "subir", hasta: 90 }).estado;
    const { estado, eventos } = aplicar(e, 1, { t: "igualar" });
    expect(quienesEnsenan(eventos)).toEqual([2]);
    expect(estado.finFase).toBe(T0 + POKER.RESULTADO_MS);
  });

  it("un solo jugador con fichas y los demás all-in: salen las cartas sin más apuestas", () => {
    let e = conCartas(mesaCon([200, 50, 50]), { 1: "AH AD", 2: "QH QD", 3: "KH KD" }, "3S 8C 9D JH 2S");
    e = aplicar(e, 1, { t: "subir", hasta: 100 }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    const { estado, eventos } = aplicar(e, 3, { t: "igualar" });
    expect(eventos).toContainEqual({ tipo: "bote_devuelto", jugadorId: 1, cantidad: 50 });
    expect(quienesEnsenan(eventos)).toEqual([1, 2, 3]);
    expect(estado).toMatchObject({ fase: "resultado", turno: null, finFase: T0 + POKER.RESULTADO_MS + 3 * POKER.CALLE_MS });
    expect(estado.mesa).toHaveLength(5);
    expect(fichas(estado)).toEqual([300, 0, 0]);
  });

  it("si se levanta el último rival con fichas, los que quedan se destapan y sale la mesa", () => {
    let e = conCartas(mesaCon([50, 100, 100]), { 1: "AH AD", 2: "QH QD", 3: "KH KD" }, "3S 8C 9D JH 2S");
    e = aplicar(e, 1, { t: "subir", hasta: 50 }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    e = aplicar(e, 3, { t: "igualar" }).estado;
    const { estado, eventos } = aplicar(e, 3, { t: "levantarse" }, T0 + 1);
    expect(quienesEnsenan(eventos)).toEqual([2, 1]);
    // Ya estaba el flop: faltan dos grupos.
    expect(estado.finFase).toBe(T0 + 1 + POKER.RESULTADO_MS + 2 * POKER.CALLE_MS);
    expect(fichas(estado)).toEqual([150, 50]);
    comprobarPagado(estado);
  });
});

describe("póker: el tiempo y las faltas", () => {
  it("antes de que venza el turno, el tick no hace nada", () => {
    const e = mesaCon([100, 100, 100]);
    expect(tick(e, T0 + POKER.TURNO_MS - 1).estado).toBe(e);
  });

  it("se acaba el tiempo: pasa si puede y si no se retira, con una falta", () => {
    let e = mesaCon([100, 100, 100]);
    const fin = T0 + POKER.TURNO_MS;
    const retirado = tick(e, fin);
    expect(retirado.eventos).toEqual([{ tipo: "accion", jugadorId: 1, accion: "retirarse", cantidad: 0 }]);
    expect(asiento(retirado.estado, 1)).toMatchObject({ estado: "retirado", faltas: 1 });
    expect(retirado.estado).toMatchObject({ finFase: fin + POKER.TURNO_MS });

    e = aplicar(mesaCon([100, 100, 100]), 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    const pasado = tick(e, fin);
    expect(pasado.eventos[0]).toEqual({ tipo: "accion", jugadorId: 3, accion: "pasar", cantidad: 0 });
    expect(asiento(pasado.estado, 3)).toMatchObject({ estado: "juega", faltas: 1 });
    expect(pasado.estado.calle).toBe("flop");
  });

  it("el tiempo también puede cerrar la mano", () => {
    const e = aplicar(mesaCon([100, 100, 100]), 1, { t: "retirarse" }).estado;
    const { estado, eventos } = tick(e, T0 + POKER.TURNO_MS);
    expect(delTipo(eventos, "bote_ganado")).toEqual([{ tipo: "bote_ganado", jugadorId: 3, cantidad: 10, indiceBote: 0 }]);
    expect(asiento(estado, 2).faltas).toBe(1);
    expect(estado.fase).toBe("resultado");
  });

  it("actuar borra las faltas", () => {
    const conFalta = (e: EstadoPoker): EstadoPoker => ({ ...e, asientos: e.asientos.map((a) => ({ ...a, faltas: 1 })) });
    const e = conFalta(mesaCon([100, 100, 100]));
    expect(asiento(aplicar(e, 1, { t: "igualar" }).estado, 1).faltas).toBe(0);
    expect(asiento(aplicar(e, 1, { t: "subir", hasta: 30 }).estado, 1).faltas).toBe(0);
    expect(asiento(aplicar(e, 1, { t: "retirarse" }).estado, 1).faltas).toBe(0);
    expect(asiento(aplicar(e, 2, { t: "anadir", fichas: 50 }).estado, 2).faltas).toBe(0);

    const pasar = aplicar(aplicar(e, 1, { t: "igualar" }).estado, 2, { t: "igualar" }).estado;
    expect(asiento(aplicar(pasar, 3, { t: "pasar" }).estado, 3).faltas).toBe(0);

    const resultado = aplicar(aplicar(e, 1, { t: "retirarse" }).estado, 2, { t: "retirarse" }).estado;
    expect(asiento(aplicar(resultado, 3, { t: "ensenar" }).estado, 3).faltas).toBe(0);
  });

  it("una acción que no vale no borra las faltas", () => {
    const e = mesaCon([100, 100, 100]);
    const conFalta = { ...e, asientos: e.asientos.map((a) => ({ ...a, faltas: 1 })) };
    expect(error(intentar(conFalta, 2, { t: "pasar" }))).toBe("accion_invalida");
    expect(asiento(conFalta, 2).faltas).toBe(1);
  });

  it("dos faltas te levantan al acabar la mano", () => {
    let e = mesaCon([100, 100, 100]);
    e = { ...e, asientos: e.asientos.map((a) => (a.jugadorId === 1 ? { ...a, faltas: POKER.FALTAS_MAX - 1 } : a)) };
    e = tick(e, T0 + POKER.TURNO_MS).estado;
    expect(asiento(e, 1).faltas).toBe(POKER.FALTAS_MAX);
    e = aplicar(e, 2, { t: "retirarse" }).estado;
    expect(e.fase).toBe("resultado");
    // Sigue sentado hasta que cierra `resultado`, para ver el final de la mano.
    expect(asiento(e, 1).faltas).toBe(POKER.FALTAS_MAX);

    const { estado, liquidaciones } = tick(e, e.finFase!);
    expect(liquidaciones).toEqual([{ ronda: 1, filas: [{ jugadorId: 1, apuesta: 100, pago: 100 }] }]);
    expect(estado.asientos.map((a) => a.jugadorId)).toEqual([2, 3]);
  });

  it("desconectado te levantas al acabar la mano", () => {
    const e = mesaCon([100, 100, 100]);
    const desconectado = poker.desconectar(e, 2, T0, rng);
    if (!desconectado.ok) throw new Error(desconectado.error);
    expect(desconectado.estado).toMatchObject({ fase: "mano", turno: 0 });
    let s = aplicar(desconectado.estado, 1, { t: "retirarse" }).estado;
    expect(turno(s)).toBe(2);
    s = tick(s, T0 + POKER.TURNO_MS).estado;
    expect(s.fase).toBe("resultado");
    const { estado, liquidaciones } = tick(s, s.finFase!);
    expect(liquidaciones).toEqual([{ ronda: 2, filas: [{ jugadorId: 2, apuesta: 100, pago: 95 }] }]);
    expect(estado.asientos.map((a) => a.jugadorId)).toEqual([1, 3]);
  });

  it("entre manos te levantas en el acto", () => {
    const solo = aplicar(poker.crear(T0, rng), 1, { t: "sentarse", fichas: 100 }).estado;
    const p = poker.desconectar(solo, 1, T0, rng);
    if (!p.ok) throw new Error(p.error);
    expect(p.estado.asientos).toEqual([]);
    expect(p.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 100, pago: 100 }] });
  });

  it("en resultado desconectarte no te levanta hasta que acaba", () => {
    const e = aplicar(aplicar(mesaCon([100, 100, 100]), 1, { t: "retirarse" }).estado, 2, { t: "retirarse" }).estado;
    const p = poker.desconectar(e, 1, T0, rng);
    if (!p.ok) throw new Error(p.error);
    expect(asiento(p.estado, 1).conectado).toBe(false);
    expect(p.liquidacion).toBeUndefined();
    expect(tick(p.estado, p.estado.finFase!).estado.asientos.map((a) => a.jugadorId)).toEqual([2, 3]);
  });

  it("volver a tiempo te mantiene sentado", () => {
    const e = mesaCon([100, 100, 100]);
    const fuera = poker.desconectar(e, 1, T0, rng);
    if (!fuera.ok) throw new Error(fuera.error);
    const vuelta = poker.sentar(fuera.estado, 1, "J1", T0);
    if (!vuelta.ok) throw new Error(vuelta.error);
    const s = aplicar(aplicar(vuelta.estado, 1, { t: "retirarse" }).estado, 2, { t: "retirarse" }).estado;
    const { estado, liquidaciones } = tick(s, s.finFase!);
    expect(liquidaciones).toBeUndefined();
    expect(estado.asientos.map((a) => a.jugadorId)).toEqual([1, 2, 3]);
  });
});

describe("póker: entre una mano y la siguiente", () => {
  /** La mano de `mesaCon` jugada a all-in entre el 1 y el 2: gana el 1 y el 2 se queda a cero. */
  function conUnoACero(): EstadoPoker {
    let e = conCartas(mesaCon([100, 100, 100]), { 1: "AH AD", 2: "QH QD" }, "3S 8C 9D JH 2S");
    e = aplicar(e, 1, { t: "subir", hasta: 100 }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    return e;
  }

  it("resultado no acaba antes de tiempo", () => {
    const e = aplicar(aplicar(conUnoACero(), 3, { t: "retirarse" }).estado, 2, { t: "anadir", fichas: 10 }).estado;
    expect(tick(e, e.finFase! - 1).estado).toBe(e);
  });

  it("al cerrar resultado empieza otra mano y el botón pasa al siguiente", () => {
    const e = aplicar(aplicar(mesaCon([100, 100, 100]), 1, { t: "retirarse" }).estado, 2, { t: "retirarse" }).estado;
    const { estado, eventos } = tick(e, e.finFase!);
    expect(eventos[0]).toEqual({ tipo: "mano_empezada", ronda: 2, boton: 1 });
    expect(estado).toMatchObject({ fase: "mano", ronda: 2, boton: 1, calle: "preflop", botes: [], mesa: [], finFase: e.finFase! + POKER.TURNO_MS });
    expect(estado.asientos.map((a) => a.ensenadas)).toEqual([false, false, false]);
  });

  it("a cero te levantas, pero no si tienes algo añadido", () => {
    const s = aplicar(conUnoACero(), 3, { t: "retirarse" }).estado;
    expect(asiento(s, 2).fichas).toBe(0);

    const levantado = tick(s, s.finFase!);
    expect(levantado.liquidaciones).toEqual([{ ronda: 2, filas: [{ jugadorId: 2, apuesta: 100, pago: 0 }] }]);
    expect(levantado.estado.asientos.map((a) => a.jugadorId)).toEqual([1, 3]);

    const conAnadido = aplicar(s, 2, { t: "anadir", fichas: 30 }).estado;
    const sigue = tick(conAnadido, conAnadido.finFase!);
    expect(sigue.liquidaciones).toBeUndefined();
    expect(sigue.estado).toMatchObject({ fase: "mano" });
    expect(asiento(sigue.estado, 2)).toMatchObject({ estado: "juega", fichas: 30 - asiento(sigue.estado, 2).aportado, porEntrar: 0 });
  });

  it("lo añadido durante la mano no cuenta hasta la siguiente", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 1, { t: "anadir", fichas: 50 }).estado;
    expect(asiento(e, 1)).toMatchObject({ fichas: 100, porEntrar: 50 });
    expect(opcionesDe(e, 1)?.subir?.max).toBe(100);
  });

  it("si queda uno solo, espera a un rival durante SOLO_MS", () => {
    const e = aplicar(mesaCon([100, 100]), 2, { t: "levantarse" }).estado;
    expect(e.fase).toBe("resultado");
    const { estado, eventos } = tick(e, e.finFase!);
    expect(eventos).toEqual([]);
    expect(estado).toMatchObject({ fase: "esperando", calle: null, turno: null, mesa: [], baraja: [], botes: [], finFase: e.finFase! + POKER.SOLO_MS });
    expect(asiento(estado, 1)).toMatchObject({ estado: "fuera", cartas: [], ensenadas: false });
    expect(vistaDe(estado, 1).misCartas).toBeNull();

    const fin = tick(estado, estado.finFase!);
    expect(fin.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 100, pago: 110 }] });
    expect(fin.estado).toMatchObject({ fase: "esperando", asientos: [], finFase: null });
  });

  it("tras esperar, el segundo que se sienta empieza la mano", () => {
    const e = aplicar(mesaCon([100, 100]), 2, { t: "levantarse" }).estado;
    const { estado } = tick(e, e.finFase!);
    const { estado: mano } = aplicar(estado, 3, { t: "sentarse", fichas: 100 }, e.finFase! + 1);
    expect(mano).toMatchObject({ fase: "mano", ronda: 2 });
    expect(mano.finFase).toBe(e.finFase! + 1 + POKER.TURNO_MS);
  });

  it("si no queda nadie, la mesa se duerme sin alarmas", () => {
    const e = aplicar(aplicar(mesaCon([100, 100]), 2, { t: "levantarse" }).estado, 1, { t: "levantarse" }).estado;
    expect(e.fase).toBe("resultado");
    const { estado, liquidaciones } = tick(e, e.finFase!);
    expect(liquidaciones).toBeUndefined();
    expect(estado).toMatchObject({ fase: "esperando", asientos: [], finFase: null });
    expect(poker.proximaAlarma(estado)).toBeNull();
  });

  it("levantarse en resultado cobra lo ganado", () => {
    const e = aplicar(mesaCon([100, 100]), 1, { t: "retirarse" }).estado;
    const { liquidacion, estado } = aplicar(e, 2, { t: "levantarse" });
    expect(liquidacion).toEqual({ ronda: 2, filas: [{ jugadorId: 2, apuesta: 100, pago: 105 }] });
    expect(estado.abandonos).toEqual([]);
  });

  it("quien se sienta durante resultado juega la mano siguiente", () => {
    const e = aplicar(mesaCon([100, 100]), 1, { t: "retirarse" }).estado;
    const s = aplicar(e, 3, { t: "sentarse", fichas: 100 }).estado;
    expect(asiento(s, 3).estado).toBe("fuera");
    expect(asiento(tick(s, s.finFase!).estado, 3).estado).toBe("juega");
  });

  it("tres se levantan a la vez: tres liquidaciones", () => {
    let e = mesaCon([100, 100, 100, 100, 100]);
    for (const id of [1, 3, 5]) {
      const p = poker.desconectar(e, id, T0, rng);
      if (!p.ok) throw new Error(p.error);
      e = p.estado;
    }
    for (const id of [4, 5, 1, 2]) e = aplicar(e, id, { t: "retirarse" }).estado;
    const { estado, liquidaciones, liquidacion } = tick(e, e.finFase!);
    expect(liquidacion).toBeUndefined();
    expect(liquidaciones).toEqual([
      { ronda: 1, filas: [{ jugadorId: 1, apuesta: 100, pago: 100 }] },
      { ronda: 3, filas: [{ jugadorId: 3, apuesta: 100, pago: 105 }] },
      { ronda: 5, filas: [{ jugadorId: 5, apuesta: 100, pago: 100 }] },
    ]);
    expect(estado).toMatchObject({ fase: "mano", ronda: 2 });
    expect(estado.asientos.map((a) => a.jugadorId)).toEqual([2, 4]);
  });
});

describe("póker: enseñar", () => {
  it("enseñar en resultado, también tras retirarte; dos veces no", () => {
    let e = conCartas(mesaCon([100, 100, 100]), { 1: "AH AD" }, "3S 8C 9D JH 2S");
    e = aplicar(e, 1, { t: "retirarse" }).estado;
    expect(opcionesDe(e, 1)?.ensenar).toBe(false);
    expect(error(intentar(e, 1, { t: "ensenar" }))).toBe("fase_incorrecta");
    e = aplicar(e, 2, { t: "retirarse" }).estado;
    expect(e.fase).toBe("resultado");

    expect(opcionesDe(e, 1)?.ensenar).toBe(true);
    const { estado, eventos } = aplicar(e, 1, { t: "ensenar" });
    expect(eventos).toEqual([{ tipo: "cartas_ensenadas", jugadorId: 1, cartas: cs("AH AD") }]);
    expect(vistaDe(estado, 3).asientos[0].cartas).toEqual(cs("AH AD"));
    expect(opcionesDe(estado, 1)?.ensenar).toBe(false);
    expect(error(intentar(estado, 1, { t: "ensenar" }))).toBe("accion_invalida");
  });

  it("quien gana sin enseñar puede enseñar por su cuenta", () => {
    const e = aplicar(mesaCon([100, 100]), 1, { t: "retirarse" }).estado;
    expect(opcionesDe(e, 2)?.ensenar).toBe(true);
    expect(aplicar(e, 2, { t: "ensenar" }).estado.asientos[1].ensenadas).toBe(true);
  });

  it("quien no jugó la mano no tiene nada que enseñar", () => {
    const e = aplicar(mesaCon([100, 100]), 1, { t: "retirarse" }).estado;
    const s = aplicar(e, 3, { t: "sentarse", fichas: 100 }).estado;
    expect(opcionesDe(s, 3)?.ensenar).toBe(false);
    expect(error(intentar(s, 3, { t: "ensenar" }))).toBe("accion_invalida");
  });

  it("sin estar sentado no se enseña", () => {
    const e = aplicar(mesaCon([100, 100]), 1, { t: "retirarse" }).estado;
    expect(error(intentar(e, 9, { t: "ensenar" }))).toBe("no_sentado");
  });
});
