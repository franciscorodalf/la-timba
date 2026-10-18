import type { Carta } from "../../../shared/cartas";
import { puntuacion, type VistaBJ } from "../../../shared/juegos/blackjack";
import type { Evento, JugadorId } from "../../../shared/juegos/tipos";

// El «guion» de un lote de eventos: en qué momento sale cada carta, para que se repartan una detrás de otra como en una
// mesa de verdad aunque el servidor mande todas a la vez. Los tiempos son milisegundos desde que llegó el lote.

/** Entre una carta y la siguiente. */
export const ESCALONADO_MS = 260;
/** Lo que tarda una carta en volar del mazo a su sitio. */
export const VUELO_MS = 480;
/** Lo que tarda en girarse la carta tapada. */
export const GIRO_MS = 550;
/** Respiro tras girar la tapada antes de que la banca pida. */
const PAUSA_GIRO_MS = 150;

export interface Guion {
  /** Cuándo sale cada carta repartida en el lote, por su clave (`claveCarta`), en el orden de los eventos. */
  cartas: Map<string, number>;
  /** Cuándo empieza a girarse la carta tapada de la banca, si se gira en este guion. */
  giro: number | null;
  /** Cuándo ha terminado de verse todo lo del lote. */
  fin: number;
}

export const GUION_VACIO: Guion = { cartas: new Map(), giro: null, fin: 0 };

/** Identifica una carta de la mesa: la ronda, de quién es (un jugador o la banca) y su posición en la mano. */
export const claveCarta = (ronda: number, de: JugadorId | "banca", indice: number): string => `${ronda}:${de}:${indice}`;

/**
 * El guion de un lote para la vista que llegó con él: cada `carta_repartida` sale `ESCALONADO_MS` después de la anterior
 * (posición entre las cartas del lote × 260 ms) y, si antes se gira la tapada, después del giro. Como cada evento dice para
 * quién es la carta pero no su posición, las cartas de un lote son las últimas de cada mano en la vista.
 */
export function guionDelLote(lote: Evento[], vista: VistaBJ): Guion {
  const porMano = new Map<string, number>();
  for (const evento of lote) {
    if (evento.tipo === "carta_repartida") porMano.set(String(evento.a), (porMano.get(String(evento.a)) ?? 0) + 1);
  }
  const vistas = new Map<string, number>();
  const cartas = new Map<string, number>();
  let momento = 0;
  let fin = 0;
  let giro: number | null = null;

  for (const evento of lote) {
    if (evento.tipo === "carta_girada") {
      giro = momento;
      fin = Math.max(fin, momento + GIRO_MS);
      momento += GIRO_MS + PAUSA_GIRO_MS;
    } else if (evento.tipo === "carta_repartida") {
      const de = evento.a as JugadorId | "banca";
      const largo = de === "banca" ? vista.banca.length : vista.manos.find((m) => m.jugadorId === de)?.cartas.length;
      const orden = vistas.get(String(de)) ?? 0;
      vistas.set(String(de), orden + 1);
      const indice = largo === undefined ? -1 : largo - (porMano.get(String(de)) ?? 0) + orden;
      // Una carta de una mano que ya no está en la vista (el jugador se fue) no se anima.
      if (indice >= 0) {
        cartas.set(claveCarta(vista.ronda, de, indice), momento);
        fin = Math.max(fin, momento + VUELO_MS);
      }
      momento += ESCALONADO_MS;
    }
  }
  return { cartas, giro, fin };
}

/**
 * Pone un guion `nuevo` detrás del que está en marcha (`previo`, del que ya han pasado `transcurrido` ms), en la escala
 * de tiempo de `previo`: sus cartas salen cuando termina la última del anterior (o ya, si el anterior terminó), así que
 * una carta pedida a mitad de reparto no adelanta a las que aún esperan. Del anterior se olvida lo que ya ha aterrizado
 * (cuenta como en su sitio) y se conserva lo que aún vuela o espera, con su momento.
 */
export function encolarGuion(previo: Guion, transcurrido: number, nuevo: Guion): Guion {
  const desde = Math.max(transcurrido, previo.fin);
  const cartas = new Map<string, number>();
  for (const [clave, salida] of previo.cartas) if (salida + VUELO_MS > transcurrido) cartas.set(clave, salida);
  for (const [clave, salida] of nuevo.cartas) cartas.set(clave, desde + salida);
  const giroPrevio = previo.giro !== null && previo.giro + GIRO_MS > transcurrido ? previo.giro : null;
  const hayNuevo = nuevo.cartas.size > 0 || nuevo.giro !== null;
  return {
    cartas,
    giro: nuevo.giro !== null ? desde + nuevo.giro : giroPrevio,
    fin: hayNuevo ? Math.max(previo.fin, desde + nuevo.fin) : previo.fin,
  };
}

/** El total de las cartas de una mano que ya se ven (las tapadas no cuentan); `null` si aún no se ve ninguna. */
export function totalVisible(cartas: (Carta | null)[], visible: (indice: number) => boolean): number | null {
  const vistas = cartas.filter((carta, i): carta is Carta => carta !== null && visible(i));
  return vistas.length === 0 ? null : puntuacion(vistas).total;
}
