import { type RefObject, useLayoutEffect, useState } from "react";
import type { Espacio } from "./manos";

/** Lo que se deja libre a cada lado de tus manos respecto a los asientos de al lado. */
const MARGEN = 6;

/**
 * Mide el tapete de ordenador (`raiz`, mientras `activo`): su alto y el hueco entre los asientos de los demás a ambos lados del tuyo,
 * que es el doble de lo que se aparta del centro el asiento más cercano (se miran las cajas enteras de los asientos: cartas, nombre,
 * total y apuesta, tal como están ahora). Con ello las manos se colocan según lo grandes que son los vecinos de verdad, no según un
 * tamaño de ventana. Los asientos ajenos no dependen de los tuyos, así que medir no provoca bucles: el estado solo cambia si cambia
 * lo medido. `null` hasta la primera medida (que se hace antes de pintar) y en el móvil, donde no hay arco.
 */
export function useEspacioDelArco(raiz: RefObject<HTMLElement | null>, activo: boolean): Espacio | null {
  const [espacio, setEspacio] = useState<Espacio | null>(null);
  // En cada pintado: cambia el contenido de los vecinos, el tamaño de la ventana, lo que ven las cartas…
  useLayoutEffect(() => {
    const tapete = raiz.current;
    if (!activo || tapete === null) return;
    const caja = tapete.getBoundingClientRect();
    const centro = caja.left + caja.width / 2;
    let mitad = Infinity;
    for (const asiento of tapete.querySelectorAll(".bj-asiento:not(.bj-asiento--yo)")) {
      const r = asiento.getBoundingClientRect();
      if (r.width === 0) continue;
      mitad = Math.min(mitad, r.left >= centro ? r.left - centro : r.right <= centro ? centro - r.right : 0);
    }
    const siguiente: Espacio = { libre: Number.isFinite(mitad) ? Math.max(0, Math.floor(2 * (mitad - MARGEN))) : Infinity, ancho: Math.round(caja.width), alto: Math.round(caja.height) };
    setEspacio((actual) => (actual !== null && actual.libre === siguiente.libre && actual.ancho === siguiente.ancho && actual.alto === siguiente.alto ? actual : siguiente));
  });
  return activo ? espacio : null;
}
