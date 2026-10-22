import { useCallback, useRef, useState } from "react";
import type { Premio } from "../componentes/CartelPremio";
import { useSesion } from "../red/sesion";
import { sonidos } from "./sonidos";
import { useDespues } from "./useDespues";
import { vibrar } from "./vibrar";

/** Lo que se queda el cartel «¡Ganas +N!». */
export const CARTEL_MS = 2_000;
/** Las fichas que vuelan tardan esto en empezar a llegar al contador: entonces empieza a contar. */
export const LLEGADA_FICHAS_MS = 450;

/**
 * El cobro de tus pagos, igual en todas las mesas. `celebrar(neto)` con un neto positivo saca el cartel («¡Ganas +N!»), suena la
 * victoria, vibra 80 ms y pone al día el contador cuando las fichas empiezan a llegar; con cualquier otro neto solo pone al día el
 * contador. `premio` es lo que enseña `CartelPremio` (y su `id` lanza las fichas volando).
 */
export function usePremio(): { premio: Premio | null; celebrar(neto: number): void } {
  const { refrescar } = useSesion();
  const despues = useDespues();
  const [premio, setPremio] = useState<Premio | null>(null);
  const premios = useRef(0);

  const celebrar = useCallback(
    (neto: number) => {
      if (neto <= 0) {
        void refrescar();
        return;
      }
      premios.current += 1;
      setPremio({ neto, id: premios.current });
      sonidos.reproducir("victoria");
      vibrar(80);
      despues(CARTEL_MS, () => setPremio(null));
      despues(LLEGADA_FICHAS_MS, () => void refrescar());
    },
    [despues, refrescar],
  );

  return { premio, celebrar };
}
