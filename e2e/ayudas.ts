import { expect, type APIRequestContext, type Page, type WebSocketRoute } from "@playwright/test";
import type { FilaRanking, MensajeMesa, RespuestaSesion } from "../src/shared/api";
import type { Carta } from "../src/shared/cartas";
import type { Evento } from "../src/shared/juegos/tipos";

/** Un apodo válido (3–16 caracteres) distinto en cada ejecución: el servidor de desarrollo conserva el estado entre ejecuciones. */
export function apodoUnico(): string {
  const azar = Math.random().toString(36).slice(2, 6);
  return `${Date.now().toString(36)}${azar}`.slice(0, 16);
}

/** Registra un jugador por la API y comprueba que el servidor lo crea (201). Devuelve su token y su perfil. */
export async function registrar(request: APIRequestContext, apodo: string, pin: string): Promise<RespuestaSesion> {
  const respuesta = await request.post("/api/registro", { data: { apodo, pin } });
  expect(respuesta.status()).toBe(201);
  return respuesta.json();
}

/** Abre una partida por la API en nombre de un jugador ya registrado y devuelve su código. */
export async function abrirPartida(request: APIRequestContext, { token }: RespuestaSesion): Promise<string> {
  const respuesta = await request.post("/api/partidas", { headers: { Authorization: `Bearer ${token}` } });
  expect(respuesta.status()).toBe(201);
  return (await respuesta.json()).codigo;
}

/** Deja la sesión de ese jugador guardada en el navegador antes de que cargue ninguna página: la app arranca ya dentro. */
export async function conSesion(pagina: Page, { token }: RespuestaSesion): Promise<void> {
  await pagina.addInitScript((t) => localStorage.setItem("timba.token", t), token);
}

/** Una carta a partir de su texto: `10H`, `AS`, `KD`. */
export const carta = (texto: string): Carta => ({ palo: texto.at(-1) as Carta["palo"], valor: texto.slice(0, -1) as Carta["valor"] });

// ---------------------------------------------------------------------------------------------------------------------
// Con la mesa simulada: el socket de la mesa no llega al servidor y la prueba decide qué manda la mesa.
// ---------------------------------------------------------------------------------------------------------------------

export interface MesaSimulada<V> {
  /** El mensaje con el que contesta la mesa al conectar (o `null`: no contesta). Se fija antes de abrir la página. */
  alConectar(mensaje: MensajeMesa<V> | null): void;
  /** Al conectar, en vez de contestar, cierra con este código. */
  cerrarAlConectar(codigo: number): void;
  enviar(mensaje: MensajeMesa<V>): void;
  cerrar(codigo: number): Promise<void>;
  /** Las acciones que ha mandado el cliente, en orden. */
  recibidas: unknown[];
  /** Cuántas conexiones ha abierto el cliente con la mesa. */
  conexiones(): number;
}

/** Intercepta el socket de la mesa `party` de esta página: nada llega al servidor; la prueba manda lo que quiera. */
export async function simularMesa<V>(pagina: Page, party: "mesa-blackjack" | "mesa-carrera"): Promise<MesaSimulada<V>> {
  let socket: WebSocketRoute | null = null;
  let inicial: MensajeMesa<V> | null = null;
  let cierre: number | null = null;
  const recibidas: unknown[] = [];
  let conexiones = 0;
  await pagina.routeWebSocket(new RegExp(`/parties/${party}/`), (ws) => {
    conexiones++;
    socket = ws;
    ws.onMessage((m) => recibidas.push(JSON.parse(String(m))));
    if (cierre !== null) void ws.close({ code: cierre });
    else if (inicial !== null) ws.send(JSON.stringify(inicial));
  });
  return {
    alConectar: (mensaje) => {
      inicial = mensaje;
    },
    cerrarAlConectar: (codigo) => {
      cierre = codigo;
    },
    enviar: (mensaje) => (socket as WebSocketRoute | null)?.send(JSON.stringify(mensaje)),
    cerrar: async (codigo) => (socket as WebSocketRoute | null)?.close({ code: codigo }),
    recibidas,
    conexiones: () => conexiones,
  };
}

let version = 0;

/** El mensaje de estado de una mesa con su vista y los eventos que trae. */
export const mensajeEstado = <V>(vista: V, eventos: Evento[] = []): MensajeMesa<V> => ({ t: "estado", version: ++version, ahora: Date.now(), vista, eventos });

/** Registra un jugador, abre una partida, deja su sesión en el navegador e intercepta el socket de la mesa `party`. */
export async function entrarSimulada<V>(pagina: Page, request: APIRequestContext, party: "mesa-blackjack" | "mesa-carrera") {
  const sesion = await registrar(request, apodoUnico(), "1234");
  const codigo = await abrirPartida(request, sesion);
  await conSesion(pagina, sesion);
  const mesa = await simularMesa<V>(pagina, party);
  return { sesion, codigo, mesa };
}

/**
 * Las fichas que devuelven `/api/fichas` (las mesas, la sala y el inicio) y `/api/yo` (al abrir la app y el perfil), a
 * elegir: se fijan al pedir (una petición en vuelo no ve el cambio siguiente). Si la prueba acaba con una petición en vuelo,
 * la página se cierra y el fallo de esa petición no se cuenta como error de la ejecución.
 */
export async function fichasDeApi(pagina: Page, inicial: number): Promise<{ poner(n: number): void }> {
  let fichas = inicial;
  // `/api/fichas` solo trae las fichas: se contesta aquí mismo, sin ir al servidor de desarrollo.
  await pagina.route(/\/api\/fichas$/, (ruta) => ruta.fulfill({ json: { fichas } }));
  await pagina.route(/\/api\/yo$/, async (ruta) => {
    const valor = fichas;
    try {
      const respuesta = await ruta.fetch();
      await ruta.fulfill({ response: respuesta, json: { ...(await respuesta.json()), fichas: valor } });
    } catch (error) {
      // Solo si la prueba ya ha acabado (la página o el contexto se han cerrado con la petición a medias) no hay nada que contestar;
      // cualquier otro fallo es real: se deja que salga en vez de dejar la petición colgada.
      const cerrada = pagina.isClosed() || (error instanceof Error && /Target (page, context or browser|page|context|browser) has been closed|Response has been disposed/.test(error.message));
      if (!cerrada) throw error;
    }
  });
  return { poner: (n) => (fichas = n) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que comparten las pruebas del ranking y del perfil.
// ---------------------------------------------------------------------------------------------------------------------

/** La barra de navegación de abajo (Sala, Ranking, Perfil). */
export const barra = (pagina: Page) => pagina.getByRole("navigation", { name: "Principal" });

/** La página no se desplaza a los lados: nada se sale de la pantalla. */
export const sinDesplazamientoHorizontal = (pagina: Page) => pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

/** `n` filas de ranking inventadas (`jugador1`…), de mayor a menor valor. */
export const jugadoresFalsos = (n: number, valor: (i: number) => number = (i) => 5000 - i * 10): FilaRanking[] =>
  Array.from({ length: n }, (_, i) => ({ posicion: i + 1, apodo: `jugador${i + 1}`, valor: valor(i) }));

/** Una promesa que la prueba cumple cuando quiere. */
export function aplazada(): { espera: Promise<void>; soltar(): void } {
  let soltar!: () => void;
  const espera = new Promise<void>((resolver) => (soltar = resolver));
  return { espera, soltar };
}
