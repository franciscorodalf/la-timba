import { describe, expect, it } from "vitest";
import { POKER } from "../../src/shared/juegos/poker";
import { leerCantidad, pasoDeSubida } from "../../src/client/pantallas/poker/subir";

const limites = { min: 100, max: 5000 };

describe("leerCantidad", () => {
  it("lo que no es un número entero cabal no vale", () => {
    for (const texto of ["", "   ", "abc", "1e3", "12.5", "12,5", "-200", "+200", "0x1F", "２００", "200 fichas"]) expect(leerCantidad(texto, limites), texto).toBeNull();
  });

  it("por debajo del mínimo o por encima del máximo no vale", () => {
    expect(leerCantidad("99", limites)).toBeNull();
    expect(leerCantidad("5001", limites)).toBeNull();
    expect(leerCantidad("99999", limites)).toBeNull();
    expect(leerCantidad("9".repeat(30), limites)).toBeNull();
  });

  it("dentro de los límites, los extremos incluidos, devuelve la cantidad", () => {
    expect(leerCantidad("340", limites)).toBe(340);
    expect(leerCantidad("100", limites)).toBe(100);
    expect(leerCantidad("5000", limites)).toBe(5000);
    expect(leerCantidad(" 340 ", limites)).toBe(340);
    expect(leerCantidad("0340", limites)).toBe(340);
  });
});

describe("pasoDeSubida", () => {
  it("es la ciega grande", () => {
    expect(pasoDeSubida(limites)).toBe(POKER.CIEGA_GRANDE);
  });

  it("con un rango más corto que la ciega, el paso es todo el rango", () => {
    expect(pasoDeSubida({ min: 40, max: 47 })).toBe(7);
  });

  it("nunca baja de 1", () => {
    expect(pasoDeSubida({ min: 40, max: 40 })).toBe(1);
  });
});
