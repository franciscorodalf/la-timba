import { AnimatePresence, motion } from "motion/react";
import type { CodigoError } from "../../shared/juegos/tipos";
import { MENSAJE_DESCANSANDO, MENSAJE_GENERICO } from "../red/api";
import { Aviso } from "./Aviso";

const TEXTO_ERROR: Partial<Record<CodigoError, string>> = {
  sin_fichas: "No tienes fichas suficientes",
  descansando: MENSAJE_DESCANSANDO,
};

/**
 * Lo que se le dice al jugador de un error de la mesa. `accion` es la acción (su `t`) a la que responde, o `null`: que la
 * mesa no esté disponible solo se cuenta como apuesta fallida si lo que falló fue una apuesta.
 */
export function textoErrorMesa(error: CodigoError, accion: string | null = null): string {
  if (error === "no_disponible") return accion === "apostar" ? "No se pudo hacer la apuesta. Inténtalo de nuevo" : MENSAJE_GENERICO;
  return TEXTO_ERROR[error] ?? "No puedes hacer eso ahora";
}

/** El error de la última acción en un aviso flotante que no tapa nada ni se puede pulsar; se funde al irse. */
export function AvisoMesa({ error, accion }: { error: CodigoError | null; accion: string | null }) {
  return (
    <AnimatePresence>
      {error !== null && (
        <motion.div key={error} className="aviso-mesa" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <Aviso>{textoErrorMesa(error, accion)}</Aviso>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
