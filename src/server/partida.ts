import { Server } from "partyserver";
import type { Env } from "./index";

const CLAVE_PARTIDA = "partida";

interface EstadoPartida {
  creadaEn: number;
  creadorId: number;
  cerrada: boolean;
}

export class Partida extends Server<Env> {
  /** Abre la sala. Sobrescribe el estado anterior: un código de una partida cerrada puede reutilizarse. */
  async iniciar(creadorId: number, ahora: number): Promise<void> {
    const estado: EstadoPartida = { creadaEn: ahora, creadorId, cerrada: false };
    await this.ctx.storage.put(CLAVE_PARTIDA, estado);
  }

  /** `true` si la sala se abrió y no está cerrada. */
  async existe(): Promise<boolean> {
    const estado = await this.ctx.storage.get<EstadoPartida>(CLAVE_PARTIDA);
    return estado !== undefined && !estado.cerrada;
  }
}
