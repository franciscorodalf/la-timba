import { carrera, type AccionCarrera, type EstadoCarrera } from "../shared/juegos/carrera";
import { Mesa } from "./mesa-base";

/** La mesa de la carrera de caballos de una partida (nombre = código de la partida). */
export class MesaCarrera extends Mesa<EstadoCarrera, AccionCarrera> {
  protected juego = carrera;
}
