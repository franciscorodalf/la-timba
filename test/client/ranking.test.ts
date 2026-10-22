import { describe, expect, it } from "vitest";
import { PESTANAS, textoSinPuesto, valorRanking } from "../../src/client/pantallas/ranking/pestanas";
import { milesConSigno, porcentajeVictorias } from "../../src/client/formato";
import { ORDENES_RANKING, PARTIDAS_MINIMAS_VICTORIAS } from "../../src/shared/api";

describe("PARTIDAS_MINIMAS_VICTORIAS", () => {
  it("el cliente y el servidor comparten el mínimo de rondas para entrar en el ranking de victorias: 10", () => {
    expect(PARTIDAS_MINIMAS_VICTORIAS).toBe(10);
  });
});

describe("pestañas del ranking", () => {
  it("son las seis, en el orden del servidor, con su texto", () => {
    expect(PESTANAS.map((p) => p.orden)).toEqual([...ORDENES_RANKING]);
    expect(PESTANAS.map((p) => p.etiqueta)).toEqual(["Fichas", "Ganancias", "% victorias", "Mayor premio", "Mejor racha", "Quiebras"]);
  });
});

describe("valorRanking", () => {
  it("fichas, ganancias y mayor premio llevan punto de millares", () => {
    expect(valorRanking("fichas", 1000)).toBe("1.000");
    expect(valorRanking("fichas", 250)).toBe("250");
    expect(valorRanking("premio", 5400)).toBe("5.400");
    expect(valorRanking("ganancias", 1250)).toBe("1.250");
    expect(valorRanking("ganancias", 0)).toBe("0");
  });

  it("las ganancias negativas llevan el signo menos de verdad (U+2212), no un guion", () => {
    expect(valorRanking("ganancias", -1250)).toBe("−1.250");
    expect(valorRanking("ganancias", -40)).toBe("−40");
    expect(valorRanking("ganancias", -1250)).not.toContain("-");
  });

  it("el porcentaje de victorias es «NN %»", () => {
    expect(valorRanking("victorias", 67)).toBe("67 %");
    expect(valorRanking("victorias", 100)).toBe("100 %");
    expect(valorRanking("victorias", 0)).toBe("0 %");
  });

  it("la mejor racha y las quiebras son enteros sin más", () => {
    expect(valorRanking("racha", 12)).toBe("12");
    expect(valorRanking("quiebras", 0)).toBe("0");
    expect(valorRanking("quiebras", 1234)).toBe("1234");
  });
});

describe("textoSinPuesto", () => {
  it("en % victorias explica el mínimo de rondas, tomado de la constante compartida", () => {
    expect(textoSinPuesto("victorias")).toBe(`Juega ${PARTIDAS_MINIMAS_VICTORIAS} rondas para entrar en este ranking`);
    expect(textoSinPuesto("victorias")).toBe("Juega 10 rondas para entrar en este ranking");
  });

  it("en mayor premio pide ganar una ronda", () => {
    expect(textoSinPuesto("premio")).toBe("Gana una ronda para entrar en este ranking");
  });

  it("en los demás órdenes todos clasifican: no hay texto", () => {
    for (const orden of ["fichas", "ganancias", "racha", "quiebras"] as const) expect(textoSinPuesto(orden)).toBeNull();
  });
});

describe("formato compartido con el perfil", () => {
  it("milesConSigno pone el menos de verdad solo a los negativos", () => {
    expect(milesConSigno(1250)).toBe("1.250");
    expect(milesConSigno(0)).toBe("0");
    expect(milesConSigno(-1250)).toBe("−1.250");
  });

  it("porcentajeVictorias redondea y, sin partidas, no inventa un 0 %", () => {
    expect(porcentajeVictorias(8, 12)).toBe("67 %");
    expect(porcentajeVictorias(1, 3)).toBe("33 %");
    expect(porcentajeVictorias(3, 3)).toBe("100 %");
    expect(porcentajeVictorias(0, 5)).toBe("0 %");
    expect(porcentajeVictorias(0, 0)).toBe("—");
  });
});
