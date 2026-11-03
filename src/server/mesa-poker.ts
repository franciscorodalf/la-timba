import { poker, type AccionPoker, type EstadoPoker } from "../shared/juegos/poker";
import { Mesa } from "./mesa-base";

/** La mesa de póker de una partida (nombre = código de la partida). */
export class MesaPoker extends Mesa<EstadoPoker, AccionPoker> {
  protected juego = poker;
}
