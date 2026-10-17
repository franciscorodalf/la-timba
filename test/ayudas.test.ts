import { describe, expect, it } from "vitest";
import { c, cs } from "./ayudas";

describe("c", () => {
  it("parsea todos los valores y palos válidos", () => {
    for (const valor of ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) {
      for (const palo of ["H", "D", "C", "S"]) {
        expect(c(valor + palo)).toEqual({ valor, palo });
      }
    }
  });

  it("lanza con un valor desconocido", () => {
    expect(() => c("1OH")).toThrow();
    expect(() => c("11H")).toThrow();
    expect(() => c("XS")).toThrow();
    expect(() => c("H")).toThrow();
  });

  it("lanza con un palo desconocido", () => {
    expect(() => c("AX")).toThrow();
    expect(() => c("10")).toThrow();
    expect(() => c("as")).toThrow();
  });

  it("lanza con una cadena vacía", () => {
    expect(() => c("")).toThrow();
  });
});

describe("cs", () => {
  it("devuelve [] con una cadena vacía o solo espacios", () => {
    expect(cs("")).toEqual([]);
    expect(cs("   ")).toEqual([]);
    expect(cs(" \t\n")).toEqual([]);
  });

  it("tolera espacios extra alrededor y entre cartas", () => {
    expect(cs("  KH   7C ")).toEqual(cs("KH 7C"));
  });

  it("propaga el error de c con una carta desconocida", () => {
    expect(() => cs("KH 1OH")).toThrow();
  });
});
