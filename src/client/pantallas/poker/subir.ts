import { POKER } from "../../../shared/juegos/poker";

/** Entre qué totales de la ronda se puede subir (`opciones.subir`). */
export interface LimitesSubida {
  min: number;
  max: number;
}

/**
 * La cantidad escrita en el campo de subir, o `null` si no vale: solo cifras (nada de signos, decimales ni «1e3»), un entero
 * seguro y dentro de los límites. Lo que `null` deja sin mandar es lo que el servidor rechazaría igualmente.
 */
export function leerCantidad(texto: string, { min, max }: LimitesSubida): number | null {
  const limpio = texto.trim();
  if (!/^[0-9]+$/.test(limpio)) return null;
  const cantidad = Number(limpio);
  return Number.isSafeInteger(cantidad) && cantidad >= min && cantidad <= max ? cantidad : null;
}

/** Lo que suman o restan «+» y «−»: una ciega grande, o todo el rango si es más corto. Nunca menos de 1. */
export function pasoDeSubida({ min, max }: LimitesSubida): number {
  return Math.max(1, Math.min(POKER.CIEGA_GRANDE, max - min));
}
