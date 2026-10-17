import type { OrdenRanking, Perfil, RespuestaRanking, RespuestaSesion } from "../../shared/api";
import { leerToken } from "./token";

export const MENSAJE_DESCANSANDO = "La Timba está descansando, vuelve mañana";

/** Respuesta no 2xx de la API (o, con `status` 0, una petición que no llegó al servidor). `datos` es el cuerpo JSON, o `null`. */
export class ErrorApi extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    /** Cada error trae sus campos: `intentosRestantes` en `pin`, `hasta` en `bloqueado`. */
    readonly datos: any,
  ) {
    super(error);
    this.name = "ErrorApi";
  }
}

/** El texto para el jugador cuando algo falla y la pantalla no tiene un mensaje más concreto. */
export function mensajeError(e: unknown): string {
  if (e instanceof ErrorApi) {
    if (e.status >= 500) return MENSAJE_DESCANSANDO;
    if (e.status === 0) return "No hay conexión con La Timba. Revisa tu red e inténtalo de nuevo";
  }
  return "Algo ha salido mal. Inténtalo de nuevo";
}

async function peticion<T>(metodo: "GET" | "POST", ruta: string, cuerpo?: unknown): Promise<T> {
  const cabeceras: Record<string, string> = {};
  const token = leerToken();
  if (token !== null) cabeceras.Authorization = `Bearer ${token}`;
  if (cuerpo !== undefined) cabeceras["Content-Type"] = "application/json";

  let respuesta: Response;
  try {
    respuesta = await fetch(ruta, { method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  } catch {
    throw new ErrorApi(0, "sin_conexion", null);
  }

  const datos: any = await respuesta.json().catch(() => null);
  if (!respuesta.ok) throw new ErrorApi(respuesta.status, typeof datos?.error === "string" ? datos.error : "desconocido", datos);
  return datos as T;
}

export const api = {
  registro: (apodo: string, pin: string) => peticion<RespuestaSesion>("POST", "/api/registro", { apodo, pin }),
  entrar: (apodo: string, pin: string) => peticion<RespuestaSesion>("POST", "/api/entrar", { apodo, pin }),
  yo: () => peticion<Perfil>("GET", "/api/yo"),
  crearPartida: () => peticion<{ codigo: string }>("POST", "/api/partidas"),
  existePartida: (codigo: string) => peticion<{ existe: boolean }>("GET", `/api/partidas/${encodeURIComponent(codigo)}`),
  ranking: (orden: OrdenRanking) => peticion<RespuestaRanking>("GET", `/api/ranking?orden=${orden}`),
  rescate: () => peticion<{ fichas: number }>("POST", "/api/rescate"),
};
