import { useSyncExternalStore } from "react";

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
