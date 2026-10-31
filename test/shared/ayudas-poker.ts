import type { Carta } from "../../src/shared/cartas";
import { POKER, poker, type AccionPoker, type AsientoPoker, type EstadoPoker, type VistaPoker } from "../../src/shared/juegos/poker";
import type { JugadorId, Paso } from "../../src/shared/juegos/tipos";
import { rngFijo } from "../ayudas";

/** Instante base de los tests de las reglas del póker. */
export const T0 = 1_000_000;
export const rng = rngFijo(0.5);

/** El apodo con el que se sienta cada jugador en los tests. */
export const apodoDe = (id: JugadorId): string => `J${id}`;

/** Aplica la acción tal cual: para comprobar errores. */
export const intentar = (e: EstadoPoker, id: JugadorId, accion: AccionPoker, ahora = T0): Paso<EstadoPoker> => poker.aplicar(e, id, accion, ahora, rng, apodoDe(id));

/** Aplica la acción y falla si no es válida. */
export function aplicar(e: EstadoPoker, id: JugadorId, accion: AccionPoker, ahora = T0) {
  const p = intentar(e, id, accion, ahora);
  if (!p.ok) throw new Error(`${id} no pudo hacer ${accion.t}: ${p.error}`);
  return p;
}

export const error = (p: Paso<EstadoPoker>) => (p.ok ? "ok" : p.error);

/**
 * Una mesa con los jugadores 1, 2, 3… en los asientos 0, 1, 2… y la primera mano ya empezada entre todos: el botón es el
 * jugador 1. Sentados de uno en uno, la mano empezaría con el segundo, así que los primeros se sientan con la mesa en
 * `resultado`, y solo el último, con la mesa en `esperando`. El último tiene que comprar al menos `COMPRA_MIN`; los demás
 * pueden tener menos, para probar las ciegas cortas.
 */
export function mesaCon(fichas: number[], ahora = T0): EstadoPoker {
  const ultimo = fichas.length - 1;
  let e: EstadoPoker = { ...poker.crear(ahora, rng), fase: "resultado" };
  fichas.slice(0, ultimo).forEach((cantidad, i) => {
    e = aplicar(e, i + 1, { t: "sentarse", fichas: Math.max(cantidad, POKER.COMPRA_MIN) }, ahora).estado;
    e = { ...e, asientos: e.asientos.map((a) => (a.asiento === i ? { ...a, fichas: cantidad, comprado: cantidad } : a)) };
  });
  return aplicar({ ...e, fase: "esperando" }, ultimo + 1, { t: "sentarse", fichas: fichas[ultimo] }, ahora).estado;
}

/** Fija la baraja: `cartas[0]` es la siguiente que sale. */
export const conBaraja = (e: EstadoPoker, cartas: Carta[]): EstadoPoker => ({ ...e, baraja: cartas });

export function asiento(e: EstadoPoker, id: JugadorId): AsientoPoker {
  const a = e.asientos.find((x) => x.jugadorId === id);
  if (a === undefined) throw new Error(`${id} no está sentado`);
  return a;
}

/** El jugador que tiene el turno, o `null`. */
export const turno = (e: EstadoPoker): JugadorId | null => e.asientos.find((a) => a.asiento === e.turno)?.jugadorId ?? null;

export const vistaDe = (e: EstadoPoker, id: JugadorId | null, ahora = T0) => poker.vista(e, id, ahora) as VistaPoker;
