import { env, exports } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect } from "vitest";
import type { JugadorPublico, MensajeMesa } from "../src/shared/api";
import type { Carta, Palo, Rng, Valor } from "../src/shared/cartas";
import type { Mesa } from "../src/server/mesa-base";

const PALOS: ReadonlySet<string> = new Set<Palo>(["H", "D", "C", "S"]);
const VALORES: ReadonlySet<string> = new Set<Valor>(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);

/**
 * Parsea una carta: valor = todo menos el último carácter, palo = el último. `c("10H")`, `c("AS")`.
 * Lanza si el valor o el palo no existen, para que un error de tipeo en un fixture falle de inmediato.
 */
export function c(texto: string): Carta {
  const valor = texto.slice(0, -1);
  const palo = texto.slice(-1);
  if (!VALORES.has(valor) || !PALOS.has(palo)) throw new Error(`Carta desconocida: "${texto}"`);
  return { valor: valor as Valor, palo: palo as Palo };
}

/** Parsea varias cartas separadas por espacios: `cs("KH 7C")`. Una cadena vacía o de espacios da `[]`. */
export function cs(texto: string): Carta[] {
  const limpio = texto.trim();
  return limpio === "" ? [] : limpio.split(/\s+/).map(c);
}

/** Rng determinista: devuelve los valores dados en orden, en ciclo. */
export function rngFijo(...valores: number[]): Rng {
  let i = 0;
  return () => valores[i++ % valores.length];
}

/** Registra un jugador por la API HTTP y devuelve su token y el jugador. Usa apodos únicos: el DO `Jugadores` global se comparte entre pruebas. */
export async function registrar(apodo: string, pin = "1234"): Promise<{ token: string; jugador: JugadorPublico }> {
  const r = await exports.default.fetch("http://x/api/registro", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apodo, pin }),
  });
  if (r.status !== 201) throw new Error(`No se pudo registrar ${apodo}: ${r.status} ${await r.text()}`);
  return (await r.json()) as { token: string; jugador: JugadorPublico };
}

/** Crea una partida por la API HTTP con el token de su creador y devuelve su código. */
export async function crearPartida(token: string): Promise<string> {
  const r = await exports.default.fetch("http://x/api/partidas", { method: "POST", headers: { authorization: `Bearer ${token}` } });
  if (r.status !== 201) throw new Error(`No se pudo crear la partida: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { codigo: string }).codigo;
}

/** Pide una conexión WebSocket al Worker y devuelve la respuesta tal cual (101 si se acepta, el error si se rechaza). */
export function intentarConectar(ruta: string, token?: string, cabeceras: Record<string, string> = {}): Promise<Response> {
  const url = `http://x${ruta}${token === undefined ? "" : `${ruta.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`}`;
  return exports.default.fetch(url, { headers: { ...cabeceras, Upgrade: "websocket" } });
}

const ESPERA_MENSAJE_MS = 2000;

/**
 * Abre un WebSocket contra el Worker (`ruta` sin `?token=`; se añade si se pasa `token`). Lanza si no se acepta.
 * `recibir(t)` devuelve el siguiente mensaje JSON cuyo `t` coincida, descartando los anteriores; sin `t`, el siguiente.
 * Falla si en 2 s no llega ninguno, para que una prueba no se cuelgue.
 */
export async function conectar(
  ruta: string,
  token?: string,
  cabeceras?: Record<string, string>,
): Promise<{ ws: WebSocket; recibir(t?: string): Promise<any>; cerrar(): void }> {
  const res = await intentarConectar(ruta, token, cabeceras);
  const ws = res.webSocket;
  if (res.status !== 101 || ws === null) throw new Error(`No se pudo conectar a ${ruta}: ${res.status} ${await res.text()}`);

  const cola: any[] = [];
  let despertar: (() => void) | null = null;
  ws.addEventListener("message", (evento) => {
    cola.push(JSON.parse(evento.data as string));
    despertar?.();
  });
  ws.accept();

  async function recibir(t?: string): Promise<any> {
    const limite = Date.now() + ESPERA_MENSAJE_MS;
    for (;;) {
      while (cola.length > 0) {
        const mensaje = cola.shift();
        if (t === undefined || mensaje.t === t) return mensaje;
      }
      const restante = limite - Date.now();
      if (restante <= 0) throw new Error(`No llegó ningún mensaje${t === undefined ? "" : ` "${t}"`} en ${ESPERA_MENSAJE_MS} ms`);
      await new Promise<void>((resolver) => {
        despertar = resolver;
        setTimeout(resolver, restante);
      });
    }
  }

  return { ws, recibir, cerrar: () => ws.close(1000, "fin") };
}

/** Muy en el futuro: las alarmas que programe una mesa nunca saltan solas durante una prueba; se ejecutan con `vencer`. */
export const T = 4_000_000_000_000;

export type Conexion = Awaited<ReturnType<typeof conectar>>;
/** El mensaje `estado` de una mesa, con la vista `V` de su juego. */
export type EstadoMesa<V> = Extract<MensajeMesa<V>, { t: "estado" }>;

/** Apodo válido (≤ 16 caracteres) y distinto en cada llamada: el DO `Jugadores` global se comparte entre pruebas. */
export const unico = () => "t" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);

export const jugadores = () => env.Jugadores.get(env.Jugadores.idFromName("global"));
export const fichas = async (jugadorId: number) => (await jugadores().perfil(jugadorId))!.fichas;

/** Apuestas cobradas en las rondas de esta mesa que aún no se han liquidado. */
export const pendientesDe = (codigo: string) =>
  runInDurableObject(jugadores(), (_j, state) =>
    state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM apuestas_pendientes WHERE ronda_id LIKE ?", `${codigo}:%`).one().n,
  );

const abiertas: Conexion[] = [];

/** Como `conectar`, pero la conexión queda registrada para que `cerrarAbiertas` la cierre al acabar cada prueba. */
export async function abrir(ruta: string, token: string): Promise<Conexion> {
  const conexion = await conectar(ruta, token);
  abiertas.push(conexion);
  return conexion;
}

/** Cierra las conexiones abiertas con `abrir` (para el `afterEach` de cada archivo de pruebas). */
export function cerrarAbiertas(): void {
  for (const conexion of abiertas.splice(0)) {
    try {
      conexion.cerrar();
    } catch {
      // ya cerrada
    }
  }
}

/** ¿Aparece la carta en algún punto del mensaje (o de cualquier valor JSON)? */
export function contiene(valor: unknown, carta: Carta): boolean {
  if (Array.isArray(valor)) return valor.some((v) => contiene(v, carta));
  if (valor === null || typeof valor !== "object") return false;
  const objeto = valor as Record<string, unknown>;
  if (objeto.palo === carta.palo && objeto.valor === carta.valor) return true;
  return Object.values(objeto).some((v) => contiene(v, carta));
}

/** Envía una acción (o un mensaje cualquiera) como JSON. */
export const enviar = (conexion: Conexion, mensaje: object) => conexion.ws.send(JSON.stringify(mensaje));

/** Recibe mensajes `t` hasta el primero que cumpla `cumple`; los que van llegando se añaden a `vistos`. */
export async function hasta<M = EstadoMesa<unknown>>(conexion: Conexion, cumple: (m: M) => boolean, t = "estado", vistos: M[] = []): Promise<M> {
  for (;;) {
    const mensaje: M = await conexion.recibir(t);
    vistos.push(mensaje);
    if (cumple(mensaje)) return mensaje;
  }
}

/**
 * Lo común a probar una mesa (subclase de `Mesa`): `ns` es su espacio de nombres y `ruta` el nombre de su party
 * (`mesa-blackjack`). Todas las funciones se refieren a la mesa de la partida con ese código.
 */
export function ayudasMesa<M extends Mesa<any, any>>(ns: DurableObjectNamespace<M>, ruta: string) {
  const mesa = (codigo: string) => ns.get(ns.idFromName(codigo));
  const estadoMesa = (codigo: string) => runInDurableObject(mesa(codigo), (m) => m.estado as M["estado"]);
  const alarmaDe = (codigo: string) => runInDurableObject(mesa(codigo), (_m, state) => state.storage.getAlarm());

  /** Fija el reloj de la mesa. Vive en memoria: tras `evictDurableObject` hay que volver a fijarlo. */
  const reloj = (codigo: string, ahora: number) =>
    runInDurableObject(mesa(codigo), (m) => {
      m.ahora = () => ahora;
    });

  /** Lleva el reloj de la mesa al fin de su fase actual y ejecuta la alarma. */
  async function vencer(codigo: string): Promise<void> {
    await runInDurableObject(mesa(codigo), (m) => {
      const fin = m.estado.finFase;
      if (fin === null) throw new Error("la mesa no tiene ninguna fase que venza");
      m.ahora = () => fin;
    });
    expect(await runDurableObjectAlarm(mesa(codigo))).toBe(true);
  }

  /**
   * Prepara una mesa que aún no ha arrancado: reloj en `T` y, si se da, un estado inicial que se guarda en el registro de
   * la mesa ("mesa"), de donde lo carga al arrancar.
   */
  const preparar = (codigo: string, estado?: M["estado"]) =>
    runInDurableObject(mesa(codigo), async (m, state) => {
      m.ahora = () => T;
      if (estado === undefined) return;
      m.estado = estado;
      await state.storage.put("mesa", { estado, pendientes: [], cobro: null });
    });

  /** El registro guardado de la mesa: `{ estado, pendientes, cobro }`. */
  const guardado = (codigo: string) =>
    runInDurableObject(mesa(codigo), (_m, state) => state.storage.get<{ estado: M["estado"]; pendientes: unknown[]; cobro: unknown }>("mesa"));

  /**
   * Apunta, mientras la mesa siga en memoria, lo que escribe en su almacenamiento: `put:<claves>`, `delete:<claves>`,
   * `setAlarm` y `deleteAlarm`.
   */
  async function vigilarEscrituras(codigo: string): Promise<string[]> {
    const escrituras: string[] = [];
    await runInDurableObject(mesa(codigo), (_m, state) => {
      const almacen = state.storage as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const nombre of ["put", "delete", "setAlarm", "deleteAlarm"]) {
        const original = almacen[nombre].bind(state.storage);
        almacen[nombre] = (...a: unknown[]) => {
          const claves = nombre.endsWith("Alarm") ? [] : typeof a[0] === "string" ? [a[0]] : Array.isArray(a[0]) ? a[0] : Object.keys(a[0] as object);
          escrituras.push(claves.length === 0 ? nombre : `${nombre}:${claves.join(",")}`);
          return original(...a);
        };
      }
    });
    return escrituras;
  }

  /** Registra `n` jugadores, abre una partida del primero y prepara su mesa (ver `preparar`). */
  async function nuevaMesa(n: number, estado?: M["estado"]) {
    const js = await Promise.all(Array.from({ length: n }, () => registrar(unico())));
    const codigo = await crearPartida(js[0].token);
    await preparar(codigo, estado);
    return { codigo, js: js.map(({ token, jugador }) => ({ token, ...jugador })) };
  }

  const sentarse = (codigo: string, token: string) => abrir(`/parties/${ruta}/${codigo}`, token);

  return { mesa, estadoMesa, guardado, alarmaDe, reloj, vencer, preparar, nuevaMesa, sentarse, vigilarEscrituras };
}
