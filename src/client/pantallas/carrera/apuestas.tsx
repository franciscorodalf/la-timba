import type { Palo } from "../../../shared/cartas";
import { CARRERA, type FaseCarrera } from "../../../shared/juegos/carrera";
import { Boton } from "../../componentes/Boton";
import { FichasApuesta } from "../../componentes/FichasApuesta";
import { miles } from "../../formato";
import { esRojo, NOMBRE_PALO, SIMBOLO_PALO } from "./palos";

// Lo de debajo de la pista: las fichas y el botón para apostar, lo tuyo mientras corren y el cartel del ganador.

interface PanelApuestasProps {
  elegido: Palo | null;
  /** Lo que llevas preparado para este caballo. */
  montante: number;
  /** Lo máximo que puede sumar `montante`: el tope por caballo (500 acumulado) o tus fichas, el menor. */
  tope: number;
  /** Ya has llegado al máximo en este caballo. */
  alMaximo: boolean;
  activo: boolean;
  /** Esperando a que la mesa confirme tu última apuesta. */
  esperando: boolean;
  onCambiar(montante: number): void;
  onApostar(): void;
}

/** Las fichas de 10 a 500 y «Apostar N a corazones»: se suman al caballo elegido, de 500 como mucho entre todas. */
export function PanelApuestas({ elegido, montante, tope, alMaximo, activo, esperando, onCambiar, onApostar }: PanelApuestasProps) {
  const cantidad = montante <= tope ? montante : 0;
  const etiqueta =
    elegido === null ? "Elige un caballo" : cantidad > 0 ? `Apostar ${miles(cantidad)} a ${NOMBRE_PALO[elegido]}` : alMaximo ? `Máximo en ${NOMBRE_PALO[elegido]}` : "Elige tu apuesta";
  return (
    <div className="panel-apuesta">
      <FichasApuesta montante={cantidad} tope={tope} activo={activo && elegido !== null} onCambiar={onCambiar} />
      <div className="panel-apuesta__fila">
        <Boton variante="secundario" className="panel-apuesta__borrar" aria-label="Borrar apuesta" disabled={cantidad === 0} onClick={() => onCambiar(0)}>
          Borrar
        </Boton>
        <Boton disabled={!activo || elegido === null || cantidad < CARRERA.MIN} cargando={esperando} onClick={onApostar}>
          {etiqueta}
        </Boton>
      </div>
    </div>
  );
}

/** Mientras corren: lo que has apostado, o una invitación a mirar si no apostaste. */
export function PanelEnCarrera({ apuestas }: { apuestas: { caballo: Palo; cantidad: number }[] }) {
  return (
    <div className="panel-carrera">
      {apuestas.length === 0 ? (
        <p className="panel-carrera__vacio">No has apostado en esta carrera. Mira cómo corren.</p>
      ) : (
        <>
          <p className="panel-carrera__titulo">Tus apuestas</p>
          <ul className="panel-carrera__lista" aria-label="Tus apuestas">
            {apuestas.map(({ caballo, cantidad }) => (
              <li key={caballo} className="panel-carrera__apuesta">
                <span className={`panel-carrera__palo${esRojo(caballo) ? " panel-carrera__palo--rojo" : ""}`} aria-hidden="true">
                  {SIMBOLO_PALO[caballo]}
                </span>
                <span className="solo-lectores">{NOMBRE_PALO[caballo]} </span>
                {miles(cantidad)}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** El cartel del ganador, donde estaban las fichas. */
export function PanelGanador({ ganador }: { ganador: Palo }) {
  return (
    <div className="panel-ganador" role="status" key={ganador}>
      <span className={`panel-ganador__palo${esRojo(ganador) ? " panel-ganador__palo--rojo" : ""}`} aria-hidden="true">
        {SIMBOLO_PALO[ganador]}
      </span>
      <p className="panel-ganador__texto">¡Gana el caballo de {NOMBRE_PALO[ganador]}!</p>
    </div>
  );
}

/** El texto de la fase para la línea de estado. */
export function textoEstado(fase: FaseCarrera | null, conApuestas: boolean): string {
  switch (fase) {
    case null:
      return "Sentándote en la mesa…";
    case "esperando":
      return "Apuesta para empezar la carrera";
    case "apuestas":
      return conApuestas ? "Apuesta hecha. Puedes sumar más" : "Elige un caballo y apuesta";
    case "carrera":
      return "¡Corren los caballos!";
    case "resultado":
      return "Nueva carrera en";
  }
}
