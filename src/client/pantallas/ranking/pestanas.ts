import { ORDENES_RANKING, type OrdenRanking, PARTIDAS_MINIMAS_VICTORIAS } from "../../../shared/api";
import { miles, milesConSigno } from "../../formato";

interface Pestana {
  orden: OrdenRanking;
  etiqueta: string;
  /** Qué mide, en una línea bajo las pestañas. */
  leyenda: string;
}

const TEXTOS: Record<OrdenRanking, { etiqueta: string; leyenda: string }> = {
  fichas: { etiqueta: "Fichas", leyenda: "Quién tiene más fichas ahora mismo" },
  ganancias: { etiqueta: "Ganancias", leyenda: "Lo ganado menos lo perdido en todas las rondas" },
  victorias: { etiqueta: "% victorias", leyenda: `Rondas ganadas sobre jugadas, con al menos ${PARTIDAS_MINIMAS_VICTORIAS} jugadas` },
  premio: { etiqueta: "Mayor premio", leyenda: "El premio más grande ganado en una sola ronda" },
  racha: { etiqueta: "Mejor racha", leyenda: "Más rondas ganadas seguidas" },
  quiebras: { etiqueta: "Quiebras", leyenda: "Las veces que alguien se ha quedado sin fichas" },
};

/** Las pestañas del ranking, en el orden del servidor. */
export const PESTANAS: readonly Pestana[] = ORDENES_RANKING.map((orden) => ({ orden, ...TEXTOS[orden] }));

/** El valor de una fila tal y como se lee en esa pestaña. */
export function valorRanking(orden: OrdenRanking, valor: number): string {
  switch (orden) {
    case "fichas":
    case "premio":
      return miles(valor);
    case "ganancias":
      return milesConSigno(valor);
    case "victorias":
      return `${valor} %`;
    case "racha":
    case "quiebras":
      return String(valor);
  }
}

/** Lo que se le dice al jugador que no clasifica en este orden (`yo` es null con sesión iniciada); `null` si siempre clasifica. */
export function textoSinPuesto(orden: OrdenRanking): string | null {
  if (orden === "victorias") return `Juega ${PARTIDAS_MINIMAS_VICTORIAS} rondas para entrar en este ranking`;
  if (orden === "premio") return "Gana una ronda para entrar en este ranking";
  return null;
}
