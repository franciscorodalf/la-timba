import type { Carta } from "../../../shared/cartas";
import { BJ } from "../../../shared/juegos/blackjack";
import { type Calle, POKER, type VistaPoker } from "../../../shared/juegos/poker";
import type { Evento, JugadorId } from "../../../shared/juegos/tipos";
import { GIRO_MS } from "../blackjack/guion";

// El «guion» de un lote de eventos: en qué momento sale cada carta y vuela cada ficha, para que se vea una mano de verdad aunque
// la vista ya lo traiga todo hecho. Los tiempos son milisegundos desde que llegó el lote.

/** Lo que tarda una ficha en ir de un asiento a lo apostado, o de lo apostado al bote. */
export const VUELO_FICHAS_MS = 280;
/** Lo que tardan las fichas de un bote en llegar a quien gana: lo mismo que tardan en empezar a llegar las de `usePremio`. */
export const VUELO_BOTE_MS = 450;
/** Entre una ficha y la siguiente de un mismo lote (las dos ciegas). */
const ENTRE_FICHAS_MS = 120;
/** Entre una carta de la mesa y la siguiente de su grupo: el flop sale en orden y se gira entero dentro de `CALLE_MS`. */
export const ENTRE_CARTAS_MESA_MS = 120;
/** Respiro entre lo último que se ha visto y el primer bote. */
const PAUSA_PREMIO_MS = 250;

export interface MovimientoFichas {
  jugadorId: JugadorId;
  cantidad: number;
  en: number;
}

export interface CalleGuion {
  calle: Calle;
  cartas: Carta[];
  en: number;
}

export interface GuionPoker {
  /** Cuándo sale cada carta de cada jugador, en orden. */
  reparto: Map<JugadorId, number[]>;
  /** Cuándo sale cada grupo de cartas de la mesa. */
  calles: CalleGuion[];
  /** Las fichas que van de un asiento hacia el centro. */
  fichas: MovimientoFichas[];
  /** Cuándo lo apostado se recoge en el bote. */
  barridos: number[];
  /** Lo que nadie igualó, que vuelve a quien lo apostó. */
  devueltos: MovimientoFichas[];
  /** Cuándo se dan la vuelta las cartas de cada jugador que las enseña. */
  ensenadas: { jugadorId: JugadorId; en: number }[];
  /** Lo que va del bote a quien gana. */
  premios: MovimientoFichas[];
  /** Cuándo ha terminado de verse todo lo del lote. */
  fin: number;
}

export const GUION_VACIO: GuionPoker = { reparto: new Map(), calles: [], fichas: [], barridos: [], devueltos: [], ensenadas: [], premios: [], fin: 0 };

/**
 * El guion de un lote. Si en él empieza otra mano, lo de antes ya no se enseña: manda la nueva. Las cartas salen una a una; una
 * calle o un bote esperan a que lo apostado haya llegado al bote; las manos se enseñan antes de sacar las cartas que falten; cada
 * grupo de la mesa sale `CALLE_MS` después del anterior (lo que `resultado` se alarga en un all-in) y los botes se pagan al final.
 */
export function guionDelLote(lote: Evento[]): GuionPoker {
  const empieza = lote.map((e) => e.tipo).lastIndexOf("mano_empezada");
  const eventos = empieza < 0 ? lote : lote.slice(empieza);

  const guion: GuionPoker = { ...GUION_VACIO, reparto: new Map(), calles: [], fichas: [], barridos: [], devueltos: [], ensenadas: [], premios: [] };
  // Cuándo puede salir lo siguiente en el orden de los eventos.
  let momento = 0;
  let fin = 0;
  // Un lote no sabe qué hay apostado en la mesa: lo apostado se recoge una vez y solo vuelve a hacer falta si se apuesta más.
  let porBarrer = true;
  let ensenando = false;
  const enDeBote = new Map<number, number>();

  const barrer = () => {
    if (!porBarrer) return;
    porBarrer = false;
    const en = Math.max(momento, fin);
    guion.barridos.push(en);
    fin = en + VUELO_FICHAS_MS;
    momento = fin;
  };

  for (const evento of eventos) {
    if (evento.tipo !== "cartas_ensenadas") ensenando = false;
    if (evento.tipo === "ciega" || evento.tipo === "accion") {
      const cantidad = evento.cantidad as number;
      if (cantidad <= 0) continue;
      guion.fichas.push({ jugadorId: evento.jugadorId as JugadorId, cantidad, en: momento });
      fin = Math.max(fin, momento + VUELO_FICHAS_MS);
      momento += ENTRE_FICHAS_MS;
      porBarrer = true;
    } else if (evento.tipo === "carta_repartida") {
      const jugadorId = evento.a as JugadorId;
      guion.reparto.set(jugadorId, [...(guion.reparto.get(jugadorId) ?? []), momento]);
      fin = Math.max(fin, momento + BJ.VUELO_MS);
      momento += BJ.ESCALONADO_MS;
    } else if (evento.tipo === "bote_devuelto") {
      const en = Math.max(momento, fin);
      guion.devueltos.push({ jugadorId: evento.jugadorId as JugadorId, cantidad: evento.cantidad as number, en });
      fin = en + VUELO_FICHAS_MS;
      momento = fin;
    } else if (evento.tipo === "cartas_ensenadas") {
      // La primera espera a lo que estaba en el aire; las demás van seguidas, sin esperar a que acabe de girarse la anterior.
      if (!ensenando) momento = Math.max(momento, fin);
      ensenando = true;
      guion.ensenadas.push({ jugadorId: evento.jugadorId as JugadorId, en: momento });
      fin = Math.max(fin, momento + GIRO_MS);
      momento += BJ.ESCALONADO_MS;
    } else if (evento.tipo === "calle_abierta") {
      barrer();
      const en = Math.max(momento, fin);
      guion.calles.push({ calle: evento.calle as Calle, cartas: evento.cartas as Carta[], en });
      momento = en + POKER.CALLE_MS;
      fin = momento;
    } else if (evento.tipo === "bote_ganado") {
      barrer();
      const indice = evento.indiceBote as number;
      // Quienes empatan un bote cobran a la vez; cada bote, cuando ya ha llegado el anterior.
      const en = enDeBote.get(indice) ?? Math.max(momento, fin) + (enDeBote.size === 0 ? PAUSA_PREMIO_MS : 0);
      enDeBote.set(indice, en);
      guion.premios.push({ jugadorId: evento.jugadorId as JugadorId, cantidad: evento.cantidad as number, en });
      fin = Math.max(fin, en + VUELO_BOTE_MS);
    }
  }
  guion.fin = fin;
  return guion;
}

/** El lote no trae nada que se anime (alguien pasa, otro se sienta): no toca el guion en curso. */
export const guionSinNada = (guion: GuionPoker): boolean => guion.fin === 0;

const retrasar = <T extends { en: number }>(lista: T[], ms: number): T[] => lista.map((x) => ({ ...x, en: x.en + ms }));

/**
 * Pone un guion `nuevo` detrás del que está en marcha (`previo`, del que ya han pasado `transcurrido` ms), en la escala de tiempo
 * de `previo`: lo nuevo sale cuando termina lo anterior (o ya, si terminó) y lo anterior conserva su momento.
 */
export function encolarGuion(previo: GuionPoker, transcurrido: number, nuevo: GuionPoker): GuionPoker {
  const desde = Math.max(transcurrido, previo.fin);
  const reparto = new Map(previo.reparto);
  for (const [jugadorId, salidas] of nuevo.reparto) reparto.set(jugadorId, [...(reparto.get(jugadorId) ?? []), ...salidas.map((t) => t + desde)]);
  return {
    reparto,
    calles: [...previo.calles, ...retrasar(nuevo.calles, desde)],
    fichas: [...previo.fichas, ...retrasar(nuevo.fichas, desde)],
    barridos: [...previo.barridos, ...nuevo.barridos.map((t) => t + desde)],
    devueltos: [...previo.devueltos, ...retrasar(nuevo.devueltos, desde)],
    ensenadas: [...previo.ensenadas, ...retrasar(nuevo.ensenadas, desde)],
    premios: [...previo.premios, ...retrasar(nuevo.premios, desde)],
    fin: desde + nuevo.fin,
  };
}

/** Cuándo sale cada carta de una calle, en orden. */
export const salidasDeLaCalle = (calle: CalleGuion): number[] => calle.cartas.map((_, i) => calle.en + i * ENTRE_CARTAS_MESA_MS);

/** Cuándo se han visto ya todas las cartas del guion: hasta entonces nadie tiene la palabra en la pantalla. */
export function finDeLasCartas(guion: GuionPoker): number {
  const repartidas = [...guion.reparto.values()].flat().map((t) => t + BJ.VUELO_MS);
  const abiertas = guion.calles.flatMap(salidasDeLaCalle).map((t) => t + GIRO_MS);
  return Math.max(0, ...repartidas, ...abiertas);
}

/** Todos los momentos en que cambia lo que se ve. */
export function hitosDelGuion(guion: GuionPoker): Set<number> {
  const movimientos = [...guion.fichas, ...guion.devueltos].flatMap(({ en }) => [en, en + VUELO_FICHAS_MS]);
  return new Set([
    ...movimientos,
    ...[...guion.reparto.values()].flat().map((t) => t + BJ.VUELO_MS),
    ...guion.barridos.flatMap((en) => [en, en + VUELO_FICHAS_MS]),
    ...guion.premios.flatMap(({ en }) => [en, en + VUELO_BOTE_MS]),
    ...guion.ensenadas.map(({ en }) => en),
    ...guion.calles.flatMap(salidasDeLaCalle),
    finDeLasCartas(guion),
    guion.fin,
  ]);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lo que se ve en cada momento
// ---------------------------------------------------------------------------------------------------------------------

/** Las cantidades de la mesa en un momento: lo que los asientos tienen delante y el bote. */
export interface Foto {
  pilas: Map<JugadorId, number>;
  apuestas: Map<JugadorId, number>;
  bote: number;
}

/** Lo que enseña una vista tal cual: de ahí arranca el guion de una jugada. */
export const fotoDeLaVista = (vista: VistaPoker): Foto => ({
  pilas: new Map(vista.asientos.map((a) => [a.jugadorId, a.fichas])),
  apuestas: new Map(vista.asientos.map((a) => [a.jugadorId, a.apostado])),
  bote: vista.botes.reduce((suma, b) => suma + b.cantidad, 0),
});

/** De dónde arranca una mano nueva: la vista trae las pilas ya con las ciegas puestas, y aquí se quitan todos los movimientos del guion. */
export function fotoAntesDeLaMano(vista: VistaPoker, guion: GuionPoker): Foto {
  const pilas = new Map(vista.asientos.map((a) => [a.jugadorId, a.fichas]));
  const sumar = (jugadorId: JugadorId, cantidad: number) => pilas.set(jugadorId, (pilas.get(jugadorId) ?? 0) + cantidad);
  for (const { jugadorId, cantidad } of guion.fichas) sumar(jugadorId, cantidad);
  for (const { jugadorId, cantidad } of [...guion.devueltos, ...guion.premios]) sumar(jugadorId, -cantidad);
  return { pilas, apuestas: new Map(), bote: 0 };
}

/** Lo que enseña la mesa a los `hito` ms del guion, a partir de `base`. Las fichas cuentan cuando llegan a su sitio. */
export function fotoEn(base: Foto, guion: GuionPoker, hito: number): Foto {
  const foto: Foto = { pilas: new Map(base.pilas), apuestas: new Map(base.apuestas), bote: base.bote };
  const sumar = (mapa: Map<JugadorId, number>, jugadorId: JugadorId, cantidad: number) => mapa.set(jugadorId, (mapa.get(jugadorId) ?? 0) + cantidad);

  const pasos = [
    ...guion.fichas.map(({ jugadorId, cantidad, en }) => ({
      llega: en + VUELO_FICHAS_MS,
      hacer() {
        sumar(foto.pilas, jugadorId, -cantidad);
        sumar(foto.apuestas, jugadorId, cantidad);
      },
    })),
    ...guion.devueltos.map(({ jugadorId, cantidad, en }) => ({
      llega: en + VUELO_FICHAS_MS,
      hacer() {
        // Sale de lo que tiene delante; si ya no estaba ahí (se devuelve después de recoger), del bote.
        const delante = Math.min(cantidad, foto.apuestas.get(jugadorId) ?? 0);
        sumar(foto.pilas, jugadorId, cantidad);
        sumar(foto.apuestas, jugadorId, -delante);
        foto.bote -= cantidad - delante;
      },
    })),
    ...guion.barridos.map((en) => ({
      llega: en + VUELO_FICHAS_MS,
      hacer() {
        for (const cantidad of foto.apuestas.values()) foto.bote += cantidad;
        foto.apuestas.clear();
      },
    })),
    ...guion.premios.map(({ jugadorId, cantidad, en }) => ({ llega: en + VUELO_BOTE_MS, hacer: () => sumar(foto.pilas, jugadorId, cantidad) })),
  ];
  pasos
    .filter((paso) => paso.llega <= hito)
    .sort((a, b) => a.llega - b.llega)
    .forEach((paso) => paso.hacer());
  return foto;
}

/**
 * La vista con lo que aún no ha llegado según el guion: la mesa, las pilas, lo apostado y el bote se retienen, las cartas que se
 * enseñan siguen boca abajo y nadie tiene la palabra hasta que se han visto las cartas. Al acabar el guion es la vista tal cual.
 */
export function vistaEn(vista: VistaPoker, base: Foto | null, guion: GuionPoker, hito: number): VistaPoker {
  if (base === null || hito >= guion.fin) return vista;
  const foto = fotoEn(base, guion, hito);
  const porSalir = guion.calles.flatMap(salidasDeLaCalle).filter((t) => t > hito).length;
  const tapadas = new Set(guion.ensenadas.filter(({ en }) => en > hito).map(({ jugadorId }) => jugadorId));
  return {
    ...vista,
    mesa: vista.mesa.slice(0, vista.mesa.length - porSalir),
    botes: [{ cantidad: foto.bote, jugadores: [] }],
    turno: hito < finDeLasCartas(guion) ? null : vista.turno,
    asientos: vista.asientos.map((a) => ({
      ...a,
      fichas: foto.pilas.get(a.jugadorId) ?? a.fichas,
      apostado: foto.apuestas.get(a.jugadorId) ?? 0,
      cartas: tapadas.has(a.jugadorId) ? null : a.cartas,
    })),
  };
}
