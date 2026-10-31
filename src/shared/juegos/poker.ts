import { barajar, crearBaraja, type Carta, type Rng } from "../cartas";
import { calcularBotes, type Aporte, type Bote } from "./poker-botes";
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

/**
 * Tiene que hablar quien juega y no ha igualado, o quien aún no ha hablado si queda alguien que le pueda responder.
 * Sin esa condición, con los demás all-in habría que esperar a que pasara el único que aún tiene fichas.
 */
function debeHablar(e: EstadoPoker, a: AsientoPoker): boolean {
  if (a.estado !== "juega") return false;
  return a.apostado < e.apuesta || (!a.actuo && e.asientos.some((otro) => otro !== a && otro.estado === "juega"));
}

/** Entre qué totales puede subir: hasta todas sus fichas, y desde una subida completa o, si no le llega, solo all-in. */
function rangoDeSubida(e: EstadoPoker, a: AsientoPoker): OpcionesPoker["subir"] {
  const max = a.apostado + a.fichas;
  const alguienResponde = e.asientos.some((otro) => otro !== a && otro.estado === "juega");
  if (!a.puedeSubir || max <= e.apuesta || !alguienResponde) return null;
  return { min: Math.min(e.apuesta + e.subidaMinima, max), max };
}

/** Lo que permiten las reglas al jugador ahora mismo, o `null` si no está sentado. */
export function opcionesDe(e: EstadoPoker, jugadorId: JugadorId): OpcionesPoker | null {
  const a = asientoDe(e, jugadorId);
  if (a === undefined) return null;
  if (e.fase !== "mano" || e.turno !== a.asiento) return { retirarse: false, pasar: false, igualar: null, subir: null, ensenar: false };
  const porIgualar = e.apuesta - a.apostado;
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

/** Provisional hasta que se repartan los botes: la mano solo pasa a `resultado`. */
function cerrarMano(e: EstadoPoker, ahora: number): void {
  e.fase = "resultado";
  e.turno = null;
  e.finFase = ahora + POKER.RESULTADO_MS;
}

/**
 * Da la palabra al siguiente después del asiento `desde`. Si nadie tiene que hablar, se abre la calle siguiente (y otra
 * más, si tampoco entonces hay nada que apostar) hasta el river; la mano acaba tras él o si solo queda uno.
 */
function darTurno(e: EstadoPoker, desde: number, ahora: number, eventos: Evento[]): void {
  if (vivos(e).length <= 1) return cerrarMano(e, ahora);
  let origen = desde;
  for (;;) {
    const siguiente = asientosDesde(e, origen).find((a) => debeHablar(e, a));
    if (siguiente !== undefined) {
      e.turno = siguiente.asiento;
      e.finFase = ahora + POKER.TURNO_MS;
      return;
    }
    const calle = e.calle === null ? undefined : CALLES_SIGUIENTES[e.calle];
    if (calle === undefined) return cerrarMano(e, ahora);
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
  return exito(s);
}

/**
 * Levantarse liquida la sesión: vuelve lo que tenga en la mesa más lo añadido que aún no había entrado, y lo aportado a la
 * mano se queda en ella. Quien seguía en la mano se retira. Si con eso quien tiene la palabra ya no tiene a quién responder,
 * o se ha ido él, sigue el juego.
 */
function levantarse(e: EstadoPoker, jugadorId: JugadorId, ahora: number): Paso<EstadoPoker> {
  if (!asientoDe(e, jugadorId)) return exito(e);
  const s = structuredClone(e);
  const a = asientoDe(s, jugadorId)!;
  const liquidacion: LiquidacionPaso = { ronda: a.sesion, filas: [{ jugadorId, apuesta: a.comprado, pago: a.fichas + a.porEntrar }] };
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

function decidir(e: EstadoPoker, jugadorId: JugadorId, accion: Decision, ahora: number): Paso<EstadoPoker> {
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

  const eventos: Evento[] = [{ tipo: "accion", jugadorId, accion: a.estado === "allin" ? "allin" : accion.t, cantidad: antes - a.fichas }];
  darTurno(s, a.asiento, ahora, eventos);
  return exito(s, eventos);
}

/** Solo vence la espera de quien está solo: te levanta y la mesa se duerme. */
function tick(e: EstadoPoker, ahora: number): Paso<EstadoPoker> {
  if (e.fase !== "esperando" || e.finFase === null || ahora < e.finFase) return exito(e);
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
  const aportes: Aporte[] = e.asientos
    .filter((a) => a.estado !== "fuera")
    .map((a) => ({ jugadorId: a.jugadorId, aportado: a.aportado - a.apostado, vivo: sigueEnLaMano(a) }));
  for (const { jugadorId, aportado } of e.abandonos) aportes.push({ jugadorId, aportado, vivo: false });
  return calcularBotes(aportes).botes;
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
        // Aún no hay manos que enseñar: llega con el final de la mano.
        return fallo("accion_invalida");
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
