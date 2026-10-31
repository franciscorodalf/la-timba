import { type ReactNode, type Ref, useState } from "react";
import { sonidos } from "../efectos/sonidos";
import { useSesion } from "../red/sesion";
import { Contador } from "./Contador";
import { Ficha } from "./Ficha";

interface Props {
  titulo: string;
  /** «← Sala»: la mesa decide si pregunta antes de salir. */
  onVolver(): void;
  /** El contador de fichas, para que lleguen ahí las fichas que vuelan al ganar. */
  refFichas?: Ref<HTMLParagraphElement>;
  /** Un control más de la mesa (el póker pone aquí «Jugadas»), a la izquierda del sonido. */
  extra?: ReactNode;
}

const trazo = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Quita o pone el sonido de las mesas; se recuerda en el navegador. */
function BotonSilencio() {
  const [silenciado, setSilenciado] = useState(sonidos.silenciado);
  return (
    <button
      type="button"
      className="barra-mesa__sonido"
      aria-label={silenciado ? "Activar el sonido" : "Silenciar el sonido"}
      onClick={() => {
        sonidos.alternar();
        setSilenciado(sonidos.silenciado);
      }}
    >
      <svg viewBox="0 0 24 24" width="22" height="22" {...trazo} aria-hidden="true" focusable="false">
        <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke="none" />
        {silenciado ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />}
      </svg>
    </button>
  );
}

/** La barra de arriba de una mesa: volver a la sala, el nombre de la mesa, lo extra que ponga la mesa, el sonido y tus fichas (que cuentan al cambiar). */
export function BarraMesa({ titulo, onVolver, refFichas, extra }: Props) {
  const { jugador } = useSesion();
  return (
    <header className={`barra-mesa${extra ? " barra-mesa--extra" : ""}`}>
      <button type="button" className="barra-mesa__volver" aria-label="Volver a la sala" onClick={onVolver}>
        <span aria-hidden="true">←</span> Sala
      </button>
      <h1 className="barra-mesa__titulo">{titulo}</h1>
      <div className="barra-mesa__derecha">
        {extra}
        <BotonSilencio />
        <p className="barra-mesa__fichas" ref={refFichas}>
          <Ficha tamaño={20} />
          <span className="solo-lectores">Tienes </span>
          <Contador valor={jugador?.fichas ?? 0} />
          <span className="solo-lectores"> fichas</span>
        </p>
      </div>
    </header>
  );
}
