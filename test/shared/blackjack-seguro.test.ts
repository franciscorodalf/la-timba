import { describe, expect, it } from "vitest";
import { blackjack, BJ, opcionesDe, type AccionBJ, type EstadoBJ, type FaseBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import type { Paso } from "../../src/shared/juegos/tipos";
import { c, cs } from "../ayudas";
import { asiento, error, estado, exito, mano, rng, T0, zapato } from "./ayudas-blackjack";

/** El instante en que vence la ventana de apuestas de los repartos de estos tests. */
const REPARTO = T0 + BJ.APUESTAS_MS;
const ANA = asiento(1, "ana");
const BETO = asiento(2, "beto");
const CARLA = asiento(3, "carla");

const seguro = (tomar: boolean): AccionBJ => ({ t: "seguro", tomar });
const tipos = (p: Extract<Paso<EstadoBJ>, { ok: true }>) => p.eventos.map((ev) => ev.tipo);
const aplicar = (e: EstadoBJ, jugadorId: number, accion: AccionBJ, ahora = T0) => exito(blackjack.aplicar(e, jugadorId, accion, ahora, rng));
const vistaDe = (e: EstadoBJ, jugadorId: number | null) => blackjack.vista(e, jugadorId, T0) as VistaBJ;

/** Una ventana de apuestas que vence en `REPARTO`; las cartas se reparten por casillas: una a cada mano, una a la banca, y otra vuelta. */
const apuestas = (asientos: EstadoBJ["asientos"], manos: EstadoBJ["manos"], cartas: string): EstadoBJ =>
  estado({ fase: "apuestas", finFase: REPARTO, asientos, manos, zapato: zapato(cartas) });
const reparte = (e: EstadoBJ) => exito(blackjack.tick(e, REPARTO, rng));

/** La fase `seguro` ya abierta: ana (25 + 50 en dos casillas) y beto (100), contra A♦ 7♣ (sin blackjack). */
const enSeguro = (parcial: Partial<EstadoBJ> = {}): EstadoBJ =>
  estado({
    fase: "seguro",
    finFase: T0 + BJ.SEGURO_MS,
    asientos: [ANA, BETO],
    banca: cs("AD 7C"),
    zapato: zapato("5C 9D"),
    manos: [
      mano(1, "ana", { casilla: 0, indice: 0, apuesta: 25, cartas: cs("10S 9H") }),
      mano(2, "beto", { casilla: 1, indice: 0, apuesta: 100, cartas: cs("10D 6H") }),
      mano(1, "ana", { casilla: 2, indice: 1, apuesta: 50, cartas: cs("8S 3H") }),
    ],
    seguros: [
      { jugadorId: 1, cantidad: 0, respondido: false },
      { jugadorId: 2, cantidad: 0, respondido: false },
    ],
    ...parcial,
  });

describe("la banca mira su carta", () => {
  const dosJugadores = (cartas: string) => apuestas([ANA, BETO], [mano(1, "ana", { casilla: 0 }), mano(2, "beto", { casilla: 1 })], cartas);

  it("con un as visible se abre el seguro de 10 s; con una figura la banca mira sin seguro; con un 6 no mira", () => {
    // ana 10♠ 9♥, beto 8♠ 7♠; la banca enseña la primera de sus dos cartas
    const conAs = reparte(dosJugadores("10S 8S AD 9H 7S KC"));
    expect(conAs.estado).toMatchObject({ fase: "seguro", finFase: REPARTO + BJ.SEGURO_MS, bancaMirada: false });
    expect(conAs.estado.seguros).toEqual([
      { jugadorId: 1, cantidad: 0, respondido: false },
      { jugadorId: 2, cantidad: 0, respondido: false },
    ]);
    expect(tipos(conAs)).not.toContain("banca_mira");
    expect(conAs.liquidacion).toBeUndefined();

    const conFigura = reparte(dosJugadores("10S 8S KD 9H 7S 7C"));
    expect(conFigura.eventos.at(-1)).toEqual({ tipo: "banca_mira", blackjack: false });
    expect(conFigura.estado).toMatchObject({ fase: "decisiones", finFase: REPARTO + BJ.DECISIONES_MS, bancaMirada: true, seguros: [] });
    expect(conFigura.liquidacion).toBeUndefined();

    const conSeis = reparte(dosJugadores("10S 8S 6D 9H 7S 7C"));
    expect(tipos(conSeis)).not.toContain("banca_mira");
    expect(conSeis.estado).toMatchObject({ fase: "decisiones", finFase: REPARTO + BJ.DECISIONES_MS, bancaMirada: false, seguros: [] });
  });

  it("con una figura visible y blackjack debajo, la banca gira, la ronda acaba y no hay seguro", () => {
    // beto tiene blackjack y empata; ana (19) pierde
    const p = reparte(dosJugadores("10S AH QD 9H KS AC"));
    expect(p.eventos.slice(-4)).toEqual([
      { tipo: "banca_mira", blackjack: true },
      { tipo: "carta_girada", carta: c("AC") },
      { tipo: "pago", jugadorId: 1, neto: -50 },
      { tipo: "pago", jugadorId: 2, neto: 0 },
    ]);
    expect(p.liquidacion).toEqual({
      ronda: 1,
      filas: [
        { jugadorId: 1, apuesta: 50, pago: 0 },
        { jugadorId: 2, apuesta: 50, pago: 50 },
      ],
    });
    expect(p.estado).toMatchObject({ fase: "resultado", finFase: REPARTO + BJ.RESULTADO_MS, bancaMirada: true, seguros: [] });
  });

  it("el seguro solo se ofrece a quien tiene manos en juego: una entrada por jugador, aunque juegue dos manos", () => {
    // beto se fue durante las apuestas: sus cartas no se reparten y no tiene seguro
    const e = apuestas(
      [ANA],
      [mano(2, "beto", { casilla: 0, abandonada: true, estado: "plantado" }), mano(1, "ana", { casilla: 1 }), mano(1, "ana", { casilla: 2, indice: 1 })],
      "10S 9S AD 8H 7S KC",
    );
    expect(reparte(e).estado.seguros).toEqual([{ jugadorId: 1, cantidad: 0, respondido: false }]);
  });

  it("si todos los asientos con manos estaban desconectados al repartir, la banca mira sin esperar al reloj", () => {
    const e = apuestas([{ ...ANA, conectado: false }], [mano(1, "ana")], "10S AD 9H 7C");
    const p = reparte(e);
    expect(p.eventos.at(-1)).toEqual({ tipo: "banca_mira", blackjack: false });
    // la mano de quien no está se planta sola y la banca juega
    expect(p.estado).toMatchObject({ fase: "banca", finFase: REPARTO + BJ.BANCA_MS });
    expect(p.estado.manos[0].estado).toBe("plantado");
  });
});

describe("coger el seguro", () => {
  it("coger seguro cuesta la mitad redondeada hacia abajo de tus apuestas", () => {
    const e = enSeguro();
    // ana tiene 25 + 50 en dos casillas: floor(75 / 2) = 37; beto 100 → 50
    expect(blackjack.costo(e, 1, seguro(true))).toBe(37);
    expect(blackjack.costo(e, 2, seguro(true))).toBe(50);
    expect(blackjack.costo(e, 1, seguro(false))).toBe(0);
    expect(opcionesDe(e, 1).seguro).toBe(37);
    expect(vistaDe(e, 1).opciones?.seguro).toBe(37);
    expect(vistaDe(e, null).opciones).toBeNull();

    const coge = aplicar(e, 1, seguro(true));
    expect(coge.estado.seguros[0]).toEqual({ jugadorId: 1, cantidad: 37, respondido: true });
    expect(coge.eventos).toEqual([]);
    // beto sigue sin contestar: la fase continúa con su reloj
    expect(coge.estado).toMatchObject({ fase: "seguro", finFase: T0 + BJ.SEGURO_MS });
    expect(vistaDe(coge.estado, 1)).toMatchObject({ miSeguro: 37 });
    expect(vistaDe(coge.estado, 1).opciones?.seguro).toBeNull();
    expect(vistaDe(coge.estado, 2).miSeguro).toBeNull();
    expect(vistaDe(coge.estado, 2).opciones?.seguro).toBe(50);

    // dice «no»: contesta, no cuesta nada y no hay seguro
    const dice = aplicar(e, 1, seguro(false));
    expect(dice.estado.seguros[0]).toEqual({ jugadorId: 1, cantidad: 0, respondido: true });
    expect(vistaDe(dice.estado, 1).miSeguro).toBeNull();
  });

  it("solo vale en la fase seguro, una vez por jugador y con quien tiene manos en juego", () => {
    const e = enSeguro();
    const contestado = aplicar(e, 1, seguro(true)).estado;
    for (const tomar of [true, false]) {
      expect(error(blackjack.aplicar(contestado, 1, seguro(tomar), T0, rng))).toBe("accion_invalida");
    }
    // ya contestó: ni cuesta ni se ofrece
    expect(blackjack.costo(contestado, 1, seguro(true))).toBe(0);
    expect(opcionesDe(contestado, 1).seguro).toBeNull();
    expect(contestado.seguros[0].cantidad).toBe(37);

    // sentado pero sin mano en juego esta ronda (llegó tarde, o se fue y volvió)
    const sinMano = enSeguro({ asientos: [ANA, BETO, CARLA] });
    expect(error(blackjack.aplicar(sinMano, 3, seguro(true), T0, rng))).toBe("accion_invalida");
    expect(blackjack.costo(sinMano, 3, seguro(true))).toBe(0);
    expect(error(blackjack.aplicar(e, 99, seguro(true), T0, rng))).toBe("no_sentado");

    // fuera de la fase seguro
    for (const fase of ["apuestas", "decisiones", "banca", "resultado"] as FaseBJ[]) {
      const fuera = enSeguro({ fase });
      expect(error(blackjack.aplicar(fuera, 1, seguro(true), T0, rng))).toBe("fase_incorrecta");
      expect(blackjack.costo(fuera, 1, seguro(true))).toBe(0);
      expect(opcionesDe(fuera, 1).seguro).toBeNull();
    }

    // la respuesta tiene que ser un booleano
    expect(error(blackjack.aplicar(e, 1, { t: "seguro", tomar: "si" } as unknown as AccionBJ, T0, rng))).toBe("mensaje_invalido");
    expect(error(blackjack.aplicar(e, 1, { t: "seguro" } as unknown as AccionBJ, T0, rng))).toBe("mensaje_invalido");
  });

  it("si todos contestan, la banca mira sin esperar al reloj", () => {
    const e = enSeguro();
    const primero = aplicar(e, 1, seguro(false), T0 + 1_000);
    expect(primero.estado.fase).toBe("seguro");
    expect(tipos(primero)).toEqual([]);

    const ultimo = aplicar(primero.estado, 2, seguro(false), T0 + 2_000);
    expect(ultimo.eventos).toEqual([{ tipo: "banca_mira", blackjack: false }]);
    // la banca (A♦ 7♣) no tiene blackjack: empiezan las decisiones con su ventana completa desde ahora
    expect(ultimo.estado).toMatchObject({ fase: "decisiones", finFase: T0 + 2_000 + BJ.DECISIONES_MS, bancaMirada: true });
    expect(blackjack.proximaAlarma(ultimo.estado)).toBe(T0 + 2_000 + BJ.DECISIONES_MS);
  });
});

describe("la banca mira con seguros", () => {
  it("banca con blackjack: el seguro paga 2:1, tu blackjack empata y el resto pierde; la ronda acaba", () => {
    // ana (100) 10♠ 9♥, beto (50) A♥ K♠ = blackjack, carla (20) 9♦ 8♦; la banca enseña A♣ y tapa K♦
    const e = apuestas(
      [ANA, BETO, CARLA],
      [mano(1, "ana", { casilla: 0, apuesta: 100 }), mano(2, "beto", { casilla: 1 }), mano(3, "carla", { casilla: 2, apuesta: 20 })],
      "10S AH 9D AC 9H KS 8D KD",
    );
    const abre = reparte(e).estado;
    expect(abre.fase).toBe("seguro");

    const ana = aplicar(abre, 1, seguro(true), REPARTO + 1_000);
    expect(blackjack.costo(abre, 1, seguro(true))).toBe(50);
    const beto = aplicar(ana.estado, 2, seguro(false), REPARTO + 2_000);
    const final = aplicar(beto.estado, 3, seguro(false), REPARTO + 3_000);

    expect(final.eventos).toEqual([
      { tipo: "banca_mira", blackjack: true },
      { tipo: "carta_girada", carta: c("KD") },
      { tipo: "seguro_pagado", jugadorId: 1, cantidad: 150 },
      { tipo: "pago", jugadorId: 1, neto: 0 },
      { tipo: "pago", jugadorId: 2, neto: 0 },
      { tipo: "pago", jugadorId: 3, neto: -20 },
    ]);
    expect(final.liquidacion).toEqual({
      ronda: 1,
      filas: [
        { jugadorId: 1, apuesta: 150, pago: 150 },
        { jugadorId: 2, apuesta: 50, pago: 50 },
        { jugadorId: 3, apuesta: 20, pago: 0 },
      ],
    });
    expect(final.estado).toMatchObject({ fase: "resultado", finFase: REPARTO + 3_000 + BJ.RESULTADO_MS, bancaMirada: true });
    expect(final.estado.manos.map((m) => m.estado)).toEqual(["jugando", "blackjack", "jugando"]);

    // pasado el resultado, la ronda siguiente empieza limpia
    const siguiente = exito(blackjack.tick(final.estado, final.estado.finFase!, rng)).estado;
    expect(siguiente).toMatchObject({ ronda: 2, fase: "apuestas", seguros: [], bancaMirada: false, banca: [], manos: [] });
  });

  it("banca sin blackjack: el seguro se pierde y empiezan las decisiones", () => {
    // ana (100) 10♠ 9♥ contra A♦ 6♣ (17 blando): la banca no tiene blackjack
    const e = apuestas([ANA], [mano(1, "ana", { apuesta: 100 })], "10S AD 9H 6C");
    const abre = reparte(e).estado;
    const coge = aplicar(abre, 1, seguro(true), REPARTO + 1_000);

    expect(coge.eventos).toEqual([{ tipo: "banca_mira", blackjack: false }]);
    expect(coge.liquidacion).toBeUndefined();
    expect(coge.estado).toMatchObject({ fase: "decisiones", finFase: REPARTO + 1_000 + BJ.DECISIONES_MS, bancaMirada: true });
    expect(coge.estado.seguros).toEqual([{ jugadorId: 1, cantidad: 50, respondido: true }]);

    // ana se planta y la banca (17) se queda: gana la mano (+100), pero el seguro (50) ya estaba perdido
    const planta = aplicar(coge.estado, 1, { t: "plantarse" }, REPARTO + 2_000).estado;
    const fin = exito(blackjack.tick(planta, planta.finFase!, rng));
    expect(fin.eventos.map((ev) => ev.tipo)).toEqual(["carta_girada", "pago"]);
    expect(fin.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 150, pago: 200 }] });
    expect(fin.eventos.at(-1)).toEqual({ tipo: "pago", jugadorId: 1, neto: 50 });
  });

  it("quien no contesta o se desconecta en el seguro no lo coge", () => {
    // ana asegura; beto no contesta; carla se desconecta. La banca enseña A♦ y tapa K♣ (blackjack)
    const e = enSeguro({
      asientos: [ANA, BETO, CARLA],
      banca: cs("AD KC"),
      manos: [
        mano(1, "ana", { casilla: 0, apuesta: 100, cartas: cs("10S 9H") }),
        mano(2, "beto", { casilla: 1, apuesta: 50, cartas: cs("10D 6H") }),
        mano(3, "carla", { casilla: 2, apuesta: 20, cartas: cs("9D 8D") }),
      ],
      seguros: [1, 2, 3].map((jugadorId) => ({ jugadorId, cantidad: 0, respondido: false })),
    });
    const ana = aplicar(e, 1, seguro(true), T0 + 1_000).estado;
    const desconecta = exito(blackjack.desconectar(ana, 3, T0 + 2_000, rng));
    expect(desconecta.estado.fase).toBe("seguro"); // beto aún puede contestar
    expect(desconecta.eventos).toEqual([]);

    // antes de que venza el reloj no pasa nada (se devuelve el mismo estado)
    expect(exito(blackjack.tick(desconecta.estado, T0 + BJ.SEGURO_MS - 1, rng)).estado).toBe(desconecta.estado);

    const vence = exito(blackjack.tick(desconecta.estado, T0 + BJ.SEGURO_MS, rng));
    expect(vence.eventos.filter((ev) => ev.tipo === "seguro_pagado")).toEqual([{ tipo: "seguro_pagado", jugadorId: 1, cantidad: 150 }]);
    expect(vence.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 150, pago: 150 },
      { jugadorId: 2, apuesta: 50, pago: 0 },
      { jugadorId: 3, apuesta: 20, pago: 0 },
    ]);
    expect(vence.estado.seguros.map((s) => [s.jugadorId, s.cantidad, s.respondido])).toEqual([[1, 50, true], [2, 0, true], [3, 0, true]]);
    expect(vence.estado).toMatchObject({ fase: "resultado", finFase: T0 + BJ.SEGURO_MS + BJ.RESULTADO_MS });
  });

  it("sin blackjack empiezan las decisiones, con las manos de quien se desconectó en el seguro ya plantadas", () => {
    const e = enSeguro();
    const ana = aplicar(e, 1, seguro(false)).estado;
    // beto era el último en contestar: al irse cuenta como «no» y la banca mira al momento
    const p = exito(blackjack.desconectar(ana, 2, T0 + 4_000, rng));
    expect(p.eventos).toEqual([{ tipo: "banca_mira", blackjack: false }]);
    expect(p.estado).toMatchObject({ fase: "decisiones", finFase: T0 + 4_000 + BJ.DECISIONES_MS });
    expect(p.estado.manos.map((m) => [m.jugadorId, m.estado])).toEqual([[1, "jugando"], [2, "plantado"], [1, "jugando"]]);

    // nadie sin contestar: el reloj del seguro, vencido sin respuestas, también abre las decisiones
    const vence = exito(blackjack.tick(e, T0 + BJ.SEGURO_MS, rng));
    expect(vence.eventos).toEqual([{ tipo: "banca_mira", blackjack: false }]);
    expect(vence.estado).toMatchObject({ fase: "decisiones", finFase: T0 + BJ.SEGURO_MS + BJ.DECISIONES_MS });
    expect(vence.estado.seguros.every((s) => s.respondido && s.cantidad === 0)).toBe(true);
  });

  it("si nadie sigue jugando tras la mirada sin blackjack, la banca juega directamente", () => {
    // los dos tienen blackjack (no hay nada que decidir) y la banca enseña un as sin blackjack
    const e = apuestas([ANA, BETO], [mano(1, "ana", { casilla: 0 }), mano(2, "beto", { casilla: 1 })], "AS AH AD KS KH 6C");
    const abre = reparte(e).estado;
    expect(abre.fase).toBe("seguro");
    const ana = aplicar(abre, 1, seguro(false), REPARTO + 1_000).estado;
    const p = aplicar(ana, 2, seguro(false), REPARTO + 2_000);
    expect(p.estado).toMatchObject({ fase: "banca", finFase: REPARTO + 2_000 + BJ.BANCA_MS });
  });

  it("quien sale en el seguro pierde el suyo aunque la banca tenga blackjack", () => {
    // ana (100) asegura 50 y se va; beto (50) contesta después. La banca enseña A♦ y tapa K♣
    const e = enSeguro({
      banca: cs("AD KC"),
      manos: [mano(1, "ana", { casilla: 0, apuesta: 100, cartas: cs("10S 9H") }), mano(2, "beto", { casilla: 1, apuesta: 50, cartas: cs("10D 6H") })],
    });
    const asegura = aplicar(e, 1, seguro(true)).estado;
    const sale = aplicar(asegura, 1, { t: "salir" });
    expect(sale.estado.fase).toBe("seguro"); // beto aún no ha contestado
    expect(sale.estado.seguros[0]).toEqual({ jugadorId: 1, cantidad: 50, respondido: true });
    expect(sale.liquidacion).toBeUndefined();

    const final = aplicar(sale.estado, 2, seguro(false));
    expect(tipos(final)).toEqual(["banca_mira", "carta_girada", "pago", "pago"]);
    expect(final.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 150, pago: 0 },
      { jugadorId: 2, apuesta: 50, pago: 0 },
    ]);

    // si el que sale es quien frena a los demás, la banca mira al momento
    const sinAna = aplicar(aplicar(e, 2, seguro(false)).estado, 1, { t: "salir" });
    expect(sinAna.eventos.slice(0, 2)).toEqual([{ tipo: "banca_mira", blackjack: true }, { tipo: "carta_girada", carta: c("KC") }]);
    expect(sinAna.estado.fase).toBe("resultado");
  });

  it("si se va el último jugador durante el seguro se liquida de inmediato y el seguro cuenta como perdido", () => {
    const e = enSeguro({
      banca: cs("AD KC"),
      manos: [mano(1, "ana", { cartas: cs("10S 9H"), apuesta: 100 }), mano(2, "beto", { casilla: 1, cartas: cs("10D 6H"), apuesta: 50 })],
    });
    const asegura = aplicar(e, 1, seguro(true)).estado;
    const saleAna = aplicar(asegura, 1, { t: "salir" }).estado;
    expect(saleAna.fase).toBe("seguro");

    const saleBeto = aplicar(saleAna, 2, { t: "salir" });
    expect(saleBeto.liquidacion).toEqual({
      ronda: 1,
      filas: [
        { jugadorId: 1, apuesta: 150, pago: 0 },
        { jugadorId: 2, apuesta: 50, pago: 0 },
      ],
    });
    expect(saleBeto.eventos).toEqual([{ tipo: "pago", jugadorId: 1, neto: -150 }, { tipo: "pago", jugadorId: 2, neto: -50 }]);
    expect(saleBeto.estado).toMatchObject({ ronda: 2, fase: "esperando", seguros: [], bancaMirada: false });
  });
});

describe("la carta tapada", () => {
  /** ana (10♠ 9♥) contra 10♣ 7♦, en la fase que se pida. */
  const conBanca = (fase: FaseBJ) => estado({ fase, asientos: [ANA], banca: cs("10C 7D"), manos: [mano(1, "ana", { cartas: cs("10S 9H") })] });

  it("la carta tapada no sale en la vista durante el seguro ni cuando la banca mira sin blackjack", () => {
    // durante el seguro, para todos: la banca enseña A♦ y tapa K♣
    const conBlackjack = enSeguro({ banca: cs("AD KC") });
    for (const jugador of [1, 2, null]) {
      expect(vistaDe(conBlackjack, jugador)).toMatchObject({ fase: "seguro", banca: [c("AD"), null], totalBanca: 11 });
    }

    // la banca mira A♦ 7♣: no es blackjack y la tapada sigue sin salir durante las decisiones
    const contestan = (e: EstadoBJ) => aplicar(aplicar(e, 1, seguro(false)).estado, 2, seguro(false)).estado;
    const sinBlackjack = contestan(enSeguro({ banca: cs("AD 7C") }));
    expect(sinBlackjack.bancaMirada).toBe(true);
    for (const jugador of [1, 2, null]) {
      expect(vistaDe(sinBlackjack, jugador)).toMatchObject({ fase: "decisiones", banca: [c("AD"), null], totalBanca: 11 });
    }

    // con blackjack la banca la gira (carta_girada) y se enseña entera
    const girada = contestan(conBlackjack);
    expect(vistaDe(girada, 1)).toMatchObject({ fase: "resultado", banca: [c("AD"), c("KC")], totalBanca: 21 });
  });

  it("solo se enseña cuando se ha girado: es la excepción, no la regla", () => {
    for (const fase of ["apuestas", "seguro", "decisiones", "banca"] as FaseBJ[]) {
      expect(vistaDe(conBanca(fase), 1)).toMatchObject({ banca: [c("10C"), null], totalBanca: 10 });
    }
    // incluso en una fase que no existe: ante la duda, tapada
    expect(vistaDe(conBanca("inventada" as FaseBJ), 1)).toMatchObject({ banca: [c("10C"), null], totalBanca: 10 });
    expect(vistaDe(conBanca("resultado"), 1)).toMatchObject({ banca: [c("10C"), c("7D")], totalBanca: 17 });
  });
});

describe("rendirse", () => {
  /** ana juega dos manos sin tocar (25 en la casilla 0 y 50 en la 2) contra 10♣ 7♦. */
  const dosManos = (parcial: Partial<EstadoBJ> = {}) =>
    estado({
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      asientos: [ANA],
      banca: cs("10C 7D"),
      zapato: zapato("5C 9D"),
      manos: [
        mano(1, "ana", { casilla: 0, indice: 0, apuesta: 25, cartas: cs("10S 6H") }),
        mano(1, "ana", { casilla: 2, indice: 1, apuesta: 50, cartas: cs("10H 9S") }),
      ],
      ...parcial,
    });

  it("rendirse devuelve la mitad hacia abajo: 25 → 12", () => {
    const e = dosManos();
    expect(opcionesDe(e, 1).rendirse).toBe(true);
    expect(blackjack.costo(e, 1, { t: "rendirse" })).toBe(0);

    const rinde = aplicar(e, 1, { t: "rendirse" });
    expect(rinde.eventos).toEqual([{ tipo: "rendido", jugadorId: 1, indice: 0 }]);
    expect(rinde.estado.manos.map((m) => m.estado)).toEqual(["rendido", "jugando"]);
    // la activa pasa a la siguiente mano, que también puede rendirse (tiene dos cartas)
    expect(rinde.estado.fase).toBe("decisiones");
    expect(opcionesDe(rinde.estado, 1)).toMatchObject({ pedir: true, rendirse: true });

    // se planta la segunda (19 contra 17): gana 100 y de la primera vuelven 12
    const planta = aplicar(rinde.estado, 1, { t: "plantarse" }, T0 + 5_000).estado;
    expect(planta).toMatchObject({ fase: "banca", finFase: T0 + 5_000 + BJ.BANCA_MS });
    const fin = exito(blackjack.tick(planta, planta.finFase!, rng));
    expect(fin.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 75, pago: 112 }] });
    expect(fin.eventos.at(-1)).toEqual({ tipo: "pago", jugadorId: 1, neto: 37 });
  });

  it("si todas las manos se rinden o se pasan, la banca no pide carta", () => {
    // 6♦ 5♣ = 11: si la banca jugara, pediría
    const e = estado({
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      asientos: [ANA],
      banca: cs("6D 5C"),
      zapato: zapato("9S"),
      manos: [mano(1, "ana", { apuesta: 25, cartas: cs("10S 6H") })],
    });
    const rinde = aplicar(e, 1, { t: "rendirse" }, T0 + 1_000);
    expect(rinde.estado).toMatchObject({ fase: "banca", finFase: T0 + 1_000 + BJ.BANCA_MS }); // nadie más decide
    const fin = exito(blackjack.tick(rinde.estado, rinde.estado.finFase!, rng));
    expect(fin.estado.banca).toEqual(cs("6D 5C"));
    expect(fin.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 25, pago: 12 }] });
  });

  it("rendirse después de pedir, en una mano doblada o fuera de decisiones → accion_invalida", () => {
    const sola = dosManos({ manos: [mano(1, "ana", { apuesta: 25, cartas: cs("10S 2H") })] });
    expect(opcionesDe(sola, 1).rendirse).toBe(true);

    // después de pedir (tres cartas)
    const pide = aplicar(sola, 1, { t: "pedir" }).estado;
    expect(opcionesDe(pide, 1).rendirse).toBe(false);
    expect(error(blackjack.aplicar(pide, 1, { t: "rendirse" }, T0, rng))).toBe("accion_invalida");

    // en una mano doblada (ya no queda mano en juego)
    const dobla = aplicar(sola, 1, { t: "doblar" }).estado;
    expect(dobla.manos[0]).toMatchObject({ doblada: true, apuesta: 50 });
    expect(opcionesDe(dobla, 1).rendirse).toBe(false);
    expect(error(blackjack.aplicar(dobla, 1, { t: "rendirse" }, T0, rng))).toBe("accion_invalida");

    // una mano que sale de dividir tampoco se rinde, aunque tenga dos cartas
    const dividida = dosManos({ manos: [mano(1, "ana", { apuesta: 25, cartas: cs("8S 8H"), dividida: true })] });
    expect(opcionesDe(dividida, 1).rendirse).toBe(false);
    expect(error(blackjack.aplicar(dividida, 1, { t: "rendirse" }, T0, rng))).toBe("accion_invalida");

    // fuera de decisiones
    for (const fase of ["apuestas", "seguro", "banca", "resultado"] as FaseBJ[]) {
      const fuera = dosManos({ fase });
      expect(opcionesDe(fuera, 1).rendirse).toBe(false);
      expect(error(blackjack.aplicar(fuera, 1, { t: "rendirse" }, T0, rng))).toBe("accion_invalida");
    }

    // sin mano en juego (ya plantado) y sin asiento
    const plantado = aplicar(sola, 1, { t: "plantarse" }).estado;
    expect(error(blackjack.aplicar(plantado, 1, { t: "rendirse" }, T0, rng))).toBe("accion_invalida");
    expect(error(blackjack.aplicar(sola, 99, { t: "rendirse" }, T0, rng))).toBe("no_sentado");
  });

  it("quien se va después de rendirse pierde también lo que le devolvían", () => {
    const e = dosManos({ asientos: [ANA, BETO], manos: [...dosManos().manos, mano(2, "beto", { casilla: 1, cartas: cs("10D 8H") })] });
    const sale = aplicar(aplicar(e, 1, { t: "rendirse" }).estado, 1, { t: "salir" }).estado;
    const planta = aplicar(sale, 2, { t: "plantarse" }).estado;
    const fin = exito(blackjack.tick(planta, planta.finFase!, rng));
    // beto (18) gana a la banca (17); ana, que se rindió y se fue, no recupera nada
    expect(fin.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 75, pago: 0 },
      { jugadorId: 2, apuesta: 50, pago: 100 },
    ]);
  });
});
