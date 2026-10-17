import type { IdJuego, ResumenMesa } from "./juegos/tipos";

export interface JugadorPublico {
  id: number;
  apodo: string;
  fichas: number;
}

export interface Perfil extends JugadorPublico {
  quiebras: number;
  rachaActual: number;
  mejorRacha: number;
  partidas: number;
  gananciasTotales: number;
  mayorPremio: number;
  porJuego: Record<IdJuego, { partidas: number; victorias: number }>;
}

export const ORDENES_RANKING = ["fichas", "ganancias", "victorias", "premio", "racha", "quiebras"] as const;
export type OrdenRanking = (typeof ORDENES_RANKING)[number];

export interface FilaRanking {
  posicion: number;
  apodo: string;
  valor: number;
}

export interface FilaRankingPartida {
  apodo: string;
  neto: number;
}

/** Respuesta de `POST /api/registro` (201) y `POST /api/entrar` (200). */
export interface RespuestaSesion {
  token: string;
  jugador: JugadorPublico;
}

/** Respuesta de `GET /api/ranking`: `yo` es null si no hay sesión o el jugador no clasifica en ese orden. */
export interface RespuestaRanking {
  top: FilaRanking[];
  yo: FilaRanking | null;
}

/** Mensaje servidor → cliente de la sala (`/parties/partida/<CODIGO>`): se envía al conectar, al desconectarse alguien y al cambiar una mesa. */
export interface MensajeSala {
  t: "sala";
  codigo: string;
  /** Apodos de los jugadores conectados, sin repetir, por orden de llegada. */
  conectados: string[];
  mesas: Record<IdJuego, ResumenMesa>;
  rankingNoche: FilaRankingPartida[];
}
