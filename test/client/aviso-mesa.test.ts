import { describe, expect, it } from "vitest";
import { textoErrorMesa } from "../../src/client/componentes/AvisoMesa";
import { MENSAJE_DESCANSANDO } from "../../src/client/red/api";

describe("textoErrorMesa", () => {
  it("«descansando» (la mesa sigue fallando) usa el texto de La Timba descansando; no_disponible, el suyo", () => {
    expect(textoErrorMesa("descansando")).toBe(MENSAJE_DESCANSANDO);
    expect(textoErrorMesa("no_disponible")).toBe("No se pudo hacer la apuesta. Inténtalo de nuevo");
  });
});
