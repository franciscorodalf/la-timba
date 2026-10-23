import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Un `localStorage` en el que escribir falla y leer no devuelve nada: ventana privada con el almacenamiento a medias. */
function almacenamientoRoto() {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
    removeItem: () => {
      throw new Error("SecurityError");
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("token", () => {
  it("la copia en memoria manda: si guardar en localStorage falla, el token no se pierde", async () => {
    vi.stubGlobal("localStorage", almacenamientoRoto());
    const { guardarToken, leerToken } = await import("../../src/client/red/token");

    guardarToken("abc");
    expect(leerToken()).toBe("abc");

    guardarToken(null);
    expect(leerToken()).toBeNull();
  });

  it("arranca con lo que haya guardado en localStorage", async () => {
    vi.stubGlobal("localStorage", { getItem: (clave: string) => (clave === "timba.token" ? "guardado" : null) });
    const { leerToken } = await import("../../src/client/red/token");

    expect(leerToken()).toBe("guardado");
  });
});

describe("api: sesión caducada", () => {
  const respuesta = (status: number, cuerpo: unknown) => Response.json(cuerpo, { status });

  it("un 401 no_autenticado con token avisa de que la sesión ya no vale, con el token que se usó", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "viejo" });
    const fetchFalso = vi.fn(async () => respuesta(401, { error: "no_autenticado" }));
    vi.stubGlobal("fetch", fetchFalso);
    const { api, alSesionInvalida, ErrorApi } = await import("../../src/client/red/api");
    const avisar = vi.fn();
    alSesionInvalida(avisar);

    await expect(api.yo()).rejects.toBeInstanceOf(ErrorApi);
    expect(avisar).toHaveBeenCalledExactlyOnceWith("viejo");
    expect((fetchFalso.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ Authorization: "Bearer viejo" });
  });

  it("un 401 de un PIN incorrecto no es una sesión caducada", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "viejo" });
    vi.stubGlobal("fetch", async () => respuesta(401, { error: "pin", intentosRestantes: 4 }));
    const { api, alSesionInvalida } = await import("../../src/client/red/api");
    const avisar = vi.fn();
    alSesionInvalida(avisar);

    await expect(api.entrar("jugador", "0000")).rejects.toMatchObject({ status: 401, error: "pin", datos: { intentosRestantes: 4 } });
    expect(avisar).not.toHaveBeenCalled();
  });

  it("sin token no hay sesión que cerrar ni cabecera Authorization", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const fetchFalso = vi.fn(async () => respuesta(401, { error: "no_autenticado" }));
    vi.stubGlobal("fetch", fetchFalso);
    const { api, alSesionInvalida } = await import("../../src/client/red/api");
    const avisar = vi.fn();
    alSesionInvalida(avisar);

    await expect(api.crearPartida()).rejects.toMatchObject({ status: 401 });
    expect(avisar).not.toHaveBeenCalled();
    expect((fetchFalso.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty("Authorization");
  });

  it("quien se da de baja deja de recibir avisos", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "viejo" });
    vi.stubGlobal("fetch", async () => respuesta(401, { error: "no_autenticado" }));
    const { api, alSesionInvalida } = await import("../../src/client/red/api");
    const avisar = vi.fn();
    alSesionInvalida(avisar)();

    await expect(api.yo()).rejects.toMatchObject({ status: 401 });
    expect(avisar).not.toHaveBeenCalled();
  });
});

describe("api: respuestas de error", () => {
  it("un error sin cuerpo JSON (la página de Cloudflare al pasar del límite diario, sea cual sea el código) es «descansando»", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const { api, mensajeError, MENSAJE_DESCANSANDO } = await import("../../src/client/red/api");
    for (const status of [429, 503, 500, 403, 400]) {
      vi.stubGlobal("fetch", async () => new Response("<html>Error 1027</html>", { status, headers: { "content-type": "text/html" } }));
      const error = await api.crearPartida().catch((e: unknown) => e);
      expect(error, String(status)).toMatchObject({ status, error: "descansando" });
      expect(mensajeError(error)).toBe(MENSAJE_DESCANSANDO);
    }
  });

  it("sin red no es «descansando»: tiene su propio texto", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    const { api, mensajeError, MENSAJE_DESCANSANDO } = await import("../../src/client/red/api");
    const error = await api.ranking("fichas").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 0 });
    expect(mensajeError(error)).not.toBe(MENSAJE_DESCANSANDO);
    expect(mensajeError(error)).toMatch(/conexión/);
  });

  it("un error JSON conocido sigue siendo el suyo", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    vi.stubGlobal("fetch", async () => Response.json({ error: "apodo_ocupado" }, { status: 409 }));
    const { api } = await import("../../src/client/red/api");
    await expect(api.registro("Ana", "1234")).rejects.toMatchObject({ status: 409, error: "apodo_ocupado" });
  });
});
