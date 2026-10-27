import { motion } from "motion/react";
import { useMovimientoReducido } from "../efectos/movimiento";
import { miles } from "../formato";

/** «Ganas 50», «Pierdes 50» o «Empate»: lo que ha dejado una mano o una carrera, cuando ya se ha visto el final. */
export function Resultado({ neto }: { neto: number }) {
  const reducido = useMovimientoReducido();
  const texto = neto > 0 ? `Ganas ${neto}` : neto < 0 ? `Pierdes ${-neto}` : "Empate";
  const tono = neto > 0 ? "gana" : neto < 0 ? "pierde" : "empata";
  return (
    <motion.span
      className={`resultado resultado--${tono}`}
      role="status"
      initial={reducido ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px)" }}
      animate={reducido ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {texto}
    </motion.span>
  );
}

/** «+50», «−50» o «=»: lo que se ha llevado otro jugador. */
export function Neto({ neto }: { neto: number }) {
  const tono = neto > 0 ? "gana" : neto < 0 ? "pierde" : "empata";
  return <span className={`neto neto--${tono}`}>{neto > 0 ? `+${miles(neto)}` : neto < 0 ? `−${miles(-neto)}` : "="}</span>;
}
