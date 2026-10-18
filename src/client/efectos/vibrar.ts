/**
 * Una vibración corta de `ms` milisegundos donde exista `navigator.vibrate` (Android). En el resto, nada. Antes del primer
 * toque en la página no se intenta: el navegador la bloquearía y dejaría un aviso en la consola.
 */
export function vibrar(ms: number): void {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } });
  if (typeof nav?.vibrate !== "function" || nav.userActivation?.hasBeenActive === false) return;
  try {
    nav.vibrate(ms);
  } catch {
    // Sin permiso o sin motor de vibración: no pasa nada.
  }
}
