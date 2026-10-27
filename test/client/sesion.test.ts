import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Un almacén en memoria con la forma de `Storage` que usan el token y la última partida. */
function almacen(inicial: Record<string, string> = {}) {
  const datos = new Map(Object.entries(inicial));
  return {
    datos,
    getItem: (clave: string) => datos.get(clave) ?? null,
    setItem: (clave: string, valor: string) => void datos.set(clave, valor),
    removeItem: (clave: string) => void datos.delete(clave),
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SesionProvider.salir", () => {
  /** Monta el proveedor (en el servidor: sin efectos, sin red) y devuelve la sesión que ve un hijo. */
  async function sesionMontada() {
    const { SesionProvider, useSesion } = await import("../../src/client/red/sesion");
    let sesion: ReturnType<typeof useSesion> | undefined;
    const Hijo = () => {
      sesion = useSesion();
      return null;
    };
    renderToString(createElement(SesionProvider, null, createElement(Hijo)));
    return sesion!;
  }

  it("olvida el token y también la última partida de la pestaña: quien entre después no vuelve a la sala del anterior", async () => {
    const local = almacen({ "timba.token": "abc" });
    const sesionDePestana = almacen({ "timba.partida": "KXP4" });
    vi.stubGlobal("localStorage", local);
    vi.stubGlobal("sessionStorage", sesionDePestana);
    const { ultimaPartida } = await import("../../src/client/red/ultimaPartida");
    const { leerToken } = await import("../../src/client/red/token");
    expect(ultimaPartida()).toBe("KXP4");
    expect(leerToken()).toBe("abc");

    const sesion = await sesionMontada();
    sesion.salir();

    expect(leerToken()).toBeNull();
    expect(local.datos.has("timba.token")).toBe(false);
    expect(ultimaPartida()).toBeNull();
    expect(sesionDePestana.datos.has("timba.partida")).toBe(false);
  });
});
