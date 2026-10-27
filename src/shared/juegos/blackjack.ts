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
} as const;

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
 * La banca no mira su carta tapada: si tiene blackjack gana a toda mano salvo a otro blackjack.
 * Una mano doblada nunca cuenta como blackjack natural.
 */
export function pago(mano: { cartas: Carta[]; apuesta: number; doblada: boolean }, banca: Carta[]): number {
  const { apuesta } = mano;
  const jugador = puntuacion(mano.cartas).total;
  const jugadorBlackjack = !mano.doblada && esBlackjack(mano.cartas);

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
  | { t: "apostar"; cantidad: number }
  | { t: "pedir" }
  | { t: "plantarse" }
  | { t: "doblar" }
  | { t: "salir" };

export type FaseBJ = "esperando" | "apuestas" | "decisiones" | "banca" | "resultado";

export interface ManoBJ {
  jugadorId: JugadorId;
  apodo: string;
  /** Total en juego en esta mano: ya vale el doble si se dobló. */
  apuesta: number;
  cartas: Carta[];
  estado: "jugando" | "plantado" | "pasado" | "blackjack";
  doblada: boolean;
  /** El jugador salió de la mesa con la ronda en curso: pierde la apuesta. */
  abandonada: boolean;
}

export interface EstadoBJ {
  ronda: number;
  fase: FaseBJ;
  /** Instante en que vence la fase actual; `null` en `esperando` (no hay alarma). */
  finFase: number | null;
  zapato: Carta[];
  /** La segunda carta (`banca[1]`) está tapada hasta la fase `banca`. */
  banca: Carta[];
  asientos: { jugadorId: JugadorId; apodo: string; conectado: boolean }[];
  manos: ManoBJ[];
  /** Ventanas de apuestas seguidas que se cerraron sin ninguna apuesta; al llegar a 3 la mesa pasa a `esperando`. */
  ventanasVacias: number;
}

export interface VistaBJ {
  ronda: number;
  fase: FaseBJ;
  finFase: number | null;
  banca: (Carta | null)[];
  totalBanca: number | null;
  manos: (Omit<ManoBJ, "abandonada"> & { total: number })[];
  sentados: string[];
  yo: JugadorId | null;
}

type Liquidacion = { ronda: number; filas: FilaLiquidacion[] };

/** Ventanas de apuestas vacías seguidas tras las que la mesa deja de programar alarmas (los asientos se conservan). */
const MAX_VENTANAS_VACIAS = 3;

function exito(estado: EstadoBJ, eventos: Evento[] = [], liquidacion?: Liquidacion): Paso<EstadoBJ> {
  return liquidacion ? { ok: true, estado, eventos, liquidacion } : { ok: true, estado, eventos };
}

function fallo(error: CodigoError): Paso<EstadoBJ> {
  return { ok: false, error };
}

const asientoDe = (e: EstadoBJ, jugadorId: JugadorId) => e.asientos.find((a) => a.jugadorId === jugadorId);
const manoDe = (e: EstadoBJ, jugadorId: JugadorId) => e.manos.find((m) => m.jugadorId === jugadorId);
const hayJugando = (e: EstadoBJ) => e.manos.some((m) => m.estado === "jugando");

/** Saca la siguiente carta del zapato. Si se vaciara en plena ronda (no ocurre con ≥ 78 al empezar), baraja uno nuevo. */
function robar(e: EstadoBJ, rng: Rng, eventos: Evento[]): Carta {
  if (e.zapato.length === 0) {
    e.zapato = barajar(crearBaraja(BJ.BARAJAS), rng);
    eventos.push({ tipo: "barajado" });
  }
  return e.zapato.shift() as Carta;
}

function cartaVisible(a: JugadorId | "banca", carta: Carta): Evento {
  return { tipo: "carta_repartida", a, oculta: false, carta };
}

/** Si ya nadie puede decidir, las decisiones terminan sin esperar al reloj. */
function cerrarDecisiones(e: EstadoBJ, ahora: number): void {
  if (e.fase === "decisiones" && !hayJugando(e)) {
    e.fase = "banca";
    e.finFase = ahora + BJ.BANCA_MS;
  }
}

/** Reparte jugador, banca, jugador, banca (la segunda de la banca, tapada) y abre la fase que toque. */
function repartir(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): void {
  const activas = e.manos.filter((m) => !m.abandonada);
  if (activas.length > 0) {
    for (const vuelta of [0, 1]) {
      for (const m of activas) {
        const carta = robar(e, rng, eventos);
        m.cartas.push(carta);
        eventos.push(cartaVisible(m.jugadorId, carta));
      }
      const carta = robar(e, rng, eventos);
      e.banca.push(carta);
      eventos.push(vuelta === 0 ? cartaVisible("banca", carta) : { tipo: "carta_repartida", a: "banca", oculta: true });
    }
    for (const m of activas) {
      if (esBlackjack(m.cartas)) m.estado = "blackjack";
      else if (asientoDe(e, m.jugadorId)?.conectado === false) m.estado = "plantado";
    }
  }
  if (hayJugando(e)) {
    e.fase = "decisiones";
    e.finFase = ahora + BJ.DECISIONES_MS;
  } else {
    e.fase = "banca";
    e.finFase = ahora + BJ.BANCA_MS;
  }
}

/** Gira la carta tapada, la banca juega su mano, y se calculan los pagos de la ronda. */
function jugarBanca(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): Liquidacion {
  if (e.banca.length >= 2) eventos.push({ tipo: "carta_girada", carta: e.banca[1] });
  // Las manos pasadas y abandonadas ya están perdidas: no hace falta que la banca pida por ellas.
  if (e.manos.some((m) => !m.abandonada && m.estado !== "pasado")) {
    while (bancaDebePedir(e.banca)) {
      const carta = robar(e, rng, eventos);
      e.banca.push(carta);
      eventos.push(cartaVisible("banca", carta));
    }
  }
  const liquidacion = liquidar(e, eventos);
  e.fase = "resultado";
  e.finFase = ahora + BJ.RESULTADO_MS;
  return liquidacion;
}

function liquidar(e: EstadoBJ, eventos: Evento[]): Liquidacion {
  const filas = e.manos.map((m) => ({
    jugadorId: m.jugadorId,
    apuesta: m.apuesta,
    pago: m.abandonada ? 0 : pago(m, e.banca),
  }));
  for (const f of filas) eventos.push({ tipo: "pago", jugadorId: f.jugadorId, neto: f.pago - f.apuesta });
  return { ronda: e.ronda, filas };
}

/** Cierra la ronda: limpia la mesa, retira a los desconectados, rebaraja si hace falta y abre apuestas si queda alguien. */
function nuevaRonda(e: EstadoBJ, ahora: number, rng: Rng, eventos: Evento[]): void {
  e.ronda += 1;
  e.manos = [];
  e.banca = [];
  e.ventanasVacias = 0;
  e.asientos = e.asientos.filter((a) => a.conectado);
  if (e.zapato.length < BJ.MIN_ZAPATO) {
    e.zapato = barajar(crearBaraja(BJ.BARAJAS), rng);
    eventos.push({ tipo: "barajado" });
  }
  if (e.asientos.length > 0) {
    e.fase = "apuestas";
    e.finFase = ahora + BJ.APUESTAS_MS;
  } else {
    e.fase = "esperando";
    e.finFase = null;
  }
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

/** En `esperando` (mesa dormida) apostar es válido: abre una ventana nueva con esa apuesta. */
function apostar(e: EstadoBJ, jugadorId: JugadorId, cantidad: number, ahora: number): Paso<EstadoBJ> {
  if (e.fase !== "apuestas" && e.fase !== "esperando") return fallo("fase_incorrecta");
  if (!apuestaValida(cantidad)) return fallo("apuesta_invalida");
  if (manoDe(e, jugadorId)) return fallo("accion_invalida");
  const s = structuredClone(e);
  const apodo = asientoDe(s, jugadorId)!.apodo;
  s.manos.push({ jugadorId, apodo, apuesta: cantidad, cartas: [], estado: "jugando", doblada: false, abandonada: false });
  if (s.fase === "esperando") abrirApuestas(s, ahora);
  return exito(s);
}

/** Pedir, plantarse y doblar: solo en decisiones y sobre una mano propia que siga jugando. */
function decidir(
  e: EstadoBJ,
  jugadorId: JugadorId,
  accion: "pedir" | "plantarse" | "doblar",
  ahora: number,
  rng: Rng,
): Paso<EstadoBJ> {
  if (e.fase !== "decisiones") return fallo("fase_incorrecta");
  const actual = manoDe(e, jugadorId);
  if (!actual || actual.estado !== "jugando") return fallo("accion_invalida");
  if (accion === "doblar" && actual.cartas.length !== 2) return fallo("accion_invalida");

  const s = structuredClone(e);
  const m = manoDe(s, jugadorId)!;
  const eventos: Evento[] = [];
  if (accion === "plantarse") {
    m.estado = "plantado";
  } else {
    const carta = robar(s, rng, eventos);
    m.cartas.push(carta);
    eventos.push(cartaVisible(jugadorId, carta));
    const pasado = puntuacion(m.cartas).total > 21;
    if (accion === "doblar") {
      m.apuesta *= 2;
      m.doblada = true;
      m.estado = pasado ? "pasado" : "plantado";
    } else if (pasado) {
      m.estado = "pasado";
    }
  }
  cerrarDecisiones(s, ahora);
  return exito(s, eventos);
}

function salir(e: EstadoBJ, jugadorId: JugadorId, ahora: number, rng: Rng): Paso<EstadoBJ> {
  const s = structuredClone(e);
  s.asientos = s.asientos.filter((a) => a.jugadorId !== jugadorId);
  const m = manoDe(s, jugadorId);
  // En `resultado` la mano ya está liquidada: no hay nada que perder.
  if (m && s.fase !== "resultado") {
    m.abandonada = true;
    if (m.estado === "jugando") m.estado = "plantado";
  }
  if (s.asientos.length > 0) {
    cerrarDecisiones(s, ahora);
    return exito(s);
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
    case "apuestas":
      if (s.manos.length > 0) {
        s.ventanasVacias = 0;
        repartir(s, ahora, rng, eventos);
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
    case "decisiones":
      for (const m of s.manos) if (m.estado === "jugando") m.estado = "plantado";
      s.fase = "banca";
      s.finFase = ahora + BJ.BANCA_MS;
      return exito(s);
    case "banca": {
      const liquidacion = jugarBanca(s, ahora, rng, eventos);
      return exito(s, eventos, liquidacion);
    }
    case "resultado":
      nuevaRonda(s, ahora, rng, eventos);
      return exito(s, eventos);
  }
}

function desconectar(e: EstadoBJ, jugadorId: JugadorId, ahora: number): Paso<EstadoBJ> {
  if (!asientoDe(e, jugadorId)) return exito(e);
  const s = structuredClone(e);
  asientoDe(s, jugadorId)!.conectado = false;
  if (s.fase === "esperando") {
    // Mesa dormida: no hay ronda que respetar, no se dejan asientos fantasma.
    s.asientos = s.asientos.filter((a) => a.jugadorId !== jugadorId);
    return exito(s);
  }
  const m = manoDe(s, jugadorId);
  if (s.fase === "decisiones" && m?.estado === "jugando") m.estado = "plantado";
  cerrarDecisiones(s, ahora);
  return exito(s);
}

function vista(e: EstadoBJ, jugadorId: JugadorId | null): VistaBJ {
  // La carta tapada no sale del servidor hasta que se gira (evento `carta_girada`, en el tick de `banca`).
  const tapada = e.fase === "apuestas" || e.fase === "decisiones" || e.fase === "banca";
  const visibles = tapada ? e.banca.slice(0, 1) : e.banca;
  return {
    ronda: e.ronda,
    fase: e.fase,
    finFase: e.finFase,
    banca: e.banca.map((carta, i) => (tapada && i > 0 ? null : { ...carta })),
    totalBanca: visibles.length > 0 ? puntuacion(visibles).total : null,
    manos: e.manos.map(({ abandonada: _abandonada, ...m }) => ({
      ...m,
      cartas: m.cartas.map((carta) => ({ ...carta })),
      total: puntuacion(m.cartas).total,
    })),
    sentados: e.asientos.map((a) => a.apodo),
    yo: jugadorId,
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
      ventanasVacias: 0,
    };
  },

  sentar,

  /** Se calcula sobre el estado ANTERIOR a `aplicar`: al doblar cuesta la apuesta original, no el doble. */
  costo(e, jugadorId, accion) {
    if (accion.t === "apostar") return apuestaValida(accion.cantidad) ? accion.cantidad : 0;
    if (accion.t === "doblar") return manoDe(e, jugadorId)?.apuesta ?? 0;
    return 0;
  },

  aplicar(e, jugadorId, accion, ahora, rng) {
    if (!asientoDe(e, jugadorId)) return fallo("no_sentado");
    switch (accion.t) {
      case "apostar":
        return apostar(e, jugadorId, accion.cantidad, ahora);
      case "pedir":
      case "plantarse":
      case "doblar":
        return decidir(e, jugadorId, accion.t, ahora, rng);
      case "salir":
        return salir(e, jugadorId, ahora, rng);
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

  /** La banca dura un instante y la sala no le enseña cuenta atrás (`finFase` a `null`). */
  resumen(e): ResumenMesa {
    return { jugadores: e.asientos.map((a) => a.apodo), fase: e.fase, finFase: e.fase === "banca" ? null : e.finFase };
  },
};
