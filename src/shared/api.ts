import type { CodigoError, Evento, IdJuego, ResumenMesa } from "./juegos/tipos";

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
  /** La hora del servidor (ms desde 1970) al enviarlo. Los instantes que trae (`finFase`) son suyos: el cliente calcula lo que falta con esta hora, no con la de su reloj. */
  ahora: number;
  /** Apodos de los jugadores conectados, sin repetir, por orden de llegada. */
  conectados: string[];
  mesas: Record<IdJuego, ResumenMesa>;
  rankingNoche: FilaRankingPartida[];
}

/**
 * Mensaje servidor → cliente de una mesa (`/parties/mesa-<juego>/<CODIGO>`). `estado` lleva la vista de quien lo recibe y
 * los `eventos` ocurridos desde el estado anterior (vacíos al conectar); `version` crece con cada cambio de la mesa y
 * `ahora` es la hora del servidor al enviarlo (como en `MensajeSala`: los `finFase` de la vista son instantes suyos).
 */
export type MensajeMesa<V> =
  | { t: "estado"; version: number; ahora: number; vista: V; eventos: Evento[] }
  | { t: "error"; codigo: CodigoError };
