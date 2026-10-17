import type { Carta } from "../cartas";

export const BJ = {
  BARAJAS: 6,
  MIN_ZAPATO: 78,
  APUESTAS_MS: 15_000,
  DECISIONES_MS: 15_000,
  BANCA_MS: 1_000,
  RESULTADO_MS: 4_000,
  MIN: 10,
  MAX: 500,
  MAX_JUGADORES: 6,
} as const;

function valorCarta(c: Carta): number {
  if (c.valor === "A") return 1;
  if (c.valor === "J" || c.valor === "Q" || c.valor === "K") return 10;
  return Number(c.valor);
}

/** Mejor total ≤ 21 si existe. `blanda` es true cuando un as cuenta ahora como 11. */
export function puntuacion(cartas: Carta[]): { total: number; blanda: boolean } {
  let total = 0;
  let hayAs = false;
  for (const carta of cartas) {
    total += valorCarta(carta);
    if (carta.valor === "A") hayAs = true;
  }
  if (hayAs && total + 10 <= 21) return { total: total + 10, blanda: true };
  return { total, blanda: false };
}

/** Blackjack natural: exactamente 2 cartas que suman 21. */
export function esBlackjack(cartas: Carta[]): boolean {
  return cartas.length === 2 && puntuacion(cartas).total === 21;
}

/** La banca pide con menos de 17 y se planta en cualquier 17 o más (también 17 blando). */
export function bancaDebePedir(cartas: Carta[]): boolean {
  return puntuacion(cartas).total < 17;
}

/**
 * Fichas que se devuelven al jugador por esta mano (apuesta incluida); neto = pago - apuesta.
 * `mano.apuesta` es lo que hay en juego en la mano (ya contando el doble si se dobló).
 * La banca no mira su carta tapada: si tiene blackjack gana a toda mano salvo a otro blackjack.
 * Una mano doblada nunca cuenta como blackjack natural.
 */
export function pago(mano: { cartas: Carta[]; apuesta: number; doblada: boolean }, banca: Carta[]): number {
  const { apuesta } = mano;
  const jugador = puntuacion(mano.cartas).total;
  const jugadorBlackjack = !mano.doblada && esBlackjack(mano.cartas);

  if (jugador > 21) return 0;
  if (esBlackjack(banca)) return jugadorBlackjack ? apuesta : 0;
  if (jugadorBlackjack) return apuesta + Math.floor((apuesta * 3) / 2);

  const total = puntuacion(banca).total;
  if (total > 21 || jugador > total) return apuesta * 2;
  if (jugador === total) return apuesta;
  return 0;
}

/** Apuesta válida: entero entre `BJ.MIN` y `BJ.MAX`, ambos inclusive. */
export function apuestaValida(cantidad: unknown): cantidad is number {
  return typeof cantidad === "number" && Number.isInteger(cantidad) && cantidad >= BJ.MIN && cantidad <= BJ.MAX;
}
