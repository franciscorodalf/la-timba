import { motion } from "motion/react";
import { type RefObject, useLayoutEffect, useState } from "react";
import { useMovimientoReducido } from "../efectos/movimiento";
import { Ficha } from "./Ficha";

const FICHAS = 6;
const LADO = 22;
const CURVA = [0.4, 0, 0.2, 1] as const;

/** Lo que se aparta del camino recto el punto medio del vuelo. */
const COMBA = 70;

interface Vuelo {
  disparo: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** Desplazamiento del punto medio: perpendicular al camino, hacia arriba y hacia el centro de la pantalla. */
  cx: number;
  cy: number;
}

/** El arco: de las dos perpendiculares al camino, la que sube y va hacia el centro de la pantalla (no contra el borde). */
function comba(x: number, dx: number, dy: number): { cx: number; cy: number } {
  const largo = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / largo, y: dx / largo };
  const haciaElCentro = Math.sign(window.innerWidth / 2 - x);
  const puntos = (v: { x: number; y: number }) => -v.y + v.x * haciaElCentro;
  const elegida = puntos(n) >= puntos({ x: -n.x, y: -n.y }) ? n : { x: -n.x, y: -n.y };
  return { cx: elegida.x * COMBA, cy: elegida.y * COMBA };
}

interface Props {
  /** Cambiarlo lanza un vuelo (con 0 no hay ninguno). */
  disparo: number;
  /** De dónde salen las fichas… */
  desde: RefObject<HTMLElement | null>;
  /** …y adónde llegan (el contador de fichas). */
  hasta: RefObject<HTMLElement | null>;
}

/**
 * Seis fichas que salen de `desde`, describen un arco hacia el centro de la pantalla y se funden en `hasta`, una detrás de otra: lo ganado va a tus fichas.
 * Van por encima de todo y no se pueden pulsar. Con movimiento reducido no vuelan.
 */
export function FichasVolando({ disparo, desde, hasta }: Props) {
  const reducido = useMovimientoReducido();
  const [vuelo, setVuelo] = useState<Vuelo | null>(null);

  useLayoutEffect(() => {
    if (disparo === 0 || reducido || desde.current === null || hasta.current === null) return;
    const a = desde.current.getBoundingClientRect();
    const b = hasta.current.getBoundingClientRect();
    const x = a.left + a.width / 2 - LADO / 2;
    const y = a.top + a.height / 2 - LADO / 2;
    const dx = b.left + b.width / 2 - LADO / 2 - x;
    const dy = b.top + b.height / 2 - LADO / 2 - y;
    setVuelo({ disparo, x, y, dx, dy, ...comba(x, dx, dy) });
  }, [disparo, reducido, desde, hasta]);

  if (vuelo === null) return null;
  const { x, y, dx, dy, cx, cy } = vuelo;
  return (
    <div key={vuelo.disparo} className="fichas-volando" aria-hidden="true">
      {Array.from({ length: FICHAS }, (_, i) => {
        // Cada ficha sale un poco desplazada; todas suben antes de caer en el contador.
        const sx = x + (i - (FICHAS - 1) / 2) * 6;
        const ex = dx - (sx - x);
        return (
          <motion.span
            key={i}
            className="fichas-volando__ficha"
            style={{ left: sx, top: y }}
            initial={{ opacity: 1, transform: "translate(0px, 0px) scale(1)" }}
            animate={{
              opacity: [1, 1, 0],
              transform: ["translate(0px, 0px) scale(1)", `translate(${(ex * 0.5 + cx).toFixed(1)}px, ${(dy * 0.5 + cy).toFixed(1)}px) scale(1.2)`, `translate(${ex.toFixed(1)}px, ${dy.toFixed(1)}px) scale(0.8)`],
            }}
            transition={{ duration: 0.75, delay: i * 0.07, ease: CURVA, times: [0, 0.5, 1] }}
            onAnimationComplete={i === FICHAS - 1 ? () => setVuelo((actual) => (actual?.disparo === vuelo.disparo ? null : actual)) : undefined}
          >
            <Ficha tamaño={LADO} />
          </motion.span>
        );
      })}
    </div>
  );
}
