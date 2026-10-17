import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ORDENES_RANKING } from "../../src/shared/api";
import { firmarToken, verificarToken } from "../../src/server/auth";
import worker, { type Env } from "../../src/server/index";
import { registrar } from "../ayudas";

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DIA_MS = 24 * 60 * 60 * 1000;

/** Apodo válido (≤ 16 caracteres) y distinto en cada llamada: el DO `Jugadores` global se comparte entre pruebas. */
const unico = () => "t" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);

interface Respuesta {
  status: number;
  cuerpo: any;
  res: Response;
}

async function llamar(
  ruta: string,
  { metodo = "GET", cuerpo, token, cabeceras = {} }: { metodo?: string; cuerpo?: unknown; token?: string; cabeceras?: Record<string, string> } = {},
): Promise<Respuesta> {
  const headers = new Headers(cabeceras);
  if (token !== undefined) headers.set("authorization", `Bearer ${token}`);
  let body: string | undefined;
  if (cuerpo !== undefined) {
    body = typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo);
    headers.set("content-type", "application/json");
  }
  const res = await exports.default.fetch(`http://x${ruta}`, { method: metodo, headers, body });
  const texto = await res.text();
  return { status: res.status, cuerpo: texto === "" ? null : JSON.parse(texto), res };
}

const jugadores = () => env.Jugadores.get(env.Jugadores.idFromName("global"));
const partida = (codigo: string) => env.Partida.get(env.Partida.idFromName(codigo));

/** Abre una partida con un código concreto saltándose la API (para controlar el código). */
async function abrirPartida(codigo: string, creadorId = 1): Promise<void> {
  await partida(codigo).iniciar(creadorId, Date.now());
}

/** Hace que `rngCripto` genere, en orden, los códigos dados (4 sorteos por código); después repite el último. */
function forzarCodigos(...codigos: string[]): void {
  const indices = [...codigos.join("")].map((letra) => ALFABETO.indexOf(letra));
  const real = crypto.getRandomValues.bind(crypto);
  let siguiente = 0;
  vi.spyOn(crypto, "getRandomValues").mockImplementation(((destino: ArrayBufferView) => {
    if (!(destino instanceof Uint32Array) || destino.length !== 1) return real(destino as Parameters<typeof real>[0]);
    const indice = indices[Math.min(siguiente++, indices.length - 1)];
    destino[0] = Math.floor(((indice + 0.5) / ALFABETO.length) * 2 ** 32);
    return destino;
  }) as typeof crypto.getRandomValues);
}

/** El entorno real con algunos bindings sustituidos, para llamar al Worker directamente. */
const entorno = (cambios: Partial<Record<keyof Env, unknown>>): Env => ({ ...env, ...cambios }) as unknown as Env;

afterEach(() => vi.restoreAllMocks());

describe("POST /api/registro", () => {
  it("201 con token y jugador con 1.000 fichas", async () => {
    const apodo = unico();
    const { status, cuerpo, res } = await llamar("/api/registro", { metodo: "POST", cuerpo: { apodo, pin: "1234" } });
    expect(status).toBe(201);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(cuerpo.jugador).toEqual({ id: expect.any(Number), apodo, fichas: 1000 });
    expect(await verificarToken(cuerpo.token, env.TOKEN_SECRET, Date.now())).toEqual({ id: cuerpo.jugador.id, apodo });
  });

  it("400 apodo_invalido con un apodo mal formado, ausente o que no es texto", async () => {
    for (const apodo of ["ab", "a".repeat(17), "con espacio", "ñandú", undefined, 12345, null]) {
      const r = await llamar("/api/registro", { metodo: "POST", cuerpo: { apodo, pin: "1234" } });
      expect(r.status, JSON.stringify(apodo)).toBe(400);
      expect(r.cuerpo).toEqual({ error: "apodo_invalido" });
    }
  });

  it("400 pin_invalido con un PIN que no son 4 dígitos, ausente o que no es texto", async () => {
    for (const pin of ["123", "12345", "12a4", "", undefined, 1234, null]) {
      const r = await llamar("/api/registro", { metodo: "POST", cuerpo: { apodo: unico(), pin } });
      expect(r.status, JSON.stringify(pin)).toBe(400);
      expect(r.cuerpo).toEqual({ error: "pin_invalido" });
    }
  });

  it("409 apodo_ocupado, sin distinguir mayúsculas", async () => {
    const apodo = unico();
    await registrar(apodo);
    const r = await llamar("/api/registro", { metodo: "POST", cuerpo: { apodo: apodo.toUpperCase(), pin: "9999" } });
    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual({ error: "apodo_ocupado" });
  });

  it("400 peticion_invalida con JSON mal formado o un cuerpo que no es un objeto", async () => {
    for (const cuerpo of ["{no es json", "", '"hola"', "42", "null", "true", "[]", '["a","b"]']) {
      const r = await llamar("/api/registro", { metodo: "POST", cuerpo, cabeceras: { "content-type": "application/json" } });
      expect(r.status, cuerpo).toBe(400);
      expect(r.cuerpo).toEqual({ error: "peticion_invalida" });
    }
  });
});

describe("POST /api/entrar", () => {
  it("200 con token y jugador; el apodo se busca sin distinguir mayúsculas y vuelve tal como se registró", async () => {
    const apodo = unico();
    const { jugador } = await registrar(apodo, "4321");
    const { status, cuerpo } = await llamar("/api/entrar", { metodo: "POST", cuerpo: { apodo: apodo.toUpperCase(), pin: "4321" } });
    expect(status).toBe(200);
    expect(cuerpo.jugador).toEqual(jugador);
    expect(await verificarToken(cuerpo.token, env.TOKEN_SECRET, Date.now())).toEqual({ id: jugador.id, apodo });
  });

  it("404 no_existe", async () => {
    const r = await llamar("/api/entrar", { metodo: "POST", cuerpo: { apodo: unico(), pin: "1234" } });
    expect(r.status).toBe(404);
    expect(r.cuerpo).toEqual({ error: "no_existe" });
  });

  it("401 pin con los intentos que quedan", async () => {
    const apodo = unico();
    await registrar(apodo);
    const r = await llamar("/api/entrar", { metodo: "POST", cuerpo: { apodo, pin: "0000" } });
    expect(r.status).toBe(401);
    expect(r.cuerpo).toEqual({ error: "pin", intentosRestantes: 4 });
  });

  it("429 bloqueado al 5º fallo, con la hora de desbloqueo, incluso con el PIN correcto", async () => {
    const apodo = unico();
    await registrar(apodo);
    for (const restantes of [4, 3, 2, 1]) {
      const r = await llamar("/api/entrar", { metodo: "POST", cuerpo: { apodo, pin: "0000" } });
      expect(r.cuerpo).toEqual({ error: "pin", intentosRestantes: restantes });
    }
    const antes = Date.now();
    const quinto = await llamar("/api/entrar", { metodo: "POST", cuerpo: { apodo, pin: "0000" } });
    expect(quinto.status).toBe(429);
    expect(quinto.cuerpo).toEqual({ error: "bloqueado", hasta: expect.any(Number) });
    expect(quinto.cuerpo.hasta).toBeGreaterThanOrEqual(antes + 15 * 60_000);
    expect(quinto.cuerpo.hasta).toBeLessThanOrEqual(Date.now() + 15 * 60_000);

    const correcto = await llamar("/api/entrar", { metodo: "POST", cuerpo: { apodo, pin: "1234" } });
    expect(correcto.status).toBe(429);
    expect(correcto.cuerpo).toEqual({ error: "bloqueado", hasta: quinto.cuerpo.hasta });
  });

  it("400 peticion_invalida con JSON mal formado, un cuerpo que no es un objeto o campos que no son texto", async () => {
    for (const cuerpo of ["{no es json", "[]", "null", "{}", '{"apodo":"abc"}', '{"pin":"1234"}', '{"apodo":123,"pin":"1234"}', '{"apodo":"abc","pin":1234}']) {
      const r = await llamar("/api/entrar", { metodo: "POST", cuerpo, cabeceras: { "content-type": "application/json" } });
      expect(r.status, cuerpo).toBe(400);
      expect(r.cuerpo).toEqual({ error: "peticion_invalida" });
    }
  });

  it("400 peticion_invalida con un apodo o un PIN de más de 64 caracteres, sin llegar a Jugadores; con 64 sigue su curso", async () => {
    const trampa = {
      idFromName: () => {
        throw new Error("no debería tocar el Durable Object");
      },
    };
    for (const cuerpo of [
      { apodo: "a".repeat(65), pin: "1234" },
      { apodo: "abc", pin: "1".repeat(65) },
      { apodo: "a".repeat(10_000), pin: "1".repeat(10_000) },
    ]) {
      const res = await worker.fetch(
        new Request("http://x/api/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }),
        entorno({ Jugadores: trampa }),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "peticion_invalida" });
    }

    const apodoLargo = await llamar("/api/entrar", { metodo: "POST", cuerpo: { apodo: "a".repeat(64), pin: "1234" } });
    expect(apodoLargo.status).toBe(404);
    expect(apodoLargo.cuerpo).toEqual({ error: "no_existe" });
    const { jugador } = await registrar(unico());
    const pinLargo = await llamar("/api/entrar", { metodo: "POST", cuerpo: { apodo: jugador.apodo, pin: "1".repeat(64) } });
    expect(pinLargo.status).toBe(401);
    expect(pinLargo.cuerpo).toEqual({ error: "pin", intentosRestantes: 4 });
  });
});

describe("GET /api/yo", () => {
  it("200 con el perfil", async () => {
    const { token, jugador } = await registrar(unico());
    const { status, cuerpo } = await llamar("/api/yo", { token });
    expect(status).toBe(200);
    expect(cuerpo).toEqual({
      ...jugador,
      quiebras: 0,
      rachaActual: 0,
      mejorRacha: 0,
      partidas: 0,
      gananciasTotales: 0,
      mayorPremio: 0,
      porJuego: { blackjack: { partidas: 0, victorias: 0 }, carrera: { partidas: 0, victorias: 0 } },
    });
  });

  it("acepta el esquema Bearer sin distinguir mayúsculas", async () => {
    const { token, jugador } = await registrar(unico());
    const r = await llamar("/api/yo", { cabeceras: { authorization: `bearer ${token}` } });
    expect(r.status).toBe(200);
    expect(r.cuerpo.id).toBe(jugador.id);
  });

  it("401 no_autenticado sin cabecera, con una cabecera mal formada o con un token inválido, caducado o ajeno", async () => {
    const { token, jugador } = await registrar(unico());
    const malos: Array<string | undefined> = [
      undefined,
      "",
      "Bearer",
      "Bearer ",
      token, // sin esquema
      `Basic ${token}`,
      `Bearer ${token} extra`,
      "Bearer basura",
      "Bearer a.b",
      `Bearer ${token}x`,
      `Bearer ${await firmarToken(jugador, "otro-secreto", Date.now())}`,
      `Bearer ${await firmarToken(jugador, env.TOKEN_SECRET, Date.now() - 31 * DIA_MS)}`,
      // Token auténtico de un jugador que no existe.
      `Bearer ${await firmarToken({ id: 999_999_999, apodo: "fantasma" }, env.TOKEN_SECRET, Date.now())}`,
    ];
    for (const autorizacion of malos) {
      const r = await llamar("/api/yo", { cabeceras: autorizacion === undefined ? {} : { authorization: autorizacion } });
      expect(r.status, String(autorizacion)).toBe(401);
      expect(r.cuerpo).toEqual({ error: "no_autenticado" });
    }
  });
});

describe("POST /api/partidas", () => {
  it("201 con un código de 4 caracteres del alfabeto, y la partida queda abierta con su creador", async () => {
    const { token, jugador } = await registrar(unico());
    const antes = Date.now();
    const { status, cuerpo } = await llamar("/api/partidas", { metodo: "POST", token });
    expect(status).toBe(201);
    expect(cuerpo).toEqual({ codigo: expect.stringMatching(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/) });

    const estado = await runInDurableObject(partida(cuerpo.codigo), (_i, state) => state.storage.get("partida"));
    expect(estado).toEqual({ creadaEn: expect.any(Number), creadorId: jugador.id, cerrada: false });
    expect((estado as { creadaEn: number }).creadaEn).toBeGreaterThanOrEqual(antes);
    expect((await llamar(`/api/partidas/${cuerpo.codigo}`)).cuerpo).toEqual({ existe: true });
    // Si nadie llega a conectarse, la sala se cierra a los 30 min de crearse.
    const alarma = await runInDurableObject(partida(cuerpo.codigo), (_i, state) => state.storage.getAlarm());
    expect(alarma).toBe((estado as { creadaEn: number }).creadaEn + 30 * 60_000);
  });

  it("los códigos salen del alfabeto y no se repiten entre partidas", async () => {
    const { token } = await registrar(unico());
    const codigos = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const { cuerpo } = await llamar("/api/partidas", { metodo: "POST", token });
      expect(cuerpo.codigo).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/);
      codigos.add(cuerpo.codigo);
    }
    expect(codigos.size).toBe(20);
  });

  it("401 no_autenticado sin token o con un token inválido", async () => {
    for (const token of [undefined, "basura"]) {
      const r = await llamar("/api/partidas", { metodo: "POST", token });
      expect(r.status).toBe(401);
      expect(r.cuerpo).toEqual({ error: "no_autenticado" });
    }
  });

  it("reintenta con otro código si el sorteado ya existe", async () => {
    await abrirPartida("EEEE");
    forzarCodigos("EEEE", "FFFF");
    const { token } = await registrar(unico());
    const r = await llamar("/api/partidas", { metodo: "POST", token });
    expect(r.status).toBe(201);
    expect(r.cuerpo).toEqual({ codigo: "FFFF" });
  });

  it("503 descansando si los 5 intentos chocan con partidas existentes", async () => {
    await abrirPartida("GGGG");
    forzarCodigos("GGGG");
    const { token } = await registrar(unico());
    const r = await llamar("/api/partidas", { metodo: "POST", token });
    expect(r.status).toBe(503);
    expect(r.cuerpo).toEqual({ error: "descansando" });
  });

  it("decide con `iniciar` en un solo paso: 5 intentos como máximo y sin consultar `existe`", async () => {
    const { token } = await registrar(unico());
    const llamadas = { iniciar: 0, existe: 0 };
    const ocupada = {
      idFromName: (nombre: string) => nombre,
      get: () => ({
        setName: async () => {},
        iniciar: async () => {
          llamadas.iniciar++;
          return false;
        },
        existe: async () => {
          llamadas.existe++;
          return false;
        },
      }),
    };
    const res = await worker.fetch(new Request("http://x/api/partidas", { method: "POST", headers: { authorization: `Bearer ${token}` } }), entorno({ Partida: ocupada }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "descansando" });
    expect(llamadas).toEqual({ iniciar: 5, existe: 0 });
  });

  it("reutiliza el código de una partida cerrada y la deja abierta de nuevo", async () => {
    await abrirPartida("HHHH", 1);
    await runInDurableObject(partida("HHHH"), (_i, state) => state.storage.put("partida", { creadaEn: 1, creadorId: 1, cerrada: true }));
    expect((await llamar("/api/partidas/HHHH")).cuerpo).toEqual({ existe: false });

    forzarCodigos("HHHH");
    const { token, jugador } = await registrar(unico());
    const r = await llamar("/api/partidas", { metodo: "POST", token });
    expect(r.status).toBe(201);
    expect(r.cuerpo).toEqual({ codigo: "HHHH" });
    expect((await llamar("/api/partidas/HHHH")).cuerpo).toEqual({ existe: true });
    const estado = await runInDurableObject(partida("HHHH"), (_i, state) => state.storage.get("partida"));
    expect(estado).toMatchObject({ creadorId: jugador.id, cerrada: false });
  });
});

describe("GET /api/partidas/:codigo", () => {
  it("existe: true para una partida creada, también en minúsculas (se normaliza a mayúsculas)", async () => {
    await abrirPartida("KXP4");
    for (const codigo of ["KXP4", "kxp4", "KxP4"]) {
      const r = await llamar(`/api/partidas/${codigo}`);
      expect(r.status).toBe(200);
      expect(r.res.headers.get("content-type")).toContain("application/json");
      expect(r.cuerpo).toEqual({ existe: true });
    }
  });

  it("encuentra la partida creada por la API consultando el código devuelto en minúsculas", async () => {
    const { token } = await registrar(unico());
    const { cuerpo } = await llamar("/api/partidas", { metodo: "POST", token });
    expect((await llamar(`/api/partidas/${cuerpo.codigo.toLowerCase()}`)).cuerpo).toEqual({ existe: true });
  });

  it("existe: false para un código válido que nadie ha creado", async () => {
    const r = await llamar("/api/partidas/ZZ99");
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ existe: false });
  });

  it("existe: false, sin error, para códigos con forma inválida", async () => {
    // I, L, O, 0 y 1 no están en el alfabeto.
    for (const codigo of ["ABC", "ABCDE", "AB1D", "ABOD", "ABID", "ABLD", "AB0D", "AB-D", "AB%20D", "%C3%B1ABC"]) {
      const r = await llamar(`/api/partidas/${codigo}`);
      expect(r.status, codigo).toBe(200);
      expect(r.cuerpo, codigo).toEqual({ existe: false });
    }
  });

  it("con forma inválida ni siquiera consulta a la Partida", async () => {
    const trampa = {
      idFromName: () => {
        throw new Error("no debería tocar el Durable Object");
      },
    };
    for (const codigo of ["ABC", "ABCDE", "AB1D", "AB%20D"]) {
      const res = await worker.fetch(new Request(`http://x/api/partidas/${codigo}`), entorno({ Partida: trampa }));
      expect(res.status, codigo).toBe(200);
      expect(await res.json(), codigo).toEqual({ existe: false });
    }
  });

  it("sondea con un stub crudo: no llama a setName (que escribiría en el almacenamiento de cada código consultado)", async () => {
    const llamadas: string[] = [];
    const sondeable = {
      idFromName: (nombre: string) => nombre,
      get: () => ({
        setName: async () => {
          llamadas.push("setName");
        },
        existe: async () => {
          llamadas.push("existe");
          return true;
        },
      }),
    };
    const res = await worker.fetch(new Request("http://x/api/partidas/ABCD"), entorno({ Partida: sondeable }));
    expect(await res.json()).toEqual({ existe: true });
    expect(llamadas).toEqual(["existe"]);
  });

  it("no necesita sesión", async () => {
    await abrirPartida("MNPQ");
    expect((await llamar("/api/partidas/MNPQ")).cuerpo).toEqual({ existe: true });
  });
});

describe("GET /api/ranking", () => {
  it("sin token: top y yo null; el top viene ordenado con posiciones consecutivas", async () => {
    await registrar(unico());
    const { status, cuerpo } = await llamar("/api/ranking");
    expect(status).toBe(200);
    expect(cuerpo.yo).toBeNull();
    expect(cuerpo.top.length).toBeGreaterThan(0);
    expect(cuerpo.top.map((f: { posicion: number }) => f.posicion)).toEqual(cuerpo.top.map((_: unknown, i: number) => i + 1));
    expect(cuerpo.top[0]).toEqual({ posicion: 1, apodo: expect.any(String), valor: expect.any(Number) });
  });

  it("con token: yo es la fila del jugador; sin `orden` equivale a fichas", async () => {
    const { token, jugador } = await registrar(unico());
    const porDefecto = await llamar("/api/ranking", { token });
    expect(porDefecto.status).toBe(200);
    expect(porDefecto.cuerpo.yo).toEqual({ posicion: expect.any(Number), apodo: jugador.apodo, valor: 1000 });
    expect(await llamar("/api/ranking?orden=fichas", { token })).toMatchObject({ cuerpo: porDefecto.cuerpo });
  });

  it("acepta los seis órdenes", async () => {
    const { token } = await registrar(unico());
    expect(ORDENES_RANKING).toEqual(["fichas", "ganancias", "victorias", "premio", "racha", "quiebras"]);
    for (const orden of ORDENES_RANKING) {
      const r = await llamar(`/api/ranking?orden=${orden}`, { token });
      expect(r.status, orden).toBe(200);
      expect(r.cuerpo.top, orden).toBeInstanceOf(Array);
      expect(r.cuerpo, orden).toHaveProperty("yo");
    }
  });

  it("con token inválido o caducado se trata como anónimo (yo null), no como error", async () => {
    const { jugador } = await registrar(unico());
    const caducado = await firmarToken(jugador, env.TOKEN_SECRET, Date.now() - 31 * DIA_MS);
    for (const token of ["basura", caducado]) {
      const r = await llamar("/api/ranking", { token });
      expect(r.status).toBe(200);
      expect(r.cuerpo.yo).toBeNull();
    }
    const r = await llamar("/api/ranking", { cabeceras: { authorization: "Basic abc" } });
    expect(r.status).toBe(200);
    expect(r.cuerpo.yo).toBeNull();
  });

  it("400 orden_invalido con un orden desconocido o vacío, sin llegar a Jugadores", async () => {
    for (const orden of ["nada", "", "FICHAS", "constructor", "__proto__", "fichas,racha"]) {
      const r = await llamar(`/api/ranking?orden=${orden}`);
      expect(r.status, orden).toBe(400);
      expect(r.cuerpo, orden).toEqual({ error: "orden_invalido" });
    }
  });
});

describe("POST /api/rescate", () => {
  /** Apuesta todas las fichas y las pierde: deja al jugador en 0. */
  async function arruinar(id: number): Promise<void> {
    const rondaId = `ronda-${crypto.randomUUID()}`;
    expect(await jugadores().apostar(id, 1000, rondaId)).toBe("ok");
    await jugadores().liquidar({ rondaId, juego: "blackjack", codigoPartida: "ABCD", filas: [{ jugadorId: id, apuesta: 1000, pago: 0 }] }, Date.now());
  }

  it("200 con 200 fichas y suma una quiebra", async () => {
    const { token, jugador } = await registrar(unico());
    await arruinar(jugador.id);
    const r = await llamar("/api/rescate", { metodo: "POST", token });
    expect(r.status).toBe(200);
    expect(r.cuerpo).toEqual({ fichas: 200 });
    expect((await llamar("/api/yo", { token })).cuerpo).toMatchObject({ fichas: 200, quiebras: 1 });
  });

  it("409 tiene_fichas si el jugador aún tiene fichas", async () => {
    const { token } = await registrar(unico());
    const r = await llamar("/api/rescate", { metodo: "POST", token });
    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual({ error: "tiene_fichas" });
  });

  it("409 apuestas_pendientes si tiene 0 fichas pero una apuesta sin liquidar", async () => {
    const { token, jugador } = await registrar(unico());
    expect(await jugadores().apostar(jugador.id, 1000, `ronda-${crypto.randomUUID()}`)).toBe("ok");
    const r = await llamar("/api/rescate", { metodo: "POST", token });
    expect(r.status).toBe(409);
    expect(r.cuerpo).toEqual({ error: "apuestas_pendientes" });
  });

  it("401 no_autenticado sin token", async () => {
    const r = await llamar("/api/rescate", { metodo: "POST" });
    expect(r.status).toBe(401);
    expect(r.cuerpo).toEqual({ error: "no_autenticado" });
  });
});

describe("enrutado", () => {
  it("GET /api/salud sigue respondiendo ok", async () => {
    const r = await exports.default.fetch("http://x/api/salud");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("ok");
  });

  it("404 no_encontrado en rutas /api/* desconocidas", async () => {
    for (const ruta of ["/api/nada", "/api/", "/api/yo/", "/api/partidas/", "/api/partidas/ABCD/extra", "/api/registro/x"]) {
      const r = await llamar(ruta);
      expect(r.status, ruta).toBe(404);
      expect(r.cuerpo, ruta).toEqual({ error: "no_encontrado" });
    }
  });

  it("404 no_encontrado con un método que la ruta no admite", async () => {
    const { token } = await registrar(unico());
    const casos: Array<[string, string]> = [
      ["GET", "/api/registro"],
      ["GET", "/api/entrar"],
      ["POST", "/api/yo"],
      ["GET", "/api/partidas"],
      ["POST", "/api/partidas/ABCD"],
      ["DELETE", "/api/partidas/ABCD"],
      ["POST", "/api/ranking"],
      ["GET", "/api/rescate"],
      ["POST", "/api/salud"],
    ];
    for (const [metodo, ruta] of casos) {
      const r = await llamar(ruta, { metodo, token });
      expect(r.status, `${metodo} ${ruta}`).toBe(404);
      expect(r.cuerpo, `${metodo} ${ruta}`).toEqual({ error: "no_encontrado" });
    }
  });
});

describe("excepciones inesperadas", () => {
  const silenciar = () => vi.spyOn(console, "error").mockImplementation(() => {});

  it("503 descansando (y se registra el error) si falta TOKEN_SECRET", async () => {
    const { token } = await registrar(unico());
    const log = silenciar();
    const res = await worker.fetch(
      new Request("http://x/api/yo", { headers: { authorization: `Bearer ${token}` } }),
      entorno({ TOKEN_SECRET: undefined }),
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "descansando" });
    expect(log).toHaveBeenCalledOnce();
  });

  it("503 descansando (y se registra el error) si falla un Durable Object", async () => {
    const { token } = await registrar(unico());
    const log = silenciar();
    const roto = {
      idFromName: () => "id",
      get: () => ({
        perfil: async () => {
          throw new Error("DO caído");
        },
      }),
    };
    const res = await worker.fetch(new Request("http://x/api/yo", { headers: { authorization: `Bearer ${token}` } }), entorno({ Jugadores: roto }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "descansando" });
    expect(log).toHaveBeenCalledOnce();
  });

  it("un cuerpo mal formado no cuenta como excepción inesperada", async () => {
    const log = silenciar();
    const r = await llamar("/api/registro", { metodo: "POST", cuerpo: "{roto" });
    expect(r.status).toBe(400);
    expect(log).not.toHaveBeenCalled();
  });
});
