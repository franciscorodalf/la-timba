import type { Carta, Palo } from "../../../shared/cartas";
import type { VistaCarrera } from "../../../shared/juegos/carrera";
import type { Evento, JugadorId } from "../../../shared/juegos/tipos";

// La «escena» de la carrera: lo que se ve en la pista en cada momento. El servidor manda cada paso entero en un solo mensaje
// (el caballo avanza, se gira un tramo y otro caballo retrocede, todo a la vez), pero en la pista eso se cuenta en orden:
// primero avanza el caballo, después se gira el tramo y, ya visto, retrocede el que toca. Aquí se calcula ese guion (puro,
// sin DOM ni reloj): `planDeLote` devuelve los cambios de la escena con el instante en que toca cada uno.

/** Los cuatro caballos, en el orden de la mesa. */
export const CABALLOS: readonly Palo[] = ["H", "D", "C", "S"];

// Instantes de un paso, en milisegundos desde que llega su mensaje (el servidor manda uno cada 800 ms).
/** El tramo empieza a girarse cuando el caballo está llegando a su casilla. */
export const GIRO_TRAMO_MS = 250;
/** El caballo empieza a retroceder cuando el tramo ya enseña su carta (la mitad del giro). */
export const RETROCESO_MS = 480;
/** Entre un giro y el siguiente, si un paso gira varios tramos. */
export const SEPARACION_GIROS_MS = 240;
/** El ganador se anuncia cuando ha terminado de llegar a la meta (el avance dura 400 ms: queda un respiro por si el pintado se retrasa). */
export const GANADOR_MS = 520;
/** Los pagos se enseñan un momento después de anunciar al ganador. */
export const PAGOS_TRAS_GANADOR_MS = 420;
/** Los pagos de una mesa que se cierra sin carrera (alguien deja la mesa) se enseñan tras este respiro. */
export const PAGOS_SIN_CARRERA_MS = 250;
/** Si React junta dos mensajes en un pintado, el segundo paso sale este rato después del primero (como poco). */
export const PASO_COMPRIMIDO_MS = 400;

export interface Escena {
  ronda: number;
  /** La casilla (0 a `META`) en que se ve cada caballo. Pasa por cada valor de uno en uno; la pista anima el tránsito. */
  posiciones: Record<Palo, number>;
  /** Cuántos tramos se ven ya girados. */
  girados: number;
  /** Las últimas cartas sacadas junto al mazo: como mucho dos, la más reciente al final. `id` no se repite. */
  cartas: { id: number; carta: Carta }[];
  /** Cuántas cartas han salido: el `id` de la última. */
  n: number;
  /** El ganador, desde que se anuncia. */
  ganador: Palo | null;
  /** Cuántas victorias se han festejado: cambia en el instante de festejar (destellos). */
  festejo: number;
  /** Los pagos de la carrera, desde el momento de enseñarlos. */
  pagos: { id: number; netos: ReadonlyMap<JugadorId, number> } | null;
  /** Cuántos pagos se han enseñado en total (da el `id` del siguiente). */
  npagos: number;
  /** Sube cada vez que la pista salta de golpe a otra situación (primera vista, reconexión): se vuelve a montar sin animar. */
  epoca: number;
  /** De dónde sale la carta nueva (el mazo, en el momento en que llegó). Lo pone quien anima; solo cuenta para la carta `n`. */
  origen: DOMRect | null;
}

export interface Marco {
  /** Milisegundos desde que llegó el lote. */
  en: number;
  /** Lo que cambia en la escena en ese momento (valores absolutos, en el orden de los marcos). */
  parche: Partial<Escena>;
  /** La pista salta de golpe a la vista: sin animar. */
  salto?: boolean;
}

export interface Plan {
  marcos: Marco[];
  /** Cuándo suena una carta (al salir una, al girarse un tramo). */
  sonidos: number[];
}

const sinCasillas = (): Record<Palo, number> => ({ H: 0, D: 0, C: 0, S: 0 });

/** Lo que se ve antes de la primera vista: la pista vacía, sin caballos en marcha. */
export const ESCENA_VACIA: Escena = {
  ronda: 0,
  posiciones: sinCasillas(),
  girados: 0,
  cartas: [],
  n: 0,
  ganador: null,
  festejo: 0,
  pagos: null,
  npagos: 0,
  epoca: 0,
  origen: null,
};

/** Cuántos tramos se ven girados en la vista (los sin girar vienen como `null`). */
export const tramosGirados = (vista: VistaCarrera): number => vista.tramos.filter((t) => t !== null).length;

/**
 * La escena que corresponde a una vista tal cual, sin guion: lo que se ve al llegar o volver a la mesa. Si viene `previa`,
 * es un salto desde ella: sube la `epoca` (la pista se vuelve a montar) y siguen las cuentas de cartas, festejos y pagos.
 */
export function escenaDeVista(vista: VistaCarrera, previa?: Escena): Escena {
  const n = previa?.n ?? 0;
  return {
    ronda: vista.ronda,
    posiciones: { ...vista.posiciones },
    girados: tramosGirados(vista),
    cartas: vista.ultimaCarta ? [{ id: n, carta: vista.ultimaCarta }] : [],
    n,
    ganador: vista.ganador,
    festejo: previa?.festejo ?? 0,
    pagos: null,
    npagos: previa?.npagos ?? 0,
    epoca: previa ? previa.epoca + 1 : 0,
    origen: null,
  };
}

export const aplicarMarco = (escena: Escena, marco: Marco): Escena => ({ ...escena, ...marco.parche });

const mismasCasillas = (a: Record<Palo, number>, b: Record<Palo, number>): boolean => CABALLOS.every((p) => a[p] === b[p]);

/** La vista es la de una pista recién puesta: todos en la salida, nada girado, sin ganador. */
const esSalida = (vista: VistaCarrera): boolean => mismasCasillas(vista.posiciones, sinCasillas()) && tramosGirados(vista) === 0 && vista.ganador === null;

/** Ganador, carrera o giro: los eventos que mueven la pista. */
const mueveLaPista = (evento: Evento): boolean => evento.tipo === "caballo_avanza" || evento.tipo === "tramo_girado" || evento.tipo === "ganador";

/**
 * El guion de un lote de eventos para la vista que llegó con él. `previa` es la escena tal como está ahora (con lo que aún
 * esperaba del guion anterior ya aplicado), o `null` si es la primera vista.
 *
 * - Primera vista, o una vista que no cuadra con lo que se ve y llega sin eventos que lo expliquen (se volvió de una
 *   desconexión): la pista salta de golpe a la vista, sin repetir la carrera.
 * - Ronda nueva en la salida: los caballos vuelven a su casilla 0 y se recogen las cartas y el ganador.
 * - Pasos de la carrera: cada `caballo_avanza` es un paso; sus giros salen detrás y cada uno devuelve a su caballo. Si algo
 *   no cuadra al final con la vista (se perdió un paso), las casillas acaban siendo las de la vista.
 * - `pago`: se enseñan tras el ganador (o, sin carrera, tras un respiro).
 */
export function planDeLote(previa: Escena | null, lote: Evento[], vista: VistaCarrera): Plan {
  if (previa === null) return { marcos: [{ en: 0, parche: escenaDeVista(vista), salto: true }], sonidos: [] };

  const marcos: Marco[] = [];
  const sonidos: number[] = [];
  const netos = new Map<JugadorId, number>();
  for (const e of lote) if (e.tipo === "pago") netos.set(e.jugadorId as JugadorId, e.neto as number);

  let sim = previa;
  let ultimo = 0;
  const poner = (en: number, parche: Partial<Escena>, salto = false) => {
    sim = { ...sim, ...parche };
    ultimo = Math.max(ultimo, en);
    marcos.push(salto ? { en, parche, salto } : { en, parche });
  };

  const rondaNueva = vista.ronda !== previa.ronda;
  const hayCarrera = lote.some(mueveLaPista);
  const cuadra = !rondaNueva && mismasCasillas(vista.posiciones, previa.posiciones) && tramosGirados(vista) === previa.girados && vista.ganador === previa.ganador;

  if (rondaNueva && !hayCarrera && esSalida(vista)) {
    // Pista nueva: los caballos vuelven a la salida (la pista anima el regreso).
    poner(0, { ronda: vista.ronda, posiciones: { ...vista.posiciones }, girados: 0, cartas: [], ganador: null, pagos: null });
  } else if ((rondaNueva && hayCarrera) || (!hayCarrera && !cuadra)) {
    poner(0, escenaDeVista(vista, previa), true);
  } else if (hayCarrera) {
    let base = 0;
    let pasos = 0;
    let girosDelPaso = 0;
    let tGanador: number | null = null;
    for (const e of lote) {
      if (e.tipo === "caballo_avanza") {
        // Si React juntó dos mensajes, el paso siguiente sale cuando el anterior ya ha terminado de moverse.
        if (pasos > 0) base = Math.max(base + PASO_COMPRIMIDO_MS, ultimo + 20);
        pasos += 1;
        girosDelPaso = 0;
        const palo = e.palo as Palo;
        const n = sim.n + 1;
        poner(base, {
          posiciones: { ...sim.posiciones, [palo]: sim.posiciones[palo] + 1 },
          n,
          cartas: [...sim.cartas.slice(-1), { id: n, carta: e.carta as Carta }],
        });
        sonidos.push(base);
      } else if (e.tipo === "tramo_girado") {
        const palo = e.palo as Palo;
        const j = girosDelPaso++;
        const giro = base + GIRO_TRAMO_MS + j * SEPARACION_GIROS_MS;
        poner(giro, { girados: Math.max(sim.girados, (e.indice as number) + 1) });
        sonidos.push(giro);
        poner(base + RETROCESO_MS + j * SEPARACION_GIROS_MS, { posiciones: { ...sim.posiciones, [palo]: Math.max(0, sim.posiciones[palo] - 1) } });
      } else if (e.tipo === "ganador") {
        tGanador = base + GANADOR_MS;
        poner(tGanador, { ganador: e.palo as Palo, festejo: sim.festejo + 1 });
      }
    }
    if (!mismasCasillas(sim.posiciones, vista.posiciones) || sim.girados !== tramosGirados(vista) || sim.ganador !== vista.ganador) {
      poner(ultimo + 40, { posiciones: { ...vista.posiciones }, girados: tramosGirados(vista), ganador: vista.ganador });
    }
    if (netos.size > 0) {
      poner(tGanador === null ? ultimo + PAGOS_SIN_CARRERA_MS : tGanador + PAGOS_TRAS_GANADOR_MS, { pagos: { id: sim.npagos + 1, netos }, npagos: sim.npagos + 1 });
    }
    return { marcos: marcos.sort((a, b) => a.en - b.en), sonidos };
  }

  if (netos.size > 0) poner(ultimo + PAGOS_SIN_CARRERA_MS, { pagos: { id: sim.npagos + 1, netos }, npagos: sim.npagos + 1 });
  return { marcos, sonidos };
}
