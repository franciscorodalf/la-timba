import { getServerByName } from "partyserver";
import { type JugadorPublico, ORDENES_RANKING, type OrdenRanking, type RespuestaRanking, type RespuestaSesion } from "../shared/api";
import { rngCripto, type Rng } from "../shared/cartas";
import { apodoValido, firmarToken, pinValido, verificarToken } from "./auth";
import { Jugadores } from "./jugadores";
import { MesaBlackjack } from "./mesa-blackjack";
import { MesaCarrera } from "./mesa-carrera";
import { Partida } from "./partida";

export { Jugadores, MesaBlackjack, MesaCarrera, Partida };

export interface Env {
  Jugadores: DurableObjectNamespace<Jugadores>;
  Partida: DurableObjectNamespace<Partida>;
  MesaBlackjack: DurableObjectNamespace<MesaBlackjack>;
  MesaCarrera: DurableObjectNamespace<MesaCarrera>;
  TOKEN_SECRET: string;
  ASSETS: Fetcher;
}

const ALFABETO_CODIGO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LONGITUD_CODIGO = 4;
const MAX_INTENTOS_CODIGO = 5;
const CODIGO = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{4}$/;

// ---------- Respuestas ----------

const json = (cuerpo: unknown, status = 200): Response => Response.json(cuerpo, { status });
const error = (status: number, codigo: string, extra: Record<string, unknown> = {}): Response => json({ error: codigo, ...extra }, status);
const noAutenticado = () => error(401, "no_autenticado");
const peticionInvalida = () => error(400, "peticion_invalida");
const descansando = () => error(503, "descansando");

// ---------- Utilidades de petición ----------

interface Contexto {
  request: Request;
  env: Env;
  url: URL;
}
type Manejador = (c: Contexto) => Promise<Response>;
type Sesion = { id: number; apodo: string };

/** El cuerpo como objeto JSON; `null` si no hay JSON válido o no es un objeto (los arrays tampoco valen). */
async function leerObjeto(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const cuerpo: unknown = await request.json();
    return typeof cuerpo === "object" && cuerpo !== null && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** El jugador del `Authorization: Bearer <token>`, o `null` si falta, está mal formado, es inválido o ha caducado. */
async function autenticar({ request, env }: Contexto): Promise<Sesion | null> {
  const token = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
  return token === undefined ? null : verificarToken(token, env.TOKEN_SECRET, Date.now());
}

/** Exige sesión: sin ella responde 401. */
const conSesion =
  (manejador: (c: Contexto, jugador: Sesion) => Promise<Response>): Manejador =>
  async (c) => {
    const jugador = await autenticar(c);
    return jugador === null ? noAutenticado() : manejador(c, jugador);
  };

const jugadores = (env: Env) => env.Jugadores.get(env.Jugadores.idFromName("global"));

async function sesion(env: Env, jugador: JugadorPublico): Promise<RespuestaSesion> {
  return { token: await firmarToken({ id: jugador.id, apodo: jugador.apodo }, env.TOKEN_SECRET, Date.now()), jugador };
}

// ---------- Códigos de partida ----------

function generarCodigo(rng: Rng): string {
  let codigo = "";
  for (let i = 0; i < LONGITUD_CODIGO; i++) codigo += ALFABETO_CODIGO[Math.floor(rng() * ALFABETO_CODIGO.length)];
  return codigo;
}

/** El código en mayúsculas, o `null` si no tiene la forma de un código de partida. */
function normalizarCodigo(crudo: string): string | null {
  const codigo = crudo.toUpperCase();
  return CODIGO.test(codigo) ? codigo : null;
}

/** Abre una partida con un código libre; `null` si los `MAX_INTENTOS_CODIGO` sorteos chocan con salas abiertas. */
async function abrirPartida(env: Env, creadorId: number, ahora: number): Promise<string | null> {
  const rng = rngCripto();
  for (let intento = 0; intento < MAX_INTENTOS_CODIGO; intento++) {
    const codigo = generarCodigo(rng);
    const sala = await getServerByName(env.Partida, codigo);
    if (await sala.existe()) continue;
    await sala.iniciar(creadorId, ahora);
    return codigo;
  }
  return null;
}

// ---------- Rutas ----------

const salud: Manejador = async () => new Response("ok");

const registro: Manejador = async (c) => {
  const cuerpo = await leerObjeto(c.request);
  if (cuerpo === null) return peticionInvalida();
  const { apodo, pin } = cuerpo;
  if (!apodoValido(apodo)) return error(400, "apodo_invalido");
  if (!pinValido(pin)) return error(400, "pin_invalido");

  const r = await jugadores(c.env).registrar(apodo, pin, Date.now());
  if (!r.ok) return error(r.error === "apodo_ocupado" ? 409 : 400, r.error);
  return json(await sesion(c.env, r.jugador), 201);
};

const entrar: Manejador = async (c) => {
  const cuerpo = await leerObjeto(c.request);
  if (cuerpo === null) return peticionInvalida();
  const { apodo, pin } = cuerpo;
  if (typeof apodo !== "string" || typeof pin !== "string") return peticionInvalida();

  const r = await jugadores(c.env).entrar(apodo, pin, Date.now());
  if (r.ok) return json(await sesion(c.env, r.jugador));
  switch (r.error) {
    case "no_existe":
      return error(404, "no_existe");
    case "pin":
      return error(401, "pin", { intentosRestantes: r.intentosRestantes });
    case "bloqueado":
      return error(429, "bloqueado", { hasta: r.hasta });
  }
};

const yo = conSesion(async (c, { id }) => {
  // Token auténtico de un jugador que ya no existe: equivale a no estar autenticado.
  const perfil = await jugadores(c.env).perfil(id);
  return perfil === null ? noAutenticado() : json(perfil);
});

const crearPartida = conSesion(async (c, { id }) => {
  const codigo = await abrirPartida(c.env, id, Date.now());
  return codigo === null ? descansando() : json({ codigo }, 201);
});

async function consultarPartida(c: Contexto, codigoCrudo: string): Promise<Response> {
  const codigo = normalizarCodigo(codigoCrudo);
  if (codigo === null) return json({ existe: false });
  const sala = await getServerByName(c.env.Partida, codigo);
  return json({ existe: await sala.existe() });
}

const esOrden = (texto: string): texto is OrdenRanking => (ORDENES_RANKING as readonly string[]).includes(texto);

const ranking: Manejador = async (c) => {
  const orden = c.url.searchParams.get("orden") ?? "fichas";
  if (!esOrden(orden)) return error(400, "orden_invalido");
  // El token es opcional: sin él, o con uno inválido, se ve el ranking como anónimo.
  const jugador = await autenticar(c);
  const respuesta: RespuestaRanking = await jugadores(c.env).ranking(orden, jugador?.id ?? null);
  return json(respuesta);
};

const rescate = conSesion(async (c, { id }) => {
  const r = await jugadores(c.env).rescate(id);
  return r.ok ? json({ fichas: r.fichas }) : error(409, r.error);
});

/** Rutas exactas, por `"MÉTODO /ruta"`. Un `Map` evita que un método como `constructor` encuentre algo en el prototipo. */
const RUTAS = new Map<string, Manejador>([
  ["GET /api/salud", salud],
  ["POST /api/registro", registro],
  ["POST /api/entrar", entrar],
  ["GET /api/yo", yo],
  ["POST /api/partidas", crearPartida],
  ["GET /api/ranking", ranking],
  ["POST /api/rescate", rescate],
]);
const RUTA_PARTIDA = /^\/api\/partidas\/([^/]+)$/;

/** Atiende `/api/*`. Cualquier excepción no controlada se registra y responde 503. */
async function manejarApi(request: Request, env: Env): Promise<Response> {
  const contexto: Contexto = { request, env, url: new URL(request.url) };
  const { pathname } = contexto.url;
  try {
    const manejador = RUTAS.get(`${request.method} ${pathname}`);
    if (manejador !== undefined) return await manejador(contexto);

    const partida = request.method === "GET" ? RUTA_PARTIDA.exec(pathname) : null;
    if (partida !== null) return await consultarPartida(contexto, partida[1]);

    return error(404, "no_encontrado");
  } catch (e) {
    console.error(e);
    return descansando();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return manejarApi(request, env);
    return new Response("No encontrado", { status: 404 });
  },
};
