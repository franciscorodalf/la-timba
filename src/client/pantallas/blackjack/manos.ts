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

/**
 * Lo que mide como mínimo la columna de cada mano cuando hay varias (índice: número de manos): debajo de las cartas van el total y
 * la apuesta, que con dos manos caben en una línea (~88 px) o, en una columna estrecha, una encima de la otra (~48 px). Una mano
 * sola lleva eso en la línea de tu nombre, no debajo.
 */
const COLUMNA_MINIMA = [0, 0, 64, 56, 48];

export interface Disposicion {
  /** El ancho de cada carta, en píxeles. */
  ancho: number;
  /** El margen entre cartas de una mano, en anchos de carta (negativo: se tapan). */
  solape: number;
  /** Lo que ocupa cada mano en horizontal: el de sus cartas o, si es más, lo que pide lo que lleva debajo (`COLUMNA_MINIMA`). */
  columnas: number[];
}

/**
 * Cómo se colocan tus manos (`cartas`: cuántas tiene cada una) para que quepan en `disponible` píxeles con `hueco` entre ellas. El
 * ancho de carta parte de `base` (el de una sola mano) y baja con el número de manos; si aun así no caben, primero se tapan más las
 * cartas y, solo si ni así, se encogen (hasta un mínimo). Cada columna mide lo que sus cartas, pero no menos de lo que necesita el
 * pie de la mano (su total y su apuesta): así lo que se mide aquí es lo que ocupa la fila de verdad.
 */
export function disponerManos(cartas: number[], base: number, disponible: number, hueco: number): Disposicion {
  const manos = Math.max(1, cartas.length);
  const clase = Math.min(manos, 4);
  const lista = cartas.length === 0 ? [0] : cartas;
  const util = disponible - hueco * (manos - 1);
  const columnas = (ancho: number, visible: number) => lista.map((n) => Math.max(Math.ceil(ancho * (1 + Math.max(n - 1, 0) * visible)), COLUMNA_MINIMA[clase]));
  const cabe = (ancho: number, visible: number) => columnas(ancho, visible).reduce((suma, c) => suma + c, 0) <= util;

  let ancho = Math.round(base * ESCALA[clase]);
  const preferido = manos === 1 && (cartas[0] ?? 0) > 5 ? VISIBLE_MUCHAS : VISIBLE[clase];
  let visible = preferido;
  if (!cabe(ancho, visible)) {
    // Lo más que se puede mostrar de cada carta sin salirse (una búsqueda: más visible, más ancho). Si ni a lo mínimo cabe, se encogen.
    visible = VISIBLE_MINIMO;
    if (cabe(ancho, visible)) {
      let [poco, mucho] = [VISIBLE_MINIMO, preferido];
      for (let i = 0; i < 20; i++) {
        const medio = (poco + mucho) / 2;
        if (cabe(ancho, medio)) poco = medio;
        else mucho = medio;
      }
      visible = poco;
    } else {
      let [poco, mucho] = [ANCHO_MINIMO, ancho];
      while (poco < mucho) {
        const medio = Math.ceil((poco + mucho) / 2);
        if (cabe(medio, visible)) poco = medio;
        else mucho = medio - 1;
      }
      ancho = poco;
    }
  }
  // Hacia abajo: redondear hacia arriba podría hacer que dejara de caber.
  visible = Math.floor(visible * 1000 + 1e-6) / 1000;
  return { ancho, solape: -Math.round((1 - visible) * 1000) / 1000, columnas: columnas(ancho, visible) };
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
