import { type CSSProperties, useCallback, useState } from "react";
import type { Carta } from "../../../shared/cartas";
import { type Jugada, nombreJugada } from "../../../shared/juegos/poker-jugadas";
import { Boton } from "../../componentes/Boton";
import { Ficha } from "../../componentes/Ficha";
import { Naipe } from "../../componentes/Naipe";
import { miles } from "../../formato";

const CLAVE_TAPAR = "timba.poker.tapar";

/** El ancho de tus cartas bajo el tapete: las más grandes de la mesa, pero sin quitar sitio a los botones en un móvil bajo. */
const ANCHO_CARTA = 44;

function leerTapadas(): boolean {
  try {
    return localStorage.getItem(CLAVE_TAPAR) === "1";
  } catch {
    return false;
  }
}

/** Si tienes las cartas tapadas, recordado en el navegador (como el silencio). Sin `localStorage` funciona igual, sin recordarlo. */
export function useTapadas(): [boolean, () => void] {
  const [tapadas, setTapadas] = useState(leerTapadas);
  const alternar = useCallback(() => {
    setTapadas((antes) => {
      try {
        localStorage.setItem(CLAVE_TAPAR, antes ? "0" : "1");
      } catch {
        // Sin almacenamiento solo se pierde el recuerdo.
      }
      return !antes;
    });
  }, []);
  return [tapadas, alternar];
}

interface Props {
  /** Tus dos cartas, o `null` si esta mano no juegas. */
  cartas: Carta[] | null;
  /** Tu mejor jugada con las cartas de la mesa que ya han salido, o `null` si no tienes cartas. */
  jugada: Jugada | null;
  /** Si las tienes tapadas (el estado vive en la mesa, que también se lo pasa a la tabla de jugadas). */
  tapadas: boolean;
  onAlternar(): void;
  /** Tu pila en la mesa. */
  pila: number;
  /** Lo que has añadido y entra al empezar la mano siguiente. */
  porEntrar: number;
}

/**
 * Debajo del tapete: tus cartas grandes y, al lado, tu pila, el nombre de tu jugada («Pareja de reyes») y «Tapar», que las da la
 * vuelta solo en tu pantalla y esconde también el texto. Sin cartas reserva su sitio (la mesa no salta cuando llega la mano).
 */
export function MisCartas({ cartas, jugada, tapadas, onAlternar, pila, porEntrar }: Props) {
  return (
    <div className="pk-mias" style={{ "--ancho-carta": `${ANCHO_CARTA}px` } as CSSProperties}>
      {cartas === null ? (
        <div className="pk-mias__cartas pk-mias__cartas--vacias" aria-hidden="true">
          <span className="pk-mias__hueco" />
          <span className="pk-mias__hueco" />
        </div>
      ) : (
        <div className="pk-mias__cartas" role="group" aria-label="Tus cartas">
          {cartas.map((carta, i) => (
            <Naipe key={i} carta={tapadas ? null : carta} ancho={ANCHO_CARTA} />
          ))}
        </div>
      )}
      <div className="pk-mias__datos">
        <p className="pk-mipila">
          <Ficha tamaño={16} />
          <span>Tu pila</span> <b>{miles(pila)}</b>
        </p>
        {porEntrar > 0 && <p className="pk-mias__entra">+{miles(porEntrar)} en la próxima mano</p>}
        {cartas !== null && (
          <>
            <p className="pk-jugada">{tapadas || jugada === null ? "" : nombreJugada(jugada)}</p>
            <Boton variante="secundario" className="pk-mias__tapar" onClick={onAlternar}>
              {tapadas ? "Destapar" : "Tapar"}
            </Boton>
          </>
        )}
      </div>
    </div>
  );
}
