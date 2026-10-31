import type { CSSProperties } from "react";
import type { AsientoVista } from "../../../shared/juegos/poker";
import { Ficha } from "../../componentes/Ficha";
import { Naipe } from "../../componentes/Naipe";
import { miles } from "../../formato";
import { type AsientoColocado, anclaDeApuesta } from "./asientos";

/** La posición de algo del tapete: el centro, en porcentaje. */
const sitio = (x: number, y: number) => ({ "--x": `${x}%`, "--y": `${y}%` }) as CSSProperties;

interface Props {
  colocado: AsientoColocado;
  esYo: boolean;
  /** Tiene la palabra: su placa va en dorado. */
  enTurno: boolean;
  /** El ancho de las cartas pequeñas del asiento. */
  anchoCarta: number;
}

/** Las clases del asiento: de quién es, si habla, si está apagado y a qué lado del tapete queda (la D va hacia el centro). */
function clasesDe(a: AsientoVista, esYo: boolean, enTurno: boolean, lado: "izq" | "der"): string {
  const clases = ["pk-asiento"];
  if (esYo) clases.push("pk-asiento--yo");
  if (lado === "der") clases.push("pk-asiento--der");
  if (enTurno) clases.push("pk-asiento--turno");
  if (a.estado === "retirado") clases.push("pk-asiento--retirado");
  if (a.estado === "fuera") clases.push("pk-asiento--fuera");
  if (!a.conectado) clases.push("pk-asiento--desconectado");
  return clases.join(" ");
}

/**
 * Un asiento del tapete: la placa con el nombre (nunca con la cantidad), debajo dos cartas pequeñas boca abajo si sigue en la
 * mano (o las que haya enseñado) y debajo su pila de fichas con la cantidad. El botón del repartidor es una ficha con una D al lado.
 * Tus cartas grandes no van aquí: van debajo del tapete.
 */
export function Asiento({ colocado, esYo, enTurno, anchoCarta }: Props) {
  const { asiento: a, x, y } = colocado;
  const cartas = a.cartas ?? (a.tieneCartas && !esYo ? [null, null] : null);
  return (
    <li className={clasesDe(a, esYo, enTurno, x > 50 ? "der" : "izq")} style={sitio(x, y)}>
      <p className="pk-placa">
        <span className="pk-placa__nombre">{esYo ? "Tú" : a.apodo}</span>
      </p>
      {a.estado === "retirado" && <span className="solo-lectores">Retirado. </span>}
      {!a.conectado && <span className="solo-lectores">Sin conexión. </span>}
      {enTurno && <span className="solo-lectores">Tiene la palabra. </span>}
      {cartas !== null && (
        <div className="pk-cartas" style={{ "--ancho-carta": `${anchoCarta}px` } as CSSProperties}>
          {cartas.map((carta, i) => (
            <div key={i} className="pk-cartas__carta">
              <Naipe carta={carta} ancho={anchoCarta} />
            </div>
          ))}
        </div>
      )}
      <p className={`pk-pila${a.estado === "allin" ? " pk-pila--allin" : ""}`}>
        <Ficha tamaño={anchoCarta <= 20 ? 14 : 20} />
        <span className="solo-lectores">Fichas: </span>
        <b>{a.estado === "allin" ? "All-in" : miles(a.fichas)}</b>
      </p>
      {a.boton && (
        <span className="pk-boton" role="img" aria-label="Botón del repartidor">
          D
        </span>
      )}
    </li>
  );
}

/** Lo apostado en la ronda por un asiento: una ficha y la cantidad, entre su sitio y el centro. */
export function ApuestaAsiento({ colocado }: { colocado: AsientoColocado }) {
  const { asiento: a, apuesta } = colocado;
  if (a.apostado <= 0) return null;
  return (
    <li className={`pk-apuesta pk-apuesta--${anclaDeApuesta(apuesta.x)}`} style={sitio(apuesta.x, apuesta.y)}>
      <Ficha tamaño={16} />
      <span className="solo-lectores">Apuesta de {a.apodo}: </span>
      <b>{miles(a.apostado)}</b>
    </li>
  );
}
