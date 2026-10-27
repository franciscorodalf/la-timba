import { blackjack, type AccionBJ, type EstadoBJ } from "../shared/juegos/blackjack";
import { Mesa } from "./mesa-base";

/** La mesa de blackjack de una partida (nombre = código de la partida). */
export class MesaBlackjack extends Mesa<EstadoBJ, AccionBJ> {
  protected juego = blackjack;
}
