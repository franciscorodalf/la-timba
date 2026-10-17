import type { Carta, Palo, Rng, Valor } from "../src/shared/cartas";

/** Parsea una carta: valor = todo menos el último carácter, palo = el último. `c("10H")`, `c("AS")`. */
export function c(texto: string): Carta {
  return {
    valor: texto.slice(0, -1) as Valor,
    palo: texto.slice(-1) as Palo,
  };
}

/** Parsea varias cartas separadas por espacios: `cs("KH 7C")`. */
export function cs(texto: string): Carta[] {
  return texto.trim().split(/\s+/).map(c);
}

/** Rng determinista: devuelve los valores dados en orden, en ciclo. */
export function rngFijo(...valores: number[]): Rng {
  let i = 0;
  return () => valores[i++ % valores.length];
}
