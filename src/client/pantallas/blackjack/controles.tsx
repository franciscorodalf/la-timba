import { useState } from "react";
import { type AccionBJ, BJ, type VistaBJ } from "../../../shared/juegos/blackjack";
import { Boton } from "../../componentes/Boton";
import { Ficha } from "../../componentes/Ficha";
import { sonidos } from "../../efectos/sonidos";
import { miles } from "../../formato";
import type { ManoVista } from "./piezas";

// Los controles de la mesa: las fichas para apostar, las decisiones y el texto de cada fase.

const VALORES_FICHA = [10, 25, 50, 100, 500] as const;

/** La última apuesta hecha en esta pestaña: la siguiente ronda empieza con ella preparada. */
let ultimaApuesta = 0;

interface ApostarProps {
  fichas: number;
  activo: boolean;
  esperando: boolean;
  onApostar(cantidad: number): void;
}

/** Las fichas de 10 a 500 para ir sumando la apuesta, «Borrar» y «Apostar N». No deja pasar de 500 ni de tus fichas. */
export function Apostar({ fichas, activo, esperando, onApostar }: ApostarProps) {
  const tope = Math.min(BJ.MAX, fichas);
  const [montante, setMontante] = useState(() => (ultimaApuesta <= tope ? ultimaApuesta : 0));
  const cantidad = montante <= tope ? montante : 0;
  return (
    <div className="bj-apostar">
      <div className="bj-fichas" role="group" aria-label="Fichas para apostar">
        {VALORES_FICHA.map((valor) => (
          <button
            key={valor}
            type="button"
            className={`bj-ficha bj-ficha--${valor}`}
            aria-label={`Añadir ${valor}`}
            disabled={!activo || cantidad + valor > tope}
            onClick={() => setMontante(cantidad + valor)}
          >
            <Ficha tamaño={50} />
            <span className="bj-ficha__valor" aria-hidden="true">
              {valor}
            </span>
          </button>
        ))}
      </div>
      <div className="bj-apostar__fila">
        <Boton variante="secundario" className="bj-apostar__borrar" aria-label="Borrar apuesta" disabled={cantidad === 0} onClick={() => setMontante(0)}>
          Borrar
        </Boton>
        <Boton disabled={!activo || cantidad < BJ.MIN} cargando={esperando} onClick={() => {
            ultimaApuesta = cantidad;
            onApostar(cantidad);
          }}>
          {cantidad === 0 ? "Elige tu apuesta" : `Apostar ${miles(cantidad)}`}
        </Boton>
      </div>
    </div>
  );
}

export function Decidir({ mano, fichas, activo, onActuar }: { mano: ManoVista; fichas: number; activo: boolean; onActuar(accion: AccionBJ): void }) {
  const puede = activo && mano.estado === "jugando";
  const puedeDoblar = puede && mano.cartas.length === 2 && fichas >= mano.apuesta;
  return (
    <div className="bj-decidir">
      <Boton variante="secundario" disabled={!puede} onClick={() => onActuar({ t: "plantarse" })}>
        Plantarse
      </Boton>
      <Boton disabled={!puede} onClick={() => onActuar({ t: "pedir" })}>
        Pedir
      </Boton>
      <Boton
        variante="secundario"
        disabled={!puedeDoblar}
        onClick={() => {
          sonidos.reproducir("fichas");
          onActuar({ t: "doblar" });
        }}
      >
        Doblar
      </Boton>
    </div>
  );
}

/**
 * El texto de la fase para el panel. `manoEnLaMesa` dice si tus cartas ya han llegado a su sitio: mientras alguna vuela,
 * el texto no adelanta lo que aún no se ve (tu blackjack, que te has pasado o que te toca).
 */
export function textoEstado(vista: VistaBJ | null, mano: ManoVista | undefined, manoEnLaMesa: boolean): string {
  if (vista === null) return "Sentándote en la mesa…";
  switch (vista.fase) {
    case "esperando":
      return "Apuesta para empezar la ronda";
    case "apuestas":
      return mano ? "Apuesta hecha. Esperando al reparto" : "Haz tu apuesta";
    case "decisiones":
      if (!mano) return "Miras esta ronda";
      if (!manoEnLaMesa) return "Repartiendo…";
      if (mano.estado === "jugando") return "Tu turno: ¿pides o te plantas?";
      if (mano.estado === "blackjack") return "¡Blackjack! Esperando al resto";
      if (mano.estado === "pasado") return "Te has pasado. Esperando al resto";
      return "Esperando al resto";
    case "banca":
      return "Juega la banca";
    case "resultado":
      return "Nueva ronda en";
  }
}
