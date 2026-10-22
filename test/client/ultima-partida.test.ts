import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Un `sessionStorage` en memoria; `roto` hace que leer y escribir fallen (datos de sitio bloqueados). */
function almacen(inicial: Record<string, string> = {}, roto = false) {
  const datos = new Map(Object.entries(inicial));
  const fallar = () => {
    throw new Error("SecurityError");
  };
  return {
    datos,
    getItem: (clave: string) => (roto ? fallar() : (datos.get(clave) ?? null)),
    setItem: (clave: string, valor: string) => (roto ? fallar() : void datos.set(clave, valor)),
    removeItem: (clave: string) => (roto ? fallar() : void datos.delete(clave)),
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("última partida de la pestaña", () => {
  it("se guarda en sessionStorage con la clave «timba.partida» y se lee de ahí", async () => {
    const sesion = almacen();
    vi.stubGlobal("sessionStorage", sesion);
    const { recordarPartida, ultimaPartida } = await import("../../src/client/red/ultimaPartida");
    expect(ultimaPartida()).toBeNull();

    recordarPartida("KXP4");

    expect(sesion.datos.get("timba.partida")).toBe("KXP4");
    expect(ultimaPartida()).toBe("KXP4");
  });

  it("arranca con la que ya hubiera guardada en la pestaña (una recarga no la pierde)", async () => {
    vi.stubGlobal("sessionStorage", almacen({ "timba.partida": "ABCD" }));
    const { ultimaPartida } = await import("../../src/client/red/ultimaPartida");
    expect(ultimaPartida()).toBe("ABCD");
  });

  it("olvidar borra la clave solo si sigue siendo esa partida", async () => {
    const sesion = almacen({ "timba.partida": "KXP4" });
    vi.stubGlobal("sessionStorage", sesion);
    const { olvidarPartida, ultimaPartida } = await import("../../src/client/red/ultimaPartida");

    olvidarPartida("ZZZZ");
    expect(ultimaPartida()).toBe("KXP4");

    olvidarPartida("KXP4");
    expect(ultimaPartida()).toBeNull();
    expect(sesion.datos.has("timba.partida")).toBe(false);
  });

  it("un valor guardado que no es un código de partida se ignora", async () => {
    vi.stubGlobal("sessionStorage", almacen({ "timba.partida": "../ranking" }));
    const { ultimaPartida } = await import("../../src/client/red/ultimaPartida");
    expect(ultimaPartida()).toBeNull();
  });

  it("sin almacenamiento no falla: la partida dura lo que la pestaña", async () => {
    vi.stubGlobal("sessionStorage", almacen({}, true));
    const { olvidarPartida, recordarPartida, ultimaPartida } = await import("../../src/client/red/ultimaPartida");
    expect(ultimaPartida()).toBeNull();

    expect(() => recordarPartida("KXP4")).not.toThrow();
    expect(ultimaPartida()).toBe("KXP4");

    expect(() => olvidarPartida("KXP4")).not.toThrow();
    expect(ultimaPartida()).toBeNull();
  });

  it("sin sessionStorage (ni siquiera existe) tampoco falla", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    const { recordarPartida, ultimaPartida } = await import("../../src/client/red/ultimaPartida");
    expect(() => recordarPartida("KXP4")).not.toThrow();
    expect(ultimaPartida()).toBe("KXP4");
  });
});

describe("olvidar la última partida sea cual sea (al cerrar sesión)", () => {
  it("borra la clave y la copia en memoria aunque no se sepa qué código era", async () => {
    const sesion = almacen({ "timba.partida": "KXP4" });
    vi.stubGlobal("sessionStorage", sesion);
    const { olvidarUltimaPartida, recordarPartida, ultimaPartida } = await import("../../src/client/red/ultimaPartida");
    recordarPartida("ZZ99");
    expect(ultimaPartida()).toBe("ZZ99");

    olvidarUltimaPartida();

    expect(ultimaPartida()).toBeNull();
    expect(sesion.datos.has("timba.partida")).toBe(false);
  });

  it("sin almacenamiento tampoco falla, y la copia en memoria se olvida", async () => {
    vi.stubGlobal("sessionStorage", almacen({}, true));
    const { olvidarUltimaPartida, recordarPartida, ultimaPartida } = await import("../../src/client/red/ultimaPartida");
    recordarPartida("KXP4");

    expect(() => olvidarUltimaPartida()).not.toThrow();
    expect(ultimaPartida()).toBeNull();
  });
});
