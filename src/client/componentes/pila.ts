/** Los valores de las fichas de las mesas. */
export const VALORES_FICHA = [10, 25, 50, 100, 500] as const;

/** Cuántas fichas se apilan como mucho en una casilla: lo que pasa ya no se ve más alto, lo dice el número. */
export const MAX_PILA = 10;

/**
 * Las fichas con las que se dibuja `cantidad` en la casilla del tapete, de abajo arriba: las más grandes primero. Es solo un
 * dibujo: lo que no cabe en fichas (los 5 de un pago 3:2) no se ve, y más de `MAX_PILA` fichas no se apilan.
 */
export function desglose(cantidad: number): number[] {
  const pila: number[] = [];
  let resto = cantidad;
  for (const valor of [...VALORES_FICHA].reverse()) {
    while (resto >= valor && pila.length < MAX_PILA) {
      pila.push(valor);
      resto -= valor;
    }
  }
  return pila;
}
