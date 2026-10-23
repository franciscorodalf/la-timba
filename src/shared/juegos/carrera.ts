import { barajar, crearBaraja, type Carta, type Palo, type Rng } from "../cartas";
import type { CodigoError, Evento, FilaLiquidacion, Juego, JugadorId, Paso, ResumenMesa } from "./tipos";

export const CARRERA = {
  TRAMOS: 7,
  META: 8,
  PASO_MS: 800,
  APUESTAS_MS: 20_000,
  RESULTADO_MS: 5_000,
  MIN: 10,
  MAX: 500,
  PAGO: 4,
  MAX_JUGADORES: 12,
} as const;

// ---------------------------------------------------------------------------
// Máquina de estados de la mesa
//
// Mismas convenciones que `blackjack.ts`: todo es puro (el tiempo entra por `ahora` y el azar por `rng`), el estado es
// JSON plano y cada transición trabaja sobre un clon (`structuredClone`) y devuelve un estado nuevo; un no-op devuelve
// el mismo objeto de entrada. Convención del mazo: `mazo[0]` es la siguiente carta que sale. Las cartas que salen van
// al final de `descartes`; si el mazo se vacía en plena carrera, el descarte se baraja y pasa a ser el mazo.
//
// Los caballos son los cuatro palos (los ases no están en la baraja). Cada carta que sale hace avanzar a su palo; en la
// pista hay `TRAMOS` cartas tapadas y, cada vez que el caballo más rezagado pasa un tramo, se gira y su palo retrocede.
//
// La carrera entera se sortea al cerrarse las apuestas (`plan`): un paso cada `PASO_MS` hasta la meta. Desde ese momento
// lo que se ve es función del plan y de la hora (`vista(e, jugador, ahora)` solo enseña los pasos ya vencidos) y el
// estado no cambia hasta la meta: solo el `tick` del último paso (la alarma del fin de la carrera) declara el ganador y
// liquida. Los pasos intermedios los anuncia la mesa con `proximoAviso` y `eventosEntre`, sin guardar nada.
// ---------------------------------------------------------------------------

export type AccionCarrera = { t: "apostar"; caballo: Palo; cantidad: number } | { t: "salir" };

export type FaseCarrera = "esperando" | "apuestas" | "carrera" | "resultado";

/** Un paso de la carrera ya sorteado: la carta que sale en `momento`, cómo queda la pista y sus eventos. */
export interface PasoCarrera {
  momento: number;
  carta: Carta;
  posiciones: Record<Palo, number>;
  tramosGirados: number;
  /** `caballo_avanza`, los `tramo_girado` que provoca y, si hizo falta, `barajado` antes de sacar la carta. */
  eventos: Evento[];
}

export interface EstadoCarrera {
  ronda: number;
  fase: FaseCarrera;
  /** Instante en que vence la fase actual (en `carrera`, el último paso: la meta); `null` en `esperando` (no hay alarma). */
  finFase: number | null;
  /** `mazo[0]` es la siguiente carta. Nunca sale del servidor. */
  mazo: Carta[];
  /** Cartas ya sacadas en esta ronda; la última es la carta que acaba de salir. */
  descartes: Carta[];
  /** Las `TRAMOS` cartas de la pista; solo las `tramosGirados` primeras son públicas. */
  tramos: Carta[];
  tramosGirados: number;
  posiciones: Record<Palo, number>;
  /**
   * La carrera sorteada, solo en la fase `carrera` (vacío en las demás). Nunca sale del servidor: lo que se ve son los
   * pasos con `momento ≤ ahora`. Mientras corre, `posiciones`, `tramosGirados` y `ganador` siguen como al salir.
   */
  plan: PasoCarrera[];
  /** Una entrada por jugador y caballo, con la cantidad acumulada (≤ `MAX`). Se conservan en `resultado`. */
  apuestas: { jugadorId: JugadorId; caballo: Palo; cantidad: number }[];
  asientos: { jugadorId: JugadorId; apodo: string; conectado: boolean }[];
  /** Jugadores que salieron de la mesa con apuestas en la ronda en curso: sus apuestas se pierden. */
  abandonos: JugadorId[];
  ganador: Palo | null;
  /** Ventanas de apuestas seguidas que se cerraron sin ninguna apuesta; al llegar a 3 la mesa pasa a `esperando`. */
  ventanasVacias: number;
}

export interface VistaCarrera {
  ronda: number;
  fase: FaseCarrera;
  finFase: number | null;
  posiciones: Record<Palo, number>;
  /** Los tramos sin girar van como `null`. */
  tramos: (Carta | null)[];
  ultimaCarta: Carta | null;
  misApuestas: { caballo: Palo; cantidad: number }[];
  totalesPorCaballo: Record<Palo, number>;
  sentados: string[];
  ganador: Palo | null;
}

type Liquidacion = { ronda: number; filas: FilaLiquidacion[] };

const CABALLOS: readonly Palo[] = ["H", "D", "C", "S"];

/** Ventanas de apuestas vacías seguidas tras las que la mesa deja de programar alarmas (los asientos se conservan). */
const MAX_VENTANAS_VACIAS = 3;

const caballoValido = (caballo: unknown): caballo is Palo => CABALLOS.includes(caballo as Palo);

/** Cantidad válida de una apuesta: entero entre `CARRERA.MIN` y `CARRERA.MAX`, ambos inclusive. */
const cantidadValida = (cantidad: unknown): cantidad is number =>
  typeof cantidad === "number" && Number.isInteger(cantidad) && cantidad >= CARRERA.MIN && cantidad <= CARRERA.MAX;

function exito(estado: EstadoCarrera, eventos: Evento[] = [], liquidacion?: Liquidacion): Paso<EstadoCarrera> {
  return liquidacion ? { ok: true, estado, eventos, liquidacion } : { ok: true, estado, eventos };
}

function fallo(error: CodigoError): Paso<EstadoCarrera> {
  return { ok: false, error };
}

const asientoDe = (e: EstadoCarrera, jugadorId: JugadorId) => e.asientos.find((a) => a.jugadorId === jugadorId);
const apuestaDe = (e: EstadoCarrera, jugadorId: JugadorId, caballo: Palo) =>
  e.apuestas.find((a) => a.jugadorId === jugadorId && a.caballo === caballo);

/** Pista nueva: una baraja sin ases barajada; 7 cartas son los tramos y el resto es el mazo. Posiciones a 0. */
function nuevaPista(e: EstadoCarrera, rng: Rng): void {
  const baraja = barajar(
    crearBaraja().filter((carta) => carta.valor !== "A"),
    rng,
  );
  e.tramos = baraja.slice(0, CARRERA.TRAMOS);
  e.mazo = baraja.slice(CARRERA.TRAMOS);
  e.descartes = [];
  e.tramosGirados = 0;
  e.posiciones = { H: 0, D: 0, C: 0, S: 0 };
  e.ganador = null;
}

/** Saca la siguiente carta (a `descartes`). Si el mazo está vacío, el descarte se baraja y pasa a ser el mazo. */
function robar(e: EstadoCarrera, rng: Rng, eventos: Evento[]): Carta {
  if (e.mazo.length === 0) {
    e.mazo = barajar(e.descartes, rng);
    e.descartes = [];
    eventos.push({ tipo: "barajado" });
  }
  const carta = e.mazo.shift() as Carta;
  e.descartes.push(carta);
  return carta;
}

/** Una fila por jugador que apostó (en el orden de su primera apuesta). Quien abandonó, o si no hay ganador, cobra 0. */
function liquidar(e: EstadoCarrera, eventos: Evento[]): Liquidacion {
  const jugadores = [...new Set(e.apuestas.map((a) => a.jugadorId))];
  const filas = jugadores.map((jugadorId) => {
    const suyas = e.apuestas.filter((a) => a.jugadorId === jugadorId);
    const cobra = e.ganador !== null && !e.abandonos.includes(jugadorId);
    return {
      jugadorId,
      apuesta: suyas.reduce((suma, a) => suma + a.cantidad, 0),
      pago: cobra ? suyas.filter((a) => a.caballo === e.ganador).reduce((suma, a) => suma + a.cantidad * CARRERA.PAGO, 0) : 0,
    };
  });
  for (const f of filas) eventos.push({ tipo: "pago", jugadorId: f.jugadorId, neto: f.pago - f.apuesta });
  return { ronda: e.ronda, filas };
}

/**
 * Sortea la carrera entera desde la pista actual: un paso cada `PASO_MS` desde `inicio` hasta que un caballo llega a la
 * meta. Saca las cartas del mazo de `e` (a `descartes`, rebarajando si se agota); la pista de `e` no se toca.
 * En cada paso sale una carta, avanza su caballo y, si no ha llegado a la meta, se giran los tramos que toquen.
 */
function sortearCarrera(e: EstadoCarrera, inicio: number, rng: Rng): PasoCarrera[] {
  const posiciones = { ...e.posiciones };
  let tramosGirados = e.tramosGirados;
  const plan: PasoCarrera[] = [];
  for (;;) {
    const eventos: Evento[] = [];
    const carta = robar(e, rng, eventos);
    posiciones[carta.palo] += 1;
    eventos.push({ tipo: "caballo_avanza", palo: carta.palo, carta: { ...carta } });
    const meta = posiciones[carta.palo] >= CARRERA.META;
    // El tramo `tramosGirados` se gira cuando el caballo más rezagado ya lo ha pasado; su palo retrocede una casilla.
    // Girar un tramo puede dejar a otro caballo atrás, pero también puede dejar listo el tramo siguiente: se repite.
    // En el paso que llega a la meta no se gira ninguno.
    while (!meta && tramosGirados < CARRERA.TRAMOS && Math.min(...CABALLOS.map((p) => posiciones[p])) > tramosGirados) {
      const indice = tramosGirados;
      const palo = e.tramos[indice].palo;
      tramosGirados += 1;
      posiciones[palo] = Math.max(0, posiciones[palo] - 1);
      eventos.push({ tipo: "tramo_girado", indice, palo });
    }
    plan.push({ momento: inicio + (plan.length + 1) * CARRERA.PASO_MS, carta: { ...carta }, posiciones: { ...posiciones }, tramosGirados, eventos });
    if (meta) return plan;
  }
}

/** La meta (el último paso del plan): la pista queda como en él, hay ganador, se liquida y empieza `resultado`. */
function llegada(e: EstadoCarrera, ahora: number, eventos: Evento[]): Liquidacion {
  const ultimo = e.plan[e.plan.length - 1];
  e.posiciones = { ...ultimo.posiciones };
  e.tramosGirados = ultimo.tramosGirados;
  e.ganador = ultimo.carta.palo;
  e.plan = [];
  eventos.push(...ultimo.eventos, { tipo: "ganador", palo: ultimo.carta.palo });
  const liquidacion = liquidar(e, eventos);
  e.fase = "resultado";
  e.finFase = ahora + CARRERA.RESULTADO_MS;
  return liquidacion;
}

/** Pasos del plan que se anuncian por su cuenta: todos menos el último, que llega con el `tick` de la meta. */
const pasosIntermedios = (e: EstadoCarrera): PasoCarrera[] => (e.fase === "carrera" ? e.plan.slice(0, -1) : []);

/** Cuántos pasos de la carrera se ven a la hora `ahora` (el último, la meta, solo tras su `tick`). */
const pasosVistos = (e: EstadoCarrera, ahora: number): number => pasosIntermedios(e).filter((p) => p.momento <= ahora).length;

/** Cierra la ronda: limpia la mesa, retira a los desconectados, reparte una pista nueva y abre apuestas si queda alguien. */
function nuevaRonda(e: EstadoCarrera, ahora: number, rng: Rng): void {
  e.ronda += 1;
  e.apuestas = [];
  e.abandonos = [];
  e.ventanasVacias = 0;
  e.asientos = e.asientos.filter((a) => a.conectado);
  e.plan = [];
  nuevaPista(e, rng);
  if (e.asientos.length > 0) {
    e.fase = "apuestas";
    e.finFase = ahora + CARRERA.APUESTAS_MS;
  } else {
    e.fase = "esperando";
    e.finFase = null;
  }
}

/** Abre una ventana de apuestas nueva desde `esperando`. */
function abrirApuestas(e: EstadoCarrera, ahora: number): void {
  e.fase = "apuestas";
  e.finFase = ahora + CARRERA.APUESTAS_MS;
  e.ventanasVacias = 0;
}

function sentar(e: EstadoCarrera, jugadorId: JugadorId, apodo: string, ahora: number): Paso<EstadoCarrera> {
  const existente = asientoDe(e, jugadorId);
  // Quien ya está sentado y conectado no cambia nada, salvo en una mesa dormida: sentarse la despierta.
  if (existente?.conectado && e.fase !== "esperando") return exito(e);
  if (!existente && e.asientos.length >= CARRERA.MAX_JUGADORES) return fallo("mesa_llena");
  const s = structuredClone(e);
  if (existente) asientoDe(s, jugadorId)!.conectado = true;
  else s.asientos.push({ jugadorId, apodo, conectado: true });
  if (s.fase === "esperando") abrirApuestas(s, ahora);
  return exito(s);
}

/** En `esperando` (mesa dormida) apostar es válido: abre una ventana nueva con esa apuesta. */
function apostar(e: EstadoCarrera, jugadorId: JugadorId, caballo: Palo, cantidad: number, ahora: number): Paso<EstadoCarrera> {
  if (e.fase !== "apuestas" && e.fase !== "esperando") return fallo("fase_incorrecta");
  if (!caballoValido(caballo) || !cantidadValida(cantidad)) return fallo("apuesta_invalida");
  // Quien salió con apuestas ya las dio por perdidas: no puede volver a apostar en esta ronda.
  if (e.abandonos.includes(jugadorId)) return fallo("accion_invalida");
  if ((apuestaDe(e, jugadorId, caballo)?.cantidad ?? 0) + cantidad > CARRERA.MAX) return fallo("apuesta_invalida");
  const s = structuredClone(e);
  const previa = apuestaDe(s, jugadorId, caballo);
  if (previa) previa.cantidad += cantidad;
  else s.apuestas.push({ jugadorId, caballo, cantidad });
  if (s.fase === "esperando") abrirApuestas(s, ahora);
  return exito(s);
}

function salir(e: EstadoCarrera, jugadorId: JugadorId, ahora: number, rng: Rng): Paso<EstadoCarrera> {
  const s = structuredClone(e);
  s.asientos = s.asientos.filter((a) => a.jugadorId !== jugadorId);
  // En `resultado` las apuestas ya están liquidadas: no hay nada que perder.
  if (s.fase !== "resultado" && s.apuestas.some((a) => a.jugadorId === jugadorId) && !s.abandonos.includes(jugadorId)) {
    s.abandonos.push(jugadorId);
  }
  if (s.asientos.length > 0) return exito(s);
  // Se fue el último: no queda nadie para ver la carrera. Se liquida ya (todos pierden) y la mesa duerme.
  const eventos: Evento[] = [];
  const liquidacion = s.apuestas.length > 0 && s.fase !== "resultado" ? liquidar(s, eventos) : undefined;
  nuevaRonda(s, ahora, rng);
  return exito(s, eventos, liquidacion);
}

function desconectar(e: EstadoCarrera, jugadorId: JugadorId): Paso<EstadoCarrera> {
  if (!asientoDe(e, jugadorId)) return exito(e);
  const s = structuredClone(e);
  asientoDe(s, jugadorId)!.conectado = false;
  // Mesa dormida: no hay ronda que respetar, no se dejan asientos fantasma. Si no, las apuestas siguen en juego.
  if (s.fase === "esperando") s.asientos = s.asientos.filter((a) => a.jugadorId !== jugadorId);
  return exito(s);
}

function tick(e: EstadoCarrera, ahora: number, rng: Rng): Paso<EstadoCarrera> {
  if (e.finFase === null || ahora < e.finFase) return exito(e);
  const s = structuredClone(e);
  const eventos: Evento[] = [];
  switch (s.fase) {
    case "esperando":
      return exito(e);
    case "apuestas":
      if (s.apuestas.length > 0) {
        // Empieza la carrera: se sortea entera. Este tick no saca carta; el primer paso llega `PASO_MS` después.
        s.ventanasVacias = 0;
        s.fase = "carrera";
        s.plan = sortearCarrera(s, ahora, rng);
        s.finFase = s.plan[s.plan.length - 1].momento;
      } else {
        // Nadie apostó. Se retiran los desconectados y, si no queda nadie o ya van varias ventanas vacías seguidas,
        // la mesa se duerme (sin alarma) hasta que alguien se siente o apueste; si no, otra ventana.
        s.asientos = s.asientos.filter((a) => a.conectado);
        s.ventanasVacias = s.asientos.length > 0 ? s.ventanasVacias + 1 : 0;
        if (s.asientos.length > 0 && s.ventanasVacias < MAX_VENTANAS_VACIAS) {
          s.finFase = ahora + CARRERA.APUESTAS_MS;
        } else {
          s.fase = "esperando";
          s.finFase = null;
        }
      }
      return exito(s);
    case "carrera": {
      const liquidacion = llegada(s, ahora, eventos);
      return exito(s, eventos, liquidacion);
    }
    case "resultado":
      nuevaRonda(s, ahora, rng);
      return exito(s);
  }
}

/** Lo que ve `jugadorId` a la hora `ahora`: en plena carrera, solo los pasos ya vencidos (ni una carta más ni el ganador). */
function vista(e: EstadoCarrera, jugadorId: JugadorId | null, ahora: number): VistaCarrera {
  const totalesPorCaballo: Record<Palo, number> = { H: 0, D: 0, C: 0, S: 0 };
  for (const a of e.apuestas) totalesPorCaballo[a.caballo] += a.cantidad;
  let { posiciones, tramosGirados, finFase } = e;
  let ultima: Carta | undefined = e.descartes[e.descartes.length - 1];
  if (e.fase === "carrera") {
    // El mazo y los descartes ya van por la meta: lo visible sale del plan.
    const vistos = pasosVistos(e, ahora);
    const paso = vistos > 0 ? e.plan[vistos - 1] : null;
    posiciones = paso?.posiciones ?? e.posiciones;
    tramosGirados = paso?.tramosGirados ?? e.tramosGirados;
    ultima = paso?.carta;
    finFase = e.plan[vistos].momento;
  }
  return {
    ronda: e.ronda,
    fase: e.fase,
    finFase,
    posiciones: { ...posiciones },
    // Los tramos sin girar no salen del servidor, y el mazo tampoco.
    tramos: e.tramos.map((carta, i) => (i < tramosGirados ? { ...carta } : null)),
    ultimaCarta: ultima ? { ...ultima } : null,
    misApuestas: e.apuestas.filter((a) => a.jugadorId === jugadorId).map(({ caballo, cantidad }) => ({ caballo, cantidad })),
    totalesPorCaballo,
    sentados: e.asientos.map((a) => a.apodo),
    ganador: e.ganador,
  };
}

export const carrera: Juego<EstadoCarrera, AccionCarrera> = {
  id: "carrera",
  maxJugadores: CARRERA.MAX_JUGADORES,

  crear(_ahora, rng) {
    const e: EstadoCarrera = {
      ronda: 1,
      fase: "esperando",
      finFase: null,
      mazo: [],
      descartes: [],
      tramos: [],
      tramosGirados: 0,
      posiciones: { H: 0, D: 0, C: 0, S: 0 },
      plan: [],
      apuestas: [],
      asientos: [],
      abandonos: [],
      ganador: null,
      ventanasVacias: 0,
    };
    nuevaPista(e, rng);
    return e;
  },

  sentar,

  /** Apostar cuesta la cantidad (si es válida); no depende del acumulado del caballo. Lo demás es gratis. */
  costo(_e, _jugadorId, accion) {
    if (accion.t === "apostar") return caballoValido(accion.caballo) && cantidadValida(accion.cantidad) ? accion.cantidad : 0;
    return 0;
  },

  aplicar(e, jugadorId, accion, ahora, rng) {
    if (!asientoDe(e, jugadorId)) return fallo("no_sentado");
    switch (accion.t) {
      case "apostar":
        return apostar(e, jugadorId, accion.caballo, accion.cantidad, ahora);
      case "salir":
        return salir(e, jugadorId, ahora, rng);
      default:
        return fallo("mensaje_invalido");
    }
  },

  desconectar,

  tick,

  /** El fin de cada fase; en plena carrera, la meta (los pasos intermedios no necesitan alarma). */
  proximaAlarma(e) {
    return e.finFase;
  },

  proximoAviso(e, desde) {
    return pasosIntermedios(e).find((p) => p.momento > desde)?.momento ?? null;
  },

  eventosEntre(e, desde, hasta) {
    return pasosIntermedios(e)
      .filter((p) => p.momento > desde && p.momento <= hasta)
      .flatMap((p) => p.eventos.map((evento) => structuredClone(evento)));
  },

  vista,

  resumen(e): ResumenMesa {
    return { jugadores: e.asientos.map((a) => a.apodo), fase: e.fase, finFase: e.finFase };
  },
};
