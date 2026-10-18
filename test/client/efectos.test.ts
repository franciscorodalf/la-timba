import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Un `localStorage` en memoria; `roto` hace que leer y escribir fallen (ventana privada, datos de sitio bloqueados). */
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

describe("sonidos", () => {
  it("el silencio se recuerda en localStorage («timba.silencio») y alternar lo cambia", async () => {
    const local = almacen({ "timba.silencio": "1" });
    vi.stubGlobal("localStorage", local);
    const { sonidos } = await import("../../src/client/efectos/sonidos");
    expect(sonidos.silenciado).toBe(true);

    sonidos.alternar();
    expect(sonidos.silenciado).toBe(false);
    expect(local.datos.get("timba.silencio")).toBe("0");
    sonidos.alternar();
    expect(sonidos.silenciado).toBe(true);
    expect(local.datos.get("timba.silencio")).toBe("1");
  });

  it("sin nada guardado suena; sin almacenamiento el silencio dura lo que la pestaña", async () => {
    vi.stubGlobal("localStorage", almacen());
    expect((await import("../../src/client/efectos/sonidos")).sonidos.silenciado).toBe(false);

    vi.resetModules();
    vi.stubGlobal("localStorage", almacen({}, true));
    const { sonidos } = await import("../../src/client/efectos/sonidos");
    expect(sonidos.silenciado).toBe(false);
    expect(() => sonidos.alternar()).not.toThrow();
    expect(sonidos.silenciado).toBe(true);
  });

  it("sin Web Audio (o antes de que el usuario toque la página) reproducir no hace nada y no falla", async () => {
    vi.stubGlobal("localStorage", almacen());
    vi.stubGlobal("AudioContext", undefined);
    const { sonidos } = await import("../../src/client/efectos/sonidos");
    expect(() => {
      sonidos.reproducir("carta");
      sonidos.reproducir("fichas");
      sonidos.reproducir("victoria");
    }).not.toThrow();
  });
});

describe("vibrar", () => {
  it("vibra con navigator.vibrate cuando existe y la página ya ha recibido un toque", async () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate, userActivation: { hasBeenActive: true } });
    const { vibrar } = await import("../../src/client/efectos/vibrar");
    vibrar(80);
    expect(vibrate).toHaveBeenCalledWith(80);
  });

  it("no hace nada sin navigator.vibrate ni antes del primer toque (el navegador lo bloquearía con un aviso)", async () => {
    const { vibrar } = await import("../../src/client/efectos/vibrar");
    vi.stubGlobal("navigator", {});
    expect(() => vibrar(200)).not.toThrow();

    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate, userActivation: { hasBeenActive: false } });
    vibrar(200);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("si vibrate lanza, se traga el error", async () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("no");
      },
    });
    const { vibrar } = await import("../../src/client/efectos/vibrar");
    expect(() => vibrar(80)).not.toThrow();
  });
});
