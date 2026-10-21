import { CARRERA } from "../../../shared/juegos/carrera";

// Las medidas de la pista. La carrera va a lo largo de un eje (de abajo arriba en móvil, de izquierda a derecha en
// ordenador) y los cuatro carriles se reparten a lo ancho. En píxeles, para que los caballos se desplacen con `transform`
// sin que el navegador tenga que recalcular nada. La casilla `k` (0 a `META`) es el punto de la pista donde la punta del
// caballo toca la línea `k`: en la 0 está la salida, en la `META` la meta, y en las intermedias cuelgan los tramos.

/** Lo que se ve de la pista detrás del caballo antes de la salida. */
const SALIDA = 10;
/** El grosor de la franja de meta (a cuadros) al final de la pista. */
const META = 24;
/** Lo que mide la franja de los tramos a lo ancho: en móvil es una columna junto a los carriles; en ordenador, una fila encima. */
export const FRANJA_VERTICAL = 76;
export const FRANJA_HORIZONTAL = 92;
/** Proporción de una carta. */
const ALTO_POR_ANCHO = 1.4;

export interface Geometria {
  horizontal: boolean;
  /** Lo que avanza un caballo por casilla, en píxeles. */
  paso: number;
  caballoAncho: number;
  caballoAlto: number;
  /** Lo que mide el caballo a lo largo de la carrera. */
  caballoLargo: number;
  salida: number;
  meta: number;
  tramoAncho: number;
  tramoAlto: number;
  franja: number;
  mazoAncho: number;
}

const entre = (minimo: number, valor: number, maximo: number): number => Math.max(minimo, Math.min(maximo, valor));

/**
 * Las medidas de la pista para una caja de `largo` píxeles a lo largo de la carrera y `ancho` a lo ancho (los cuatro
 * carriles juntos). El caballo ocupa casi todo su carril; el tramo, la franja; y el paso es lo que queda de pista dividido
 * entre las `META` casillas.
 */
export function geometria(largo: number, ancho: number, horizontal: boolean): Geometria {
  const carril = ancho / 4;
  const caballoAncho = horizontal
    ? Math.round(entre(28, (carril * 0.84) / ALTO_POR_ANCHO, 66))
    : Math.round(entre(28, Math.min(carril * 0.74, largo * 0.118), 64));
  const caballoAlto = Math.round(caballoAncho * ALTO_POR_ANCHO);
  const caballoLargo = horizontal ? caballoAncho : caballoAlto;
  const paso = Math.max(12, (largo - SALIDA - caballoLargo - META) / CARRERA.META);
  const franja = horizontal ? FRANJA_HORIZONTAL : FRANJA_VERTICAL;
  // En ordenador el tramo llena la franja; en móvil, si el paso es corto, los tramos se solapan un poco (se ve su esquina).
  const tramoAncho = horizontal ? Math.floor((franja - 16) / ALTO_POR_ANCHO) : Math.round(entre(32, Math.floor((paso * 0.95) / ALTO_POR_ANCHO), 46));
  return {
    horizontal,
    paso,
    caballoAncho,
    caballoAlto,
    caballoLargo,
    salida: SALIDA,
    meta: META,
    tramoAncho,
    tramoAlto: Math.round(tramoAncho * ALTO_POR_ANCHO),
    franja,
    mazoAncho: horizontal ? 50 : 32,
  };
}

/** Las variables CSS que usa la pista (en píxeles, salvo `--franja` que se pone aparte). */
export function variablesDe(g: Geometria): Record<string, string> {
  return {
    "--paso": `${g.paso.toFixed(2)}px`,
    "--cab-ancho": `${g.caballoAncho}px`,
    "--cab-alto": `${g.caballoAlto}px`,
    "--cab-largo": `${g.caballoLargo}px`,
    "--salida": `${g.salida}px`,
    "--meta": `${g.meta}px`,
    "--tramo-ancho": `${g.tramoAncho}px`,
    "--tramo-alto": `${g.tramoAlto}px`,
    "--mazo-ancho": `${g.mazoAncho}px`,
  };
}
