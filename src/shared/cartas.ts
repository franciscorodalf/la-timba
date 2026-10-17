export type Palo = "H" | "D" | "C" | "S";
export type Valor = "A" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "J" | "Q" | "K";
export interface Carta {
  palo: Palo;
  valor: Valor;
}
/** Generador de números en [0, 1). */
export type Rng = () => number;

const PALOS: readonly Palo[] = ["H", "D", "C", "S"];
const VALORES: readonly Valor[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/** `numBarajas` barajas de 52 cartas, en orden fijo (sin barajar). */
export function crearBaraja(numBarajas = 1): Carta[] {
  const baraja: Carta[] = [];
  for (let n = 0; n < numBarajas; n++) {
    for (const palo of PALOS) {
      for (const valor of VALORES) baraja.push({ palo, valor });
    }
  }
  return baraja;
}

/** Fisher–Yates. Devuelve una copia barajada; no muta la entrada. */
export function barajar<T>(items: readonly T[], rng: Rng): T[] {
  const copia = [...items];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/** Rng criptográfico: `crypto.getRandomValues` sobre un `Uint32Array(1)`, dividido entre 2^32. */
export function rngCripto(): Rng {
  const buffer = new Uint32Array(1);
  return () => crypto.getRandomValues(buffer)[0] / 2 ** 32;
}

/** Nombre del componente de `@letele/playing-cards`: `H10`, `Sa`, `Dk`, `Cq`, `Hj`. */
export function codigoCarta(c: Carta): string {
  const valor = /^\d+$/.test(c.valor) ? c.valor : c.valor.toLowerCase();
  return c.palo + valor;
}
