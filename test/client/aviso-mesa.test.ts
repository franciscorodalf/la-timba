import { describe, expect, it } from "vitest";
import { textoErrorMesa } from "../../src/client/componentes/AvisoMesa";
import { MENSAJE_DESCANSANDO } from "../../src/client/red/api";

describe("textoErrorMesa", () => {
  it("«descansando» (la mesa sigue fallando) usa el texto de La Timba descansando, responda a lo que responda", () => {
    expect(textoErrorMesa("descansando")).toBe(MENSAJE_DESCANSANDO);
    expect(textoErrorMesa("descansando", "apostar")).toBe(MENSAJE_DESCANSANDO);
  });

  it("sin_casilla dice que ya no quedan casillas libres", () => {
    expect(textoErrorMesa("sin_casilla", "apostar")).toBe("Ya no quedan casillas libres");
  });

  it("sin_asiento dice que la mesa está completa", () => {
    expect(textoErrorMesa("sin_asiento", "sentarse")).toBe("La mesa está completa");
  });

  it("no_disponible es una apuesta fallida solo si lo que falló fue una apuesta; si no (decisión, llegada), el texto general", () => {
    expect(textoErrorMesa("no_disponible", "apostar")).toBe("No se pudo hacer la apuesta. Inténtalo de nuevo");
    for (const accion of ["pedir", "plantarse", "doblar", "salir", null]) {
      expect(textoErrorMesa("no_disponible", accion), String(accion)).toBe("Algo ha salido mal. Inténtalo de nuevo");
    }
  });
});
