import { describe, expect, it } from "vitest";
import { blackjack, BJ, manoActiva, opcionesDe, pago, type AccionBJ, type EstadoBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import { c, cs } from "../ayudas";
import { alVerseLaBanca, asiento, error, estado, exito, faseVista, mano, rng, T0, zapato } from "./ayudas-blackjack";

const ANA = asiento(1, "ana");
const BETO = asiento(2, "beto");
const DIVIDIR: AccionBJ = { t: "dividir" };

const aplicar = (e: EstadoBJ, jugadorId: number, accion: AccionBJ, ahora = T0) => exito(blackjack.aplicar(e, jugadorId, accion, ahora, rng));
const vistaDe = (e: EstadoBJ, jugadorId: number | null) => blackjack.vista(e, jugadorId, T0) as VistaBJ;

/** Resumen de las manos de un jugador para comparar de un vistazo: [indice, casilla, cartas]. */
const resumen = (e: EstadoBJ, jugadorId: number) =>
  e.manos.filter((m) => m.jugadorId === jugadorId).map((m) => [m.indice, m.casilla, m.cartas.map((x) => x.valor + x.palo).join(" ")]);

/** Ana juega una mano de 100 con `cartas` en decisiones contra 10♣ 7♦ (17); detrás del zapato, lo escrito en `siguientes`. */
const conPar = (cartas: string, siguientes = "3D 4C", parcial: Partial<EstadoBJ> = {}): EstadoBJ =>
  estado({
    fase: "decisiones",
    finFase: T0 + BJ.DECISIONES_MS,
    asientos: [ANA],
    banca: cs("10C 7D"),
    zapato: zapato(siguientes),
    manos: [mano(1, "ana", { apuesta: 100, cartas: cs(cartas) })],
    ...parcial,
  });

describe("cuándo se puede dividir", () => {
  it("se divide un par del mismo valor, también 10 con K, pero no 9 con 10", () => {
    for (const par of ["8S 8H", "10S KH", "JD QC", "KS KD", "AS AH", "2S 2D"]) {
      const e = conPar(par);
      expect(opcionesDe(e, 1).dividir, par).toBe(true);
      expect(vistaDe(e, 1).opciones?.dividir, par).toBe(true);
      expect(aplicar(e, 1, DIVIDIR).estado.manos, par).toHaveLength(2);
    }
    // el as vale 1 y el 10 vale 10: no son pareja
    for (const noPar of ["9S 10H", "10S AH", "AS KH", "8S 9H", "10S 6H"]) {
      const e = conPar(noPar);
      expect(opcionesDe(e, 1).dividir, noPar).toBe(false);
      expect(vistaDe(e, 1).opciones?.dividir, noPar).toBe(false);
      expect(error(blackjack.aplicar(e, 1, DIVIDIR, T0, rng)), noPar).toBe("accion_invalida");
    }
  });

  it("solo con dos cartas: una pareja de tres cartas ya no se divide", () => {
    const e = conPar("8S 8H 2C");
    expect(opcionesDe(e, 1).dividir).toBe(false);
    expect(error(blackjack.aplicar(e, 1, DIVIDIR, T0, rng))).toBe("accion_invalida");
  });

  it("solo en decisiones, sobre una mano en juego y con asiento", () => {
    for (const fase of ["apuestas", "seguro", "banca", "resultado"] as const) {
      const e = conPar("8S 8H", "3D 4C", { fase });
      expect(opcionesDe(e, 1).dividir, fase).toBe(false);
      expect(error(blackjack.aplicar(e, 1, DIVIDIR, T0, rng)), fase).toBe("fase_incorrecta");
    }
    // la pareja ya está plantada: no hay mano activa
    const plantada = conPar("8S 8H", "3D 4C", { manos: [mano(1, "ana", { apuesta: 100, cartas: cs("8S 8H"), estado: "plantado" })] });
    expect(opcionesDe(plantada, 1).dividir).toBe(false);
    expect(error(blackjack.aplicar(plantada, 1, DIVIDIR, T0, rng))).toBe("accion_invalida");

    // sentado pero sin manos, y sin asiento
    expect(error(blackjack.aplicar(conPar("8S 8H", "3D 4C", { asientos: [ANA, BETO] }), 2, DIVIDIR, T0, rng))).toBe("accion_invalida");
    expect(error(blackjack.aplicar(conPar("8S 8H"), 99, DIVIDIR, T0, rng))).toBe("no_sentado");
  });

  it("el espectador no recibe opciones y la acción no cambia el estado de entrada", () => {
    const e = conPar("8S 8H");
    const antes = structuredClone(e);
    expect(vistaDe(e, null).opciones).toBeNull();
    aplicar(e, 1, DIVIDIR);
    expect(e).toEqual(antes);
  });
});

describe("dividir", () => {
  it("cada mano recibe al momento su segunda carta, primero la original, y se juegan en orden", () => {
    const e = conPar("8S 8H", "3D 4C 5S");
    const p = aplicar(e, 1, DIVIDIR);

    expect(p.eventos).toEqual([
      { tipo: "mano_dividida", jugadorId: 1, casilla: 0, indice: 0 },
      { tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("3D") },
      { tipo: "carta_repartida", a: 1, mano: 1, oculta: false, carta: c("4C") },
    ]);
    expect(p.estado.manos).toEqual([
      mano(1, "ana", { casilla: 0, indice: 0, apuesta: 100, cartas: cs("8S 3D"), dividida: true }),
      mano(1, "ana", { casilla: 0, indice: 1, apuesta: 100, cartas: cs("8H 4C"), dividida: true }),
    ]);
    expect(p.estado.zapato.slice(0, 1)).toEqual(cs("5S"));
    expect(p.liquidacion).toBeUndefined();
    expect(p.estado.fase).toBe("decisiones");
    expect(manoActiva(p.estado, 1)).toMatchObject({ indice: 0, cartas: cs("8S 3D") });

    // se juegan en orden: pedir y plantarse actúan sobre la 0 y después sobre la 1
    const pide = aplicar(p.estado, 1, { t: "pedir" });
    expect(pide.eventos).toEqual([{ tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("5S") }]);
    const planta = aplicar(pide.estado, 1, { t: "plantarse" }).estado;
    expect(manoActiva(planta, 1)).toMatchObject({ indice: 1, cartas: cs("8H 4C") });
    expect(planta.fase).toBe("decisiones");
    const fin = aplicar(planta, 1, { t: "plantarse" }).estado;
    expect(manoActiva(fin, 1)).toBeUndefined();
    expect(faseVista(fin, T0).fase).toBe("banca");
  });

  it("la mano nueva va justo detrás de la original y se renumeran los índices del jugador", () => {
    // ana: casilla 0 (8♠ 8♥) y casilla 2 (9♠ 9♥); beto en la casilla 1. Se divide la primera de ana.
    const e = estado({
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      asientos: [ANA, BETO],
      banca: cs("10C 7D"),
      zapato: zapato("3D 4C"),
      manos: [
        mano(1, "ana", { casilla: 0, indice: 0, cartas: cs("8S 8H") }),
        mano(2, "beto", { casilla: 1, indice: 0, cartas: cs("10D 8H") }),
        mano(1, "ana", { casilla: 2, indice: 1, cartas: cs("9S 9H") }),
      ],
    });
    const p = aplicar(e, 1, DIVIDIR);

    expect(p.estado.manos.map((m) => [m.jugadorId, m.casilla, m.indice])).toEqual([[1, 0, 0], [1, 0, 1], [2, 1, 0], [1, 2, 2]]);
    expect(resumen(p.estado, 1)).toEqual([[0, 0, "8S 3D"], [1, 0, "8H 4C"], [2, 2, "9S 9H"]]);
    // la mano de beto no se toca
    expect(p.estado.manos[2]).toEqual(e.manos[1]);
    expect(p.eventos[0]).toEqual({ tipo: "mano_dividida", jugadorId: 1, casilla: 0, indice: 0 });
    expect(p.eventos.slice(1).map((ev) => [ev.a, ev.mano])).toEqual([[1, 0], [1, 1]]);

    // la vista las ordena por (casilla, indice)
    expect(vistaDe(p.estado, 1).manos.map((m) => [m.jugadorId, m.casilla, m.indice, m.dividida])).toEqual([
      [1, 0, 0, true],
      [1, 0, 1, true],
      [2, 1, 0, false],
      [1, 2, 2, false],
    ]);
  });

  it("dividir la segunda casilla deja la primera como está y numera la nueva detrás", () => {
    const e = estado({
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      asientos: [ANA],
      banca: cs("10C 7D"),
      zapato: zapato("3D 4C"),
      manos: [
        mano(1, "ana", { casilla: 0, indice: 0, cartas: cs("10S 6H"), estado: "plantado" }),
        mano(1, "ana", { casilla: 3, indice: 1, cartas: cs("7S 7H") }),
      ],
    });
    const p = aplicar(e, 1, DIVIDIR);
    expect(resumen(p.estado, 1)).toEqual([[0, 0, "10S 6H"], [1, 3, "7S 3D"], [2, 3, "7H 4C"]]);
    expect(p.eventos[0]).toEqual({ tipo: "mano_dividida", jugadorId: 1, casilla: 3, indice: 1 });
    expect(p.eventos.slice(1).map((ev) => ev.mano)).toEqual([1, 2]);
    expect(manoActiva(p.estado, 1)).toMatchObject({ casilla: 3, indice: 1 });
  });

  it("los ases se dividen una sola vez, reciben una carta cada uno y se plantan", () => {
    // el primer as recibe otro as: sigue siendo un par de ases, pero ya no se vuelve a dividir
    const e = conPar("AS AH", "AC 5D", { asientos: [ANA, BETO], manos: [mano(1, "ana", { apuesta: 100, cartas: cs("AS AH") }), mano(2, "beto", { casilla: 1, cartas: cs("10D 8H") })] });
    const p = aplicar(e, 1, DIVIDIR);
    expect(p.eventos).toEqual([
      { tipo: "mano_dividida", jugadorId: 1, casilla: 0, indice: 0 },
      { tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("AC") },
      { tipo: "carta_repartida", a: 1, mano: 1, oculta: false, carta: c("5D") },
    ]);
    expect(p.estado.manos.filter((m) => m.jugadorId === 1).map((m) => [m.cartas, m.estado, m.dividida])).toEqual([
      [cs("AS AC"), "plantado", true],
      [cs("AH 5D"), "plantado", true],
    ]);
    expect(manoActiva(p.estado, 1)).toBeUndefined();
    expect(opcionesDe(p.estado, 1)).toMatchObject({ pedir: false, plantarse: false, doblar: false, dividir: false, rendirse: false });
    expect(error(blackjack.aplicar(p.estado, 1, DIVIDIR, T0, rng))).toBe("accion_invalida");
    expect(error(blackjack.aplicar(p.estado, 1, { t: "pedir" }, T0, rng))).toBe("accion_invalida");
    // beto sigue decidiendo: la fase continúa
    expect(p.estado.fase).toBe("decisiones");

    // aunque el estado dijera que una pareja de ases dividida sigue en juego, no se vuelve a dividir
    const forzada = conPar("AS AH", "3D 4C", { manos: [mano(1, "ana", { apuesta: 100, cartas: cs("AS AH"), dividida: true })] });
    expect(opcionesDe(forzada, 1).dividir).toBe(false);
    expect(error(blackjack.aplicar(forzada, 1, DIVIDIR, T0, rng))).toBe("accion_invalida");
    // en cambio, una pareja de otro valor que sale de dividir sí se vuelve a dividir
    const ochos = conPar("8S 8H", "3D 4C", { manos: [mano(1, "ana", { apuesta: 100, cartas: cs("8S 8H"), dividida: true })] });
    expect(opcionesDe(ochos, 1).dividir).toBe(true);
  });

  it("si solo quedaban los ases divididos, la banca juega sin esperar al reloj", () => {
    const p = aplicar(conPar("AS AH", "KD 5D"), 1, DIVIDIR, T0 + 2_000);
    expect(faseVista(p.estado, T0 + 2_000)).toEqual({ fase: "banca", finFase: T0 + 2_000 + BJ.BANCA_MS });
    expect(p.liquidacion?.visibleEn).toBe(T0 + 2_000 + BJ.BANCA_MS);
  });

  it("con una casilla se llega a 4 manos; con dos, cada casilla se divide una vez", () => {
    // una casilla: 8♠ 8♥ → cada división reparte otro ocho a la mano original y a la nueva
    let e = conPar("8S 8H", "8D 8C 8S 8H 8D 8C");
    for (const manos of [2, 3, 4]) {
      expect(opcionesDe(e, 1).dividir, `antes de tener ${manos}`).toBe(true);
      e = aplicar(e, 1, DIVIDIR).estado;
      expect(e.manos, `con ${manos}`).toHaveLength(manos);
    }
    expect(e.manos.map((m) => [m.indice, m.casilla, m.dividida])).toEqual([[0, 0, true], [1, 0, true], [2, 0, true], [3, 0, true]]);
    // la mano activa vuelve a ser una pareja de ochos, pero ya no cabe otra mano
    expect(manoActiva(e, 1)).toMatchObject({ indice: 0, cartas: cs("8S 8D") });
    expect(opcionesDe(e, 1).dividir).toBe(false);
    expect(error(blackjack.aplicar(e, 1, DIVIDIR, T0, rng))).toBe("accion_invalida");
    // ni siquiera pasando a la siguiente mano (otra pareja de ochos)
    const siguiente = aplicar(e, 1, { t: "plantarse" }).estado;
    expect(manoActiva(siguiente, 1)).toMatchObject({ indice: 1 });
    expect(opcionesDe(siguiente, 1).dividir).toBe(false);

    // dos casillas: la 0 se divide una vez y ya no más, aunque haya otra pareja de ochos
    const dos = estado({
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      asientos: [ANA],
      banca: cs("10C 7D"),
      zapato: zapato("8D 8C 9D 9C"),
      manos: [mano(1, "ana", { casilla: 0, indice: 0, apuesta: 50, cartas: cs("8S 8H") }), mano(1, "ana", { casilla: 3, indice: 1, apuesta: 50, cartas: cs("9S 9H") })],
    });
    const primera = aplicar(dos, 1, DIVIDIR).estado;
    expect(resumen(primera, 1)).toEqual([[0, 0, "8S 8D"], [1, 0, "8H 8C"], [2, 3, "9S 9H"]]);
    // la mano activa es otro par de ochos y el jugador solo tiene 3 manos, pero la casilla 0 ya tiene las dos que le tocan
    expect(opcionesDe(primera, 1).dividir).toBe(false);
    expect(error(blackjack.aplicar(primera, 1, DIVIDIR, T0, rng))).toBe("accion_invalida");

    // pasa a las dos de la casilla 0 y llega a los nueves de la otra casilla: esa sí se divide, y es la cuarta mano
    const enLaOtra = aplicar(aplicar(primera, 1, { t: "plantarse" }).estado, 1, { t: "plantarse" }).estado;
    expect(manoActiva(enLaOtra, 1)).toMatchObject({ casilla: 3, indice: 2 });
    expect(opcionesDe(enLaOtra, 1).dividir).toBe(true);
    const cuatro = aplicar(enLaOtra, 1, DIVIDIR).estado;
    expect(resumen(cuatro, 1).map((r) => r.slice(0, 2))).toEqual([[0, 0], [1, 0], [2, 3], [3, 3]]);
    expect(cuatro.manos).toHaveLength(4);
    expect(opcionesDe(cuatro, 1).dividir).toBe(false);
  });

  it("el tope es por jugador: ana ya tiene cuatro manos y beto, con su propio cupo, todavía divide", () => {
    const cuatro = (indice: number, parcial: Partial<EstadoBJ["manos"][number]> = {}) =>
      mano(1, "ana", { casilla: 0, indice, apuesta: 100, dividida: true, cartas: cs("10S 6H"), estado: "plantado", ...parcial });
    const e = conPar("8S 8H", "8D 8C", {
      asientos: [ANA, BETO],
      manos: [
        cuatro(0, { cartas: cs("8S 8H"), estado: "jugando" }),
        cuatro(1),
        cuatro(2),
        cuatro(3),
        mano(2, "beto", { casilla: 1, apuesta: 40, cartas: cs("7S 7H") }),
      ],
    });
    expect(opcionesDe(e, 1).dividir).toBe(false);
    expect(error(blackjack.aplicar(e, 1, DIVIDIR, T0, rng))).toBe("accion_invalida");

    expect(opcionesDe(e, 2).dividir).toBe(true);
    const p = aplicar(e, 2, DIVIDIR);
    expect(resumen(p.estado, 2)).toEqual([[0, 1, "7S 8D"], [1, 1, "7H 8C"]]);
    expect(p.estado.manos.find((m) => m.jugadorId === 2 && m.indice === 1)).toMatchObject({ apuesta: 40, dividida: true });
    expect(p.estado.manos.filter((m) => m.jugadorId === 1)).toEqual(e.manos.filter((m) => m.jugadorId === 1));
  });
});

describe("tiempo, coste y pago", () => {
  it("cada división alarga la ventana 10 s", () => {
    const e = conPar("8S 8H", "8D 8C 3S 4S");
    expect(e.finFase).toBe(T0 + BJ.DECISIONES_MS);

    // se alarga sobre la hora de fin, no sobre el instante en que se divide
    const una = aplicar(e, 1, DIVIDIR, T0 + 3_000);
    expect(una.estado.finFase).toBe(T0 + BJ.DECISIONES_MS + BJ.DIVIDIR_EXTRA_MS);
    expect(BJ.DIVIDIR_EXTRA_MS).toBe(10_000);
    expect(blackjack.proximaAlarma(una.estado)).toBe(T0 + 25_000);

    const dos = aplicar(una.estado, 1, DIVIDIR, T0 + 6_000);
    expect(dos.estado.finFase).toBe(T0 + BJ.DECISIONES_MS + 2 * BJ.DIVIDIR_EXTRA_MS);
  });

  it("con la ventana alargada no se cierra a la hora antigua, y al vencer se plantan las manos que queden", () => {
    const dividida = aplicar(conPar("8S 8H", "3D 4C"), 1, DIVIDIR, T0 + 1_000).estado;
    // a la hora original no pasa nada: se devuelve el mismo estado
    expect(exito(blackjack.tick(dividida, T0 + BJ.DECISIONES_MS, rng)).estado).toBe(dividida);

    const vence = exito(blackjack.tick(dividida, T0 + BJ.DECISIONES_MS + BJ.DIVIDIR_EXTRA_MS, rng));
    expect(vence.estado.manos.map((m) => m.estado)).toEqual(["plantado", "plantado"]);
    const cierre = T0 + BJ.DECISIONES_MS + BJ.DIVIDIR_EXTRA_MS;
    expect(faseVista(vence.estado, cierre)).toEqual({ fase: "banca", finFase: cierre + BJ.BANCA_MS });
  });

  it("dividir cuesta la apuesta de la mano y se puede doblar después", () => {
    // con dos manos, cuesta la apuesta de la activa
    const dos = conPar("8S 8H", "3D 4C 9S KS", {
      manos: [mano(1, "ana", { casilla: 0, indice: 0, apuesta: 30, cartas: cs("10S 6H"), estado: "plantado" }), mano(1, "ana", { casilla: 1, indice: 1, apuesta: 100, cartas: cs("8S 8H") })],
    });
    expect(blackjack.costo(dos, 1, DIVIDIR)).toBe(100);
    expect(blackjack.costo(conPar("8S 8H"), 1, DIVIDIR)).toBe(100);
    expect(blackjack.costo(conPar("8S 8H"), 2, DIVIDIR)).toBe(0); // sin manos no cuesta nada

    // después de dividir, cada mano apuesta 100 y se puede doblar la activa: cuesta otros 100
    const e = conPar("8S 8H", "3D 4C 9S KS");
    const dividida = aplicar(e, 1, DIVIDIR).estado;
    expect(dividida.manos.map((m) => m.apuesta)).toEqual([100, 100]);
    expect(opcionesDe(dividida, 1)).toMatchObject({ doblar: true, rendirse: false, pedir: true, plantarse: true });
    expect(blackjack.costo(dividida, 1, { t: "doblar" })).toBe(100);

    const dobla = aplicar(dividida, 1, { t: "doblar" });
    expect(dobla.eventos).toEqual([{ tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("9S") }]);
    expect(dobla.estado.manos[0]).toMatchObject({ apuesta: 200, doblada: true, dividida: true, estado: "plantado", cartas: cs("8S 3D 9S") });
    expect(manoActiva(dobla.estado, 1)).toMatchObject({ indice: 1, apuesta: 100 });
    // la otra mano también se dobla (con 8♥ 4♣ K♠ se pasa, pero ya había pagado el doble)
    const dobla2 = aplicar(dobla.estado, 1, { t: "doblar" });
    expect(dobla2.estado.manos.map((m) => m.apuesta)).toEqual([200, 200]);
    expect(faseVista(dobla2.estado, T0).fase).toBe("banca");
    expect(opcionesDe(dobla2.estado, 1).dividir).toBe(false);
  });

  it("no se puede rendir una mano que sale de dividir, aunque tenga dos cartas", () => {
    const dividida = aplicar(conPar("8S 8H"), 1, DIVIDIR).estado;
    expect(opcionesDe(dividida, 1).rendirse).toBe(false);
    expect(error(blackjack.aplicar(dividida, 1, { t: "rendirse" }, T0, rng))).toBe("accion_invalida");
  });

  it("un 21 tras dividir paga 1:1, no 3:2", () => {
    const mano21 = (dividida: boolean) => ({ cartas: cs("AS KH"), apuesta: 100, doblada: false, dividida });
    expect(pago(mano21(false), cs("10C 9D"))).toBe(250); // blackjack natural
    expect(pago(mano21(true), cs("10C 9D"))).toBe(200); // 21 de una mano dividida
    expect(pago(mano21(true), cs("10C 7D 4S"))).toBe(100); // empata con un 21 de tres cartas
    expect(pago(mano21(true), cs("AH QD"))).toBe(0); // y pierde contra el blackjack de la banca
    expect(pago({ ...mano21(true), apuesta: 15 }, cs("10C 9D"))).toBe(30);

    // de punta a punta: 10♠ K♥ se divide y la primera recibe un as (A♣), la segunda un 6
    const e = conPar("10S KH", "AC 6D");
    const dividida = aplicar(e, 1, DIVIDIR).estado;
    expect(dividida.manos.map((m) => [m.cartas, m.estado])).toEqual([[cs("10S AC"), "jugando"], [cs("KH 6D"), "jugando"]]);
    const fin = aplicar(aplicar(dividida, 1, { t: "plantarse" }).estado, 1, { t: "plantarse" });
    // la banca (17) paga 1:1 el 21 y gana a la otra mano (16)
    expect(fin.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 200, pago: 200 }], visibleEn: T0 + BJ.BANCA_MS });
    expect(alVerseLaBanca(fin).at(-1)).toEqual({ tipo: "pago", jugadorId: 1, neto: 0 });
  });

  it("la liquidación suma las manos divididas en una fila", () => {
    // ana (100) divide 8♠ 8♥: la primera recibe 3♦ y se dobla con K♠ (21 de tres cartas, 200), la segunda 9♣ y se planta (17: empata)
    // beto (20) tiene 18 y gana a la banca (10♣ 7♦ = 17)
    const e = conPar("8S 8H", "3D 9C KS", {
      asientos: [ANA, BETO],
      manos: [mano(1, "ana", { casilla: 0, apuesta: 100, cartas: cs("8S 8H") }), mano(2, "beto", { casilla: 1, apuesta: 20, cartas: cs("10D 8H"), estado: "plantado" })],
    });
    const dividida = aplicar(e, 1, DIVIDIR).estado;
    const dobla = aplicar(dividida, 1, { t: "doblar" }, T0 + 1_000).estado;
    expect(dobla.manos.filter((m) => m.jugadorId === 1).map((m) => m.apuesta)).toEqual([200, 100]);
    const fin = aplicar(dobla, 1, { t: "plantarse" }, T0 + 2_000);
    expect(faseVista(fin.estado, T0 + 2_000).fase).toBe("banca");
    expect(fin.liquidacion).toEqual({
      ronda: 1,
      filas: [
        { jugadorId: 1, apuesta: 300, pago: 500 }, // 400 de la doblada (gana) + 100 de la que empata
        { jugadorId: 2, apuesta: 20, pago: 40 },
      ],
      visibleEn: T0 + 2_000 + BJ.BANCA_MS,
    });
    expect(alVerseLaBanca(fin).filter((ev) => ev.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: 1, neto: 200 },
      { tipo: "pago", jugadorId: 2, neto: 20 },
    ]);
    expect(fin.estado.fase).toBe("resultado");
  });

  it("la liquidación de manos divididas con resultados distintos: gana una, pierde otra, otra se pasa", () => {
    // ana (50) divide dos veces y juega tres manos contra la banca (17): una gana, otra pierde y la última se pasa
    const e = conPar("8S 8H", "KD 8C 8D 3H 9D KH", { manos: [mano(1, "ana", { apuesta: 50, cartas: cs("8S 8H") })] });
    // 1.ª división: mano 0 = 8♠ K♦ (18), mano 1 = 8♥ 8♣ (otro par)
    const primera = aplicar(e, 1, DIVIDIR).estado;
    expect(resumen(primera, 1)).toEqual([[0, 0, "8S KD"], [1, 0, "8H 8C"]]);
    const planta0 = aplicar(primera, 1, { t: "plantarse" }).estado; // 18 gana a 17
    // 2.ª división sobre la mano 1: mano 1 = 8♥ 8♦, mano 2 = 8♣ 3♥
    const segunda = aplicar(planta0, 1, DIVIDIR).estado;
    expect(resumen(segunda, 1)).toEqual([[0, 0, "8S KD"], [1, 0, "8H 8D"], [2, 0, "8C 3H"]]);
    const planta1 = aplicar(segunda, 1, { t: "plantarse" }).estado; // 16 pierde contra 17
    const pasa = aplicar(planta1, 1, { t: "pedir" }).estado; // 8♣ 3♥ 9♦ = 20
    const fin = aplicar(pasa, 1, { t: "pedir" }); // + K♥ = 30: pasada
    expect(fin.estado.manos.map((m) => m.estado)).toEqual(["plantado", "plantado", "pasado"]);
    expect(faseVista(fin.estado, T0).fase).toBe("banca");
    expect(fin.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 150, pago: 100 }], visibleEn: T0 + BJ.BANCA_MS });
    expect(alVerseLaBanca(fin).at(-1)).toEqual({ tipo: "pago", jugadorId: 1, neto: -50 });
  });
});

describe("dividir y salir", () => {
  it("quien se va después de dividir pierde las dos manos, y las dos apuestas", () => {
    const dividida = aplicar(conPar("8S 8H"), 1, DIVIDIR).estado;
    const sale = aplicar(dividida, 1, { t: "salir" });
    // era el último jugador: se liquida ya, con una sola fila de 200 y nada de pago
    expect(sale.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 200, pago: 0 }] });
    expect(sale.eventos).toEqual([{ tipo: "pago", jugadorId: 1, neto: -200 }]);
    expect(sale.estado).toMatchObject({ ronda: 2, fase: "esperando", manos: [] });

    // con otro jugador en la mesa las dos manos quedan abandonadas y plantadas
    const conBeto = conPar("8S 8H", "3D 4C", { asientos: [ANA, BETO], manos: [mano(1, "ana", { apuesta: 100, cartas: cs("8S 8H") }), mano(2, "beto", { casilla: 1, cartas: cs("10D 8H") })] });
    const salida = aplicar(aplicar(conBeto, 1, DIVIDIR).estado, 1, { t: "salir" }).estado;
    expect(salida.manos.filter((m) => m.jugadorId === 1).map((m) => [m.abandonada, m.estado])).toEqual([[true, "plantado"], [true, "plantado"]]);
    const fin = aplicar(salida, 2, { t: "plantarse" });
    expect(fin.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 200, pago: 0 },
      { jugadorId: 2, apuesta: 50, pago: 100 },
    ]);
  });

  it("quien se desconecta después de dividir planta las dos manos", () => {
    const conBeto = conPar("8S 8H", "3D 4C", { asientos: [ANA, BETO], manos: [mano(1, "ana", { apuesta: 100, cartas: cs("8S 8H") }), mano(2, "beto", { casilla: 1, cartas: cs("10D 8H") })] });
    const p = exito(blackjack.desconectar(aplicar(conBeto, 1, DIVIDIR).estado, 1, T0 + 1_000, rng));
    expect(p.estado.manos.filter((m) => m.jugadorId === 1).map((m) => [m.estado, m.abandonada])).toEqual([["plantado", false], ["plantado", false]]);
    expect(p.estado.fase).toBe("decisiones"); // beto sigue decidiendo
  });
});
