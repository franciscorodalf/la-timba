import { useEffect, useState } from "react";
import { usePartida } from "../red/usePartida";

/** Una caída más corta que esto (la primera conexión, un parpadeo de la red) no merece un aviso. */
const RETRASO_MS = 1000;

/** `true` cuando `condicion` lleva `ms` seguida cumpliéndose; en cuanto deja de cumplirse, `false` al instante. */
function useTrasRetraso(condicion: boolean, ms: number): boolean {
  const [pasado, setPasado] = useState(false);
  useEffect(() => {
    if (!condicion) {
      setPasado(false);
      return;
    }
    const espera = setTimeout(() => setPasado(true), ms);
    return () => clearTimeout(espera);
  }, [condicion, ms]);
  return condicion && pasado;
}

/**
 * «Reconectando…» mientras el socket de la sala está caído, para cualquier pantalla de dentro de la partida. No existe
 * hasta pasado `RETRASO_MS` sin conexión: en una carga normal no se pinta ni se anuncia. La región `status` sí está
 * siempre, vacía, para que los lectores de pantalla anuncien el texto cuando aparece.
 */
export function Reconectando() {
  const { conectado } = usePartida();
  const visible = useTrasRetraso(!conectado, RETRASO_MS);
  return (
    <div role="status">
      {visible && (
        <p className="reconectando">
          <span className="reconectando__giro" aria-hidden="true" />
          Reconectando…
        </p>
      )}
    </div>
  );
}
