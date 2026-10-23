import { env } from "cloudflare:workers";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import type { MensajeSala } from "../../src/shared/api";
import type { ResumenMesa } from "../../src/shared/juegos/tipos";
import { firmarToken } from "../../src/server/auth";
import worker, { type Env } from "../../src/server/index";
import { conectar, crearPartida, intentarConectar, registrar } from "../ayudas";

const MIN_30 = 30 * 60_000;
const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const MESA_VACIA: ResumenMesa = { jugadores: [], fase: "esperando", finFase: null };

/** Apodo válido (≤ 16 caracteres) y distinto en cada llamada: el DO `Jugadores` global se comparte entre pruebas. */
const unico = () => "t" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
const codigoAleatorio = () => Array.from({ length: 4 }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join("");

const sala = (codigo: string) => env.Partida.get(env.Partida.idFromName(codigo));
const jugadores = () => env.Jugadores.get(env.Jugadores.idFromName("global"));
const estadoDe = (codigo: string) => runInDurableObject(sala(codigo), (_i, state) => state.storage.get("partida"));
const alarmaDe = (codigo: string) => runInDurableObject(sala(codigo), (_i, state) => state.storage.getAlarm());
const entorno = (cambios: Partial<Record<keyof Env, unknown>>): Env => ({ ...env, ...cambios }) as unknown as Env;

/** Un jugador registrado con una partida recién creada por él. */
async function nuevaPartida() {
  const { token, jugador } = await registrar(unico());
  return { token, jugador, codigo: await crearPartida(token) };
}

const abiertas: Array<{ cerrar(): void }> = [];
/** Conecta a la partida (o a otra sala con `sala`) y la cierra sola al acabar la prueba. */
async function abrir(
  codigo: string,
  token: string,
  { cabeceras, sala = "partida" }: { cabeceras?: Record<string, string>; sala?: string } = {},
  consulta = "",
) {
  const conexion = await conectar(`/parties/${sala}/${codigo}${consulta}`, token, cabeceras);
  abiertas.push(conexion);
  return conexion;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const conexion of abiertas.splice(0)) {
    try {
      conexion.cerrar();
    } catch {
      // ya cerrada
    }
  }
});

/** Espera (hasta 2 s) a que se cumpla una condición que depende de algo asíncrono en el servidor. */
async function esperar(condicion: () => boolean | Promise<boolean>, que: string): Promise<void> {
  const limite = Date.now() + 2000;
  while (!(await condicion())) {
    if (Date.now() > limite) throw new Error(`Nunca se cumplió: ${que}`);
    await new Promise((resolver) => setTimeout(resolver, 10));
  }
}

let rondas = 0;
/** Lo que manda una mesa al liquidar una ronda: su id y el neto de cada jugador. */
const ronda = (...netos: [string, number][]) => ({ rondaId: `ABCD:blackjack:${++rondas}`, netos: netos.map(([apodo, neto]) => ({ apodo, neto })) });

describe("enrutado de /parties/*", () => {
  it("conectar sin token → 401; con código inexistente → 404", async () => {
    const { token } = await registrar(unico());
    const sinToken = await intentarConectar("/parties/partida/ZZ99");
    expect(sinToken.status).toBe(401);
    expect(await sinToken.json()).toEqual({ error: "no_autenticado" });

    const inexistente = await intentarConectar("/parties/partida/ZZ99", token);
    expect(inexistente.status).toBe(404);
    expect(await inexistente.json()).toEqual({ error: "partida_inexistente" });
  });

  it("401 con un token vacío, basura, firmado con otro secreto o caducado, aunque la partida exista", async () => {
    const { jugador, codigo } = await nuevaPartida();
    const malos = [
      "",
      "basura",
      "a.b",
      await firmarToken(jugador, "otro-secreto", Date.now()),
      await firmarToken(jugador, env.TOKEN_SECRET, Date.now() - 31 * 24 * 60 * 60 * 1000),
    ];
    for (const token of malos) {
      const res = await intentarConectar(`/parties/partida/${codigo}`, token);
      expect(res.status, token).toBe(401);
      expect(await res.json(), token).toEqual({ error: "no_autenticado" });
    }
  });

  it("la autenticación va antes que la existencia: sin token y partida inexistente → 401", async () => {
    expect((await intentarConectar("/parties/partida/ZZ99")).status).toBe(401);
  });

  it("/parties/jugadores/global → 404 y cualquier otra ruta con forma distinta también", async () => {
    const { token, codigo } = await nuevaPartida();
    const rutas = [
      "/parties/jugadores/global",
      "/parties/",
      "/parties/partida",
      "/parties/partida/",
      "/parties/partida/ABC",
      "/parties/partida/ABCDE",
      "/parties/partida/AB-D",
      "/parties/partida/AB0D", // 0 y 1 no están en el alfabeto
      "/parties/partida/AB1D",
      "/parties/partida/AB%20D",
      "/parties/partida/%C3%B1ABC",
      `/parties/partida/${codigo}/`,
      `/parties/partida/${codigo}/extra`,
      `/parties/Partida/${codigo}`,
      `/parties/mesa-poker/${codigo}`,
      `/parties/mesa-blackjack`,
      `/parties/main/${codigo}`,
    ];
    for (const ruta of rutas) {
      const res = await intentarConectar(ruta, token);
      expect(res.status, ruta).toBe(404);
      expect(await res.json(), ruta).toEqual({ error: "no_encontrado" });
    }
    // Sin cabecera de WebSocket también: no hay nada que servir por HTTP bajo /parties.
    const http = await worker.fetch(new Request("http://x/parties/jugadores/global"), env);
    expect(http.status).toBe(404);
    expect(await http.json()).toEqual({ error: "no_encontrado" });
  });

  it("solo se admiten WebSockets: una petición HTTP normal a una partida válida → 404", async () => {
    const { token, codigo } = await nuevaPartida();
    for (const sala of ["partida", "mesa-blackjack", "mesa-carrera"]) {
      for (const metodo of ["GET", "POST"]) {
        const res = await worker.fetch(new Request(`http://x/parties/${sala}/${codigo}?token=${token}`, { method: metodo }), env);
        expect(res.status, `${metodo} ${sala}`).toBe(404);
        expect(await res.json(), `${metodo} ${sala}`).toEqual({ error: "no_encontrado" });
      }
    }
  });

  it("las mesas pasan por el mismo filtro: 401 sin token, 404 sin partida y 101 con ambos", async () => {
    const { token, codigo } = await nuevaPartida();
    for (const nombre of ["mesa-blackjack", "mesa-carrera"]) {
      const ruta = `/parties/${nombre}/${codigo}`;
      expect((await intentarConectar(ruta)).status, nombre).toBe(401);
      expect((await intentarConectar(`/parties/${nombre}/ZZ99`, token)).status, nombre).toBe(404);
      await abrir(codigo, token, { sala: nombre });
    }
  });

  it("las letras que no están en el alfabeto (I, L, O) pasan el filtro de forma y acaban en 404 partida_inexistente", async () => {
    const { token } = await registrar(unico());
    const res = await intentarConectar("/parties/partida/ILOS", token);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "partida_inexistente" });
  });

  it("503 descansando (y se registra el error) si falla la comprobación del token o el Durable Object", async () => {
    const { token, codigo } = await nuevaPartida();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const cabeceras = { Upgrade: "websocket" };

    const sinSecreto = await worker.fetch(new Request(`http://x/parties/partida/${codigo}?token=${token}`, { headers: cabeceras }), entorno({ TOKEN_SECRET: undefined }));
    expect(sinSecreto.status).toBe(503);
    expect(await sinSecreto.json()).toEqual({ error: "descansando" });

    const roto = {
      idFromName: () => "id",
      get: () => ({
        existe: async () => {
          throw new Error("DO caído");
        },
      }),
    };
    const caido = await worker.fetch(new Request(`http://x/parties/partida/${codigo}?token=${token}`, { headers: cabeceras }), entorno({ Partida: roto }));
    expect(caido.status).toBe(503);
    expect(await caido.json()).toEqual({ error: "descansando" });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("ws a /parties/partida/kxp4 llega a la partida KXP4", async () => {
    const { token, jugador } = await registrar(unico());
    await sala("KXP4").iniciar(jugador.id, Date.now());
    const conexion = await abrir("kxp4", token);
    expect((await conexion.recibir("sala")).codigo).toBe("KXP4");

    // La conexión vive en el Durable Object KXP4, no en uno llamado "kxp4".
    expect(await runInDurableObject(sala("KXP4"), (partida) => [...partida.getConnections()].length)).toBe(1);
    expect(await runInDurableObject(sala("kxp4"), (partida) => [...partida.getConnections()].length)).toBe(0);
    expect(await sala("kxp4").existe()).toBe(false);
  });

  it("una cabecera x-jugador-id (o x-apodo) enviada por el cliente se ignora: manda el token", async () => {
    const { token, jugador, codigo } = await nuevaPartida();
    const conexion = await abrir(codigo, token, { cabeceras: { "x-jugador-id": "999999", "x-apodo": "intruso" } });
    const mensaje: MensajeSala = await conexion.recibir("sala");
    expect(mensaje.conectados).toEqual([jugador.apodo]);

    const estados = await runInDurableObject(sala(codigo), (partida) => [...partida.getConnections()].map((c) => c.state));
    expect(estados).toEqual([{ jugadorId: jugador.id, apodo: jugador.apodo, orden: 1 }]);
  });

  it("una conexión que llega al Durable Object sin las cabeceras de confianza se cierra con 4401", async () => {
    const { codigo } = await nuevaPartida();
    const res = await sala(codigo).fetch(`http://x/parties/partida/${codigo}`, { headers: { Upgrade: "websocket" } });
    const ws = res.webSocket!;
    const cierre = new Promise<CloseEvent>((resolver) => ws.addEventListener("close", resolver));
    ws.accept();
    expect((await cierre).code).toBe(4401);
    expect(await runInDurableObject(sala(codigo), (partida) => [...partida.getConnections()].length)).toBe(0);
  });
});

describe("enrutado: frontera de confianza", () => {
  it("una cabecera x-partykit-props mal formada del cliente no rompe la conexión: llega una 'sala' normal", async () => {
    const { token, codigo } = await nuevaPartida();
    const conexion = await abrir(codigo, token, { cabeceras: { "x-partykit-props": "{" } });
    const mensaje = await conexion.recibir();
    expect(mensaje.error).toBeUndefined(); // sin traza de error del servidor
    expect(mensaje.t).toBe("sala");
  });

  it("?_pk= del cliente no se convierte en el id de la conexión", async () => {
    const { token, codigo } = await nuevaPartida();
    const primera = await abrir(codigo, token, {}, "?_pk=ELEGIDO");
    await primera.recibir("sala");
    const segunda = await abrir(codigo, token, {}, "?_pk=ELEGIDO");
    await segunda.recibir("sala");

    const ids = await runInDurableObject(sala(codigo), (partida) => [...partida.getConnections()].map((c) => c.id));
    expect(ids).toHaveLength(2);
    expect(ids).not.toContain("ELEGIDO");
    expect(new Set(ids).size).toBe(2);
  });

  it("lo que llega a la sala: código en mayúsculas, identidad del token, sin x-partykit-* ni _pk del cliente", async () => {
    const { token, jugador, codigo } = await nuevaPartida();
    let recibida: Request | undefined;
    const falsa = {
      idFromName: (nombre: string) => nombre,
      get: () => ({
        existe: async () => true,
        fetch: async (peticion: Request) => {
          recibida = peticion;
          return new Response("ok");
        },
      }),
    };
    const peticion = new Request(`http://x/parties/partida/${codigo.toLowerCase()}?_pk=ELEGIDO&token=${encodeURIComponent(token)}`, {
      headers: {
        Upgrade: "websocket",
        "x-jugador-id": "999999",
        "x-apodo": "intruso",
        "x-partykit-props": "{",
        "x-partykit-room": "OTRA",
        "x-partykit-jurisdiction": "eu",
      },
    });
    await worker.fetch(peticion, entorno({ Partida: falsa }));

    expect(recibida).toBeDefined();
    const url = new URL(recibida!.url);
    expect(url.pathname).toBe(`/parties/partida/${codigo}`);
    expect(url.searchParams.has("_pk")).toBe(false);
    expect(recibida!.headers.get("x-jugador-id")).toBe(String(jugador.id));
    expect(recibida!.headers.get("x-apodo")).toBe(jugador.apodo);
    expect(recibida!.headers.get("upgrade")).toBe("websocket");
    for (const nombre of ["x-partykit-props", "x-partykit-room", "x-partykit-jurisdiction"]) expect(recibida!.headers.has(nombre), nombre).toBe(false);
  });
});

describe("Partida: sala", () => {
  it("al conectar recibe 'sala' con su apodo en conectados, las mesas vacías y el ranking vacío", async () => {
    const { token, jugador, codigo } = await nuevaPartida();
    const conexion = await abrir(codigo, token);
    expect(await conexion.recibir("sala")).toEqual({
      t: "sala",
      codigo,
      ahora: expect.any(Number),
      conectados: [jugador.apodo],
      mesas: { blackjack: MESA_VACIA, carrera: MESA_VACIA },
      rankingNoche: [],
    });
  });

  it("cada 'sala' lleva la hora del reloj de la sala, para que los clientes calculen las cuentas atrás con el reloj del servidor", async () => {
    const { token, codigo } = await nuevaPartida();
    const t0 = 5_500_000_000_000;
    await runInDurableObject(sala(codigo), (partida) => {
      partida.ahora = () => t0;
    });

    const conexion = await abrir(codigo, token);
    expect((await conexion.recibir("sala")).ahora).toBe(t0);

    await runInDurableObject(sala(codigo), (partida) => {
      partida.ahora = () => t0 + 7_000;
    });
    await sala(codigo).actualizarMesa("blackjack", { jugadores: [], fase: "esperando", finFase: null });
    expect((await conexion.recibir("sala")).ahora).toBe(t0 + 7_000);
  });

  it("dos jugadores: el segundo aparece en conectados del primero, por orden de llegada", async () => {
    const a = await registrar(unico());
    const b = await registrar(unico());
    const codigo = await crearPartida(a.token);

    const conexionA = await abrir(codigo, a.token);
    expect((await conexionA.recibir("sala")).conectados).toEqual([a.jugador.apodo]);

    const conexionB = await abrir(codigo, b.token);
    expect((await conexionB.recibir("sala")).conectados).toEqual([a.jugador.apodo, b.jugador.apodo]);
    expect((await conexionA.recibir("sala")).conectados).toEqual([a.jugador.apodo, b.jugador.apodo]);
  });

  it("dos pestañas del mismo jugador son una sola entrada, y sigue conectado mientras quede una", async () => {
    const a = await registrar(unico());
    const b = await registrar(unico());
    const codigo = await crearPartida(a.token);

    const pestana1 = await abrir(codigo, a.token);
    const pestana2 = await abrir(codigo, a.token);
    const conexionB = await abrir(codigo, b.token);
    expect((await conexionB.recibir("sala")).conectados).toEqual([a.jugador.apodo, b.jugador.apodo]);

    pestana1.cerrar();
    expect((await conexionB.recibir("sala")).conectados).toEqual([a.jugador.apodo, b.jugador.apodo]);
    pestana2.cerrar();
    expect((await conexionB.recibir("sala")).conectados).toEqual([b.jugador.apodo]);
  });

  it("al desconectarse un jugador, el resto recibe 'sala' sin él", async () => {
    const a = await registrar(unico());
    const b = await registrar(unico());
    const codigo = await crearPartida(a.token);
    const conexionA = await abrir(codigo, a.token);
    const conexionB = await abrir(codigo, b.token);
    await conexionA.recibir("sala");
    await conexionA.recibir("sala");

    conexionB.cerrar();
    expect((await conexionA.recibir("sala")).conectados).toEqual([a.jugador.apodo]);
  });

  it("actualizarMesa guarda el resumen, lo difunde a todos y lo ve quien entra después", async () => {
    const a = await registrar(unico());
    const b = await registrar(unico());
    const codigo = await crearPartida(a.token);
    const conexionA = await abrir(codigo, a.token);
    await conexionA.recibir("sala");

    const resumen: ResumenMesa = { jugadores: [a.jugador.apodo], fase: "apuestas", finFase: 1234 };
    await sala(codigo).actualizarMesa("blackjack", resumen);
    expect(await conexionA.recibir("sala")).toMatchObject({ mesas: { blackjack: resumen, carrera: MESA_VACIA } });

    const otro: ResumenMesa = { jugadores: [], fase: "corriendo", finFase: null };
    await sala(codigo).actualizarMesa("carrera", otro);
    expect(await conexionA.recibir("sala")).toMatchObject({ mesas: { blackjack: resumen, carrera: otro } });

    const conexionB = await abrir(codigo, b.token);
    expect(await conexionB.recibir("sala")).toMatchObject({ mesas: { blackjack: resumen, carrera: otro } });
  });

  it("rankingNoche suma, por apodo, los netos de las rondas que liquidan las mesas, de mayor a menor", async () => {
    const a = await registrar(unico());
    const b = await registrar(unico());
    const codigo = await crearPartida(a.token);
    const conexionA = await abrir(codigo, a.token);
    expect((await conexionA.recibir("sala")).rankingNoche).toEqual([]);

    const resumen: ResumenMesa = { jugadores: [], fase: "resultado", finFase: 5 };
    await sala(codigo).actualizarMesa("blackjack", resumen, [ronda([a.jugador.apodo, 100], [b.jugador.apodo, 30])]);
    expect((await conexionA.recibir("sala")).rankingNoche).toEqual([
      { apodo: a.jugador.apodo, neto: 100 },
      { apodo: b.jugador.apodo, neto: 30 },
    ]);
    // Dos rondas en el mismo aviso (una que se reintentó y la de ahora); y la de la otra mesa también cuenta.
    await sala(codigo).actualizarMesa("carrera", resumen, [ronda([b.jugador.apodo, 200]), ronda([a.jugador.apodo, -40])]);
    const esperado = [
      { apodo: b.jugador.apodo, neto: 230 },
      { apodo: a.jugador.apodo, neto: 60 },
    ];
    expect((await conexionA.recibir("sala")).rankingNoche).toEqual(esperado);

    // Lo ve quien llega después, y un aviso sin rondas no lo cambia.
    const conexionB = await abrir(codigo, b.token);
    expect((await conexionB.recibir("sala")).rankingNoche).toEqual(esperado);
    await sala(codigo).actualizarMesa("blackjack", { ...resumen, fase: "apuestas" });
    expect((await conexionB.recibir("sala")).rankingNoche).toEqual(esperado);
  });

  it("una ronda que llega dos veces (la mesa la repite si no supo que llegó) cuenta una sola vez", async () => {
    const { token, jugador, codigo } = await nuevaPartida();
    const conexion = await abrir(codigo, token);
    await conexion.recibir("sala");
    const repetida = ronda([jugador.apodo, 70]);
    await sala(codigo).actualizarMesa("blackjack", MESA_VACIA, [repetida]);
    await sala(codigo).actualizarMesa("blackjack", MESA_VACIA, [repetida, ronda([jugador.apodo, 5])]);
    await conexion.recibir("sala");
    expect((await conexion.recibir("sala")).rankingNoche).toEqual([{ apodo: jugador.apodo, neto: 75 }]);
  });

  it("empata por neto → desempata por apodo sin distinguir mayúsculas", async () => {
    const { token, codigo } = await nuevaPartida();
    const conexion = await abrir(codigo, token);
    await conexion.recibir("sala");
    await sala(codigo).actualizarMesa("blackjack", MESA_VACIA, [ronda(["beto", 10], ["Ana", 10], ["carla", 20], ["dani", -5])]);
    expect((await conexion.recibir("sala")).rankingNoche).toEqual([
      { apodo: "carla", neto: 20 },
      { apodo: "Ana", neto: 10 },
      { apodo: "beto", neto: 10 },
      { apodo: "dani", neto: -5 },
    ]);
  });

  it("la sala no le pregunta nada a Jugadores: con Jugadores caído conecta, difunde y suma el ranking igual", async () => {
    const { token, jugador, codigo } = await nuevaPartida();
    // Solo esta instancia ve un Jugadores roto (se cambia su `env`, no el compartido), y se restaura pase lo que pase.
    const original = await runInDurableObject(sala(codigo), (partida) => {
      const instancia = partida as unknown as { env: Env };
      const real = instancia.env;
      const roto = { idFromName: () => real.Jugadores.idFromName("global"), get: () => ({}) };
      instancia.env = Object.assign(Object.create(real), { Jugadores: roto });
      return real;
    });
    onTestFinished(() =>
      runInDurableObject(sala(codigo), (partida) => {
        (partida as unknown as { env: Env }).env = original;
      }),
    );
    const conexion = await abrir(codigo, token);
    expect((await conexion.recibir("sala")).conectados).toEqual([jugador.apodo]);
    await sala(codigo).actualizarMesa("blackjack", MESA_VACIA, [ronda([jugador.apodo, 70])]);
    expect((await conexion.recibir("sala")).rankingNoche).toEqual([{ apodo: jugador.apodo, neto: 70 }]);
  });

  it("rankingNoche solo cuenta lo jugado desde que se (re)abrió la partida", async () => {
    const { token, jugador } = await registrar(unico());
    const codigo = codigoAleatorio();
    const T = Date.now();
    expect(await sala(codigo).iniciar(jugador.id, T)).toBe(true);
    await runInDurableObject(sala(codigo), (partida) => {
      partida.ahora = () => T + 1; // distinto del T con que se abrió, para distinguir la alarma de la desconexión
    });
    const primera = await abrir(codigo, token);
    await primera.recibir("sala");
    await sala(codigo).actualizarMesa("blackjack", MESA_VACIA, [ronda([jugador.apodo, 500])]);
    expect((await primera.recibir("sala")).rankingNoche).toEqual([{ apodo: jugador.apodo, neto: 500 }]);
    primera.cerrar();
    await esperar(async () => (await alarmaDe(codigo)) === T + 1 + MIN_30, "alarma tras la desconexión");
    await runDurableObjectAlarm(sala(codigo));
    expect(await sala(codigo).existe()).toBe(false);

    // Mismo código, partida nueva: lo de antes no cuenta, lo de ahora sí.
    expect(await sala(codigo).iniciar(jugador.id, T + 60_000)).toBe(true);
    const segunda = await abrir(codigo, token);
    expect((await segunda.recibir("sala")).rankingNoche).toEqual([]);
    await sala(codigo).actualizarMesa("blackjack", MESA_VACIA, [ronda([jugador.apodo, 25])]);
    expect((await segunda.recibir("sala")).rankingNoche).toEqual([{ apodo: jugador.apodo, neto: 25 }]);
  });

  it("cada aviso de una mesa es una sola escritura en la sala, aunque traiga rondas", async () => {
    const { token, jugador, codigo } = await nuevaPartida();
    const conexion = await abrir(codigo, token);
    await conexion.recibir("sala");
    const escrituras: string[] = [];
    await runInDurableObject(sala(codigo), (_p, state) => {
      const almacen = state.storage as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const nombre of ["put", "delete", "setAlarm"]) {
        const original = almacen[nombre].bind(state.storage);
        almacen[nombre] = (...a: unknown[]) => {
          escrituras.push(`${nombre}:${typeof a[0] === "string" ? a[0] : Object.keys(a[0] as object).join(",")}`);
          return original(...a);
        };
      }
    });
    await sala(codigo).actualizarMesa("blackjack", { jugadores: [jugador.apodo], fase: "resultado", finFase: 9 }, [ronda([jugador.apodo, 50])]);
    await sala(codigo).actualizarMesa("carrera", { jugadores: [jugador.apodo], fase: "apuestas", finFase: 9 });
    expect(escrituras).toEqual(["put:sala", "put:sala"]);
  });

  it("ignora lo que envía el cliente: ni responde ni se cae", async () => {
    const { token, codigo } = await nuevaPartida();
    const conexion = await abrir(codigo, token);
    await conexion.recibir("sala");

    conexion.ws.send("hola");
    conexion.ws.send(JSON.stringify({ t: "apostar", cantidad: 100 }));
    conexion.ws.send(new Uint8Array([1, 2, 3]));

    // Lo siguiente que llega es lo que provoca el servidor, sin respuestas intercaladas a lo anterior.
    await sala(codigo).actualizarMesa("blackjack", { jugadores: [], fase: "uno", finFase: null });
    expect(await conexion.recibir()).toMatchObject({ t: "sala", mesas: { blackjack: { fase: "uno" } } });
    await sala(codigo).actualizarMesa("blackjack", { jugadores: [], fase: "dos", finFase: null });
    expect(await conexion.recibir()).toMatchObject({ t: "sala", mesas: { blackjack: { fase: "dos" } } });
    expect(conexion.ws.readyState).toBe(WebSocket.OPEN);
  });

  it("tras hibernar (el Durable Object sale de memoria) conserva conectados, mesas y ranking", async () => {
    const a = await registrar(unico());
    const b = await registrar(unico());
    const codigo = await crearPartida(a.token);
    const conexionA = await abrir(codigo, a.token);
    await conexionA.recibir("sala");
    const resumen: ResumenMesa = { jugadores: [a.jugador.apodo], fase: "apuestas", finFase: 99 };
    await sala(codigo).actualizarMesa("carrera", resumen, [ronda([a.jugador.apodo, 50])]);
    await conexionA.recibir("sala");

    await evictDurableObject(sala(codigo));

    const conexionB = await abrir(codigo, b.token);
    const entrante = await conexionB.recibir("sala");
    expect(entrante.conectados).toEqual([a.jugador.apodo, b.jugador.apodo]);
    expect(entrante.mesas).toEqual({ blackjack: MESA_VACIA, carrera: resumen });
    expect(entrante.rankingNoche).toEqual([{ apodo: a.jugador.apodo, neto: 50 }]);
    expect((await conexionA.recibir("sala")).conectados).toEqual([a.jugador.apodo, b.jugador.apodo]);

    await evictDurableObject(sala(codigo));
    conexionB.cerrar();
    expect((await conexionA.recibir("sala")).conectados).toEqual([a.jugador.apodo]);
  });
});

describe("Partida: ciclo de vida", () => {
  it("iniciar abre la sala con alarma a 30 min; si ya está abierta devuelve false y no cambia nada", async () => {
    const codigo = codigoAleatorio();
    const t0 = Date.now() + 24 * 60 * MIN_30; // en el futuro: una alarma en el pasado saltaría al instante
    expect(await sala(codigo).existe()).toBe(false);
    expect(await sala(codigo).iniciar(7, t0)).toBe(true);
    expect(await sala(codigo).existe()).toBe(true);
    expect(await estadoDe(codigo)).toEqual({ creadaEn: t0, creadorId: 7, cerrada: false });
    expect(await alarmaDe(codigo)).toBe(t0 + MIN_30);

    expect(await sala(codigo).iniciar(8, t0 + 1000)).toBe(false);
    expect(await estadoDe(codigo)).toEqual({ creadaEn: t0, creadorId: 7, cerrada: false });
    expect(await alarmaDe(codigo)).toBe(t0 + MIN_30);
  });

  it("30 min sin conexiones cierra la partida", async () => {
    const { token, codigo } = await nuevaPartida();
    const t0 = 4_000_000_000_000;
    await runInDurableObject(sala(codigo), (partida) => {
      partida.ahora = () => t0;
    });

    const conexion = await abrir(codigo, token);
    await conexion.recibir("sala");
    conexion.cerrar();
    await esperar(async () => (await alarmaDe(codigo)) === t0 + MIN_30, "alarma a 30 min de la última desconexión");
    expect(await sala(codigo).existe()).toBe(true); // todavía no ha vencido

    expect(await runDurableObjectAlarm(sala(codigo))).toBe(true);
    expect(await sala(codigo).existe()).toBe(false);
    expect(await estadoDe(codigo)).toMatchObject({ cerrada: true });
    const consulta = await worker.fetch(new Request(`http://x/api/partidas/${codigo}`), env);
    expect(await consulta.json()).toEqual({ existe: false });
    expect((await intentarConectar(`/parties/partida/${codigo}`, token)).status).toBe(404);
  });

  it("si vence la alarma con alguien conectado no se cierra y se vuelve a programar a 30 min", async () => {
    const { token, codigo } = await nuevaPartida();
    const t0 = 7_000_000_000_000;
    await runInDurableObject(sala(codigo), (partida) => {
      partida.ahora = () => t0;
    });
    const conexion = await abrir(codigo, token);
    await conexion.recibir("sala");

    expect(await runDurableObjectAlarm(sala(codigo))).toBe(true);
    expect(await sala(codigo).existe()).toBe(true);
    expect(conexion.ws.readyState).toBe(WebSocket.OPEN);
    // Si se perdiera un evento de cierre, la sala se cerraría sola cuando por fin quedara vacía.
    expect(await alarmaDe(codigo)).toBe(t0 + MIN_30);
  });

  it("volver a conectar antes de que venza aplaza el cierre: cuenta desde la última desconexión", async () => {
    const { token, codigo } = await nuevaPartida();
    await runInDurableObject(sala(codigo), (partida) => {
      partida.ahora = () => 5_000_000_000_000;
    });
    const primera = await abrir(codigo, token);
    await primera.recibir("sala");
    primera.cerrar();
    await esperar(async () => (await alarmaDe(codigo)) === 5_000_000_000_000 + MIN_30, "primera alarma");

    await runInDurableObject(sala(codigo), (partida) => {
      partida.ahora = () => 5_000_001_000_000;
    });
    const segunda = await abrir(codigo, token);
    await segunda.recibir("sala");
    segunda.cerrar();
    await esperar(async () => (await alarmaDe(codigo)) === 5_000_001_000_000 + MIN_30, "alarma desplazada");
  });

  it("una partida cerrada se puede reabrir con el mismo código y empieza sin las mesas de antes", async () => {
    const { token, jugador, codigo } = await nuevaPartida();
    const t0 = 6_000_000_000_000;
    await runInDurableObject(sala(codigo), (partida) => {
      partida.ahora = () => t0;
    });
    const conexion = await abrir(codigo, token);
    await conexion.recibir("sala");
    const resumen: ResumenMesa = { jugadores: [jugador.apodo], fase: "apuestas", finFase: 1 };
    await sala(codigo).actualizarMesa("blackjack", resumen);
    expect(await conexion.recibir("sala")).toMatchObject({ mesas: { blackjack: resumen } });
    conexion.cerrar();
    await esperar(async () => (await alarmaDe(codigo)) === t0 + MIN_30, "alarma tras la desconexión");
    await runDurableObjectAlarm(sala(codigo));
    expect(await sala(codigo).existe()).toBe(false);

    expect(await sala(codigo).iniciar(jugador.id, Date.now())).toBe(true);
    expect(await sala(codigo).existe()).toBe(true);
    const nueva = await abrir(codigo, token);
    const mensaje: MensajeSala = await nueva.recibir("sala");
    expect(mensaje.mesas).toEqual({ blackjack: MESA_VACIA, carrera: MESA_VACIA });
  });
});
