import type { ReactNode } from "react";
import { Temporizador } from "./Temporizador";

interface Props {
  /** Qué pasa ahora en la mesa («Haz tu apuesta», «Nueva carrera en»). */
  texto: string;
  /** La cuenta atrás ya escrita (`0:12`), o `null` si la fase no tiene. Va pegada al texto: «Nueva carrera en 0:04». */
  cuenta: string | null;
  /** Detalles al final de la línea (el resultado de tu última jugada); nunca entre el texto y su cuenta. */
  children?: ReactNode;
  /** Fin de la fase del temporizador (de la hora del servidor), o `null` si no hay barra que vaciar. */
  finFase: number | null;
  duracionMs: number;
}

/**
 * La línea de estado de una mesa con la barra del temporizador debajo. El texto anuncia los cambios de fase (`status`); la cuenta
 * va justo detrás, fuera de esa región para que sus cambios no se anuncien a cada segundo, pero dentro del flujo de lectura: se
 * oye «Nueva carrera en» y, a continuación, «0:04».
 */
export function EstadoMesa({ texto, cuenta, children, finFase, duracionMs }: Props) {
  return (
    <div className="estado-mesa">
      <div className="estado-mesa__fila">
        <p className="estado-mesa__texto" role="status">
          {texto}
        </p>
        {cuenta !== null && <span className="estado-mesa__cuenta">{cuenta}</span>}
        {children && <div className="estado-mesa__detalle">{children}</div>}
      </div>
      <Temporizador finFase={finFase} duracionMs={duracionMs} />
    </div>
  );
}
