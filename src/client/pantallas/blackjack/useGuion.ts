import { type RefObject, useEffect, useState } from "react";
import type { VistaBJ } from "../../../shared/juegos/blackjack";
import type { Evento } from "../../../shared/juegos/tipos";
import { sonidos } from "../../efectos/sonidos";
import { encolarGuion, GIRO_MS, type Guion, GUION_VACIO, guionDelLote, MIRA_MS, sumarGeneraciones, VUELO_MS } from "./guion";

/** El lote trae algo que se anima con el guion: cartas que salen, la tapada que se gira o la banca que mira. */
export const hayCartas = (lote: Evento[]): boolean => lote.some((e) => e.tipo === "carta_repartida" || e.tipo === "carta_girada" || e.tipo === "banca_mira");

export interface Reloj {
  lote: Evento[];
  /** Los tiempos van en milisegundos desde `inicio`. */
  guion: Guion;
  /** `performance.now()` cuando empezó el guion en curso. */
  inicio: number;
  /** Lo que llevaba el guion cuando llegó el último lote: una carta que aparece ahora espera `salida − desde`. */
  desde: number;
  /** Milisegundos del guion que ya han pasado (a saltos: cada llegada de una carta). */
  hito: number;
  /** Dónde estaba el mazo cuando llegó el último lote: de ahí salen sus cartas. */
  origen: DOMRect | null;
  /** Cuántas veces se ha repartido cada clave de carta en esta ronda: cada reparto es una carta nueva, aunque tenga la clave de otra. */
  generaciones: ReadonlyMap<string, number>;
}

/**
 * Lo que identifica en React a una carta: su clave y las veces que se ha repartido. Al dividir, la clave de la segunda carta de una
 * mano pasa a ser la de otra carta: con la generación nueva se monta un naipe nuevo, que vuela del mazo, en vez de cambiar la cara al viejo.
 */
export const claveNaipe = (reloj: Reloj, clave: string): string => `${clave}~${reloj.generaciones.get(clave) ?? 0}`;

/**
 * El guion de los lotes con cartas y su avance. Un lote con cartas que llega con un reparto en marcha se pone detrás
 * (`encolarGuion`): sus cartas no adelantan a las que esperan, los totales no se adelantan y no se pierde ningún sonido.
 * Un lote sin cartas (alguien apuesta, otro se sienta) no toca el guion. Cada carta suena al salir del mazo.
 */
export function useGuion(lote: Evento[], vista: VistaBJ | null, mazo: RefObject<HTMLElement | null>): Reloj {
  const [reloj, setReloj] = useState<Reloj>({ lote, guion: GUION_VACIO, inicio: 0, desde: 0, hito: Infinity, origen: null, generaciones: new Map() });
  let actual = reloj;
  if (lote !== reloj.lote) {
    if (vista !== null && hayCartas(lote)) {
      const ahora = performance.now();
      const nuevo = guionDelLote(lote, vista);
      const origen = mazo.current?.getBoundingClientRect() ?? null;
      const transcurrido = ahora - reloj.inicio;
      const generaciones = sumarGeneraciones(reloj.generaciones, nuevo);
      actual =
        reloj.guion !== GUION_VACIO && transcurrido < reloj.guion.fin
          ? { lote, guion: encolarGuion(reloj.guion, transcurrido, nuevo), inicio: reloj.inicio, desde: transcurrido, hito: reloj.hito, origen, generaciones }
          : { lote, guion: nuevo, inicio: ahora, desde: 0, hito: 0, origen, generaciones };
    } else {
      actual = { ...reloj, lote };
    }
    setReloj(actual);
  }

  const { guion, inicio, desde } = actual;
  useEffect(() => {
    if (guion === GUION_VACIO) return;
    // Al cambiar el guion se cancelan los relojes del anterior: aquí se vuelven a poner los que aún no han llegado.
    const pasado = performance.now() - inicio;
    const relojes: ReturnType<typeof setTimeout>[] = [];
    const hitos = new Set([...guion.cartas.values()].map((t) => t + VUELO_MS));
    if (guion.giro !== null) {
      hitos.add(guion.giro);
      hitos.add(guion.giro + GIRO_MS);
    }
    if (guion.mira !== null) {
      hitos.add(guion.mira);
      hitos.add(guion.mira + MIRA_MS);
    }
    hitos.add(guion.fin);
    for (const t of hitos) {
      relojes.push(setTimeout(() => setReloj((r) => (r.guion === guion ? { ...r, hito: Math.max(r.hito, t) } : r)), Math.max(0, t - pasado)));
    }
    // Suenan las cartas que aún no habían salido al llegar el último lote (las suyas y las que esperaban turno).
    const salidas = [...guion.cartas.values()];
    if (guion.giro !== null) salidas.push(guion.giro);
    // Al levantar la tapada también suena una carta.
    if (guion.mira !== null) salidas.push(guion.mira);
    for (const t of salidas) if (t >= desde) relojes.push(setTimeout(() => sonidos.reproducir("carta"), Math.max(0, t - pasado)));
    return () => relojes.forEach(clearTimeout);
  }, [guion, inicio, desde]);

  return actual;
}

/** La carta ya está en su sitio (o no venía en el guion en curso). */
export function aterrizada(reloj: Reloj, clave: string): boolean {
  const salida = reloj.guion.cartas.get(clave);
  return salida === undefined || reloj.hito >= salida + VUELO_MS;
}

/** La tapada de la banca ya se ha girado del todo (o no se gira en el guion en curso). */
export function girada(reloj: Reloj): boolean {
  return reloj.guion.giro === null || reloj.hito >= reloj.guion.giro + GIRO_MS;
}

/** La tapada de la banca ya puede empezar a girarse (o no se gira en el guion en curso): hasta entonces se sigue viendo boca abajo. */
export function giroIniciado(reloj: Reloj): boolean {
  return reloj.guion.giro === null || reloj.hito >= reloj.guion.giro;
}

/** La banca está mirando su carta tapada ahora mismo (la tapada se levanta y baja, y el estado lo dice). */
export function mirando(reloj: Reloj): boolean {
  const { mira } = reloj.guion;
  return mira !== null && reloj.hito >= mira && reloj.hito < mira + MIRA_MS;
}

/** Lo que le queda al guion en curso por terminar de verse, ahora mismo. */
export function restante(reloj: Reloj): number {
  return reloj.guion === GUION_VACIO ? 0 : Math.max(0, reloj.guion.fin - (performance.now() - reloj.inicio));
}
