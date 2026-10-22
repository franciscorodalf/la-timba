import { ErrorApi, mensajeError } from "../../red/api";

/** Qué hacer cuando `POST /api/rescate` falla: avisar con un texto, o ponerse al día porque en realidad ya hay fichas. */
export type ResultadoErrorRescate = { tipo: "aviso"; texto: string } | { tipo: "tiene_fichas" };

export function errorRescate(e: unknown): ResultadoErrorRescate {
  if (e instanceof ErrorApi && e.status === 409) {
    if (e.error === "apuestas_pendientes") return { tipo: "aviso", texto: "Espera a que acabe tu ronda" };
    if (e.error === "tiene_fichas") return { tipo: "tiene_fichas" };
  }
  return { tipo: "aviso", texto: mensajeError(e) };
}
