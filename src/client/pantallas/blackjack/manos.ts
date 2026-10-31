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

/** Lo mismo con las manos acopladas bajo los vecinos: el total y la apuesta (sin la pila de fichas) van en una sola línea. */
const COLUMNA_ACOPLADA = [0, 0, 70, 66, 64];

/**
 * Lo mínimo que mide una carta para que siga siendo útil: con 36 px todavía se ve el palo y el valor de su esquina (el total de la
 * mano lo dice además aparte). Por debajo, apretar las cartas no gana sitio: lo que manda es lo que va debajo de ellas.
 */
export const ANCHO_LEGIBLE = 36;

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
 * ancho de carta parte de `base` (el de una sola mano) y baja con el número de manos (sin pasar de `maximo`); si aun así no caben,
 * primero se tapan más las cartas y, solo si ni así, se encogen (hasta un mínimo). Cada columna mide lo que sus cartas, pero no menos
 * de lo que necesita el pie de la mano (su total y su apuesta): así lo que se mide aquí es lo que ocupa la fila de verdad. Si ni con
 * las cartas al mínimo caben las columnas, no se encogen: no ganarían sitio y quedarían inservibles.
 */
export function disponerManos(cartas: number[], base: number, disponible: number, hueco: number, opciones: { maximo?: number; columnaMinima?: number } = {}): Disposicion {
  const manos = Math.max(1, cartas.length);
  const clase = Math.min(manos, 4);
  const lista = cartas.length === 0 ? [0] : cartas;
  const util = disponible - hueco * (manos - 1);
  const minima = opciones.columnaMinima ?? COLUMNA_MINIMA[clase];
  const columnas = (ancho: number, visible: number) => lista.map((n) => Math.max(Math.ceil(ancho * (1 + Math.max(n - 1, 0) * visible)), minima));
  const cabe = (ancho: number, visible: number) => columnas(ancho, visible).reduce((suma, c) => suma + c, 0) <= util;

  let ancho = Math.min(Math.round(base * ESCALA[clase]), opciones.maximo ?? Infinity);
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
    } else if (cabe(ANCHO_MINIMO, visible)) {
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

/** Dónde se sientan los demás: cada hueco del arco se aparta `paso` grados del centro sobre una elipse (en % del tapete). */
export const ARCO = { paso: 23, radioX: 41, radioY: 88 } as const;

/** Dónde acaban (su borde de abajo, en fracción del alto del tapete) los asientos de los lados del tuyo: el primer hueco del arco. */
const FONDO_VECINOS = (ARCO.radioY / 100) * Math.cos((ARCO.paso * Math.PI) / 180);

/** Lo que mide, acopladas bajo los vecinos, la línea del total y la apuesta de cada mano, y el hueco entre ella y las cartas. */
const PIE_ACOPLADO = 20 + 4;
/** El margen del tapete por abajo y el que se deja sin pisar el fondo de los vecinos por arriba. */
const MARGEN_ACOPLADO = 4 + 3;

/**
 * Lo más ancha que puede ser una carta de tus manos acopladas bajo los vecinos (`alto`: el del tapete): entre el fondo de sus asientos
 * y el borde del tapete queda el 19 % del alto, y de ahí salen la línea del total y la apuesta, los márgenes y las cartas (5:7).
 */
export function anchoAcoplado(alto: number): number {
  return Math.floor((alto * (1 - FONDO_VECINOS) - PIE_ACOPLADO - MARGEN_ACOPLADO) / 1.4);
}

/** Lo que se ha medido del tapete de ordenador: el hueco entre tus vecinos (el doble de lo que se aparta el más cercano) y su ancho y alto. */
export interface Espacio {
  libre: number;
  ancho: number;
  alto: number;
}

export interface DisposicionEnElArco extends Disposicion {
  /** `fila`: en tu sitio, entre tus vecinos. `acoplada`: bajo los asientos de los lados, donde no hay nadie. */
  modo: "fila" | "acoplada";
  /** Cuánto se sube, en píxeles, una fila acoplada del borde de abajo del tapete (lo que sobra de alto y hace falta para no salirse de su curva). */
  sube: number;
}

/**
 * Dónde está el borde de abajo del tapete (medido desde su borde de arriba) a `mitad` píxeles del centro. Sus esquinas de abajo son
 * una elipse de radios 50 % × 100 % que el navegador reduce a `alto / (alto + 56)` (las de arriba suman 56 px): queda un tramo recto
 * en el centro y, a los lados, el borde sube.
 */
export function bordeInferior(ancho: number, alto: number, mitad: number): number {
  const reduccion = alto / (alto + 56);
  const radioX = (ancho / 2) * reduccion;
  const radioY = alto * reduccion;
  const recto = ancho / 2 - radioX;
  const desvio = Math.min(Math.max(0, mitad - recto) / radioX, 1);
  return alto - radioY * (1 - Math.sqrt(1 - desvio * desvio));
}

/**
 * Cómo se colocan tus manos en la mesa de ordenador. Con una mano, o si caben entre tus vecinos (`espacio.libre`, medido sobre sus
 * asientos tal como están) con cartas legibles, van en fila en tu sitio. Si no caben, se acoplan bajo el fondo de los asientos de los
 * lados (el 81 % del tapete): ahí no hay nadie, así que el ancho no importa y solo manda el alto del tapete (`anchoAcoplado`).
 * Así nada depende de lo grandes que sean los vecinos ni del tamaño de la ventana.
 */
export function disponerEnElArco(cartas: number[], base: number, espacio: Espacio | null, disponible: number, hueco: number): DisposicionEnElArco {
  const fila = disponerManos(cartas, base, espacio === null ? disponible : Math.min(disponible, espacio.libre), hueco);
  if (cartas.length < 2 || espacio === null) return { modo: "fila", sube: 0, ...fila };
  const ancho = (d: Disposicion) => d.columnas.reduce((suma, c) => suma + c, 0) + hueco * (cartas.length - 1);
  if (ancho(fila) <= espacio.libre && fila.ancho >= ANCHO_LEGIBLE) return { modo: "fila", sube: 0, ...fila };
  const clase = Math.min(cartas.length, 4);
  const acoplada = disponerManos(cartas, base, disponible, hueco, { maximo: anchoAcoplado(espacio.alto), columnaMinima: COLUMNA_ACOPLADA[clase] });
  // Con alto de sobra, la fila sube lo que haga falta para que sus extremos no se salgan por la curva del tapete (sin pisar a los vecinos).
  const sobra = Math.floor((anchoAcoplado(espacio.alto) - acoplada.ancho) * 1.4);
  const fuera = Math.ceil(espacio.alto - bordeInferior(espacio.ancho, espacio.alto, ancho(acoplada) / 2));
  return { modo: "acoplada", sube: Math.max(0, Math.min(sobra, fuera)), ...acoplada };
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
