import type { VistaBJ } from "../../../shared/juegos/blackjack";
import type { JugadorId } from "../../../shared/juegos/tipos";

// Lo que la mesa de blackjack calcula de las manos que ve: cuál es la activa, qué tamaño tienen las cartas de las tuyas para que
// quepan en fila y cómo se agrupan las de los demás. Todo puro.

export type ManoVista = VistaBJ["manos"][number];

/** El lugar de `manos` (las de un jugador, en el orden de la vista) de la mano activa: la primera que sigue en juego; `-1` si ninguna. */
export function activaDe(manos: ManoVista[]): number {
  return manos.findIndex((m) => m.estado === "jugando");
}

/** Cuánto de su ancho conserva la carta según cuántas manos hay (índice: número de manos; con más de cuatro, como cuatro). */
const ESCALA = [1, 1, 0.75, 0.58, 0.58];
/** Qué fracción de cada carta queda a la vista cuando la tapa la siguiente, según cuántas manos hay. Una mano: lo de siempre. */
const VISIBLE = [0.58, 0.58, 0.5, 0.45, 0.45];
/** Con una sola mano de más de cinco cartas se solapan más para que quepa. */
const VISIBLE_MUCHAS = 0.38;
/** Lo mínimo que asoma de una carta tapada por la siguiente (que se lea el valor) y lo mínimo que mide una carta. */
const VISIBLE_MINIMO = 0.26;
const ANCHO_MINIMO = 24;

export interface Disposicion {
  /** El ancho de cada carta, en píxeles. */
  ancho: number;
  /** El margen entre cartas de una mano, en anchos de carta (negativo: se tapan). */
  solape: number;
}

/**
 * Cómo se colocan las cartas de tus manos (`cartas`: cuántas tiene cada una) para que quepan en `disponible` píxeles con `hueco`
 * entre manos. El ancho parte de `base` (el de una sola mano) y baja con el número de manos; si aun así no caben, primero se tapan
 * más las cartas y, solo si ni así, se encogen (hasta un mínimo).
 */
export function disponerManos(cartas: number[], base: number, disponible: number, hueco: number): Disposicion {
  const manos = Math.max(1, cartas.length);
  const clase = Math.min(manos, 4);
  let ancho = Math.round(base * ESCALA[clase]);
  const preferido = manos === 1 && (cartas[0] ?? 0) > 5 ? VISIBLE_MUCHAS : VISIBLE[clase];
  // Cartas que asoman, sumadas las de todas las manos (la primera de cada una se ve entera).
  const asoman = cartas.reduce((suma, n) => suma + Math.max(n - 1, 0), 0);
  const util = disponible - hueco * (manos - 1);
  const mide = (a: number, visible: number) => a * (manos + visible * asoman);

  let visible = preferido;
  if (mide(ancho, visible) > util && asoman > 0) {
    visible = Math.max(VISIBLE_MINIMO, Math.min(preferido, (util / ancho - manos) / asoman));
    if (mide(ancho, visible) > util) ancho = Math.max(ANCHO_MINIMO, Math.min(ancho, Math.floor(util / (manos + visible * asoman))));
  }
  return { ancho, solape: -Math.round((1 - visible) * 1000) / 1000 };
}

export interface Otro {
  apodo: string;
  /** Todas sus manos de esta ronda, en orden; ninguna si solo mira. */
  manos: ManoVista[];
}

/**
 * El resto de la mesa: los sentados por orden de llegada (sin ti) y quien se fue con una mano en juego, que sigue hasta que
 * acaba la ronda. Cada uno con todas sus manos juntas.
 */
export function agruparOtros(vista: Pick<VistaBJ, "sentados" | "manos" | "yo">, yoApodo: string | undefined): Otro[] {
  const otros: Otro[] = [];
  for (const apodo of vista.sentados) {
    if (apodo.toLowerCase() !== yoApodo) otros.push({ apodo, manos: vista.manos.filter((m) => m.apodo === apodo) });
  }
  const yaEstan = new Set<ManoVista>(otros.flatMap((o) => o.manos));
  const sueltos = new Map<JugadorId, Otro>();
  for (const mano of vista.manos) {
    if (mano.jugadorId === vista.yo || yaEstan.has(mano)) continue;
    let otro = sueltos.get(mano.jugadorId);
    if (otro === undefined) {
      otro = { apodo: mano.apodo, manos: [] };
      sueltos.set(mano.jugadorId, otro);
      otros.push(otro);
    }
    otro.manos.push(mano);
  }
  return otros;
}
