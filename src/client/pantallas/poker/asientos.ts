import type { AsientoVista } from "../../../shared/juegos/poker";
import type { JugadorId } from "../../../shared/juegos/tipos";

// Dónde se sienta cada uno en el tapete. Todo en porcentaje del tapete (x desde la izquierda, y desde arriba), con el origen en el
// centro de lo que se coloca. Las posiciones del móvil son las del boceto aprobado, en un tapete algo más ancho que alto para dejar sitio a tus cartas y a los botones (los dos de los lados, un 2 % más hacia el borde para no tocar las cinco cartas de la mesa); las del ordenador son las de una elipse.

export interface Punto {
  x: number;
  y: number;
}

/** Un rectángulo en píxeles, para comprobar que nada se pisa. */
export interface Caja {
  izq: number;
  der: number;
  arr: number;
  aba: number;
}

export interface AsientoColocado {
  asiento: AsientoVista;
  /** El centro de la placa y las cartas del asiento. */
  x: number;
  y: number;
  /** Dónde queda lo que ha apostado en la ronda: entre el asiento y el centro. */
  apuesta: Punto;
}

/** El tapete de referencia, en píxeles, con el que se comprueba que los asientos caben (el real se estira, pero no cambia la forma). */
export const TAPETE_REFERENCIA = { movil: { ancho: 300, alto: 363 }, ordenador: { ancho: 880, alto: 440 } } as const;
/** Lo que ocupa un asiento (placa, cartas pequeñas y pila) en el tapete de referencia. */
export const CAJA_ASIENTO = { movil: { ancho: 62, alto: 64 }, ordenador: { ancho: 100, alto: 93 } } as const;
/** Lo que ocupa lo apostado (ficha y cantidad), con una cantidad de hasta tres cifras: con más, la cantidad crece hacia el centro. */
export const CAJA_APUESTA = { movil: { ancho: 52, alto: 18 }, ordenador: { ancho: 66, alto: 22 } } as const;
/** El centro: las cinco cartas de la mesa con «Bote N» debajo. `y` es el centro del conjunto, en porcentaje. */
export const CAJA_CENTRO = { movil: { ancho: 150, alto: 64, y: 44 }, ordenador: { ancho: 312, alto: 106, y: 44 } } as const;

/**
 * Por dónde se sujeta lo apostado al punto que le toca: por el borde que mira al centro del tapete (el izquierdo en los asientos de
 * la izquierda, el derecho en los de la derecha) o por el medio si está en el eje. Así una cantidad larga crece hacia el centro y
 * nunca llega a su propio asiento.
 */
export const anclaDeApuesta = (x: number): "izq" | "centro" | "der" => (x < 50 ? "izq" : x > 50 ? "der" : "centro");

interface Hueco {
  x: number;
  y: number;
  apuesta: Punto;
}

/** Tu sitio, abajo en el centro. */
const MI_SITIO = {
  movil: { x: 50, y: 91, apuesta: { x: 50, y: 73 } },
  ordenador: { x: 50, y: 88, apuesta: { x: 50, y: 69 } },
} as const satisfies Record<string, Hueco>;

/**
 * Los sitios de los demás, en el sentido del reloj visto desde arriba empezando por el que queda a tu izquierda: primero el de
 * abajo a la izquierda, luego se sube por ese lado, se cruza por arriba y se baja por la derecha.
 */
const ANILLO = {
  movil: [
    { x: 20, y: 73, apuesta: { x: 32, y: 64 } },
    { x: 13, y: 45, apuesta: { x: 30, y: 57 } },
    { x: 18, y: 19, apuesta: { x: 30, y: 31 } },
    { x: 50, y: 9, apuesta: { x: 50, y: 25 } },
    { x: 82, y: 19, apuesta: { x: 70, y: 31 } },
    { x: 87, y: 45, apuesta: { x: 70, y: 57 } },
    { x: 80, y: 73, apuesta: { x: 68, y: 64 } },
  ],
  ordenador: [
    { x: 22, y: 77, apuesta: { x: 30, y: 72 } },
    { x: 10, y: 50, apuesta: { x: 19, y: 50 } },
    { x: 22, y: 23, apuesta: { x: 30, y: 28 } },
    { x: 50, y: 12, apuesta: { x: 50, y: 27 } },
    { x: 78, y: 23, apuesta: { x: 70, y: 28 } },
    { x: 90, y: 50, apuesta: { x: 81, y: 50 } },
    { x: 78, y: 77, apuesta: { x: 70, y: 72 } },
  ],
} as const satisfies Record<string, readonly Hueco[]>;

/** Qué sitios del anillo se usan según cuántos rivales hay (de 1 a 7): repartidos y simétricos, sin amontonarse en un lado. */
const SITIOS_SEGUN_RIVALES: readonly (readonly number[])[] = [[], [3], [2, 4], [1, 3, 5], [0, 2, 4, 6], [0, 1, 3, 5, 6], [0, 1, 2, 4, 5, 6], [0, 1, 2, 3, 4, 5, 6]];

/**
 * Coloca a todos los sentados con tú abajo y los demás en el orden de sus asientos, empezando por el siguiente al tuyo. Si no
 * estás sentado (miras), el asiento de número más bajo va abajo. Devuelve primero a quien va abajo y luego al resto, en el orden
 * en que se sientan.
 */
export function colocarAsientos(asientos: AsientoVista[], yo: JugadorId | null, ordenador: boolean): AsientoColocado[] {
  if (asientos.length === 0) return [];
  const medida = ordenador ? "ordenador" : "movil";
  const porNumero = [...asientos].sort((a, b) => a.asiento - b.asiento);
  const mio = Math.max(0, yo === null ? -1 : porNumero.findIndex((a) => a.jugadorId === yo));
  const desdeMi = [...porNumero.slice(mio), ...porNumero.slice(0, mio)];
  const sitios = SITIOS_SEGUN_RIVALES[desdeMi.length - 1];

  return desdeMi.map((asiento, i) => {
    const hueco: Hueco = i === 0 ? MI_SITIO[medida] : ANILLO[medida][sitios[i - 1]];
    return { asiento, x: hueco.x, y: hueco.y, apuesta: hueco.apuesta };
  });
}
