import { AnimatePresence, motion } from "motion/react";
import type { CodigoError } from "../../shared/juegos/tipos";
import { Aviso } from "./Aviso";

const TEXTO_ERROR: Partial<Record<CodigoError, string>> = {
  sin_fichas: "No tienes fichas suficientes",
  no_disponible: "No se pudo hacer la apuesta. Inténtalo de nuevo",
};

/** Lo que se le dice al jugador de un error de la mesa. */
export const textoErrorMesa = (error: CodigoError): string => TEXTO_ERROR[error] ?? "No puedes hacer eso ahora";

/** El error de la última acción en un aviso flotante que no tapa nada ni se puede pulsar; se funde al irse. */
export function AvisoMesa({ error }: { error: CodigoError | null }) {
  return (
    <AnimatePresence>
      {error !== null && (
        <motion.div key={error} className="aviso-mesa" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <Aviso>{textoErrorMesa(error)}</Aviso>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
