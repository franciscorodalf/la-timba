import type { CSSProperties } from "react";
import type { VistaPoker } from "../../../shared/juegos/poker";
import { Naipe } from "../../componentes/Naipe";
import { miles } from "../../formato";
import { ApuestaAsiento, Asiento } from "./Asiento";
import { colocarAsientos } from "./asientos";

/** Las cartas de la mesa: cinco huecos, de los que se llenan los que ya han salido. */
const CARTAS_DE_LA_MESA = 5;

interface Props {
  vista: VistaPoker;
  ordenador: boolean;
}

/**
 * El tapete ovalado, vertical en el móvil y horizontal en el ordenador: los asientos alrededor con tú abajo, lo apostado en la
 * ronda entre cada uno y el centro, y en el centro las cinco cartas de la mesa con el bote debajo.
 */
export function Tapete({ vista, ordenador }: Props) {
  const puestos = colocarAsientos(vista.asientos, vista.yo, ordenador);
  const bote = vista.botes.reduce((suma, b) => suma + b.cantidad, 0);
  const anchoCarta = ordenador ? 56 : 28;
  const anchoMini = ordenador ? 30 : 18;
  const turno = vista.turno;

  return (
    <div className="pk-tapete">
      <ul className="pk-asientos" aria-label="Asientos">
        {puestos.map((p) => (
          <Asiento key={p.asiento.jugadorId} colocado={p} esYo={p.asiento.jugadorId === vista.yo} enTurno={p.asiento.jugadorId === turno} anchoCarta={anchoMini} />
        ))}
      </ul>
      <ul className="pk-apuestas" aria-label="Apuestas de la ronda">
        {puestos.map((p) => (
          <ApuestaAsiento key={p.asiento.jugadorId} colocado={p} />
        ))}
      </ul>
      <div className="pk-centro">
        <div className="pk-mesa-cartas" role="group" aria-label="Cartas de la mesa" style={{ "--ancho-carta": `${anchoCarta}px` } as CSSProperties}>
          {Array.from({ length: CARTAS_DE_LA_MESA }, (_, i) =>
            vista.mesa[i] ? (
              <Naipe key={i} carta={vista.mesa[i]} ancho={anchoCarta} />
            ) : (
              <span key={i} className="pk-hueco" aria-hidden="true" />
            ),
          )}
        </div>
        <p className={`pk-bote${bote <= 0 ? " pk-bote--vacio" : ""}`}>
          Bote <b>{miles(bote)}</b>
        </p>
      </div>
    </div>
  );
}
