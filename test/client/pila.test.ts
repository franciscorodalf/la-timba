import { describe, expect, it } from "vitest";
import { desglose, MAX_PILA } from "../../src/client/componentes/pila";

describe("desglose de una apuesta en fichas", () => {
  it("usa las fichas más grandes primero, de abajo arriba", () => {
    expect(desglose(10)).toEqual([10]);
    expect(desglose(85)).toEqual([50, 25, 10]);
    expect(desglose(150)).toEqual([100, 50]);
    expect(desglose(635)).toEqual([500, 100, 25, 10]);
  });

  it("sin nada no hay pila, y lo que no cabe en fichas (los 5 de un pago 3:2) no se dibuja", () => {
    expect(desglose(0)).toEqual([]);
    expect(desglose(-20)).toEqual([]);
    expect(desglose(5)).toEqual([]);
    expect(desglose(1015)).toEqual([500, 500, 10]);
  });

  it("la pila tiene un alto máximo: lo que pasa no se apila, lo cuenta el número", () => {
    const pila = desglose(12_345);
    expect(pila).toHaveLength(MAX_PILA);
    expect(pila.every((v) => v === 500)).toBe(true);
    expect(desglose(370)).toEqual([100, 100, 100, 50, 10, 10]);
  });
});
