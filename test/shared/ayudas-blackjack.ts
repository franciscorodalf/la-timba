import { crearBaraja, type Carta } from "../../src/shared/cartas";
import type { EstadoBJ, ManoBJ } from "../../src/shared/juegos/blackjack";
import type { Paso } from "../../src/shared/juegos/tipos";
import { cs, rngFijo } from "../ayudas";

/** Instante base de los tests de las reglas del blackjack. */
export const T0 = 1_000_000;
export const rng = rngFijo(0.5);
/** Cartas de relleno al final del zapato (2 barajas: nunca provocan un rebarajado por sí solas). */
export const RELLENO = crearBaraja(2);

export function estado(parcial: Partial<EstadoBJ> = {}): EstadoBJ {
  return { ronda: 1, fase: "esperando", finFase: null, zapato: [], banca: [], asientos: [], manos: [], seguros: [], bancaMirada: false, ventanasVacias: 0, ...parcial };
}
export const asiento = (jugadorId: number, apodo: string, conectado = true) => ({ jugadorId, apodo, conectado });
/** Una mano en la casilla 0 y sin dividir; los tests con varias manos del mismo jugador ponen `casilla` e `indice`. */
export const mano = (jugadorId: number, apodo: string, parcial: Partial<ManoBJ> = {}): ManoBJ => ({
  jugadorId,
  apodo,
  casilla: 0,
  indice: 0,
  apuesta: 50,
  cartas: [],
  estado: "jugando",
  doblada: false,
  dividida: false,
  abandonada: false,
  ...parcial,
});
/** Zapato conocido: las primeras cartas se reparten en el orden escrito; detrás, relleno. */
export const zapato = (texto: string): Carta[] => [...cs(texto), ...RELLENO];

export function exito(p: Paso<EstadoBJ>) {
  if (!p.ok) throw new Error(`se esperaba ok y llegó el error ${p.error}`);
  return p;
}
export const error = (p: Paso<EstadoBJ>) => (p.ok ? "ok" : p.error);
