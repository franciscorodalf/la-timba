import { type RefObject, useEffect, useState } from "react";
import type { VistaBJ } from "../../../shared/juegos/blackjack";
import type { Evento } from "../../../shared/juegos/tipos";
import { sonidos } from "../../efectos/sonidos";
import { GIRO_MS, type Guion, GUION_VACIO, guionDelLote, VUELO_MS } from "./guion";

export const hayCartas = (lote: Evento[]): boolean => lote.some((e) => e.tipo === "carta_repartida" || e.tipo === "carta_girada");

export interface Reloj {
  lote: Evento[];
  guion: Guion;
  /** Milisegundos del guion que ya han pasado (a saltos: cada llegada de una carta). */
  hito: number;
  /** Dónde estaba el mazo cuando llegó el guion: de ahí salen sus cartas. */
  origen: DOMRect | null;
}

/**
 * El guion del último lote con cartas y su avance. Un lote sin cartas (alguien apuesta, otro se sienta) no interrumpe el
 * reparto en curso. Cada carta suena al salir del mazo.
 */
export function useGuion(lote: Evento[], vista: VistaBJ | null, mazo: RefObject<HTMLElement | null>): Reloj {
  const [reloj, setReloj] = useState<Reloj>({ lote, guion: GUION_VACIO, hito: Infinity, origen: null });
  let actual = reloj;
  if (lote !== reloj.lote) {
    actual =
      vista !== null && hayCartas(lote)
        ? { lote, guion: guionDelLote(lote, vista), hito: 0, origen: mazo.current?.getBoundingClientRect() ?? null }
        : { ...reloj, lote };
    setReloj(actual);
  }

  const { guion } = actual;
  useEffect(() => {
    if (guion === GUION_VACIO) return;
    const hitos = new Set([...guion.cartas.values()].map((t) => t + VUELO_MS));
    if (guion.giro) hitos.add(GIRO_MS);
    hitos.add(guion.fin);
    const relojes = [...hitos].map((t) => setTimeout(() => setReloj((r) => (r.guion === guion ? { ...r, hito: Math.max(r.hito, t) } : r)), t));
    for (const t of guion.cartas.values()) relojes.push(setTimeout(() => sonidos.reproducir("carta"), t));
    if (guion.giro) sonidos.reproducir("carta");
    return () => relojes.forEach(clearTimeout);
  }, [guion]);

  return actual;
}

/** La carta ya está en su sitio (o no venía en el guion en curso). */
export function aterrizada(reloj: Reloj, clave: string): boolean {
  const salida = reloj.guion.cartas.get(clave);
  return salida === undefined || reloj.hito >= salida + VUELO_MS;
}
