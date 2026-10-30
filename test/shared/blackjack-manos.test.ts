import { describe, expect, it } from "vitest";
import { blackjack, BJ, casillasLibres, manoActiva, opcionesDe, type AccionBJ, type EstadoBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import { c, cs } from "../ayudas";
import { asiento, error, estado, exito, mano, rng, T0, zapato } from "./ayudas-blackjack";

const SIN_OPCIONES = { pedir: false, plantarse: false, doblar: false, dividir: false, rendirse: false, seguro: null };

/** Una ventana de apuestas con `n` jugadores sentados (ids 1..n) y nadie ha apostado todavía. */
const conJugadores = (n: number): EstadoBJ =>
  estado({
    fase: "apuestas",
    finFase: T0 + BJ.APUESTAS_MS,
    asientos: Array.from({ length: n }, (_, i) => asiento(i + 1, `jugador${i + 1}`)),
  });

const apostar = (e: EstadoBJ, jugadorId: number, segunda = false, cantidad = 50) =>
  blackjack.aplicar(e, jugadorId, segunda ? { t: "apostar", cantidad, segunda: true } : { t: "apostar", cantidad }, T0, rng);

/** Aplica una apuesta que tiene que salir bien y devuelve el estado nuevo. */
const apuesta = (e: EstadoBJ, jugadorId: number, segunda = false, cantidad = 50): EstadoBJ => exito(apostar(e, jugadorId, segunda, cantidad)).estado;

/** Ana juega dos manos en decisiones: la de la casilla 0 (10♠ 6♥, 100) y la de la casilla 2 (8♠ 3♥, 50), contra 10♣ 7♦. */
const dosManosEnDecisiones = (parcial: Partial<EstadoBJ> = {}) =>
  estado({
    fase: "decisiones",
    finFase: T0 + BJ.DECISIONES_MS,
    asientos: [asiento(1, "ana")],
    banca: cs("10C 7D"),
    zapato: zapato("5C 9D KS"),
    manos: [
      mano(1, "ana", { casilla: 0, indice: 0, apuesta: 100, cartas: cs("10S 6H") }),
      mano(1, "ana", { casilla: 2, indice: 1, apuesta: 50, cartas: cs("8S 3H") }),
    ],
    ...parcial,
  });

/** Lo mismo con beto sentado: su mano está en la casilla 1 (10♠ 9♥, 50). */
const conBeto = () =>
  dosManosEnDecisiones({
    asientos: [asiento(1, "ana"), asiento(2, "beto")],
    manos: [...dosManosEnDecisiones().manos, mano(2, "beto", { casilla: 1, indice: 0, cartas: cs("10S 9H") })],
  });

describe("casillas", () => {
  it("las casillas se ocupan por orden de llegada; con las 7 ocupadas, apostar da sin_casilla y no cambia el estado", () => {
    let e = conJugadores(6);
    expect(casillasLibres(e)).toBe(BJ.CASILLAS);
    for (const id of [1, 2, 3, 4, 5, 6]) e = apuesta(e, id);
    expect(e.manos.map((m) => [m.jugadorId, m.casilla, m.indice])).toEqual([[1, 0, 0], [2, 1, 0], [3, 2, 0], [4, 3, 0], [5, 4, 0], [6, 5, 0]]);
    expect(casillasLibres(e)).toBe(1);

    // el jugador 1 pide la segunda y la mesa queda llena
    e = apuesta(e, 1, true);
    expect(e.manos[6]).toMatchObject({ jugadorId: 1, casilla: 6, indice: 1, apuesta: 50, estado: "jugando", dividida: false });
    expect(casillasLibres(e)).toBe(0);

    const antes = structuredClone(e);
    expect(error(apostar(e, 2, true))).toBe("sin_casilla");
    expect(e).toEqual(antes);
    expect(casillasLibres(e)).toBe(0);
  });

  it("una apuesta normal sin casilla libre también da sin_casilla", () => {
    let e = conJugadores(5);
    for (const id of [1, 2, 3]) e = apuesta(apuesta(e, id), id, true); // tres jugadores con dos casillas: 6
    e = apuesta(e, 4); // la séptima
    expect(casillasLibres(e)).toBe(0);
    expect(error(apostar(e, 5))).toBe("sin_casilla");
  });

  it("segunda sin casilla propia, tercera casilla o una apuesta normal teniendo ya casilla → accion_invalida", () => {
    const vacia = conJugadores(2);
    expect(error(apostar(vacia, 1, true))).toBe("accion_invalida");

    const una = apuesta(vacia, 1);
    expect(error(apostar(una, 1))).toBe("accion_invalida");
    // `segunda` solo vale si es exactamente `true`: cualquier otra cosa es una apuesta normal
    expect(error(blackjack.aplicar(una, 1, { t: "apostar", cantidad: 50, segunda: "si" } as unknown as AccionBJ, T0, rng))).toBe("accion_invalida");

    const dos = apuesta(una, 1, true);
    expect(error(apostar(dos, 1, true))).toBe("accion_invalida");
    expect(error(apostar(dos, 1))).toBe("accion_invalida");

    // la segunda cuesta lo que se apuesta, como una apuesta normal
    expect(blackjack.costo(una, 1, { t: "apostar", cantidad: 75, segunda: true })).toBe(75);
  });

  it("la segunda apuesta despierta una mesa dormida como una apuesta normal", () => {
    // Estado artificial: una mesa dormida no suele conservar manos, pero la regla es la misma que para apostar.
    const dormida = estado({ asientos: [asiento(1, "ana")], manos: [mano(1, "ana")], ventanasVacias: 3 });
    const p = exito(blackjack.aplicar(dormida, 1, { t: "apostar", cantidad: 75, segunda: true }, T0 + 5_000, rng));
    expect(p.estado).toMatchObject({ fase: "apuestas", finFase: T0 + 5_000 + BJ.APUESTAS_MS, ventanasVacias: 0 });
    expect(p.estado.manos[1]).toMatchObject({ casilla: 1, indice: 1, apuesta: 75 });
  });
});

describe("reparto por casillas", () => {
  it("se reparte por casillas en orden y cada carta dice su mano", () => {
    // ana tiene las casillas 0 y 2 y beto la 1; las manos se guardan sin orden para comprobar que se reparte por casilla
    const e = estado({
      fase: "apuestas",
      finFase: T0 + BJ.APUESTAS_MS,
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      manos: [
        mano(1, "ana", { casilla: 2, indice: 1 }),
        mano(1, "ana", { casilla: 0, indice: 0 }),
        mano(2, "beto", { casilla: 1, indice: 0 }),
      ],
      zapato: zapato("2S 3S 4S 5S 6S 7S 8S 9S"),
    });
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(p.eventos.slice(0, 4)).toEqual([
      { tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("2S") },
      { tipo: "carta_repartida", a: 2, mano: 0, oculta: false, carta: c("3S") },
      { tipo: "carta_repartida", a: 1, mano: 1, oculta: false, carta: c("4S") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("5S") },
    ]);
    expect(p.eventos[3]).not.toHaveProperty("mano");
    expect(p.eventos.slice(4).map((ev) => [ev.a, ev.mano])).toEqual([[1, 0], [2, 0], [1, 1], ["banca", undefined]]);
    expect(p.eventos[7]).toEqual({ tipo: "carta_repartida", a: "banca", oculta: true });
    const cartas = (casilla: number) => p.estado.manos.find((m) => m.casilla === casilla)!.cartas;
    expect([cartas(0), cartas(1), cartas(2)]).toEqual([cs("2S 6S"), cs("3S 7S"), cs("4S 8S")]);
    expect(p.estado.banca).toEqual(cs("5S 9S"));
    expect(p.estado.fase).toBe("decisiones");
  });
});

describe("mano activa", () => {
  it("pedir y plantarse actúan sobre la mano activa; al plantarse, la activa es la siguiente", () => {
    const e = dosManosEnDecisiones();
    expect(manoActiva(e, 1)).toMatchObject({ casilla: 0, indice: 0 });

    const pide = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rng));
    expect(pide.eventos).toEqual([{ tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("5C") }]);
    expect(pide.estado.manos[0].cartas).toEqual(cs("10S 6H 5C"));
    expect(pide.estado.manos[1].cartas).toEqual(cs("8S 3H"));
    expect(manoActiva(pide.estado, 1)).toMatchObject({ indice: 0 });

    const planta = exito(blackjack.aplicar(pide.estado, 1, { t: "plantarse" }, T0, rng));
    expect(planta.estado.manos.map((m) => m.estado)).toEqual(["plantado", "jugando"]);
    expect(manoActiva(planta.estado, 1)).toMatchObject({ casilla: 2, indice: 1 });
    expect(planta.estado.fase).toBe("decisiones");

    const pideOtra = exito(blackjack.aplicar(planta.estado, 1, { t: "pedir" }, T0, rng));
    expect(pideOtra.eventos).toEqual([{ tipo: "carta_repartida", a: 1, mano: 1, oculta: false, carta: c("9D") }]);
    expect(pideOtra.estado.manos[1].cartas).toEqual(cs("8S 3H 9D"));

    const fin = exito(blackjack.aplicar(pideOtra.estado, 1, { t: "plantarse" }, T0 + 10, rng));
    expect(manoActiva(fin.estado, 1)).toBeUndefined();
    expect(fin.estado.fase).toBe("banca");
    expect(fin.estado.finFase).toBe(T0 + 10 + BJ.BANCA_MS);
  });

  it("al pasarse la activa también es la siguiente", () => {
    const e = dosManosEnDecisiones({ zapato: zapato("KS 5C") });
    const pasa = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rng)).estado;
    expect(pasa.manos.map((m) => m.estado)).toEqual(["pasado", "jugando"]);
    expect(manoActiva(pasa, 1)).toMatchObject({ indice: 1 });
    expect(pasa.fase).toBe("decisiones");
  });

  it("doblar cuesta la apuesta de la mano activa", () => {
    const e = dosManosEnDecisiones({ zapato: zapato("9S 2D") });
    expect(blackjack.costo(e, 1, { t: "doblar" })).toBe(100);
    expect(blackjack.costo(e, 1, { t: "apostar", cantidad: 75 })).toBe(75);

    const planta = exito(blackjack.aplicar(e, 1, { t: "plantarse" }, T0, rng)).estado;
    expect(blackjack.costo(planta, 1, { t: "doblar" })).toBe(50);

    const dobla = exito(blackjack.aplicar(planta, 1, { t: "doblar" }, T0, rng));
    expect(dobla.estado.manos[0]).toMatchObject({ apuesta: 100, doblada: false, estado: "plantado" });
    expect(dobla.estado.manos[1]).toMatchObject({ apuesta: 100, doblada: true, estado: "plantado", cartas: cs("8S 3H 9S") });
    expect(dobla.eventos).toEqual([{ tipo: "carta_repartida", a: 1, mano: 1, oculta: false, carta: c("9S") }]);
    expect(dobla.estado.fase).toBe("banca");
  });

  it("dividir, rendirse y seguro responden accion_invalida por ahora", () => {
    const e = dosManosEnDecisiones();
    for (const accion of [{ t: "dividir" }, { t: "rendirse" }, { t: "seguro", tomar: true }, { t: "seguro", tomar: false }] as AccionBJ[]) {
      expect(error(blackjack.aplicar(e, 1, accion, T0, rng))).toBe("accion_invalida");
      expect(blackjack.costo(e, 1, accion)).toBe(0);
    }
    expect(error(blackjack.aplicar(e, 99, { t: "dividir" }, T0, rng))).toBe("no_sentado");
  });
});

describe("liquidación, salir y desconectar con varias manos", () => {
  it("una fila de liquidación por jugador con la suma de sus manos", () => {
    // ana: una mano de 100 que gana (19 contra 17) y otra de 50 que pierde (16); beto tiene una mano de 20 con 18
    const e = estado({
      fase: "banca",
      finFase: T0,
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      banca: cs("10C 7D"),
      manos: [
        mano(1, "ana", { casilla: 0, indice: 0, apuesta: 100, cartas: cs("10S 9H"), estado: "plantado" }),
        mano(2, "beto", { casilla: 1, indice: 0, apuesta: 20, cartas: cs("10D 8H"), estado: "plantado" }),
        mano(1, "ana", { casilla: 2, indice: 1, apuesta: 50, cartas: cs("10H 6H"), estado: "plantado" }),
      ],
    });
    const p = exito(blackjack.tick(e, T0, rng));
    expect(p.liquidacion).toEqual({
      ronda: 1,
      filas: [
        { jugadorId: 1, apuesta: 150, pago: 200 },
        { jugadorId: 2, apuesta: 20, pago: 40 },
      ],
    });
    expect(p.eventos.filter((ev) => ev.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: 1, neto: 50 },
      { tipo: "pago", jugadorId: 2, neto: 20 },
    ]);
  });

  it("salir con dos manos las pierde las dos", () => {
    const sale = exito(blackjack.aplicar(conBeto(), 1, { t: "salir" }, T0, rng));
    expect(sale.estado.manos.filter((m) => m.jugadorId === 1).map((m) => [m.abandonada, m.estado])).toEqual([[true, "plantado"], [true, "plantado"]]);
    expect(sale.estado.asientos.map((a) => a.jugadorId)).toEqual([2]);
    expect(manoActiva(sale.estado, 1)).toBeUndefined();
    expect(sale.liquidacion).toBeUndefined();

    // beto se planta con 19 y la banca (10♣ 7♦) se queda en 17: él cobra y ana, que se fue con dos manos, no
    const plantado = exito(blackjack.aplicar(sale.estado, 2, { t: "plantarse" }, T0, rng)).estado;
    const final = exito(blackjack.tick(plantado, plantado.finFase!, rng));
    expect(final.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 150, pago: 0 },
      { jugadorId: 2, apuesta: 50, pago: 100 },
    ]);
  });

  it("si se va el último jugador con dos manos se liquida de inmediato con una sola fila", () => {
    const p = exito(blackjack.aplicar(dosManosEnDecisiones(), 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 150, pago: 0 }] });
    expect(p.eventos).toEqual([{ tipo: "pago", jugadorId: 1, neto: -150 }]);
    expect(p.estado).toMatchObject({ ronda: 2, fase: "esperando", manos: [] });
  });

  it("desconectar en decisiones planta todas las manos que siguen en juego", () => {
    const p = exito(blackjack.desconectar(conBeto(), 1, T0, rng));
    expect(p.estado.asientos[0]).toEqual({ jugadorId: 1, apodo: "ana", conectado: false });
    expect(p.estado.manos.filter((m) => m.jugadorId === 1).map((m) => [m.estado, m.abandonada])).toEqual([["plantado", false], ["plantado", false]]);
    expect(p.estado.manos.find((m) => m.jugadorId === 2)?.estado).toBe("jugando");
    expect(p.estado.fase).toBe("decisiones"); // beto sigue decidiendo
  });
});

describe("vista", () => {
  const enMesa = () =>
    estado({
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      banca: cs("10C 7D"),
      // sin orden: la vista los ordena por (casilla, indice)
      manos: [
        mano(1, "ana", { casilla: 2, indice: 1, cartas: cs("8S 3H") }),
        mano(2, "beto", { casilla: 1, indice: 0, cartas: cs("10S 8H"), estado: "plantado" }),
        mano(1, "ana", { casilla: 0, indice: 0, cartas: cs("10S 6H") }),
      ],
    });

  it("la vista lleva casilla, indice, casillasLibres y opciones solo para quien la recibe", () => {
    const e = enMesa();
    const ana = blackjack.vista(e, 1, T0) as VistaBJ;
    expect(ana.manos.map((m) => [m.jugadorId, m.casilla, m.indice, m.dividida, m.total])).toEqual([
      [1, 0, 0, false, 16],
      [2, 1, 0, false, 18],
      [1, 2, 1, false, 11],
    ]);
    for (const m of ana.manos) expect(m).not.toHaveProperty("abandonada");
    expect(ana.casillasLibres).toBe(BJ.CASILLAS - 3);
    expect(ana.miSeguro).toBeNull();
    expect(ana.opciones).toEqual({ pedir: true, plantarse: true, doblar: true, dividir: false, rendirse: false, seguro: null });

    // beto ya está plantado: no tiene mano activa; el espectador no recibe opciones
    expect((blackjack.vista(e, 2, T0) as VistaBJ).opciones).toEqual(SIN_OPCIONES);
    const espectador = blackjack.vista(e, null, T0) as VistaBJ;
    expect(espectador.opciones).toBeNull();
    expect(espectador.manos).toEqual(ana.manos);
    expect(espectador.casillasLibres).toBe(ana.casillasLibres);
  });

  it("las opciones siguen a la mano activa: no se dobla con tres cartas ni fuera de decisiones", () => {
    const e = estado({
      fase: "decisiones",
      asientos: [asiento(1, "ana")],
      banca: cs("10C 7D"),
      manos: [mano(1, "ana", { cartas: cs("2S 3H 4C") })],
    });
    expect(opcionesDe(e, 1)).toEqual({ ...SIN_OPCIONES, pedir: true, plantarse: true });
    expect(opcionesDe(e, 99)).toEqual(SIN_OPCIONES);
    expect(opcionesDe({ ...e, fase: "apuestas" }, 1)).toEqual(SIN_OPCIONES);
    expect((blackjack.vista({ ...e, fase: "apuestas" }, 1, T0) as VistaBJ).opciones).toEqual(SIN_OPCIONES);
  });

  it("la carta tapada no sale en la fase seguro y miSeguro es lo asegurado, o null si no se aseguró", () => {
    const e = estado({
      fase: "seguro",
      finFase: T0 + BJ.SEGURO_MS,
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      banca: cs("AD 7C"),
      manos: [mano(1, "ana", { cartas: cs("10S 9H") }), mano(2, "beto", { casilla: 1, cartas: cs("8S 8H") })],
      seguros: [
        { jugadorId: 1, cantidad: 25, respondido: true },
        { jugadorId: 2, cantidad: 0, respondido: true },
      ],
    });
    const ana = blackjack.vista(e, 1, T0) as VistaBJ;
    expect(ana.banca).toEqual([c("AD"), null]);
    expect(ana.totalBanca).toBe(11);
    expect(ana.miSeguro).toBe(25);
    expect((blackjack.vista(e, 2, T0) as VistaBJ).miSeguro).toBeNull();
    expect((blackjack.vista(e, null, T0) as VistaBJ).miSeguro).toBeNull();
  });
});
