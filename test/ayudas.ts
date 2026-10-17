import type { Carta, Palo, Rng, Valor } from "../src/shared/cartas";

const PALOS: ReadonlySet<string> = new Set<Palo>(["H", "D", "C", "S"]);
const VALORES: ReadonlySet<string> = new Set<Valor>(["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]);

/**
 * Parsea una carta: valor = todo menos el último carácter, palo = el último. `c("10H")`, `c("AS")`.
 * Lanza si el valor o el palo no existen, para que un error de tipeo en un fixture falle de inmediato.
 */
export function c(texto: string): Carta {
  const valor = texto.slice(0, -1);
  const palo = texto.slice(-1);
  if (!VALORES.has(valor) || !PALOS.has(palo)) throw new Error(`Carta desconocida: "${texto}"`);
  return { valor: valor as Valor, palo: palo as Palo };
}

/** Parsea varias cartas separadas por espacios: `cs("KH 7C")`. Una cadena vacía o de espacios da `[]`. */
export function cs(texto: string): Carta[] {
  const limpio = texto.trim();
  return limpio === "" ? [] : limpio.split(/\s+/).map(c);
}

/** Rng determinista: devuelve los valores dados en orden, en ciclo. */
export function rngFijo(...valores: number[]): Rng {
  let i = 0;
  return () => valores[i++ % valores.length];
}
