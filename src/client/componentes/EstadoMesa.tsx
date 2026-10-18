import type { ReactNode } from "react";
import { Temporizador } from "./Temporizador";

interface Props {
  /** Qué pasa ahora en la mesa («Haz tu apuesta», «Nueva carrera en»). */
  texto: string;
  /** La cuenta atrás ya escrita (`0:12`), o `null` si la fase no tiene. */
  cuenta: string | null;
  /** Detalles a continuación del texto (el resultado de tu última jugada). */
  children?: ReactNode;
  /** Fin de la fase del temporizador (de la hora del servidor), o `null` si no hay barra que vaciar. */
  finFase: number | null;
  duracionMs: number;
}

/** La línea de estado de una mesa (texto de la fase y cuenta atrás) con la barra del temporizador debajo. */
export function EstadoMesa({ texto, cuenta, children, finFase, duracionMs }: Props) {
  return (
    <div className="estado-mesa">
      <div className="estado-mesa__fila">
        <div className="estado-mesa__texto">
          <p role="status">{texto}</p>
          {children}
        </div>
        {cuenta !== null && (
          <span className="estado-mesa__cuenta" aria-hidden="true">
            {cuenta}
          </span>
        )}
      </div>
      <Temporizador finFase={finFase} duracionMs={duracionMs} />
    </div>
  );
}
