import { animate } from "motion/react";
import { type RefObject, useLayoutEffect, useRef } from "react";
import type { Evento, JugadorId } from "../../../shared/juegos/tipos";
import { useMovimientoReducido } from "../../efectos/movimiento";
import { claveTrasDividir, DESLIZE_MS, type Division } from "./guion";

// Al dividir una mano, la segunda carta no desaparece de un sitio para aparecer en otro: se desliza (y se ajusta de tamaño) hasta
// su hueco en la mano nueva, y las demás cartas hacen lo mismo hasta el sitio que les deja el nuevo reparto de la fila.

const CURVA = [0.2, 0.8, 0.2, 1] as const;
const EN_SU_SITIO = "translate(0px, 0px) scale(1)";

/** Dónde estaba una carta en la página (no en la ventana: si se desplazó entre un pintado y otro, no cuenta). */
interface Sitio {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

function sitioDe(nodo: HTMLElement): Sitio {
  const r = nodo.getBoundingClientRect();
  return { x: r.left + r.width / 2 + window.scrollX, y: r.top + r.height / 2 + window.scrollY, ancho: r.width, alto: r.height };
}

/**
 * Anima las cartas de `raiz` (las que llevan `data-clave`) cuando el lote trae una división: cada una parte de donde estaba en el
 * pintado anterior y se desliza hasta su sitio. Las que salen del mazo (cartas nuevas) no estaban: no entran aquí. Como el
 * nodo que ocupa el hueco nuevo se pinta ya en su sitio y se le pone el desplazamiento antes del siguiente fotograma, la carta no
 * desaparece en ningún momento. Con movimiento reducido no se anima nada, y al reconectar (sin eventos) tampoco.
 */
export function useDeslizarAlDividir(lote: Evento[], raiz: RefObject<HTMLElement | null>): void {
  const reducido = useMovimientoReducido();
  const antes = useRef<Map<string, Sitio>>(new Map());
  const atendido = useRef<Evento[] | null>(null);

  // En cada pintado: se anota dónde está cada carta y, si ha llegado un lote con divisiones, se parte de lo anotado en el anterior.
  useLayoutEffect(() => {
    const el = raiz.current;
    if (el === null) return;
    const nodos = new Map<string, HTMLElement>();
    for (const nodo of el.querySelectorAll<HTMLElement>("[data-clave]")) nodos.set(nodo.dataset.clave as string, nodo);
    const previos = antes.current;
    const ahora = new Map<string, Sitio>();
    for (const [clave, nodo] of nodos) ahora.set(clave, sitioDe(nodo));
    antes.current = ahora;

    if (lote === atendido.current) return;
    atendido.current = lote;
    const divisiones: Division[] = lote.filter((e) => e.tipo === "mano_dividida").map((e) => ({ jugadorId: e.jugadorId as JugadorId, indice: Number(e.indice) }));
    if (divisiones.length === 0 || reducido) return;

    for (const [claveAntes, desde] of previos) {
      const clave = divisiones.reduce((c, division) => claveTrasDividir(c, division), claveAntes);
      const nodo = nodos.get(clave);
      const hasta = ahora.get(clave);
      if (nodo === undefined || hasta === undefined) continue;
      const dx = desde.x - hasta.x;
      const dy = desde.y - hasta.y;
      const escala = hasta.ancho > 0 ? desde.ancho / hasta.ancho : 1;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(escala - 1) < 0.01) continue;
      const desplazada = `translate(${dx}px, ${dy}px) scale(${escala})`;
      // Ya desplazada antes de pintar: la animación empieza en el siguiente fotograma y no debe verse un destello en su sitio.
      nodo.style.transform = desplazada;
      animate(nodo, { transform: [desplazada, EN_SU_SITIO] }, { duration: DESLIZE_MS / 1000, ease: CURVA });
    }
  });
}
