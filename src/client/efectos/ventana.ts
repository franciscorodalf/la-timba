import { useSyncExternalStore } from "react";

/** A partir de este ancho, las mesas usan su vista de ordenador (todo el tapete); por debajo, la vista de móvil. */
export const ORDENADOR_PX = 900;

/**
 * Cuándo el aviso «Gira el móvil para jugar» tapa la mesa: puntero táctil, pantalla apaisada y 500 px de alto o menos. La misma
 * consulta, palabra por palabra, que usa `tema/girar-movil.css`.
 */
export const MESA_TAPADA = "(pointer: coarse) and (orientation: landscape) and (max-height: 500px)";

/** `true` mientras el aviso de girar el móvil tapa la mesa: lo que pasa detrás ni se oye ni se nota. */
export function mesaTapada(): boolean {
  return typeof matchMedia === "function" && matchMedia(MESA_TAPADA).matches;
}

function suscribir(avisar: () => void): () => void {
  window.addEventListener("resize", avisar);
  return () => window.removeEventListener("resize", avisar);
}

/** El ancho de la ventana en píxeles; se actualiza al cambiar de tamaño (o de orientación el móvil). */
export function useAnchoVentana(): number {
  return useSyncExternalStore(suscribir, () => window.innerWidth, () => 1024);
}

/** El alto de la ventana en píxeles. */
export function useAltoVentana(): number {
  return useSyncExternalStore(suscribir, () => window.innerHeight, () => 768);
}
