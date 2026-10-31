import { barajar, crearBaraja, type Carta, type Rng } from "../cartas";
import { calcularBotes, repartirBote, type Aporte, type Bote } from "./poker-botes";
import { compararJugadas, mejorJugada, type Jugada } from "./poker-jugadas";
import type { CodigoError, Evento, Juego, JugadorId, LiquidacionPaso, Paso, ResumenMesa } from "./tipos";

export const POKER = {
  MAX_JUGADORES: 8,
  MIN_JUGADORES: 2,
  CIEGA_PEQUENA: 5,
  CIEGA_GRANDE: 10,
  COMPRA_MIN: 10,
  TURNO_MS: 20_000,
  RESULTADO_MS: 6_000,
  /** Lo que tarda la pantalla en enseñar cada carta o grupo de cartas de la mesa que sale sin apuestas de por medio. */
  CALLE_MS: 900,
  SOLO_MS: 600_000,
  FALTAS_MAX: 2,
} as const;

// ---------------------------------------------------------------------------
// Máquina de estados de la mesa
//
// Mismas convenciones que `blackjack.ts`: todo es puro (el tiempo entra por `ahora` y el azar por `rng`), el estado es
// JSON plano y cada transición trabaja sobre un clon (`structuredClone`) y devuelve un estado nuevo; un no-op devuelve
// el mismo objeto de entrada. Convención de la baraja: `baraja[0]` es la siguiente carta que sale.
//
// Las fichas de la mesa se cobran al sentarse y vuelven al levantarse (spec §3). Durante las manos solo se mueven aquí, y
// en todo momento los montones, lo añadido pendiente, lo aportado a la mano y `abandonos` suman lo comprado menos lo pagado.
// ---------------------------------------------------------------------------

export type AccionPoker =
  | { t: "sentarse"; fichas: number }
  | { t: "anadir"; fichas: number }
  | { t: "levantarse" }
  | { t: "salir" }
  | { t: "retirarse" }
  | { t: "pasar" }
  | { t: "igualar" }
  | { t: "subir"; hasta: number }
  | { t: "ensenar" };

export interface OpcionesPoker {
  retirarse: boolean;
  pasar: boolean;
  /** Lo que cuesta igualar (con all-in, lo que te quede), o `null` si no toca. */
  igualar: number | null;
  /** Entre qué totales puedes subir, o `null` si no puedes. */
  subir: { min: number; max: number } | null;
  ensenar: boolean;
}

export type FasePoker = "esperando" | "mano" | "resultado";
export type Calle = "preflop" | "flop" | "turn" | "river";
/** `fuera`: está sentado, pero no juega esta mano. */
export type EstadoAsiento = "fuera" | "juega" | "allin" | "retirado";

export interface AsientoPoker {
  /** Del 0 al `POKER.MAX_JUGADORES - 1`. `EstadoPoker.asientos` va siempre ordenado por este número. */
  asiento: number;
  jugadorId: JugadorId;
  apodo: string;
  /** La ronda del libro de fichas en la que se cobra y se liquida todo lo de esta sentada. */
  sesion: number;
  /** Todo lo cobrado en esta sesión. */
  comprado: number;
  fichas: number;
  /** Lo añadido que entra en `fichas` al empezar la mano siguiente. */
  porEntrar: number;
  conectado: boolean;
  faltas: number;
  cartas: Carta[];
  ensenadas: boolean;
  estado: EstadoAsiento;
  /** Lo puesto en la ronda de apuestas en curso; también cuenta en `aportado`. */
  apostado: number;
  /** Lo puesto en toda la mano. */
  aportado: number;
  /** Ya ha hablado desde la última subida completa. */
  actuo: boolean;
  /** Un all-in corto no reabre las apuestas: quien ya había actuado solo puede igualar o retirarse. */
  puedeSubir: boolean;
}

export interface EstadoPoker {
  /** El número de mano: 0 hasta que empieza la primera. */
  ronda: number;
  fase: FasePoker;
  calle: Calle | null;
  /** Cuándo vence el turno, el `resultado` o la espera de quien está solo; `null` si no hay nada que vencer. */
  finFase: number | null;
  /** Nunca sale del servidor. */
  baraja: Carta[];
  mesa: Carta[];
  asientos: AsientoPoker[];
  /** El número de asiento del botón. Se conserva entre manos para pasarlo al siguiente. */
  boton: number | null;
  /** El número de asiento que tiene la palabra. */
  turno: number | null;
  /** Lo que hay que tener apostado en esta ronda para seguir. */
  apuesta: number;
  subidaMinima: number;
  /** El número de asiento de quien hizo la última apuesta o subida de la ronda. */
  ultimoAgresor: number | null;
  siguienteSesion: number;
  /** Lo que dejaron en la mano quienes se levantaron a mitad. */
  abandonos: { jugadorId: JugadorId; aportado: number }[];
  /** Los botes que se enseñan en `resultado`; durante la mano, la vista los calcula. */
  botes: Bote[];
}

export interface AsientoVista {
  asiento: number;
  jugadorId: JugadorId;
  apodo: string;
  fichas: number;
  apostado: number;
  estado: EstadoAsiento;
  conectado: boolean;
  boton: boolean;
  /** Sigue en la mano: la pantalla le pinta dos cartas boca abajo. */
  tieneCartas: boolean;
  /** Las que haya enseñado. */
  cartas: Carta[] | null;
}

export interface VistaPoker {
  ronda: number;
  fase: FasePoker;
  calle: Calle | null;
  finFase: number | null;
  mesa: Carta[];
  botes: Bote[];
  turno: JugadorId | null;
  asientos: AsientoVista[];
  asientosLibres: number;
  yo: JugadorId | null;
  misCartas: Carta[] | null;
  opciones: OpcionesPoker | null;
  porEntrar: number;
}

function exito(estado: EstadoPoker, eventos: Evento[] = [], liquidacion?: LiquidacionPaso): Paso<EstadoPoker> {
  return liquidacion ? { ok: true, estado, eventos, liquidacion } : { ok: true, estado, eventos };
}

function fallo(error: CodigoError): Paso<EstadoPoker> {
  return { ok: false, error };
}

const asientoDe = (e: EstadoPoker, jugadorId: JugadorId) => e.asientos.find((a) => a.jugadorId === jugadorId);
const sigueEnLaMano = (a: AsientoPoker) => a.estado === "juega" || a.estado === "allin";
const vivos = (e: EstadoPoker) => e.asientos.filter(sigueEnLaMano);
const puedeJugar = (a: AsientoPoker) => a.conectado && a.fichas + a.porEntrar > 0;

/** Los asientos a partir del siguiente a `numero`, dando la vuelta a la mesa: el propio `numero`, si está ocupado, va el último. */
const asientosDesde = (e: EstadoPoker, numero: number): AsientoPoker[] => [...e.asientos.filter((a) => a.asiento > numero), ...e.asientos.filter((a) => a.asiento <= numero)];

/** Una compra válida: un entero seguro desde `POKER.COMPRA_MIN`. No hay tope: lo que no tengas lo rechaza el cobro. */
const compraValida = (cantidad: unknown): cantidad is number => Number.isSafeInteger(cantidad) && (cantidad as number) >= POKER.COMPRA_MIN;

/** Pasa fichas del montón a la apuesta. Sin más fichas, va all-in. */
function poner(a: AsientoPoker, cantidad: number): void {
  a.fichas -= cantidad;
  a.apostado += cantidad;
  a.aportado += cantidad;
  if (a.fichas === 0) a.estado = "allin";
}

const tieneRivalConFichas = (e: EstadoPoker, a: AsientoPoker) => e.asientos.some((otro) => otro !== a && otro.estado === "juega");

/**
 * Hasta dónde tiene que llegar `a` para seguir en la mano: la apuesta de la ronda. Sin rivales con fichas, solo lo que puso
 * el mayor all-in: lo demás (una ciega que no se llegó a poner entera, la apuesta de quien se levantó) no lo disputa nadie.
 */
function apuestaAIgualar(e: EstadoPoker, a: AsientoPoker): number {
  if (tieneRivalConFichas(e, a)) return e.apuesta;
  return Math.max(0, ...e.asientos.filter((otro) => otro !== a && sigueEnLaMano(otro)).map((otro) => otro.apostado));
}

/**
 * Tiene que hablar quien juega y no ha igualado, o quien aún no ha hablado si queda alguien que le pueda responder.
 * Sin esa condición, con los demás all-in habría que esperar a que pasara el único que aún tiene fichas.
 */
function debeHablar(e: EstadoPoker, a: AsientoPoker): boolean {
  if (a.estado !== "juega") return false;
  return a.apostado < apuestaAIgualar(e, a) || (!a.actuo && tieneRivalConFichas(e, a));
}

/** Entre qué totales puede subir: hasta todas sus fichas, y desde una subida completa o, si no le llega, solo all-in. */
function rangoDeSubida(e: EstadoPoker, a: AsientoPoker): OpcionesPoker["subir"] {
  const max = a.apostado + a.fichas;
  if (!a.puedeSubir || max <= e.apuesta || !tieneRivalConFichas(e, a)) return null;
  return { min: Math.min(e.apuesta + e.subidaMinima, max), max };
}

/** Lo que permiten las reglas al jugador ahora mismo, o `null` si no está sentado. */
export function opcionesDe(e: EstadoPoker, jugadorId: JugadorId): OpcionesPoker | null {
  const a = asientoDe(e, jugadorId);
  if (a === undefined) return null;
  if (e.fase !== "mano" || e.turno !== a.asiento) {
    const ensenar = e.fase === "resultado" && a.cartas.length > 0 && !a.ensenadas;
    return { retirarse: false, pasar: false, igualar: null, subir: null, ensenar };
  }
  const porIgualar = apuestaAIgualar(e, a) - a.apostado;
  return {
    retirarse: true,
    pasar: porIgualar === 0,
    igualar: porIgualar === 0 ? null : Math.min(porIgualar, a.fichas),
    subir: rangoDeSubida(e, a),
    ensenar: false,
  };
}

const CALLES_SIGUIENTES: Partial<Record<Calle, { calle: Calle; cartas: number }>> = {
  preflop: { calle: "flop", cartas: 3 },
  flop: { calle: "turn", cartas: 1 },
  turn: { calle: "river", cartas: 1 },
};

/** Quema una carta, abre las de la calle siguiente y empieza otra ronda de apuestas. */
function abrirCalle(e: EstadoPoker, siguiente: { calle: Calle; cartas: number }, eventos: Evento[]): void {
  e.baraja.shift();
  const cartas = e.baraja.splice(0, siguiente.cartas);
  e.mesa.push(...cartas);
  e.calle = siguiente.calle;
  e.apuesta = 0;
  e.subidaMinima = POKER.CIEGA_GRANDE;
  e.ultimoAgresor = null;
  for (const a of e.asientos) {
    a.apostado = 0;
    a.actuo = false;
    a.puedeSubir = true;
  }
  eventos.push({ tipo: "calle_abierta", calle: siguiente.calle, cartas });
}

/** Lo que ha puesto cada uno en la mano, también quienes ya se levantaron; `cuanto` dice qué parte cuenta. */
function aportesDe(e: EstadoPoker, cuanto: (a: AsientoPoker) => number): Aporte[] {
  const aportes: Aporte[] = e.asientos.filter((a) => a.estado !== "fuera").map((a) => ({ jugadorId: a.jugadorId, aportado: cuanto(a), vivo: sigueEnLaMano(a) }));
  for (const { jugadorId, aportado } of e.abandonos) aportes.push({ jugadorId, aportado, vivo: false });
  return aportes;
}

/** Las calles que aún no han salido, en orden. */
function callesPorAbrir(e: EstadoPoker): { calle: Calle; cartas: number }[] {
  const calles: { calle: Calle; cartas: number }[] = [];
  for (let c = e.calle === null ? undefined : CALLES_SIGUIENTES[e.calle]; c !== undefined; c = CALLES_SIGUIENTES[c.calle]) calles.push(c);
  return calles;
}

/** Quienes siguen en la mano en el orden de enseñar: desde quien hizo la última apuesta de la ronda o, sin ella, desde la izquierda del botón. */
function ordenAlEnsenar(e: EstadoPoker): AsientoPoker[] {
  const anterior = e.ultimoAgresor === null ? (e.boton as number) : e.ultimoAgresor - 1;
  return asientosDesde(e, anterior).filter(sigueEnLaMano);
}

function ensenarCartas(a: AsientoPoker, eventos: Evento[]): void {
  a.ensenadas = true;
  eventos.push({ tipo: "cartas_ensenadas", jugadorId: a.jugadorId, cartas: a.cartas });
}

const jugadaDe = (e: EstadoPoker, a: AsientoPoker): Jugada => mejorJugada([...a.cartas, ...e.mesa]) as Jugada;

/** Quienes se llevan un bote, ordenados desde la izquierda del botón: de ahí sale quién cobra la ficha impar. Sin rival no se compara nada. */
function ganadoresDe(e: EstadoPoker, bote: Bote): JugadorId[] {
  const aspirantes = asientosDesde(e, e.boton as number).filter((a) => bote.jugadores.includes(a.jugadorId));
  if (aspirantes.length === 1) return [aspirantes[0].jugadorId];
  const jugadas = aspirantes.map((a) => ({ jugadorId: a.jugadorId, jugada: jugadaDe(e, a) }));
  const mejor = jugadas.reduce((m, x) => (compararJugadas(x.jugada, m) > 0 ? x.jugada : m), jugadas[0].jugada);
  return jugadas.filter((x) => compararJugadas(x.jugada, mejor) === 0).map((x) => x.jugadorId);
}

/** Se enseña la mano que gana algún bote y la que gana o empata con la mejor enseñada hasta entonces; las demás, no. */
function ensenarAlComparar(e: EstadoPoker, ganadores: Set<JugadorId>, eventos: Evento[]): void {
  let mejor: Jugada | null = null;
  for (const a of ordenAlEnsenar(e)) {
    const jugada = jugadaDe(e, a);
    const alcanza = mejor === null || compararJugadas(jugada, mejor) >= 0;
    if (alcanza) mejor = jugada;
    if (alcanza || ganadores.has(a.jugadorId)) ensenarCartas(a, eventos);
  }
}

/**
 * Acaba la mano y paga. Lo que nadie iguala vuelve antes de nada. Si solo queda uno, gana sin enseñar. Si aún faltan cartas
 * de la mesa es que ya no hay más apuestas posibles: se destapan todos y `resultado` se alarga para que dé tiempo a verlas salir.
 * Tras el river, solo se enseña lo que marca `ensenarAlComparar`, aunque alguien esté all-in: no queda nada por destapar.
 */
function cerrarMano(e: EstadoPoker, ahora: number, eventos: Evento[]): void {
  const { botes, devuelto } = calcularBotes(aportesDe(e, (a) => a.aportado));
  if (devuelto !== null) {
    asientoDe(e, devuelto.jugadorId)!.fichas += devuelto.cantidad;
    eventos.push({ tipo: "bote_devuelto", ...devuelto });
  }

  const hayRivales = vivos(e).length > 1;
  const porAbrir = hayRivales ? callesPorAbrir(e) : [];
  if (porAbrir.length > 0) for (const a of ordenAlEnsenar(e)) ensenarCartas(a, eventos);
  for (const calle of porAbrir) abrirCalle(e, calle, eventos);

  const ganadores = botes.map((bote) => ganadoresDe(e, bote));
  if (hayRivales && porAbrir.length === 0) ensenarAlComparar(e, new Set(ganadores.flat()), eventos);
  botes.forEach((bote, indiceBote) => {
    for (const { jugadorId, cantidad } of repartirBote(bote.cantidad, ganadores[indiceBote])) {
      if (cantidad === 0) continue;
      asientoDe(e, jugadorId)!.fichas += cantidad;
      eventos.push({ tipo: "bote_ganado", jugadorId, cantidad, indiceBote });
    }
  });

  for (const a of e.asientos) {
    a.apostado = 0;
    a.aportado = 0;
  }
  e.abandonos = [];
  e.botes = botes;
  e.fase = "resultado";
  e.turno = null;
  e.finFase = ahora + POKER.RESULTADO_MS + POKER.CALLE_MS * porAbrir.length;
}

/**
 * Da la palabra al siguiente después del asiento `desde`. Si nadie tiene que hablar, se abre la calle siguiente; la mano
 * acaba tras el river, si solo queda uno o si ya nadie puede apostar a nadie.
 */
function darTurno(e: EstadoPoker, desde: number, ahora: number, eventos: Evento[]): void {
  if (vivos(e).length <= 1) return cerrarMano(e, ahora, eventos);
  let origen = desde;
  for (;;) {
    const siguiente = asientosDesde(e, origen).find((a) => debeHablar(e, a));
    if (siguiente !== undefined) {
      e.turno = siguiente.asiento;
      e.finFase = ahora + POKER.TURNO_MS;
      return;
    }
    const calle = e.calle === null ? undefined : CALLES_SIGUIENTES[e.calle];
    if (calle === undefined || e.asientos.filter((a) => a.estado === "juega").length <= 1) return cerrarMano(e, ahora, eventos);
    abrirCalle(e, calle, eventos);
    origen = e.boton as number;
  }
}

/** Quien no llega a la ciega la pone con lo que tenga. La apuesta de la ronda sigue siendo la ciega grande. */
function ponerCiega(a: AsientoPoker, ciega: number, eventos: Evento[]): void {
  const cantidad = Math.min(ciega, a.fichas);
  poner(a, cantidad);
  eventos.push({ tipo: "ciega", jugadorId: a.jugadorId, cantidad });
}

/** Lo añadido entra en los montones, juegan quienes están conectados y con fichas, y se ponen las ciegas y se reparte. */
function empezarMano(e: EstadoPoker, ahora: number, rng: Rng, eventos: Evento[]): void {
  e.ronda += 1;
  e.fase = "mano";
  e.calle = "preflop";
  e.baraja = barajar(crearBaraja(), rng);
  e.mesa = [];
  e.botes = [];
  e.apuesta = POKER.CIEGA_GRANDE;
  e.subidaMinima = POKER.CIEGA_GRANDE;
  e.ultimoAgresor = null;
  for (const a of e.asientos) {
    a.estado = puedeJugar(a) ? "juega" : "fuera";
    a.fichas += a.porEntrar;
    a.porEntrar = 0;
    a.cartas = [];
    a.ensenadas = false;
    a.apostado = 0;
    a.actuo = false;
    a.puedeSubir = true;
  }

  const juegan = (a: AsientoPoker) => a.estado === "juega";
  const boton = e.boton === null ? e.asientos.find(juegan)! : asientosDesde(e, e.boton).find(juegan)!;
  e.boton = boton.asiento;
  eventos.push({ tipo: "mano_empezada", ronda: e.ronda, boton: boton.asiento });

  // Desde la izquierda del botón: el botón, el último. Se calcula antes de las ciegas, que pueden dejar a alguien all-in.
  const jugadores = asientosDesde(e, boton.asiento).filter(juegan);
  const [pequena, grande] = jugadores.length === 2 ? [boton, jugadores[0]] : jugadores;
  ponerCiega(pequena, POKER.CIEGA_PEQUENA, eventos);
  ponerCiega(grande, POKER.CIEGA_GRANDE, eventos);

  for (let vuelta = 0; vuelta < 2; vuelta++) {
    for (const a of jugadores) {
      a.cartas.push(e.baraja.shift() as Carta);
      // Los eventos son iguales para todos: cada uno ve sus cartas en `misCartas`.
      eventos.push({ tipo: "carta_repartida", a: a.jugadorId });
    }
  }
  darTurno(e, grande.asiento, ahora, eventos);
}

/** El asiento libre de número más bajo, o `null` si no queda ninguno. */
function primerAsientoLibre(e: EstadoPoker): number | null {
  for (let asiento = 0; asiento < POKER.MAX_JUGADORES; asiento++) if (!e.asientos.some((a) => a.asiento === asiento)) return asiento;
  return null;
}

/** En `esperando`, quien está solo tiene `POKER.SOLO_MS` para encontrar rival; sin nadie, la mesa duerme, sin alarmas. */
function esperarRival(e: EstadoPoker, ahora: number): void {
  e.finFase = e.asientos.length === 0 ? null : (e.finFase ?? ahora + POKER.SOLO_MS);
}

function sentarse(e: EstadoPoker, jugadorId: JugadorId, fichas: number, ahora: number, rng: Rng, apodo: string | undefined): Paso<EstadoPoker> {
  if (asientoDe(e, jugadorId)) return fallo("accion_invalida");
  if (!compraValida(fichas)) return fallo("apuesta_invalida");
  const asiento = primerAsientoLibre(e);
  if (asiento === null) return fallo("sin_asiento");
  // `Mesa` siempre lo pasa: mejor un error que un asiento sin nombre.
  if (apodo === undefined) return fallo("no_disponible");

  const s = structuredClone(e);
  const a: AsientoPoker = {
    asiento,
    jugadorId,
    apodo,
    sesion: s.siguienteSesion,
    comprado: fichas,
    fichas,
    porEntrar: 0,
    conectado: true,
    faltas: 0,
    cartas: [],
    ensenadas: false,
    estado: "fuera",
    apostado: 0,
    aportado: 0,
    actuo: false,
    puedeSubir: true,
  };
  s.asientos.splice(s.asientos.filter((x) => x.asiento < asiento).length, 0, a);
  s.siguienteSesion += 1;

  const eventos: Evento[] = [];
  if (s.fase === "esperando") {
    if (s.asientos.filter(puedeJugar).length >= POKER.MIN_JUGADORES) empezarMano(s, ahora, rng, eventos);
    else esperarRival(s, ahora);
  }
  return exito(s, eventos);
}

function anadir(e: EstadoPoker, jugadorId: JugadorId, fichas: number): Paso<EstadoPoker> {
  if (!compraValida(fichas)) return fallo("apuesta_invalida");
  const s = structuredClone(e);
  const a = asientoDe(s, jugadorId)!;
  a.comprado += fichas;
  a.porEntrar += fichas;
  a.faltas = 0;
  return exito(s);
}

/** Todo lo que paga el libro de fichas al cerrar la sesión de `a`: lo que tenga en la mesa más lo añadido que aún no había entrado. */
const liquidacionDe = (a: AsientoPoker): LiquidacionPaso => ({ ronda: a.sesion, filas: [{ jugadorId: a.jugadorId, apuesta: a.comprado, pago: a.fichas + a.porEntrar }] });

/**
 * Levantarse liquida la sesión: vuelve lo que tenga en la mesa más lo añadido que aún no había entrado, y lo aportado a la
 * mano se queda en ella. Quien seguía en la mano se retira. Si con eso quien tiene la palabra ya no tiene a quién responder,
 * o se ha ido él, sigue el juego.
 */
function levantarse(e: EstadoPoker, jugadorId: JugadorId, ahora: number): Paso<EstadoPoker> {
  if (!asientoDe(e, jugadorId)) return exito(e);
  const s = structuredClone(e);
  const a = asientoDe(s, jugadorId)!;
  const liquidacion = liquidacionDe(a);
  if (a.aportado > 0) s.abandonos.push({ jugadorId, aportado: a.aportado });
  s.asientos = s.asientos.filter((x) => x !== a);

  const eventos: Evento[] = [];
  if (s.fase === "esperando") esperarRival(s, ahora);
  if (s.fase === "mano" && sigueEnLaMano(a)) {
    eventos.push({ tipo: "accion", jugadorId, accion: "retirarse", cantidad: 0 });
    const conTurno = s.asientos.find((x) => x.asiento === s.turno);
    if (vivos(s).length <= 1 || conTurno === undefined || !debeHablar(s, conTurno)) darTurno(s, s.turno as number, ahora, eventos);
  }
  return exito(s, eventos, liquidacion);
}

type Decision = Extract<AccionPoker, { t: "retirarse" | "pasar" | "igualar" | "subir" }>;

/** Una subida. Si es completa reabre las apuestas; un all-in corto no cambia la subida mínima ni reabre a quien ya actuó. */
function subir(e: EstadoPoker, a: AsientoPoker, hasta: number): void {
  const subida = hasta - e.apuesta;
  const completa = subida >= e.subidaMinima;
  for (const otro of e.asientos) {
    if (otro === a) continue;
    if (completa) {
      otro.actuo = false;
      otro.puedeSubir = true;
    } else if (otro.actuo) {
      otro.puedeSubir = false;
    }
  }
  if (completa) e.subidaMinima = subida;
  poner(a, hasta - a.apostado);
  e.apuesta = hasta;
  e.ultimoAgresor = a.asiento;
}

/** `faltas`, con las que se queda: decidir por tu cuenta las borra, y solo el tiempo que se acaba las suma. */
function decidir(e: EstadoPoker, jugadorId: JugadorId, accion: Decision, ahora: number, faltas = 0): Paso<EstadoPoker> {
  if (e.fase !== "mano") return fallo("fase_incorrecta");
  if (e.turno !== asientoDe(e, jugadorId)!.asiento) return fallo("accion_invalida");
  const opciones = opcionesDe(e, jugadorId)!;
  if (accion.t === "pasar" && !opciones.pasar) return fallo("accion_invalida");
  if (accion.t === "igualar" && opciones.igualar === null) return fallo("accion_invalida");
  if (accion.t === "subir") {
    const { subir: rango } = opciones;
    if (rango === null || !Number.isSafeInteger(accion.hasta) || accion.hasta < rango.min || accion.hasta > rango.max) return fallo("apuesta_invalida");
  }

  const s = structuredClone(e);
  const a = asientoDe(s, jugadorId)!;
  const antes = a.fichas;
  if (accion.t === "retirarse") a.estado = "retirado";
  if (accion.t === "igualar") poner(a, opciones.igualar!);
  if (accion.t === "subir") subir(s, a, accion.hasta);
  a.actuo = true;
  a.faltas = faltas;

  const eventos: Evento[] = [{ tipo: "accion", jugadorId, accion: a.estado === "allin" ? "allin" : accion.t, cantidad: antes - a.fichas }];
  darTurno(s, a.asiento, ahora, eventos);
  return exito(s, eventos);
}

function ensenar(e: EstadoPoker, jugadorId: JugadorId): Paso<EstadoPoker> {
  if (e.fase !== "resultado") return fallo("fase_incorrecta");
  if (!opcionesDe(e, jugadorId)!.ensenar) return fallo("accion_invalida");
  const s = structuredClone(e);
  const a = asientoDe(s, jugadorId)!;
  a.faltas = 0;
  const eventos: Evento[] = [];
  ensenarCartas(a, eventos);
  return exito(s, eventos);
}

/** Se acabó el tiempo de quien tiene la palabra: pasa si puede y si no, se retira. Cuenta como una falta. */
function agotarTurno(e: EstadoPoker, ahora: number): Paso<EstadoPoker> {
  const a = e.asientos.find((x) => x.asiento === e.turno)!;
  return decidir(e, a.jugadorId, { t: opcionesDe(e, a.jugadorId)!.pasar ? "pasar" : "retirarse" }, ahora, a.faltas + 1);
}

const noSigue = (a: AsientoPoker) => !a.conectado || a.faltas >= POKER.FALTAS_MAX || a.fichas + a.porEntrar === 0;

/** Sin mano a la vista: nadie conserva cartas y quien queda solo tiene `POKER.SOLO_MS` para encontrar rival. */
function pasarAEsperar(e: EstadoPoker, ahora: number): void {
  e.fase = "esperando";
  e.calle = null;
  e.finFase = null;
  e.baraja = [];
  e.mesa = [];
  e.botes = [];
  for (const a of e.asientos) {
    a.estado = "fuera";
    a.cartas = [];
    a.ensenadas = false;
  }
  esperarRival(e, ahora);
}

/** Se levantan aquí, y no al repartir, quienes no siguen: así ven el final de la mano. Después, otra mano si hay con quién. */
function cerrarResultado(e: EstadoPoker, ahora: number, rng: Rng): Paso<EstadoPoker> {
  const s = structuredClone(e);
  const liquidaciones = s.asientos.filter(noSigue).map(liquidacionDe);
  s.asientos = s.asientos.filter((a) => !noSigue(a));

  const eventos: Evento[] = [];
  if (s.asientos.filter(puedeJugar).length >= POKER.MIN_JUGADORES) empezarMano(s, ahora, rng, eventos);
  else pasarAEsperar(s, ahora);
  return liquidaciones.length > 0 ? { ok: true, estado: s, eventos, liquidaciones } : exito(s, eventos);
}

function tick(e: EstadoPoker, ahora: number, rng: Rng): Paso<EstadoPoker> {
  if (e.finFase === null || ahora < e.finFase) return exito(e);
  if (e.fase === "mano") return agotarTurno(e, ahora);
  if (e.fase === "resultado") return cerrarResultado(e, ahora, rng);
  // Vence la espera de quien está solo: te levanta y la mesa se duerme.
  return levantarse(e, e.asientos[0].jugadorId, ahora);
}

/** Entre manos te levantas en el acto. En plena mano solo cambia `conectado`, para que tu turno siga corriendo. */
function desconectar(e: EstadoPoker, jugadorId: JugadorId, ahora: number): Paso<EstadoPoker> {
  if (!asientoDe(e, jugadorId)) return exito(e);
  if (e.fase === "esperando") return levantarse(e, jugadorId, ahora);
  const s = structuredClone(e);
  asientoDe(s, jugadorId)!.conectado = false;
  return exito(s);
}

/** Durante la mano no hay botes hechos: se enseña lo de las rondas cerradas y lo que dejaron quienes se fueron. */
function botesALaVista(e: EstadoPoker): Bote[] {
  if (e.fase !== "mano") return e.botes;
  return calcularBotes(aportesDe(e, (a) => a.aportado - a.apostado)).botes;
}

/** Lo que ve `jugadorId`: nunca la baraja, ni las cartas quemadas, ni las de otro antes de enseñarse. */
function vista(e: EstadoPoker, jugadorId: JugadorId | null, _ahora: number): VistaPoker {
  const propio = jugadorId === null ? undefined : asientoDe(e, jugadorId);
  return {
    ronda: e.ronda,
    fase: e.fase,
    calle: e.calle,
    finFase: e.finFase,
    mesa: e.mesa.map((carta) => ({ ...carta })),
    botes: botesALaVista(e),
    turno: e.asientos.find((a) => a.asiento === e.turno)?.jugadorId ?? null,
    asientos: e.asientos.map((a) => ({
      asiento: a.asiento,
      jugadorId: a.jugadorId,
      apodo: a.apodo,
      fichas: a.fichas,
      apostado: a.apostado,
      estado: a.estado,
      conectado: a.conectado,
      boton: a.asiento === e.boton,
      tieneCartas: a.cartas.length > 0 && sigueEnLaMano(a),
      cartas: a.ensenadas ? a.cartas.map((carta) => ({ ...carta })) : null,
    })),
    asientosLibres: POKER.MAX_JUGADORES - e.asientos.length,
    yo: jugadorId,
    misCartas: propio !== undefined && propio.cartas.length > 0 ? propio.cartas.map((carta) => ({ ...carta })) : null,
    opciones: jugadorId === null ? null : opcionesDe(e, jugadorId),
    porEntrar: propio?.porEntrar ?? 0,
  };
}

/** `IdJuego` se amplía cuando la mesa exista en el servidor; hasta entonces, el `id` va aparte. */
export const poker: Omit<Juego<EstadoPoker, AccionPoker>, "id"> & { id: "poker" } = {
  id: "poker",
  maxJugadores: POKER.MAX_JUGADORES,

  crear() {
    return {
      ronda: 0,
      fase: "esperando",
      calle: null,
      finFase: null,
      baraja: [],
      mesa: [],
      asientos: [],
      boton: null,
      turno: null,
      apuesta: 0,
      subidaMinima: POKER.CIEGA_GRANDE,
      ultimoAgresor: null,
      siguienteSesion: 1,
      abandonos: [],
      botes: [],
    };
  },

  /** Entrar no sienta (sentarse es una acción de pago): solo devuelve la conexión a quien ya estaba sentado. */
  sentar(e, jugadorId) {
    if (asientoDe(e, jugadorId)?.conectado !== false) return exito(e);
    const s = structuredClone(e);
    asientoDe(s, jugadorId)!.conectado = true;
    return exito(s);
  },

  costo(_e, _jugadorId, accion) {
    return accion.t === "sentarse" || accion.t === "anadir" ? accion.fichas : 0;
  },

  /** Cada sentada es una ronda del libro de fichas: las compras no van a cuenta de la mano en curso. */
  rondaDelCobro(e, jugadorId, accion) {
    return accion.t === "sentarse" ? e.siguienteSesion : (asientoDe(e, jugadorId)?.sesion ?? e.ronda);
  },

  aplicar(e, jugadorId, accion, ahora, rng, apodo) {
    if (accion.t === "sentarse") return sentarse(e, jugadorId, accion.fichas, ahora, rng, apodo);
    if (accion.t === "levantarse" || accion.t === "salir") return levantarse(e, jugadorId, ahora);
    if (!asientoDe(e, jugadorId)) return fallo("no_sentado");
    switch (accion.t) {
      case "anadir":
        return anadir(e, jugadorId, accion.fichas);
      case "retirarse":
      case "pasar":
      case "igualar":
      case "subir":
        return decidir(e, jugadorId, accion, ahora);
      case "ensenar":
        return ensenar(e, jugadorId);
      default:
        return fallo("mensaje_invalido");
    }
  },

  desconectar,

  tick,

  proximaAlarma(e) {
    return e.finFase;
  },

  vista,

  /** La sala solo cuenta atrás en `resultado`. Con el `finFase` de cada turno se la avisaría en cada jugada, sin enseñar nada nuevo. */
  resumen(e): ResumenMesa {
    return { jugadores: e.asientos.map((a) => a.apodo), fase: e.fase, finFase: e.fase === "resultado" ? e.finFase : null };
  },
};
