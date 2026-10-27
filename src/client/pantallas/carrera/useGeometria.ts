import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Geometria, geometria } from "./geometria";

/** Lo que se espera tras cambiar las medidas antes de volver a animar los caballos (el reencaje no debe verse como una carrera). */
const AJUSTE_MS = 200;

/**
 * Las medidas de la pista, tomadas de la caja `ref` (y vueltas a tomar al cambiar de tamaño). `null` hasta la primera
 * medida, que llega antes del primer pintado. `ajustando` es verdadero mientras cambian las medidas o la orientación: los
 * caballos saltan a su sitio en vez de deslizarse, porque cambiar el tamaño de la ventana no es una carrera.
 */
export function useGeometria(ref: RefObject<HTMLElement | null>, horizontal: boolean): { g: Geometria | null; ajustando: boolean } {
  const [g, setG] = useState<Geometria | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const ultima = useRef<Geometria | null>(null);
  const reposo = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(reposo.current), []);

  useLayoutEffect(() => {
    const caja = ref.current;
    if (caja === null) return;
    const medir = () => {
      const ancho = caja.clientWidth;
      const alto = caja.clientHeight;
      if (ancho === 0 || alto === 0) return;
      const nueva = geometria(horizontal ? ancho : alto, horizontal ? alto : ancho, horizontal);
      const antes = ultima.current;
      if (antes !== null && antes.horizontal === nueva.horizontal && antes.paso === nueva.paso && antes.caballoAncho === nueva.caballoAncho && antes.tramoAncho === nueva.tramoAncho) return;
      ultima.current = nueva;
      if (antes !== null) {
        setCambiando(true);
        clearTimeout(reposo.current);
        reposo.current = setTimeout(() => setCambiando(false), AJUSTE_MS);
      }
      setG(nueva);
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(caja);
    return () => observador.disconnect();
  }, [ref, horizontal]);

  // En el pintado en que cambia la orientación aún hay medidas de la anterior: tampoco ahí se anima.
  return { g, ajustando: cambiando || (g !== null && g.horizontal !== horizontal) };
}
