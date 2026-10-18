import { AnimatePresence, motion } from "motion/react";
import { useMovimientoReducido } from "../efectos/movimiento";
import { miles } from "../formato";
import { Destellos } from "./Destellos";

export interface Premio {
  neto: number;
  /** Cambia con cada premio: cada uno repite la animación. */
  id: number;
}

/** «¡Ganas +N!» grande en el centro de la pantalla: aparece con un golpe, lanza los destellos y se funde. Con movimiento reducido solo se funde. */
export function CartelPremio({ premio }: { premio: Premio | null }) {
  const reducido = useMovimientoReducido();
  return (
    <AnimatePresence>
      {premio !== null && (
        <motion.div
          key={premio.id}
          className="cartel-premio"
          aria-hidden="true"
          initial={reducido ? { opacity: 0 } : { opacity: 0, transform: "scale(0.3)" }}
          animate={reducido ? { opacity: 1 } : { opacity: [0, 1, 1], transform: ["scale(0.3)", "scale(1.12)", "scale(1)"] }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
          transition={{ duration: reducido ? 0.3 : 0.52, ease: [0.2, 0.8, 0.2, 1.3], times: reducido ? undefined : [0, 0.6, 1] }}
        >
          <span className="cartel-premio__texto">¡Ganas +{miles(premio.neto)}!</span>
          <Destellos disparo={premio.id} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
