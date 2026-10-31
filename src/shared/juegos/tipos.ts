import type { Rng } from "../cartas";

export type JugadorId = number;
export type IdJuego = "blackjack" | "carrera" | "poker";
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
/** Lo que paga un cambio de una ronda; `visibleEn`, como en `Paso.liquidacion`. */
export type LiquidacionPaso = { ronda: number; filas: FilaLiquidacion[]; visibleEn?: number };
export type CodigoError =
  | "fase_incorrecta"
  | "apuesta_invalida"
  | "accion_invalida"
  | "mesa_llena"
  /** No queda ninguna casilla de apuesta libre en la mesa. */
  | "sin_casilla"
  /** No queda ningún asiento libre en una mesa con asientos numerados (el póker). */
  | "sin_asiento"
  | "no_sentado"
  | "sin_fichas"
  | "demasiados_mensajes"
  | "mensaje_invalido"
  /** El servidor de fichas (Jugadores) no respondió, o la mesa no pudo guardar: la acción se descarta. */
  | "no_disponible"
  /** La mesa sigue sin poder atender (p. ej. se agotó el límite diario gratuito): «La Timba está descansando». */
  | "descansando";
export type Paso<E> =
  | {
      ok: true;
      estado: E;
      eventos: Evento[];
      /**
       * La ronda que cierra este cambio. Con `visibleEn`, su resultado no se ve hasta ese instante (lo anuncia el reloj): la
       * mesa la guarda ya, pero no la paga antes, para que las fichas no se adelanten a lo que se ve.
       */
      liquidacion?: LiquidacionPaso;
      /** Cuando un mismo cambio cierra varias rondas: en el póker, cada jugador que se levanta tiene su sesión. */
      liquidaciones?: LiquidacionPaso[];
      /**
       * Solo en un `tick`: el cambio aplica lo que el reloj ya trajo y ya se anunció (la vista y `eventosEntre` lo enseñaron a
       * su hora), sin nada que pagar. La mesa no lo guarda ni lo envía ahora: va con la siguiente escritura que haya, y si
       * se pierde (la mesa sale de memoria antes), el `tick` siguiente lo vuelve a aplicar igual.
       */
      anunciado?: true;
    }
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
  /**
   * Pone al día un estado guardado por una versión anterior de las reglas (campos que entonces no existían). La mesa lo
   * llama al cargar el estado del almacenamiento, solo en memoria: no escribe nada hasta la siguiente jugada. Un estado
   * que ya está al día debe quedar igual, y nunca se muta el que se recibe.
   */
  normalizar?(e: E): E;
  /** Idempotente si el jugador ya está sentado. */
  sentar(e: E, jugadorId: JugadorId, apodo: string, ahora: number): Paso<E>;
  /** Fichas a cobrar antes de aplicar la acción. */
  costo(e: E, jugadorId: JugadorId, accion: A): number;
  /** La ronda a cuya cuenta se cobra esa acción. Sin este método, `e.ronda`. */
  rondaDelCobro?(e: E, jugadorId: JugadorId, accion: A): number;
  /** `apodo` es el del jugador que actúa: una acción puede ocupar un asiento, y su nombre no se le pide al cliente. */
  aplicar(e: E, jugadorId: JugadorId, accion: A, ahora: number, rng: Rng, apodo?: string): Paso<E>;
  desconectar(e: E, jugadorId: JugadorId, ahora: number, rng: Rng): Paso<E>;
  /** No-op (ok, sin eventos) si `ahora < finFase`. */
  tick(e: E, ahora: number, rng: Rng): Paso<E>;
  /**
   * Cuándo tiene que despertar la mesa para cambiar el estado aunque nadie actúe, o `null`. Lo que el reloj enseña sin
   * cambiar el estado (`proximoAviso`) no necesita alarma.
   */
  proximaAlarma(e: E): number | null;
  /**
   * Cambios de lo que se ve que trae el reloj sin cambiar el estado (los pasos de la carrera, ya sorteados; la jugada de la
   * banca y la ronda siguiente del blackjack): el primer instante posterior a `desde` en que cambia la vista, o `null` si no
   * hay ninguno. Sin este método, la vista solo cambia con el estado.
   */
  proximoAviso?(e: E, desde: number): number | null;
  /**
   * Los eventos de esos cambios con `desde < instante ≤ hasta`, en orden. Lo que ya trajo el cambio que guardó el estado no
   * se repite: la mesa sigue desde el instante de ese cambio.
   */
  eventosEntre?(e: E, desde: number, hasta: number): Evento[];
  /** Lo que ve `jugadorId` (o un espectador, con `null`) a la hora `ahora`. */
  vista(e: E, jugadorId: JugadorId | null, ahora: number): unknown;
  /**
   * Lo que enseña la sala de la mesa a la hora `ahora`, o `null` en una fase que dura un instante y no cambia lo que enseña
   * (la banca del blackjack): la sala se queda con lo último y la mesa no la avisa, tampoco de las rondas pagadas, que van
   * con el siguiente resumen.
   */
  resumen(e: E, ahora: number): ResumenMesa | null;
}
