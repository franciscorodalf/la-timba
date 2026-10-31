import { describe, expect, it } from "vitest";
import { textoDeEspera } from "../../src/client/componentes/TarjetaMesa";

describe("lo que dice la tarjeta de una mesa que espera", () => {
  it("sin nadie sentado, la mesa está libre en todos los juegos", () => {
    for (const juego of ["blackjack", "carrera", "poker"] as const) expect(textoDeEspera(juego, 0), juego).toBe("Mesa libre");
  });

  it("en blackjack y carrera, con alguien sentado, espera apuestas", () => {
    expect(textoDeEspera("blackjack", 1)).toBe("Esperando apuestas");
    expect(textoDeEspera("carrera", 2)).toBe("Esperando apuestas");
  });

  it("en póker, con alguien solo en la mesa, espera rivales", () => {
    expect(textoDeEspera("poker", 1)).toBe("Esperando rivales");
  });
});
