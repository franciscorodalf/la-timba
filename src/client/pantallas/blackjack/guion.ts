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
/** Lo que tarda en deslizarse la segunda carta de una mano que se divide hasta su sitio en la mano nueva. */
export const DESLIZE_MS = 340;
/** Lo que se espera, desde que empieza ese deslizamiento, para que salgan del mazo las cartas nuevas: ya ha dejado libre su hueco. */
const PAUSA_DIVISION_MS = 170;

export interface Guion {
  /** Cuándo sale cada carta repartida en el lote, por su clave (`claveCarta`), en el orden de los eventos. */
  cartas: Map<string, number>;
  /** Cuándo empieza a girarse la carta tapada de la banca, si se gira en este guion. */
  giro: number | null;
  /** Cuándo ha terminado de verse todo lo del lote. */
  fin: number;
}

export const GUION_VACIO: Guion = { cartas: new Map(), giro: null, fin: 0 };

/**
 * Identifica una carta de la mesa: la ronda, de quién es (un jugador o la banca), a cuál de sus manos pertenece (`mano`, su
 * `indice` en la vista; la banca solo tiene la 0) y su posición en esa mano.
 */
export const claveCarta = (ronda: number, de: JugadorId | "banca", mano: number, indice: number): string => `${ronda}:${de}:${mano}:${indice}`;

export interface PartesClave {
  ronda: number;
  de: JugadorId | "banca";
  mano: number;
  indice: number;
}

/** Lo que `claveCarta` juntó; `null` si el texto no es una clave. */
export function partesDeClave(clave: string): PartesClave | null {
  const [ronda, de, mano, indice, ...resto] = clave.split(":");
  if (resto.length > 0 || indice === undefined) return null;
  const numeros = [ronda, mano, indice].map(Number);
  if (numeros.some((n) => !Number.isInteger(n)) || (de !== "banca" && !Number.isInteger(Number(de)))) return null;
  return { ronda: numeros[0], de: de === "banca" ? "banca" : Number(de), mano: numeros[1], indice: numeros[2] };
}

/** Una mano que se divide: de qué jugador y cuál (su `indice` antes de dividir; la nueva queda justo detrás). */
export interface Division {
  jugadorId: JugadorId;
  indice: number;
}

/**
 * Cómo se llama, después de una división, la carta que antes se llamaba `clave`: la segunda carta de la mano que se divide pasa a
 * ser la primera de la nueva, y las manos de ese jugador que iban detrás se corren una. El resto de cartas conserva su clave.
 */
export function claveTrasDividir(clave: string, division: Division): string {
  const partes = partesDeClave(clave);
  if (partes === null || partes.de !== division.jugadorId) return clave;
  if (partes.mano === division.indice && partes.indice === 1) return claveCarta(partes.ronda, partes.de, partes.mano + 1, 0);
  if (partes.mano > division.indice) return claveCarta(partes.ronda, partes.de, partes.mano + 1, partes.indice);
  return clave;
}

/**
 * La clave con la que se ve, en la vista que llegó con el lote, cada carta repartida (`null`: ya no está, como la de quien se fue;
 * los demás eventos no tienen). Se recorre el lote hacia atrás deshaciendo lo que hizo: cada carta es la última que queda en su
 * mano y cada división junta de nuevo las dos manos, así valen también varios mensajes juntos (dividir y pedir en la nueva). Si
 * una carta cambia de mano por una división posterior del mismo lote, lleva ya la clave de la mano a la que acaba yendo.
 */
function clavesDeLasCartas(lote: Evento[], vista: VistaBJ): (string | null)[] {
  const manos = new Map<JugadorId, number[]>();
  for (const m of [...vista.manos].sort((a, b) => a.indice - b.indice)) manos.set(m.jugadorId, [...(manos.get(m.jugadorId) ?? []), m.cartas.length]);
  let banca = vista.banca.length;
  // Las divisiones que vienen después del evento que se mira, en orden.
  const posteriores: Division[] = [];
  const claves: (string | null)[] = lote.map(() => null);
  for (let i = lote.length - 1; i >= 0; i--) {
    const evento = lote[i];
    if (evento.tipo === "carta_repartida") {
      if (evento.a === "banca") {
        if (banca > 0) claves[i] = claveCarta(vista.ronda, "banca", 0, --banca);
      } else {
        const jugadorId = evento.a as JugadorId;
        const cuentas = manos.get(jugadorId);
        const mano = Number(evento.mano ?? 0);
        if (cuentas !== undefined && cuentas[mano] > 0) {
          claves[i] = posteriores.reduce((clave, division) => claveTrasDividir(clave, division), claveCarta(vista.ronda, jugadorId, mano, --cuentas[mano]));
        }
      }
    } else if (evento.tipo === "mano_dividida") {
      const jugadorId = evento.jugadorId as JugadorId;
      const cuentas = manos.get(jugadorId);
      const mano = Number(evento.indice);
      if (cuentas !== undefined && mano + 1 < cuentas.length) cuentas.splice(mano, 2, cuentas[mano] + cuentas[mano + 1]);
      posteriores.unshift({ jugadorId, indice: mano });
    }
  }
  return claves;
}

/**
 * El guion de un lote para la vista que llegó con él: cada `carta_repartida` sale `ESCALONADO_MS` después de la anterior
 * (posición entre las cartas del lote × 260 ms) y, si antes se gira la tapada, después del giro. Cada evento dice para quién
 * es la carta y a cuál de sus manos (`mano`, la 0 si no lo dice) pero no su posición: las cartas de un lote son las últimas de
 * cada mano en la vista. Al dividir una mano, la segunda carta se desliza a la mano nueva (no es una carta repartida: no vuela
 * desde el mazo) y las cartas nuevas salen cuando ya ha dejado libre su hueco.
 */
export function guionDelLote(lote: Evento[], vista: VistaBJ): Guion {
  const claves = clavesDeLasCartas(lote, vista);
  const cartas = new Map<string, number>();
  let momento = 0;
  let fin = 0;
  let giro: number | null = null;

  lote.forEach((evento, i) => {
    if (evento.tipo === "carta_girada") {
      giro = momento;
      fin = Math.max(fin, momento + GIRO_MS);
      momento += GIRO_MS + PAUSA_GIRO_MS;
    } else if (evento.tipo === "mano_dividida") {
      fin = Math.max(fin, momento + DESLIZE_MS);
      momento += PAUSA_DIVISION_MS;
    } else if (evento.tipo === "carta_repartida") {
      // Una carta de una mano que ya no está en la vista (el jugador se fue) no se anima.
      const clave = claves[i];
      if (clave !== null) {
        cartas.set(clave, momento);
        fin = Math.max(fin, momento + VUELO_MS);
      }
      momento += ESCALONADO_MS;
    }
  });
  return { cartas, giro, fin };
}

/**
 * Cuántas veces se ha repartido cada clave de carta en la ronda: las generaciones de antes y una más por cada carta que reparte `guion`.
 * Las de rondas anteriores se olvidan. Una carta con una clave ya repartida (la segunda de una mano que se divide) es otra carta: la
 * mesa le monta un naipe nuevo (ver `claveNaipe`) en vez de cambiarle la cara al viejo.
 */
export function sumarGeneraciones(previas: ReadonlyMap<string, number>, guion: Guion): ReadonlyMap<string, number> {
  // Un guion sin cartas (solo el giro de la tapada) no cambia nada: las claves que ya hay no pueden cambiar de identidad.
  if (guion.cartas.size === 0) return previas;
  const ronda = partesDeClave(guion.cartas.keys().next().value as string)?.ronda;
  const siguientes = new Map<string, number>();
  for (const [clave, n] of previas) if (partesDeClave(clave)?.ronda === ronda) siguientes.set(clave, n);
  for (const clave of guion.cartas.keys()) siguientes.set(clave, (siguientes.get(clave) ?? 0) + 1);
  return siguientes;
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
