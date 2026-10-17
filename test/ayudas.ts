import { exports } from "cloudflare:workers";
import type { JugadorPublico } from "../src/shared/api";
import type { Carta, Palo, Rng, Valor } from "../src/shared/cartas";

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
