import { type KeyboardEvent, useRef } from "react";
import type { OrdenRanking } from "../../../shared/api";
import { PESTANAS } from "./pestanas";

export const idPestana = (orden: OrdenRanking): string => `ranking-pestana-${orden}`;
export const ID_PANEL = "ranking-panel";

interface Props {
  activa: OrdenRanking;
  onElegir(orden: OrdenRanking): void;
}

/**
 * Las pestañas del ranking. Al moverse con las flechas (también Inicio y Fin, y dando la vuelta) la pestaña se activa al
 * llegar a ella; solo la activa está en el orden del tabulador y de ella se pasa al panel.
 */
export function BarraPestanas({ activa, onElegir }: Props) {
  const botones = useRef(new Map<OrdenRanking, HTMLButtonElement>());

  function alTeclear(evento: KeyboardEvent<HTMLDivElement>) {
    const enfocada = PESTANAS.findIndex(({ orden }) => botones.current.get(orden) === document.activeElement);
    const desde = enfocada === -1 ? PESTANAS.findIndex(({ orden }) => orden === activa) : enfocada;
    const n = PESTANAS.length;
    const destino = { ArrowRight: (desde + 1) % n, ArrowLeft: (desde - 1 + n) % n, Home: 0, End: n - 1 }[evento.key];
    if (destino === undefined) return;
    evento.preventDefault();
    const { orden } = PESTANAS[destino];
    onElegir(orden);
    botones.current.get(orden)?.focus();
  }

  return (
    <div className="ranking-pestanas" role="tablist" aria-label="Ordenar el ranking por" onKeyDown={alTeclear}>
      {PESTANAS.map(({ orden, etiqueta }) => (
        <button
          key={orden}
          ref={(boton) => {
            if (boton === null) botones.current.delete(orden);
            else botones.current.set(orden, boton);
          }}
          type="button"
          role="tab"
          id={idPestana(orden)}
          className="ranking-pestana"
          aria-selected={orden === activa}
          aria-controls={ID_PANEL}
          tabIndex={orden === activa ? 0 : -1}
          onClick={() => onElegir(orden)}
        >
          {etiqueta}
        </button>
      ))}
    </div>
  );
}
