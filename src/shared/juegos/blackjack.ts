import { barajar, crearBaraja, type Carta, type Rng } from "../cartas";
import type { CodigoError, Evento, FilaLiquidacion, Juego, JugadorId, Paso, ResumenMesa } from "./tipos";

export const BJ = {
  BARAJAS: 6,
  MIN_ZAPATO: 78,
  APUESTAS_MS: 15_000,
  DECISIONES_MS: 15_000,
  BANCA_MS: 1_000,
  RESULTADO_MS: 4_000,
  MIN: 10,
  MAX_JUGADORES: 6,
  /** Casillas de apuesta de la mesa: cada jugador ocupa una y puede pedir una segunda. */
  CASILLAS: 7,
  /** Manos como mucho por jugador en una ronda, contando las que salen de dividir. */
  MAX_MANOS_JUGADOR: 4,
  /** Lo que dura la fase `seguro`. */
  SEGURO_MS: 10_000,
  /** Lo que se alarga la ventana de decisiones con cada división. */
  DIVIDIR_EXTRA_MS: 10_000,
  // El ritmo con el que la pantalla enseña el reparto y la mirada de la banca. Viven aquí, y no solo en el cliente, porque el
  // servidor retrasa la jugada de la banca lo que la pantalla tarda en enseñar lo anterior (`esperaDeLaMirada`): así no se desajustan.
  /** Entre una carta repartida y la siguiente. */
  ESCALONADO_MS: 260,
  /** Lo que tarda una carta en volar del mazo a su sitio. */
  VUELO_MS: 480,
  /** Lo que dura la mirada de la banca a su carta tapada (sube un poco y baja); con blackjack, el giro viene después. */
  MIRA_MS: 700,
} as const;

/**
 * Lo que tarda la pantalla en enseñar el reparto de `manos` manos (2·(manos + 1) cartas, la última a (2·manos + 1)·`ESCALONADO_MS`)
 * y la mirada de la banca que empieza cuando esa carta ha llegado: hasta entonces la banca no gira su carta. Sin reparto
 * (la mirada tras el seguro), `manos` es 0 y solo cuenta la mirada.
 */
export const esperaDeLaMirada = (manos: number, conReparto = true): number =>
  (conReparto ? (2 * manos + 1) * BJ.ESCALONADO_MS + BJ.VUELO_MS : 0) + BJ.MIRA_MS;

function valorCarta(c: Carta): number {
  if (c.valor === "A") return 1;
  if (c.valor === "J" || c.valor === "Q" || c.valor === "K") return 10;
  return Number(c.valor);
}

/** Mejor total ≤ 21 si existe. `blanda` es true cuando un as cuenta ahora como 11. */
export function puntuacion(cartas: Carta[]): { total: number; blanda: boolean } {
  let total = 0;
  let hayAs = false;
  for (const carta of cartas) {
    total += valorCarta(carta);
    if (carta.valor === "A") hayAs = true;
  }
  if (hayAs && total + 10 <= 21) return { total: total + 10, blanda: true };
  return { total, blanda: false };
}

/** Blackjack natural: exactamente 2 cartas que suman 21. */
export function esBlackjack(cartas: Carta[]): boolean {
  return cartas.length === 2 && puntuacion(cartas).total === 21;
}

/** La banca pide con menos de 17 y se planta en cualquier 17 o más (también 17 blando). */
export function bancaDebePedir(cartas: Carta[]): boolean {
  return puntuacion(cartas).total < 17;
}

/**
 * Fichas que se devuelven al jugador por esta mano (apuesta incluida); neto = pago - apuesta.
 * `mano.apuesta` es lo que hay en juego en la mano (ya contando el doble si se dobló).
 * Contra un blackjack de la banca solo empata otro blackjack natural y lo demás pierde (la banca lo mira antes de las decisiones).
 * Una mano doblada o dividida nunca cuenta como blackjack natural: su 21 de dos cartas paga 1:1.
 */
export function pago(mano: Pick<ManoBJ, "cartas" | "apuesta" | "doblada" | "dividida">, banca: Carta[]): number {
  const { apuesta } = mano;
  const jugador = puntuacion(mano.cartas).total;
  const jugadorBlackjack = !mano.doblada && !mano.dividida && esBlackjack(mano.cartas);

  if (jugador > 21) return 0;
  if (esBlackjack(banca)) return jugadorBlackjack ? apuesta : 0;
  if (jugadorBlackjack) return apuesta + Math.floor((apuesta * 3) / 2);

  const total = puntuacion(banca).total;
  if (total > 21 || jugador > total) return apuesta * 2;
  if (jugador === total) return apuesta;
  return 0;
}

/** Apuesta válida: un entero seguro desde `BJ.MIN`. No hay tope: se puede apostar todo (lo que no tengas lo rechaza el cobro). */
export function apuestaValida(cantidad: unknown): cantidad is number {
  return typeof cantidad === "number" && Number.isSafeInteger(cantidad) && cantidad >= BJ.MIN;
}

// ---------------------------------------------------------------------------
// Máquina de estados de la mesa
//
// Todo es puro: el tiempo entra por `ahora` y el azar por `rng`. El estado es JSON plano y se trata como
// inmutable: cada transición trabaja sobre un clon y devuelve un estado nuevo (la entrada nunca se muta).
// Un no-op (p. ej. `tick` antes de `finFase`) devuelve el mismo objeto de entrada, sin cambios.
// Convención del zapato: `zapato[0]` es la siguiente carta que sale; se reparte en el orden del array.
// ---------------------------------------------------------------------------

export type AccionBJ =
  /** `segunda: true` pide una segunda casilla; sin ella solo vale si aún no tienes casilla. */
  | { t: "apostar"; cantidad: number; segunda?: boolean }
  | { t: "pedir" }
  | { t: "plantarse" }
  | { t: "doblar" }
  | { t: "dividir" }
  | { t: "rendirse" }
  | { t: "seguro"; tomar: boolean }
  | { t: "salir" };

export type FaseBJ = "esperando" | "apuestas" | "seguro" | "decisiones" | "banca" | "resultado";

export interface ManoBJ {
  jugadorId: JugadorId;
  apodo: string;
  /** La casilla de apuesta (0..`BJ.CASILLAS - 1`); las manos que salen de dividir la comparten. */
  casilla: number;
  /** Orden de la mano dentro del jugador (0..`BJ.MAX_MANOS_JUGADOR - 1`): por casilla y luego por división. */
  indice: number;
  /** Total en juego en esta mano: ya vale el doble si se dobló. */
  apuesta: number;
  cartas: Carta[];
  estado: "jugando" | "plantado" | "pasado" | "blackjack" | "rendido";
  doblada: boolean;
  /** La mano sale de dividir otra: un 21 con dos cartas ya no es blackjack natural. */
  dividida: boolean;
  /** El jugador salió de la mesa con la ronda en curso: pierde la apuesta. */
  abandonada: boolean;
}

/** Lo que un jugador ha asegurado en la ronda (`cantidad` 0 si dijo que no, no contestó o se fue). */
export interface SeguroBJ {
  jugadorId: JugadorId;
  cantidad: number;
  respondido: boolean;
}

/** Qué puede hacer un jugador ahora mismo según las reglas; no sabe cuántas fichas tiene (eso lo comprueba el cobro). */
export interface OpcionesBJ {
  pedir: boolean;
  plantarse: boolean;
  doblar: boolean;
  dividir: boolean;
  rendirse: boolean;
  /** Lo que costaría asegurarse, o `null` si no se ofrece. */
  seguro: number | null;
}

/**
 * El estado guardado de la mesa. En `resultado` la ronda ya está decidida y liquidada (la banca juega al cerrarse las
 * decisiones), pero el reloj enseña antes `BJ.BANCA_MS` de banca y, al acabar, la ronda siguiente, sin cambiar el estado:
 * ver `aLaVista`.
 */
export interface EstadoBJ {
  ronda: number;
  /** `banca` solo queda guardada en mesas de una versión anterior, con la banca aún sin jugar: ahora es solo lo que se ve. */
  fase: FaseBJ;
  /** Instante en que vence la fase actual; `null` en `esperando` (no hay alarma). */
  finFase: number | null;
  zapato: Carta[];
  /** La segunda carta (`banca[1]`) está tapada hasta que se gira (`carta_girada`): al pasar a `resultado`, o cuando la banca mira y tiene blackjack. */
  banca: Carta[];
  asientos: { jugadorId: JugadorId; apodo: string; conectado: boolean }[];
  manos: ManoBJ[];
  /** Seguros de la ronda: una entrada por jugador con manos no abandonadas, creada al abrirse la fase `seguro` (con `respondido` a false). */
  seguros: SeguroBJ[];
  /** La banca ya ha mirado su carta tapada en esta ronda (solo mira con un as o un 10 visibles, y una sola vez). */
  bancaMirada: boolean;
  /**
   * Con blackjack de la banca al mirar, lo que ha jugado se ve en el mismo instante en que se decide la ronda (aquí, ese instante),
   * pero el resultado dura lo que la pantalla tarda en enseñar el reparto y la mirada, más `BJ.RESULTADO_MS`. Sin él, la banca
   * enseña su jugada `BJ.RESULTADO_MS` antes de `finFase`.
   */
  revelaEn?: number;
  /** Ventanas de apuestas seguidas que se cerraron sin ninguna apuesta; al llegar a 3 la mesa pasa a `esperando`. */
  ventanasVacias: number;
}

export interface VistaBJ {
  ronda: number;
  fase: FaseBJ;
  finFase: number | null;
  banca: (Carta | null)[];
  totalBanca: number | null;
  /** Ordenadas por (casilla, indice). */
  manos: (Omit<ManoBJ, "abandonada"> & { total: number })[];
  sentados: string[];
  yo: JugadorId | null;
  /** Solo para quien recibe la vista: `null` para un espectador. */
  opciones: OpcionesBJ | null;
  /** Lo que has asegurado esta ronda, o `null`. */
  miSeguro: number | null;
  casillasLibres: number;
}

type Liquidacion = { ronda: number; filas: FilaLiquidacion[]; visibleEn?: number };

/** Ventanas de apuestas vacías seguidas tras las que la mesa deja de programar alarmas (los asientos se conservan). */
const MAX_VENTANAS_VACIAS = 3;

function exito(estado: EstadoBJ, eventos: Evento[] = [], liquidacion?: Liquidacion): Paso<EstadoBJ> {
  return liquidacion ? { ok: true, estado, eventos, liquidacion } : { ok: true, estado, eventos };
}

function fallo(error: CodigoError): Paso<EstadoBJ> {
  return { ok: false, error };
}

const asientoDe = (e: EstadoBJ, jugadorId: JugadorId) => e.asientos.find((a) => a.jugadorId === jugadorId);
const hayJugando = (e: EstadoBJ) => e.manos.some((m) => m.estado === "jugando");

/** Las manos (las mismas, no copias) ordenadas por (casilla, indice): el orden de reparto y de juego. */
const porCasilla = (manos: ManoBJ[]): ManoBJ[] => [...manos].sort((a, b) => a.casilla - b.casilla || a.indice - b.indice);
const manosDe = (e: EstadoBJ, jugadorId: JugadorId): ManoBJ[] => porCasilla(e.manos.filter((m) => m.jugadorId === jugadorId));
/** Las casillas distintas que ocupa el jugador (las manos que salen de dividir comparten la de su original). */
const casillasDe = (e: EstadoBJ, jugadorId: JugadorId): number[] => [...new Set(manosDe(e, jugadorId).map((m) => m.casilla))];

/** La mano que juega ahora el jugador: la primera que sigue en juego por (casilla, indice). */
export function manoActiva(e: EstadoBJ, jugadorId: JugadorId): ManoBJ | undefined {
  return manosDe(e, jugadorId).find((m) => m.estado === "jugando");
}

/** Casillas sin apuesta. Las manos abandonadas siguen ocupando la suya hasta que acaba la ronda. */
export function casillasLibres(e: EstadoBJ): number {
  return BJ.CASILLAS - new Set(e.manos.map((m) => m.casilla)).size;
}

/** La casilla libre de número más bajo, o `null` si la mesa está llena. */
function primeraCasillaLibre(e: EstadoBJ): number | null {
  const ocupadas = new Set(e.manos.map((m) => m.casilla));
  for (let casilla = 0; casilla < BJ.CASILLAS; casilla++) if (!ocupadas.has(casilla)) return casilla;
  return null;
}

/** Rendirse: solo como primera decisión de una mano sin dividir. Con dos cartas basta: una mano doblada ya tiene tres. */
const puedeRendirse = (m: ManoBJ | undefined): boolean => m !== undefined && m.cartas.length === 2 && !m.dividida;

/** Lo que cuesta asegurarse (la mitad, hacia abajo, de lo apostado en todas sus manos) mientras el jugador no ha contestado; si no, `null`. */
function costeSeguro(e: EstadoBJ, jugadorId: JugadorId): number | null {
  if (e.fase !== "seguro") return null;
  const entrada = e.seguros.find((s) => s.jugadorId === jugadorId);
  if (entrada === undefined || entrada.respondido) return null;
  return Math.floor(manosDe(e, jugadorId).reduce((suma, m) => suma + m.apuesta, 0) / 2);
}

/**
 * Dividir: dos cartas del mismo valor (el 10 y las figuras valen lo mismo, así que se dividen entre sí), con sitio en los topes:
 * menos de `BJ.MAX_MANOS_JUGADOR` manos en total y, en esa casilla, menos de ese tope repartido entre las casillas del jugador
 * (4 con una casilla, 2 con dos). Unos ases ya divididos no se vuelven a dividir.
 */
function puedeDividir(e: EstadoBJ, m: ManoBJ | undefined): boolean {
  if (m === undefined || m.cartas.length !== 2 || valorCarta(m.cartas[0]) !== valorCarta(m.cartas[1])) return false;
  if (m.dividida && m.cartas[0].valor === "A") return false;
  const propias = manosDe(e, m.jugadorId);
  const enLaCasilla = propias.filter((otra) => otra.casilla === m.casilla).length;
  return propias.length < BJ.MAX_MANOS_JUGADOR && enLaCasilla < BJ.MAX_MANOS_JUGADOR / casillasDe(e, m.jugadorId).length;
}

/** Lo que permiten las reglas al jugador ahora mismo. */
export function opcionesDe(e: EstadoBJ, jugadorId: JugadorId): OpcionesBJ {
  const activa = e.fase === "decisiones" ? manoActiva(e, jugadorId) : undefined;
  return {
    pedir: activa !== undefined,
    plantarse: activa !== undefined,
    doblar: activa?.cartas.length === 2,
    dividir: puedeDividir(e, activa),
    rendirse: puedeRendirse(activa),
    seguro: costeSeguro(e, jugadorId),
  };
}

/** Saca la siguiente carta del zapato. Si se vaciara en plena ronda (casi imposible con ≥ 78 al empezar, aun con divisiones), baraja uno nuevo. */
function robar(e: EstadoBJ, rng: Rng, eventos: Evento[]): Carta {
  if (e.zapato.length === 0) {
    e.zapato = barajar(crearBaraja(BJ.BARAJAS), rng);
    eventos.push({ tipo: "barajado" });
  }
  return e.zapato.shift() as Carta;
}

/** La carta visible que recibe una mano de un jugador: siempre dice a qué mano va (su `indice`). */
const cartaDeMano = (m: Pick<ManoBJ, "jugadorId" | "indice">, carta: Carta): Evento =>
  ({ tipo: "carta_repartida", a: m.jugadorId, mano: m.indice, oculta: false, carta });

/** La carta visible de la banca: no lleva `mano`. */
const cartaDeBanca = (carta: Carta): Evento => ({ tipo: "carta_repartida", a: "banca", oculta: false, carta });

/** Si ya nadie puede decidir, las decisiones terminan sin esperar al reloj: juega la banca (`cerrarRonda`). */
function cerrarDecisiones(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): Liquidacion | undefined {
  if (e.fase === "decisiones" && !hayJugando(e)) return cerrarRonda(e, ahora, rng, eventos);
  return undefined;
}

/** Abre las decisiones, o juega ya la banca si nadie juega. Quien se desconectó antes planta sus manos. */
function abrirDecisiones(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): Liquidacion | undefined {
  for (const m of e.manos) if (m.estado === "jugando" && asientoDe(e, m.jugadorId)?.conectado === false) m.estado = "plantado";
  if (!hayJugando(e)) return cerrarRonda(e, ahora, rng, eventos);
  e.fase = "decisiones";
  e.finFase = ahora + BJ.DECISIONES_MS;
  return undefined;
}

/**
 * Cierra las decisiones. La banca juega ya su mano (solo depende del zapato guardado) y la ronda se liquida en este mismo
 * cambio, pero lo que ha jugado no se ve hasta `BJ.BANCA_MS` después: hasta entonces la vista es la de la banca, y el reloj
 * lo enseña a su hora (`proximoAviso`/`eventosEntre`) sin escribir nada. La liquidación lleva ese instante (`visibleEn`).
 */
function cerrarRonda(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): Liquidacion {
  return jugarBanca(e, ahora, rng, eventos, BJ.BANCA_MS);
}

/**
 * La banca mira su carta tapada (solo con un as o un 10 visibles, y una sola vez). Con blackjack la gira y la ronda acaba
 * ya (devuelve la liquidación), pero la pantalla necesita `espera` ms para enseñar lo anterior (el reparto, si lo hay, y la mirada) antes de girarla y
 * enseñar el premio: el resultado dura esa espera más `BJ.RESULTADO_MS`, no solo desde el reparto; sin él, los seguros se pierden y siguen las decisiones.
 */
function bancaMira(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[], espera: number): Liquidacion | undefined {
  const blackjack = esBlackjack(e.banca);
  e.bancaMirada = true;
  eventos.push({ tipo: "banca_mira", blackjack });
  if (blackjack) {
    const liquidacion = jugarBanca(e, ahora, rng, eventos, 0);
    // Lo que pasa se ve ya (sin cambiar nada de lo anterior), pero el resultado se queda en pantalla `espera` más.
    e.revelaEn = ahora;
    e.finFase = ahora + espera + BJ.RESULTADO_MS;
    return liquidacion;
  }
  return abrirDecisiones(e, ahora, rng, eventos);
}

/** Quien no contesta el seguro cuenta como «no»: su entrada queda respondida con lo que tuviera (0 si no había cogido). */
function contestarNo(e: EstadoBJ, jugadorId: JugadorId): void {
  const entrada = e.seguros.find((s) => s.jugadorId === jugadorId);
  if (entrada !== undefined) entrada.respondido = true;
}

/** Si estamos en `seguro` y ya nadie queda por contestar, la banca mira sin esperar al reloj. */
function resolverSeguroSiListo(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): Liquidacion | undefined {
  if (e.fase !== "seguro" || e.seguros.some((s) => !s.respondido)) return undefined;
  return bancaMira(e, ahora, rng, eventos, esperaDeLaMirada(0, false));
}

/** Abre la fase `seguro` con una entrada por jugador con manos en juego. Quien ya está desconectado cuenta como «no». */
function abrirSeguro(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): Liquidacion | undefined {
  const jugadores = new Set(porCasilla(e.manos.filter((m) => !m.abandonada)).map((m) => m.jugadorId));
  e.seguros = [...jugadores].map((jugadorId) => ({ jugadorId, cantidad: 0, respondido: false }));
  e.fase = "seguro";
  e.finFase = ahora + BJ.SEGURO_MS;
  for (const a of e.asientos) if (!a.conectado) contestarNo(e, a.jugadorId);
  return resolverSeguroSiListo(e, ahora, rng, eventos);
}

/**
 * Reparte por casillas, banca, por casillas, banca (la segunda de la banca, tapada) y abre la fase que toque: con un as
 * visible, el seguro; con un 10 o una figura, la banca mira al momento; con otra carta, las decisiones.
 */
function repartir(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): Liquidacion | undefined {
  const activas = porCasilla(e.manos.filter((m) => !m.abandonada));
  if (activas.length > 0) {
    for (const vuelta of [0, 1]) {
      for (const m of activas) {
        const carta = robar(e, rng, eventos);
        m.cartas.push(carta);
        eventos.push(cartaDeMano(m, carta));
      }
      const carta = robar(e, rng, eventos);
      e.banca.push(carta);
      eventos.push(vuelta === 0 ? cartaDeBanca(carta) : { tipo: "carta_repartida", a: "banca", oculta: true });
    }
    for (const m of activas) if (esBlackjack(m.cartas)) m.estado = "blackjack";
    if (e.banca[0].valor === "A") return abrirSeguro(e, ahora, rng, eventos);
    if (valorCarta(e.banca[0]) === 10) return bancaMira(e, ahora, rng, eventos, esperaDeLaMirada(activas.length));
  }
  return abrirDecisiones(e, ahora, rng, eventos);
}

/**
 * La banca juega su mano, se calculan los pagos y la ronda pasa a `resultado`, que acaba `espera + BJ.RESULTADO_MS` después.
 * Lo que se ve (`eventosDeLaBanca`) llega a los `espera` ms: con 0, en estos mismos eventos; si no, lo anuncia el reloj, y
 * la liquidación lleva ese instante en `visibleEn`. (Un rebarajado en plena jugada, casi imposible, sale con este cambio.)
 */
function jugarBanca(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[], espera: number): Liquidacion {
  // Si la banca tiene blackjack la ronda acaba sin decisiones: lo que seguía en juego pierde y queda plantado, no «jugando».
  for (const m of e.manos) if (m.estado === "jugando") m.estado = "plantado";
  // Las manos pasadas, rendidas y abandonadas ya están decididas: no hace falta que la banca pida por ellas.
  if (e.manos.some((m) => !m.abandonada && m.estado !== "pasado" && m.estado !== "rendido")) {
    while (bancaDebePedir(e.banca)) e.banca.push(robar(e, rng, eventos));
  }
  e.fase = "resultado";
  e.finFase = ahora + espera + BJ.RESULTADO_MS;
  const liquidacion = liquidar(e, []);
  if (espera === 0) {
    eventos.push(...eventosDeLaBanca(e));
    return liquidacion;
  }
  return { ...liquidacion, visibleEn: ahora + espera };
}

/** El instante en que se ve lo que ha jugado la banca, en un `resultado` que acaba en `fin`: hasta entonces, se ve la banca. */
const revelacion = (e: EstadoBJ): number => e.revelaEn ?? e.finFase! - BJ.RESULTADO_MS;

/** Lo que se ve cuando la banca enseña su jugada: la carta girada, las que ha pedido y los pagos (con los del seguro). */
function eventosDeLaBanca(e: EstadoBJ): Evento[] {
  const eventos: Evento[] = [];
  if (e.banca.length >= 2) eventos.push({ tipo: "carta_girada", carta: { ...e.banca[1] } });
  for (const carta of e.banca.slice(2)) eventos.push(cartaDeBanca({ ...carta }));
  liquidar(e, eventos);
  return eventos;
}

/**
 * Una fila por jugador, en el orden de su primera mano, con la suma de lo apostado y de lo cobrado en todas sus manos.
 * El seguro suma lo asegurado en `apuesta` y, si la banca tiene blackjack, el triple en `pago` (devuelve lo asegurado más
 * el doble); quien se fue lo pierde con sus manos. Rendirse devuelve la mitad de la apuesta, hacia abajo.
 */
function liquidar(e: EstadoBJ, eventos: Evento[]): Liquidacion {
  const filas: FilaLiquidacion[] = [];
  for (const m of e.manos) {
    const cobrado = m.abandonada ? 0 : m.estado === "rendido" ? Math.floor(m.apuesta / 2) : pago(m, e.banca);
    const fila = filas.find((f) => f.jugadorId === m.jugadorId);
    if (fila) {
      fila.apuesta += m.apuesta;
      fila.pago += cobrado;
    } else {
      filas.push({ jugadorId: m.jugadorId, apuesta: m.apuesta, pago: cobrado });
    }
  }
  for (const { jugadorId, cantidad } of e.seguros) {
    if (cantidad === 0) continue;
    const fila = filas.find((f) => f.jugadorId === jugadorId)!;
    fila.apuesta += cantidad;
    if (esBlackjack(e.banca) && manosDe(e, jugadorId).some((m) => !m.abandonada)) {
      fila.pago += 3 * cantidad;
      eventos.push({ tipo: "seguro_pagado", jugadorId, cantidad: 3 * cantidad });
    }
  }
  for (const f of filas) eventos.push({ tipo: "pago", jugadorId: f.jugadorId, neto: f.pago - f.apuesta });
  return { ronda: e.ronda, filas };
}

/**
 * La ronda siguiente, que empieza en `inicio`: la mesa limpia, sin los desconectados y con apuestas abiertas si queda
 * alguien. Sin rebarajar (eso lo hace `nuevaRonda`, que tiene el azar): el zapato no se ve.
 */
function rondaSiguiente(e: EstadoBJ, inicio: number): EstadoBJ {
  const asientos = e.asientos.filter((a) => a.conectado);
  const abierta = asientos.length > 0;
  return {
    ...e,
    ronda: e.ronda + 1,
    manos: [],
    seguros: [],
    bancaMirada: false,
    revelaEn: undefined,
    banca: [],
    ventanasVacias: 0,
    asientos,
    fase: abierta ? "apuestas" : "esperando",
    finFase: abierta ? inicio + BJ.APUESTAS_MS : null,
  };
}

/** Cierra la ronda: pasa a la siguiente (`rondaSiguiente`), que empieza en `inicio`, y rebaraja si hace falta. */
function nuevaRonda(e: EstadoBJ, inicio: number, rng: Rng, eventos: Evento[]): void {
  Object.assign(e, rondaSiguiente(e, inicio));
  if (e.zapato.length < BJ.MIN_ZAPATO) {
    e.zapato = barajar(crearBaraja(BJ.BARAJAS), rng);
    eventos.push({ tipo: "barajado" });
  }
}

/**
 * El estado tal como se ve a la hora `ahora`: lo guardado más lo que el reloj ha traído sin cambiarlo. En `resultado`, antes
 * de `revelacion` se ve la banca (con la carta tapada y sin las que ha pedido) y desde `finFase`, la ronda siguiente.
 */
function aLaVista(e: EstadoBJ, ahora: number): EstadoBJ {
  if (e.fase !== "resultado" || e.finFase === null) return e;
  const revela = revelacion(e);
  if (ahora < revela) return { ...e, fase: "banca", finFase: revela, banca: e.banca.slice(0, 2) };
  if (ahora >= e.finFase) return rondaSiguiente(e, e.finFase);
  return e;
}

/** Abre una ventana de apuestas nueva desde `esperando`. */
function abrirApuestas(e: EstadoBJ, ahora: number): void {
  e.fase = "apuestas";
  e.finFase = ahora + BJ.APUESTAS_MS;
  e.ventanasVacias = 0;
}

function sentar(e: EstadoBJ, jugadorId: JugadorId, apodo: string, ahora: number): Paso<EstadoBJ> {
  const existente = asientoDe(e, jugadorId);
  // Quien ya está sentado y conectado no cambia nada, salvo en una mesa dormida: sentarse la despierta.
  if (existente?.conectado && e.fase !== "esperando") return exito(e);
  if (!existente && e.asientos.length >= BJ.MAX_JUGADORES) return fallo("mesa_llena");
  const s = structuredClone(e);
  if (existente) asientoDe(s, jugadorId)!.conectado = true;
  else s.asientos.push({ jugadorId, apodo, conectado: true });
  if (s.fase === "esperando") abrirApuestas(s, ahora);
  return exito(s);
}

/**
 * Apostar ocupa la casilla libre de número más bajo. Sin `segunda` solo vale si aún no tienes casilla; con ella, solo si
 * ya tienes exactamente una. En `esperando` (mesa dormida) es válido: abre una ventana nueva con esa apuesta.
 */
function apostar(e: EstadoBJ, jugadorId: JugadorId, cantidad: number, segunda: boolean, ahora: number): Paso<EstadoBJ> {
  if (e.fase !== "apuestas" && e.fase !== "esperando") return fallo("fase_incorrecta");
  if (!apuestaValida(cantidad)) return fallo("apuesta_invalida");
  // Quien se fue en esta ronda y volvió ya no juega en ella: ni una apuesta normal ni una segunda casilla.
  if (manosDe(e, jugadorId).some((m) => m.abandonada)) return fallo("accion_invalida");
  const propias = casillasDe(e, jugadorId).length;
  if (propias !== (segunda ? 1 : 0)) return fallo("accion_invalida");
  const casilla = primeraCasillaLibre(e);
  if (casilla === null) return fallo("sin_casilla");
  const s = structuredClone(e);
  const apodo = asientoDe(s, jugadorId)!.apodo;
  s.manos.push({ jugadorId, apodo, casilla, indice: propias, apuesta: cantidad, cartas: [], estado: "jugando", doblada: false, dividida: false, abandonada: false });
  if (s.fase === "esperando") abrirApuestas(s, ahora);
  return exito(s);
}

/** Pedir, plantarse y doblar: solo en decisiones y sobre la mano activa del jugador. */
function decidir(
  e: EstadoBJ,
  jugadorId: JugadorId,
  accion: "pedir" | "plantarse" | "doblar",
  ahora: number,
  rng: Rng,
): Paso<EstadoBJ> {
  if (e.fase !== "decisiones") return fallo("fase_incorrecta");
  const actual = manoActiva(e, jugadorId);
  if (!actual) return fallo("accion_invalida");
  if (accion === "doblar" && actual.cartas.length !== 2) return fallo("accion_invalida");

  const s = structuredClone(e);
  const m = manoActiva(s, jugadorId)!;
  const eventos: Evento[] = [];
  if (accion === "plantarse") {
    m.estado = "plantado";
  } else {
    const carta = robar(s, rng, eventos);
    m.cartas.push(carta);
    eventos.push(cartaDeMano(m, carta));
    const pasado = puntuacion(m.cartas).total > 21;
    if (accion === "doblar") {
      m.apuesta *= 2;
      m.doblada = true;
      m.estado = pasado ? "pasado" : "plantado";
    } else if (pasado) {
      m.estado = "pasado";
    }
  }
  const liquidacion = cerrarDecisiones(s, ahora, rng, eventos);
  return exito(s, eventos, liquidacion);
}

/**
 * Responde al seguro, una vez por jugador y por todas sus manos a la vez. «Sí» guarda lo asegurado (que cobra Mesa antes,
 * con `costo`); «no» solo contesta. Cuando contestan todos, la banca mira en el acto.
 */
function responderSeguro(e: EstadoBJ, jugadorId: JugadorId, tomar: boolean, ahora: number, rng: Rng): Paso<EstadoBJ> {
  if (e.fase !== "seguro") return fallo("fase_incorrecta");
  const coste = costeSeguro(e, jugadorId);
  if (coste === null) return fallo("accion_invalida");
  const s = structuredClone(e);
  const entrada = s.seguros.find((x) => x.jugadorId === jugadorId)!;
  entrada.respondido = true;
  if (tomar) entrada.cantidad = coste;
  const eventos: Evento[] = [];
  const liquidacion = resolverSeguroSiListo(s, ahora, rng, eventos);
  return exito(s, eventos, liquidacion);
}

/**
 * Dividir: solo en decisiones y sobre la mano activa. La segunda carta pasa a una mano nueva, justo detrás, con la misma casilla y
 * apuesta (se renumeran los `indice` del jugador), y cada mitad recibe al momento una carta, primero la original. Con ases se
 * plantan las dos. Cada división alarga la ventana de decisiones. Lo que cuesta (otra apuesta igual) lo cobra Mesa antes.
 */
function dividir(e: EstadoBJ, jugadorId: JugadorId, ahora: number, rng: Rng): Paso<EstadoBJ> {
  if (e.fase !== "decisiones") return fallo("fase_incorrecta");
  if (!puedeDividir(e, manoActiva(e, jugadorId))) return fallo("accion_invalida");

  const s = structuredClone(e);
  const original = manoActiva(s, jugadorId)!;
  const eventos: Evento[] = [{ tipo: "mano_dividida", jugadorId, casilla: original.casilla, indice: original.indice }];
  for (const otra of s.manos) if (otra.jugadorId === jugadorId && otra.indice > original.indice) otra.indice += 1;
  const nueva: ManoBJ = {
    jugadorId,
    apodo: original.apodo,
    casilla: original.casilla,
    indice: original.indice + 1,
    apuesta: original.apuesta,
    cartas: [original.cartas.pop() as Carta],
    estado: "jugando",
    doblada: false,
    dividida: true,
    abandonada: false,
  };
  original.dividida = true;
  s.manos.splice(s.manos.indexOf(original) + 1, 0, nueva);

  for (const mitad of [original, nueva]) {
    const carta = robar(s, rng, eventos);
    mitad.cartas.push(carta);
    eventos.push(cartaDeMano(mitad, carta));
  }
  if (original.cartas[0].valor === "A") {
    original.estado = "plantado";
    nueva.estado = "plantado";
  }
  s.finFase = (s.finFase ?? ahora) + BJ.DIVIDIR_EXTRA_MS;
  const liquidacion = cerrarDecisiones(s, ahora, rng, eventos);
  return exito(s, eventos, liquidacion);
}

/** Rendirse: solo en decisiones y sobre la mano activa si es la primera decisión. La mano deja de jugar y la activa pasa a la siguiente. */
function rendirse(e: EstadoBJ, jugadorId: JugadorId, ahora: number, rng: Rng): Paso<EstadoBJ> {
  if (e.fase !== "decisiones" || !puedeRendirse(manoActiva(e, jugadorId))) return fallo("accion_invalida");
  const s = structuredClone(e);
  const m = manoActiva(s, jugadorId)!;
  m.estado = "rendido";
  const eventos: Evento[] = [{ tipo: "rendido", jugadorId, indice: m.indice }];
  const liquidacion = cerrarDecisiones(s, ahora, rng, eventos);
  return exito(s, eventos, liquidacion);
}

function salir(e: EstadoBJ, jugadorId: JugadorId, ahora: number, rng: Rng): Paso<EstadoBJ> {
  const s = structuredClone(e);
  s.asientos = s.asientos.filter((a) => a.jugadorId !== jugadorId);
  // En `resultado` las manos ya están liquidadas: no hay nada que perder.
  if (s.fase !== "resultado") {
    for (const m of s.manos) {
      if (m.jugadorId !== jugadorId) continue;
      m.abandonada = true;
      if (m.estado === "jugando") m.estado = "plantado";
    }
    // Quien se va no contesta el seguro; si ya lo había cogido, lo pierde con sus manos.
    contestarNo(s, jugadorId);
  }
  if (s.asientos.length > 0) {
    const eventos: Evento[] = [];
    const liquidacion = resolverSeguroSiListo(s, ahora, rng, eventos) ?? cerrarDecisiones(s, ahora, rng, eventos);
    return exito(s, eventos, liquidacion);
  }
  // Se fue el último: no queda nadie para ver la ronda. Se liquida ya (pierden las manos abandonadas) y la mesa duerme.
  const eventos: Evento[] = [];
  const liquidacion = s.manos.length > 0 && s.fase !== "resultado" ? liquidar(s, eventos) : undefined;
  nuevaRonda(s, ahora, rng, eventos);
  return exito(s, eventos, liquidacion);
}

function tick(e: EstadoBJ, ahora: number, rng: Rng): Paso<EstadoBJ> {
  if (e.finFase === null || ahora < e.finFase) return exito(e);
  const s = structuredClone(e);
  const eventos: Evento[] = [];
  switch (s.fase) {
    case "esperando":
      return exito(e);
    case "seguro": {
      // Quien no ha contestado cuenta como «no».
      for (const x of s.seguros) x.respondido = true;
      const liquidacion = bancaMira(s, ahora, rng, eventos, esperaDeLaMirada(0, false));
      return exito(s, eventos, liquidacion);
    }
    case "apuestas":
      if (s.manos.length > 0) {
        s.ventanasVacias = 0;
        const liquidacion = repartir(s, ahora, rng, eventos);
        return exito(s, eventos, liquidacion);
      } else {
        // Nadie apostó. Se retiran los desconectados y, si no queda nadie o ya van varias ventanas vacías seguidas,
        // la mesa se duerme (sin alarma) hasta que alguien se siente o apueste; si no, otra ventana.
        s.asientos = s.asientos.filter((a) => a.conectado);
        s.ventanasVacias = s.asientos.length > 0 ? s.ventanasVacias + 1 : 0;
        if (s.asientos.length > 0 && s.ventanasVacias < MAX_VENTANAS_VACIAS) {
          s.finFase = ahora + BJ.APUESTAS_MS;
        } else {
          s.fase = "esperando";
          s.finFase = null;
        }
      }
      return exito(s, eventos);
    case "decisiones": {
      // Quien no ha decidido se planta (lo hace `jugarBanca`) y juega la banca.
      const liquidacion = cerrarRonda(s, ahora, rng, eventos);
      return exito(s, eventos, liquidacion);
    }
    case "banca": {
      // Solo en una mesa guardada por una versión anterior, con la banca aún sin jugar: juega y se ve ya.
      const liquidacion = jugarBanca(s, ahora, rng, eventos, 0);
      return exito(s, eventos, liquidacion);
    }
    case "resultado": {
      // La ronda siguiente ya se ve desde `finFase` (`aLaVista`) y el reloj la anunció: se aplica sin prisa, con la siguiente
      // escritura que haya. Empieza a su hora y no a la del tick, para que sea la misma que se ha visto.
      nuevaRonda(s, e.finFase, rng, eventos);
      if (s.finFase !== null && ahora >= s.finFase) {
        // También ha vencido su ventana de apuestas: eso sí cambia el estado, como siempre.
        const despues = tick(s, ahora, rng);
        if (despues.ok && despues.estado !== s) return despues;
      }
      return { ok: true, estado: s, eventos, anunciado: true };
    }
  }
}

function desconectar(e: EstadoBJ, jugadorId: JugadorId, ahora: number, rng: Rng): Paso<EstadoBJ> {
  if (!asientoDe(e, jugadorId)) return exito(e);
  const s = structuredClone(e);
  asientoDe(s, jugadorId)!.conectado = false;
  if (s.fase === "esperando") {
    // Mesa dormida: no hay ronda que respetar, no se dejan asientos fantasma.
    s.asientos = s.asientos.filter((a) => a.jugadorId !== jugadorId);
    return exito(s);
  }
  if (s.fase === "decisiones") {
    for (const m of s.manos) if (m.jugadorId === jugadorId && m.estado === "jugando") m.estado = "plantado";
  }
  // En el seguro, irse es contestar «no» (sus manos se plantan cuando empiecen las decisiones).
  contestarNo(s, jugadorId);
  const eventos: Evento[] = [];
  const liquidacion = resolverSeguroSiListo(s, ahora, rng, eventos) ?? cerrarDecisiones(s, ahora, rng, eventos);
  return exito(s, eventos, liquidacion);
}

/** Lo que ha asegurado el jugador, o `null` si no ha cogido seguro. */
function aseguradoPor(e: EstadoBJ, jugadorId: JugadorId | null): number | null {
  const cantidad = e.seguros.find((s) => s.jugadorId === jugadorId)?.cantidad ?? 0;
  return cantidad > 0 ? cantidad : null;
}

/** Lo que pudo guardar una versión anterior: manos sin `casilla`, `indice` ni `dividida`, y un estado sin `seguros` ni `bancaMirada`. */
type ManoAntigua = Omit<ManoBJ, "casilla" | "indice" | "dividida"> & Partial<Pick<ManoBJ, "casilla" | "indice" | "dividida">>;
type EstadoAntiguo = Omit<EstadoBJ, "manos" | "seguros" | "bancaMirada"> & Partial<Pick<EstadoBJ, "seguros" | "bancaMirada">> & { manos: ManoAntigua[] };

/**
 * Pone al día un estado guardado antes de las casillas, el seguro y dividir (las mesas ya desplegadas): rellena lo que no
 * existía. Las manos sin `casilla` toman la casilla libre de número más bajo por orden de aparición, como al apostar; sin
 * `indice`, su orden entre las manos del jugador; sin `dividida`, `false`. Sin `seguros`, ninguno; sin `bancaMirada`, `false`
 * (la banca no miraba, así que solo afecta a si se enseña su carta tapada). Un estado que ya está al día queda igual.
 */
function normalizar(e: EstadoBJ): EstadoBJ {
  const antiguo: EstadoAntiguo = e;
  const ocupadas = new Set(antiguo.manos.flatMap((m) => (m.casilla === undefined ? [] : [m.casilla])));
  const casillaLibre = (): number => {
    let casilla = 0;
    while (ocupadas.has(casilla)) casilla += 1;
    ocupadas.add(casilla);
    return casilla;
  };
  const previas = new Map<JugadorId, number>();
  const manos = antiguo.manos.map((m): ManoBJ => {
    const delJugador = previas.get(m.jugadorId) ?? 0;
    previas.set(m.jugadorId, delJugador + 1);
    return { ...m, casilla: m.casilla ?? casillaLibre(), indice: m.indice ?? delJugador, dividida: m.dividida ?? false };
  });
  return { ...antiguo, manos, seguros: antiguo.seguros ?? [], bancaMirada: antiguo.bancaMirada ?? false };
}

/** Lo que ve `jugadorId` a la hora `ahora` (ver `aLaVista`): ni el zapato ni lo que la banca aún no ha enseñado. */
function vista(guardado: EstadoBJ, jugadorId: JugadorId | null, ahora: number): VistaBJ {
  const e = aLaVista(guardado, ahora);
  // La carta tapada no sale del servidor hasta que se gira (evento `carta_girada`): en `resultado`, o cuando la banca mira
  // y tiene blackjack. Ante cualquier otro caso, tapada: las fases nuevas no pueden filtrarla por descuido.
  const girada = e.fase === "resultado" || (e.bancaMirada && esBlackjack(e.banca));
  const visibles = girada ? e.banca : e.banca.slice(0, 1);
  return {
    ronda: e.ronda,
    fase: e.fase,
    finFase: e.finFase,
    banca: e.banca.map((carta, i) => (!girada && i > 0 ? null : { ...carta })),
    totalBanca: visibles.length > 0 ? puntuacion(visibles).total : null,
    manos: porCasilla(e.manos).map(({ abandonada: _abandonada, ...m }) => ({
      ...m,
      cartas: m.cartas.map((carta) => ({ ...carta })),
      total: puntuacion(m.cartas).total,
    })),
    sentados: e.asientos.map((a) => a.apodo),
    yo: jugadorId,
    opciones: jugadorId === null ? null : opcionesDe(e, jugadorId),
    miSeguro: aseguradoPor(e, jugadorId),
    casillasLibres: casillasLibres(e),
  };
}

export const blackjack: Juego<EstadoBJ, AccionBJ> = {
  id: "blackjack",
  maxJugadores: BJ.MAX_JUGADORES,

  crear(_ahora, rng) {
    return {
      ronda: 1,
      fase: "esperando",
      finFase: null,
      zapato: barajar(crearBaraja(BJ.BARAJAS), rng),
      banca: [],
      asientos: [],
      manos: [],
      seguros: [],
      bancaMirada: false,
      ventanasVacias: 0,
    };
  },

  normalizar,

  sentar,

  /** Se calcula sobre el estado ANTERIOR a `aplicar`: doblar y dividir cuestan la apuesta de la mano activa (al doblar, la original, no el doble). */
  costo(e, jugadorId, accion) {
    if (accion.t === "apostar") return apuestaValida(accion.cantidad) ? accion.cantidad : 0;
    if (accion.t === "doblar" || accion.t === "dividir") return manoActiva(e, jugadorId)?.apuesta ?? 0;
    if (accion.t === "seguro") return accion.tomar === true ? costeSeguro(e, jugadorId) ?? 0 : 0;
    return 0;
  },

  aplicar(e, jugadorId, accion, ahora, rng) {
    if (!asientoDe(e, jugadorId)) return fallo("no_sentado");
    switch (accion.t) {
      case "apostar":
        return apostar(e, jugadorId, accion.cantidad, accion.segunda === true, ahora);
      case "pedir":
      case "plantarse":
      case "doblar":
        return decidir(e, jugadorId, accion.t, ahora, rng);
      case "seguro":
        return typeof accion.tomar === "boolean" ? responderSeguro(e, jugadorId, accion.tomar, ahora, rng) : fallo("mensaje_invalido");
      case "rendirse":
        return rendirse(e, jugadorId, ahora, rng);
      case "dividir":
        return dividir(e, jugadorId, ahora, rng);
      case "salir":
        return salir(e, jugadorId, ahora, rng);
      default:
        return fallo("mensaje_invalido");
    }
  },

  desconectar,

  tick,

  /**
   * El fin de la fase. En `resultado`, el de la ventana de apuestas siguiente: la jugada de la banca y la ronda nueva las
   * enseña el reloj sin cambiar el estado (`proximoAviso`), y la alarma solo hace falta si nadie apuesta.
   */
  proximaAlarma(e) {
    return e.fase === "resultado" && e.finFase !== null ? e.finFase + BJ.APUESTAS_MS : e.finFase;
  },

  /** En `resultado`, la banca enseña su jugada (`revelacion`) y, al acabar, empieza la ronda siguiente. */
  proximoAviso(e, desde) {
    if (e.fase !== "resultado" || e.finFase === null) return null;
    return [revelacion(e), e.finFase].find((instante) => instante > desde) ?? null;
  },

  eventosEntre(e, desde, hasta) {
    if (e.fase !== "resultado" || e.finFase === null) return [];
    const dentro = (instante: number) => desde < instante && instante <= hasta;
    const eventos: Evento[] = [];
    if (dentro(revelacion(e))) eventos.push(...eventosDeLaBanca(e));
    // La ronda siguiente rebaraja con menos de `BJ.MIN_ZAPATO` cartas (lo hará `nuevaRonda` al aplicarla).
    if (dentro(e.finFase) && e.zapato.length < BJ.MIN_ZAPATO) eventos.push({ tipo: "barajado" });
    return eventos;
  },

  vista,

  /** Lo que se ve a esa hora (`aLaVista`). La banca dura un instante: la sala sigue con lo que enseñaba (`null`). */
  resumen(guardado, ahora): ResumenMesa | null {
    const e = aLaVista(guardado, ahora);
    if (e.fase === "banca") return null;
    return { jugadores: e.asientos.map((a) => a.apodo), fase: e.fase, finFase: e.finFase };
  },
};
