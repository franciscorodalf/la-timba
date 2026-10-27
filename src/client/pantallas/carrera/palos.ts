import type { Carta, Palo } from "../../../shared/cartas";

/** Los caballos son los cuatro palos; cada uno corre con su as. */
export const NOMBRE_PALO: Record<Palo, string> = { H: "corazones", D: "diamantes", C: "tréboles", S: "picas" };

/** El símbolo del palo (con el selector de texto: sin emoji). */
export const SIMBOLO_PALO: Record<Palo, string> = { H: "♥︎", D: "♦︎", C: "♣︎", S: "♠︎" };

export const esRojo = (palo: Palo): boolean => palo === "H" || palo === "D";

export const AS_DE: Record<Palo, Carta> = {
  H: { palo: "H", valor: "A" },
  D: { palo: "D", valor: "A" },
  C: { palo: "C", valor: "A" },
  S: { palo: "S", valor: "A" },
};
