import { describe, expect, it } from "vitest";
import { barajar, codigoCarta, crearBaraja, rngCripto } from "../../src/shared/cartas";
import { c, cs, rngFijo } from "../ayudas";

const clave = (carta: { valor: string; palo: string }) => carta.valor + carta.palo;

describe("crearBaraja", () => {
  it("crearBaraja(6) tiene 312 cartas y cada carta aparece 6 veces", () => {
    const baraja = crearBaraja(6);
    expect(baraja).toHaveLength(312);
    const cuentas = new Map<string, number>();
    for (const carta of baraja) cuentas.set(clave(carta), (cuentas.get(clave(carta)) ?? 0) + 1);
    expect(cuentas.size).toBe(52);
    for (const n of cuentas.values()) expect(n).toBe(6);
  });

  it("por defecto es una sola baraja de 52 cartas", () => {
    expect(crearBaraja()).toHaveLength(52);
  });

  it("tiene un orden fijo", () => {
    expect(crearBaraja(2)).toEqual(crearBaraja(2));
  });
});

describe("barajar", () => {
  it("no pierde ni duplica cartas y no muta la entrada", () => {
    const original = crearBaraja(2);
    const copia = original.map((carta) => ({ ...carta }));
    const barajada = barajar(original, rngCripto());
    expect(original).toEqual(copia);
    expect(barajada).not.toBe(original);
    expect(barajada).toHaveLength(original.length);
    expect(barajada.map(clave).sort()).toEqual(original.map(clave).sort());
  });

  it("con rngFijo(0) da un orden determinista", () => {
    const baraja = crearBaraja();
    const a = barajar(baraja, rngFijo(0));
    const b = barajar(baraja, rngFijo(0));
    expect(a).toEqual(b);
  });

  it("aplica Fisher–Yates: rngFijo(0) lleva cada elemento al principio por turnos", () => {
    expect(barajar([1, 2, 3, 4], rngFijo(0))).toEqual([2, 3, 4, 1]);
  });

  it("funciona con entradas vacías y de un solo elemento", () => {
    expect(barajar([], rngFijo(0))).toEqual([]);
    expect(barajar(["x"], rngFijo(0.9))).toEqual(["x"]);
  });
});

describe("codigoCarta", () => {
  it("usa los nombres de @letele", () => {
    expect(codigoCarta(c("10H"))).toBe("H10");
    expect(codigoCarta(c("AS"))).toBe("Sa");
    expect(codigoCarta(c("KD"))).toBe("Dk");
    expect(codigoCarta(c("QC"))).toBe("Cq");
    expect(codigoCarta(c("JH"))).toBe("Hj");
    expect(codigoCarta(c("7C"))).toBe("C7");
  });
});

describe("rngCripto", () => {
  it("devuelve valores en [0,1)", () => {
    const rng = rngCripto();
    for (let i = 0; i < 1000; i++) {
      const x = rng();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe("ayudas de test", () => {
  it("c parsea valor y palo (también el 10)", () => {
    expect(c("AS")).toEqual({ valor: "A", palo: "S" });
    expect(c("10H")).toEqual({ valor: "10", palo: "H" });
  });

  it("cs parsea varias cartas", () => {
    expect(cs("KH 7C")).toEqual([
      { valor: "K", palo: "H" },
      { valor: "7", palo: "C" },
    ]);
  });

  it("rngFijo devuelve los valores en ciclo", () => {
    const rng = rngFijo(0.1, 0.2, 0.3);
    expect([rng(), rng(), rng(), rng(), rng()]).toEqual([0.1, 0.2, 0.3, 0.1, 0.2]);
  });
});
