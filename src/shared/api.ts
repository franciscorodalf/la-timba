import type { IdJuego } from "./juegos/tipos";

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

export type OrdenRanking = "fichas" | "ganancias" | "victorias" | "premio" | "racha" | "quiebras";

export interface FilaRanking {
  posicion: number;
  apodo: string;
  valor: number;
}

export interface FilaRankingPartida {
  apodo: string;
  neto: number;
}
