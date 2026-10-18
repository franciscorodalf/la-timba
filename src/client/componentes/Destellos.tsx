import { motion } from "motion/react";
import { useState } from "react";
import { useMovimientoReducido } from "../efectos/movimiento";

const CHISPAS = 16;
const CURVA = [0.1, 0.8, 0.3, 1] as const;

/** Las 16 chispas de una ráfaga: en círculo, cada una a una distancia y con una duración un poco distintas. */
function Rafaga() {
  const [chispas] = useState(() =>
    Array.from({ length: CHISPAS }, (_, i) => {
      const angulo = (i / CHISPAS) * Math.PI * 2;
      const distancia = 60 + Math.random() * 50;
      return { x: Math.cos(angulo) * distancia, y: Math.sin(angulo) * distancia, duracion: 0.7 + Math.random() * 0.3 };
    }),
  );
  return chispas.map(({ x, y, duracion }, i) => (
    <motion.span
      key={i}
      className="destellos__chispa"
      initial={{ opacity: 1, transform: "translate(0px, 0px) scale(1)" }}
      animate={{ opacity: 0, transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(0.2)` }}
      transition={{ duration: duracion, ease: CURVA }}
    />
  ));
}

/**
 * Una ráfaga de 16 chispas doradas que salen del centro de su contenedor cada vez que cambia `disparo` (con 0 no hay
 * ninguna). Decorativas. Con movimiento reducido no salen: el premio se celebra solo con el fundido del cartel.
 */
export function Destellos({ disparo }: { disparo: number }) {
  const reducido = useMovimientoReducido();
  return (
    <span className="destellos" aria-hidden="true">
      {disparo !== 0 && !reducido && <Rafaga key={disparo} />}
    </span>
  );
}
