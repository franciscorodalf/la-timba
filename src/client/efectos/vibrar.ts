import { mesaTapada } from "./ventana";

/**
 * Una vibración corta de `ms` milisegundos donde exista `navigator.vibrate` (Android). En el resto, nada. Antes del primer
 * toque en la página no se intenta: el navegador la bloquearía y dejaría un aviso en la consola. Tampoco mientras el aviso de
 * girar el móvil tapa la mesa.
 */
export function vibrar(ms: number): void {
  if (mesaTapada()) return;
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } });
  if (typeof nav?.vibrate !== "function" || nav.userActivation?.hasBeenActive === false) return;
  try {
    nav.vibrate(ms);
  } catch {
    // Sin permiso o sin motor de vibración: no pasa nada.
  }
}
