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
  /** No queda ninguna casilla de apuesta libre en la mesa. */
  | "sin_casilla"
  | "no_sentado"
  | "sin_fichas"
  | "demasiados_mensajes"
  | "mensaje_invalido"
  /** El servidor de fichas (Jugadores) no respondió, o la mesa no pudo guardar: la acción se descarta. */
  | "no_disponible"
  /** La mesa sigue sin poder atender (p. ej. se agotó el límite diario gratuito): «La Timba está descansando». */
  | "descansando";
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
  /**
   * Cambios de lo que se ve que trae el reloj sin cambiar el estado (los pasos de la carrera, ya sorteados): el primer
   * instante posterior a `desde` en que cambia la vista, o `null` si no hay ninguno. Sin este método, la vista solo cambia
   * con el estado.
   */
  proximoAviso?(e: E, desde: number): number | null;
  /** Los eventos de esos cambios con `desde < instante ≤ hasta`, en orden. */
  eventosEntre?(e: E, desde: number, hasta: number): Evento[];
  /** Lo que ve `jugadorId` (o un espectador, con `null`) a la hora `ahora`. */
  vista(e: E, jugadorId: JugadorId | null, ahora: number): unknown;
  resumen(e: E): ResumenMesa;
}
