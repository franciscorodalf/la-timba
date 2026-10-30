import { describe, expect, it } from "vitest";
import { apuestaValida, bancaDebePedir, BJ, esBlackjack, pago, puntuacion } from "../../src/shared/juegos/blackjack";
import { cs } from "../ayudas";

describe("puntuacion", () => {
  it("puntuación con ases", () => {
    expect(puntuacion(cs("AS KH")).total).toBe(21);
    expect(puntuacion(cs("AS AH 9C")).total).toBe(21);
    expect(puntuacion(cs("AS 6H")).blanda).toBe(true);
    expect(puntuacion(cs("AS 6H KD")).total).toBe(17);
    expect(puntuacion(cs("KS QH 5D")).total).toBe(25);
  });

  it("blanda es true solo cuando un as cuenta como 11", () => {
    expect(puntuacion(cs("AS 6H"))).toEqual({ total: 17, blanda: true });
    expect(puntuacion(cs("AS 6H KD"))).toEqual({ total: 17, blanda: false });
    expect(puntuacion(cs("AS AH 9C"))).toEqual({ total: 21, blanda: true });
    expect(puntuacion(cs("AS AH"))).toEqual({ total: 12, blanda: true });
    expect(puntuacion(cs("10S 6H"))).toEqual({ total: 16, blanda: false });
    expect(puntuacion(cs("KS QH 5D"))).toEqual({ total: 25, blanda: false });
  });

  it("las figuras y el 10 valen 10; el resto, su número", () => {
    expect(puntuacion(cs("JS")).total).toBe(10);
    expect(puntuacion(cs("QS")).total).toBe(10);
    expect(puntuacion(cs("KS")).total).toBe(10);
    expect(puntuacion(cs("10S")).total).toBe(10);
    expect(puntuacion(cs("2S 3H 4D")).total).toBe(9);
  });

  it("cuatro ases suman 14 (un solo as como 11)", () => {
    expect(puntuacion(cs("AS AH AD AC"))).toEqual({ total: 14, blanda: true });
  });

  it("una mano vacía suma 0", () => {
    expect(puntuacion([])).toEqual({ total: 0, blanda: false });
  });
});

describe("esBlackjack", () => {
  it("son exactamente 2 cartas y 21", () => {
    expect(esBlackjack(cs("AS KH"))).toBe(true);
    expect(esBlackjack(cs("10S AH"))).toBe(true);
    expect(esBlackjack(cs("7S 7H 7D"))).toBe(false);
    expect(esBlackjack(cs("AS AH 9C"))).toBe(false);
    expect(esBlackjack(cs("KS 9H"))).toBe(false);
    expect(esBlackjack(cs("AS"))).toBe(false);
    expect(esBlackjack([])).toBe(false);
  });
});

describe("bancaDebePedir", () => {
  it("banca pide con 16 y se planta con 17 blando", () => {
    expect(bancaDebePedir(cs("10S 6H"))).toBe(true);
    expect(bancaDebePedir(cs("AS 6H"))).toBe(false);
  });

  it("se planta en cualquier 17 o más y pide con menos de 17", () => {
    expect(bancaDebePedir(cs("10S 7H"))).toBe(false);
    expect(bancaDebePedir(cs("10S 8H"))).toBe(false);
    expect(bancaDebePedir(cs("KS QH 5D"))).toBe(false);
    expect(bancaDebePedir(cs("AS 5H"))).toBe(true);
    expect(bancaDebePedir(cs("2S 3H"))).toBe(true);
  });
});

describe("pago", () => {
  const m = (s: string, apuesta = 50, doblada = false, dividida = false) => ({ cartas: cs(s), apuesta, doblada, dividida });

  it("pagos", () => {
    expect(pago(m("AS KH"), cs("10S 9H"))).toBe(125); // blackjack 3:2
    expect(pago(m("AS KH", 15), cs("10S 9H"))).toBe(37); // 15 + floor(22,5)
    expect(pago(m("AS KH"), cs("AH QD"))).toBe(50); // blackjack vs blackjack = empate
    expect(pago(m("10S 9H"), cs("AH QD"))).toBe(0); // banca blackjack
    expect(pago(m("10S 9H"), cs("10C 6D 9S"))).toBe(100); // banca se pasa
    expect(pago(m("10S 9H"), cs("10C 9D"))).toBe(50); // empate
    expect(pago(m("10S 7H"), cs("10C 9D"))).toBe(0);
    expect(pago(m("KS 5H 9C"), cs("10C 6D 9S"))).toBe(0); // jugador pasado pierde aunque banca se pase
    expect(pago(m("5S 6H KC", 100, true), cs("10C 9D"))).toBe(200); // doblada gana
  });

  it("ganar con más puntos paga 1:1 (apuesta incluida)", () => {
    expect(pago(m("10S 9H"), cs("10C 8D"))).toBe(100);
    expect(pago(m("5S 6H KC"), cs("10C 9D"))).toBe(100); // 21 de tres cartas no es blackjack
  });

  it("el blackjack paga 3:2 con la fracción redondeada hacia abajo", () => {
    expect(pago(m("AS KH", 10), cs("10S 9H"))).toBe(25);
    expect(pago(m("AS KH", 11), cs("10S 9H"))).toBe(27); // 11 + floor(16,5)
    expect(pago(m("AS KH", 500), cs("10S 9H"))).toBe(1250);
  });

  it("el blackjack gana 3:2 aunque la banca llegue a 21 con tres cartas", () => {
    expect(pago(m("AS KH"), cs("7C 7D 7S"))).toBe(125);
  });

  it("una mano doblada nunca cuenta como blackjack natural", () => {
    expect(pago(m("AS KH", 100, true), cs("10S 9H"))).toBe(200); // 1:1, no 3:2
    expect(pago(m("AS KH", 100, true), cs("AH QD"))).toBe(0); // pierde contra blackjack de banca
    expect(pago(m("AS KH", 100, true), cs("7C 7D 7S"))).toBe(100); // empata a 21 con la banca
  });

  it("21 de varias cartas pierde contra el blackjack de la banca", () => {
    expect(pago(m("7S 7H 7D"), cs("AH QD"))).toBe(0);
  });

  it("jugador pasado pierde, también contra una banca pasada o con blackjack", () => {
    expect(pago(m("KS 5H 9C"), cs("AH QD"))).toBe(0);
    expect(pago(m("KS 5H 9C"), cs("10C 6D 9S"))).toBe(0);
  });

  it("banca pasada paga 1:1 a toda mano viva", () => {
    expect(pago(m("2S 3H"), cs("10C 6D 9S"))).toBe(100);
    expect(pago(m("AS 6H"), cs("10C 6D 9S"))).toBe(100);
  });

  it("empate a 21 de tres cartas devuelve la apuesta", () => {
    expect(pago(m("7S 7H 7D"), cs("5C 6D KS"))).toBe(50);
  });
});

describe("apuestaValida", () => {
  it("apuestaValida", () => {
    for (const ok of [10, 250, 500, 501, 12_345]) expect(apuestaValida(ok)).toBe(true);
    for (const mal of [0, -10, 9, 50.5, "50", NaN, null]) expect(apuestaValida(mal)).toBe(false);
  });

  it("rechaza infinitos, undefined, booleanos y objetos", () => {
    for (const mal of [Infinity, -Infinity, undefined, true, {}, [], [50]]) expect(apuestaValida(mal)).toBe(false);
  });

  it("acepta desde el mínimo sin tope (se puede apostar todo), pero solo enteros seguros", () => {
    expect(apuestaValida(BJ.MIN)).toBe(true);
    expect(apuestaValida(BJ.MIN - 1)).toBe(false);
    expect(apuestaValida(1_000_000)).toBe(true);
    expect(apuestaValida(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(apuestaValida(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
  });
});

describe("BJ", () => {
  it("fija las constantes de la mesa", () => {
    expect(BJ).toEqual({
      BARAJAS: 6,
      MIN_ZAPATO: 78,
      APUESTAS_MS: 15_000,
      DECISIONES_MS: 15_000,
      BANCA_MS: 1_000,
      RESULTADO_MS: 4_000,
      MIN: 10,
      MAX_JUGADORES: 6,
      CASILLAS: 7,
      MAX_MANOS_JUGADOR: 4,
      SEGURO_MS: 10_000,
      DIVIDIR_EXTRA_MS: 10_000,
    });
  });
});
