import { describe, expect, it } from "vitest";
import { cuentaAtras, miles, valorAnimado } from "../../src/client/formato";

describe("miles", () => {
  it("pone el punto de millares también en cuatro cifras", () => {
    expect(miles(0)).toBe("0");
    expect(miles(999)).toBe("999");
    expect(miles(1000)).toBe("1.000");
    expect(miles(1234567)).toBe("1.234.567");
  });
});

describe("cuentaAtras", () => {
  it("escribe minutos y segundos con dos cifras, redondeando los segundos hacia arriba", () => {
    expect(cuentaAtras(12_000)).toBe("0:12");
    expect(cuentaAtras(11_001)).toBe("0:12");
    expect(cuentaAtras(9_000)).toBe("0:09");
    expect(cuentaAtras(61_000)).toBe("1:01");
    expect(cuentaAtras(600_000)).toBe("10:00");
  });

  it("no baja de cero cuando el plazo ya venció", () => {
    expect(cuentaAtras(1)).toBe("0:01");
    expect(cuentaAtras(0)).toBe("0:00");
    expect(cuentaAtras(-3_500)).toBe("0:00");
  });
});

describe("valorAnimado", () => {
  it("va del valor de partida al de llegada, frenando al final", () => {
    expect(valorAnimado(1000, 1250, 0, 700)).toBe(1000);
    expect(valorAnimado(1000, 1250, 350, 700)).toBeGreaterThan(1125); // a mitad de tiempo ya pasó de la mitad del camino
    expect(valorAnimado(1000, 1250, 350, 700)).toBeLessThan(1250);
    expect(valorAnimado(1000, 1250, 700, 700)).toBe(1250);
  });

  it("también baja", () => {
    expect(valorAnimado(1250, 1000, 0, 700)).toBe(1250);
    expect(valorAnimado(1250, 1000, 350, 700)).toBeLessThan(1125);
    expect(valorAnimado(1250, 1000, 700, 700)).toBe(1000);
  });

  it("no se sale del camino: ni antes de empezar ni después de acabar", () => {
    // El primer fotograma puede traer una marca de tiempo anterior a la que se anotó al empezar.
    expect(valorAnimado(1000, 1250, -16, 700)).toBe(1000);
    expect(valorAnimado(1250, 1000, -16, 700)).toBe(1250);
    expect(valorAnimado(1000, 1250, 5_000, 700)).toBe(1250);
  });
});
