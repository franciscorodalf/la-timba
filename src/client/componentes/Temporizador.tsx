import { useAnimate } from "motion/react";
import { useLayoutEffect } from "react";
import { useMovimientoReducido } from "../efectos/movimiento";
import { ahoraServidor, useAhoraServidor } from "../red/reloj";

/** En los últimos segundos la barra se tiñe de rojo para avisar. */
const URGENTE_MS = 5_000;

interface Props {
  /** Instante del servidor en que vence la fase; `null` si no hay cuenta atrás (la barra se queda vacía y tenue). */
  finFase: number | null;
  /** Lo que dura la fase entera: la barra llena equivale a esto. */
  duracionMs: number;
}

/**
 * La barra dorada que se vacía hasta `finFase`, medida con la hora del servidor. Se mueve en el compositor (una sola
 * animación de `transform`), no en cada fotograma de React. Con movimiento reducido no se desliza: baja a saltos de un segundo.
 */
export function Temporizador({ finFase, duracionMs }: Props) {
  const reducido = useMovimientoReducido();
  const [barra, animar] = useAnimate<HTMLSpanElement>();
  const ahora = useAhoraServidor(reducido && finFase !== null);

  useLayoutEffect(() => {
    const el = barra.current;
    const urgente = el?.firstElementChild;
    if (el === null || !(urgente instanceof HTMLElement) || reducido) return;
    // Sin cuenta atrás, lo que quedaba se vacía deprisa (también lo que deja a medias la animación anterior al pararse).
    if (finFase === null) {
      const vaciar = [animar(el, { transform: "scaleX(0)" }, { duration: 0.25, ease: "easeOut" }), animar(urgente, { opacity: 0 }, { duration: 0.25 })];
      return () => vaciar.forEach((a) => a.stop());
    }
    const restante = Math.max(0, finFase - ahoraServidor());
    const animaciones = [
      animar(el, { transform: [`scaleX(${Math.min(1, restante / duracionMs)})`, "scaleX(0)"] }, { duration: restante / 1000, ease: "linear" }),
      animar(urgente, { opacity: [0, 1] }, { duration: 0.4, delay: Math.max(0, restante - URGENTE_MS) / 1000 }),
    ];
    return () => animaciones.forEach((a) => a.stop());
  }, [finFase, duracionMs, reducido, animar]);

  let estilo: { transform: string } | undefined;
  let urgente = false;
  if (reducido) {
    const restante = finFase === null ? 0 : Math.max(0, finFase - ahora);
    estilo = { transform: `scaleX(${Math.min(1, Math.ceil(restante / 1000) / Math.ceil(duracionMs / 1000))})` };
    urgente = finFase !== null && restante <= URGENTE_MS;
  }

  return (
    <div className={`temporizador${finFase === null ? " temporizador--parado" : ""}`} aria-hidden="true">
      <span ref={barra} className="temporizador__barra" style={estilo}>
        <span className="temporizador__urgente" style={reducido ? { opacity: urgente ? 1 : 0 } : undefined} />
      </span>
    </div>
  );
}
