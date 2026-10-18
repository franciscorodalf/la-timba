import { describe, expect, it } from "vitest";
import { claveCarta, ESCALONADO_MS, GIRO_MS, guionDelLote, totalVisible, VUELO_MS } from "../../src/client/pantallas/guion-blackjack";
import type { Carta } from "../../src/shared/cartas";
import type { VistaBJ } from "../../src/shared/juegos/blackjack";

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Carta["palo"], valor: texto.slice(0, -1) as Carta["valor"] });

function mano(jugadorId: number, cartas: Carta[]): VistaBJ["manos"][number] {
  return { jugadorId, apodo: `j${jugadorId}`, apuesta: 50, cartas, estado: "jugando", doblada: false, total: 0 };
}

function vista(resto: Partial<VistaBJ>): VistaBJ {
  return { ronda: 3, fase: "decisiones", finFase: 0, banca: [], totalBanca: null, manos: [], sentados: [], yo: 1, ...resto };
}

describe("guionDelLote", () => {
  it("en el reparto, cada carta sale 260 ms después de la anterior en el orden de los eventos", () => {
    const v = vista({ banca: [c("6S"), null], manos: [mano(1, [c("10H"), c("9C")]), mano(2, [c("2D"), c("AS")])] });
    const guion = guionDelLote(
      [
        { tipo: "carta_repartida", a: 1, oculta: false, carta: c("10H") },
        { tipo: "carta_repartida", a: 2, oculta: false, carta: c("2D") },
        { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("6S") },
        { tipo: "carta_repartida", a: 1, oculta: false, carta: c("9C") },
        { tipo: "carta_repartida", a: 2, oculta: false, carta: c("AS") },
        { tipo: "carta_repartida", a: "banca", oculta: true },
      ],
      v,
    );
    expect(ESCALONADO_MS).toBe(260);
    expect([...guion.cartas]).toEqual([
      [claveCarta(3, 1, 0), 0],
      [claveCarta(3, 2, 0), 260],
      [claveCarta(3, "banca", 0), 520],
      [claveCarta(3, 1, 1), 780],
      [claveCarta(3, 2, 1), 1040],
      [claveCarta(3, "banca", 1), 1300],
    ]);
    expect(guion.giro).toBe(false);
    expect(guion.fin).toBe(1300 + VUELO_MS);
  });

  it("una carta pedida es la última de la mano; los eventos que no son cartas no cuentan como posición", () => {
    const v = vista({ manos: [mano(1, [c("10H"), c("2C"), c("5D")])] });
    const guion = guionDelLote([{ tipo: "barajado" }, { tipo: "carta_repartida", a: 1, oculta: false, carta: c("5D") }], v);
    expect([...guion.cartas]).toEqual([[claveCarta(3, 1, 2), 0]]);
  });

  it("al jugar la banca, primero se gira la tapada y las cartas que pide salen cuando termina el giro", () => {
    const v = vista({ fase: "resultado", banca: [c("6S"), c("10D"), c("2C"), c("3H")] });
    const guion = guionDelLote(
      [
        { tipo: "carta_girada", carta: c("10D") },
        { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("2C") },
        { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("3H") },
        { tipo: "pago", jugadorId: 1, neto: 50 },
      ],
      v,
    );
    expect(guion.giro).toBe(true);
    const primera = guion.cartas.get(claveCarta(3, "banca", 2))!;
    expect(primera).toBeGreaterThanOrEqual(GIRO_MS);
    expect(guion.cartas.get(claveCarta(3, "banca", 3))).toBe(primera + ESCALONADO_MS);
    expect(guion.fin).toBe(primera + ESCALONADO_MS + VUELO_MS);
  });

  it("sin cartas en el lote no hay nada que animar; un evento de una mano que ya no está se ignora", () => {
    expect(guionDelLote([{ tipo: "pago", jugadorId: 1, neto: -50 }], vista({})).cartas.size).toBe(0);
    const guion = guionDelLote([{ tipo: "carta_repartida", a: 9, oculta: false, carta: c("5D") }], vista({ manos: [mano(1, [c("5D")])] }));
    expect(guion.cartas.size).toBe(0);
    expect(guion.fin).toBe(0);
  });
});

describe("totalVisible", () => {
  it("suma solo las cartas que ya se ven, con el as como 11 si cabe", () => {
    expect(totalVisible([c("AS"), c("6D"), c("9C")], () => true)).toBe(16);
    expect(totalVisible([c("AS"), c("6D"), c("9C")], (i) => i < 2)).toBe(17);
  });

  it("la carta tapada no cuenta y, si no se ve ninguna, no hay total", () => {
    expect(totalVisible([c("KH"), null], () => true)).toBe(10);
    expect(totalVisible([c("KH"), c("7S")], () => false)).toBeNull();
    expect(totalVisible([], () => true)).toBeNull();
  });
});
