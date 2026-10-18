import { useSyncExternalStore } from "react";

const CONSULTA = "(prefers-reduced-motion: reduce)";

let lista: MediaQueryList | null | undefined;

/** La consulta del sistema, creada una sola vez: cada carta la lee en cada pintado. */
function consulta(): MediaQueryList | null {
  lista ??= typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(CONSULTA) : null;
  return lista;
}

function suscribir(avisar: () => void): () => void {
  const actual = consulta();
  actual?.addEventListener("change", avisar);
  return () => actual?.removeEventListener("change", avisar);
}

/** El sistema pide menos movimiento ahora mismo. */
const movimientoReducido = (): boolean => consulta()?.matches ?? false;

/**
 * `true` si el sistema pide menos movimiento (`prefers-reduced-motion: reduce`). Se actualiza en cuanto cambia el ajuste.
 * Con movimiento reducido las animaciones se quedan en fundidos: nada vuela, gira ni rebota.
 */
export function useMovimientoReducido(): boolean {
  return useSyncExternalStore(suscribir, movimientoReducido, () => false);
}
