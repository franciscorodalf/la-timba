import type { Rng } from "../cartas";

export type JugadorId = number;
export type IdJuego = "blackjack" | "carrera";
export interface Evento {
  tipo: string;
  [k: string]: unknown;
}
/** neto = pago - apuesta */
export interface FilaLiquidacion {
  jugadorId: JugadorId;
  apuesta: number;
  pago: number;
}
export type CodigoError =
  | "fase_incorrecta"
  | "apuesta_invalida"
  | "accion_invalida"
  | "mesa_llena"
  | "no_sentado"
  | "sin_fichas"
  | "demasiados_mensajes"
  | "mensaje_invalido"
  /** El servidor de fichas (Jugadores) no respondió: la acción se descarta. */
  | "no_disponible";
export type Paso<E> =
  | { ok: true; estado: E; eventos: Evento[]; liquidacion?: { ronda: number; filas: FilaLiquidacion[] } }
  | { ok: false; error: CodigoError };
export interface ResumenMesa {
  jugadores: string[];
  fase: string;
  finFase: number | null;
}
export interface Juego<E extends { ronda: number }, A extends { t: string }> {
  id: IdJuego;
  maxJugadores: number;
  crear(ahora: number, rng: Rng): E;
  /** Idempotente si el jugador ya está sentado. */
  sentar(e: E, jugadorId: JugadorId, apodo: string, ahora: number): Paso<E>;
  /** Fichas a cobrar antes de aplicar la acción. */
  costo(e: E, jugadorId: JugadorId, accion: A): number;
  aplicar(e: E, jugadorId: JugadorId, accion: A, ahora: number, rng: Rng): Paso<E>;
  desconectar(e: E, jugadorId: JugadorId, ahora: number, rng: Rng): Paso<E>;
  /** No-op (ok, sin eventos) si `ahora < finFase`. */
  tick(e: E, ahora: number, rng: Rng): Paso<E>;
  proximaAlarma(e: E): number | null;
  vista(e: E, jugadorId: JugadorId | null): unknown;
  resumen(e: E): ResumenMesa;
}
