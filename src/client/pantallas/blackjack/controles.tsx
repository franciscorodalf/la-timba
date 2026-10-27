import type { RefObject } from "react";
import { type AccionBJ, BJ, type VistaBJ } from "../../../shared/juegos/blackjack";
import { Boton } from "../../componentes/Boton";
import { FichasApuesta } from "../../componentes/FichasApuesta";
import { sonidos } from "../../efectos/sonidos";
import { miles } from "../../formato";
import type { ManoVista } from "./piezas";

// Los controles de la mesa: las fichas para apostar, las decisiones y el texto de cada fase.

/** La última apuesta hecha en esta pestaña: la siguiente ronda empieza con ella preparada. */
let ultimaApuesta = 0;

/** Lo que se prepara al empezar a apostar: la última apuesta de esta pestaña. */
export const apuestaRecordada = (): number => ultimaApuesta;

interface ApostarProps {
  /** Lo preparado (lo lleva la pantalla: también se ve en tu casilla del tapete). */
  cantidad: number;
  fichas: number;
  activo: boolean;
  esperando: boolean;
  onCambiar(cantidad: number): void;
  onApostar(cantidad: number): void;
  /** Tu casilla del tapete, adonde vuelan las fichas. */
  destino: RefObject<HTMLElement | null>;
}

/** Las fichas para ir sumando la apuesta (y «Todo»), «Borrar» y «Apostar N». No hay tope: solo tus fichas. */
export function Apostar({ cantidad, fichas, activo, esperando, onCambiar, onApostar, destino }: ApostarProps) {
  return (
    <div className="panel-apuesta">
      <FichasApuesta montante={cantidad} tope={fichas} minimo={BJ.MIN} activo={activo} onCambiar={onCambiar} destino={destino} />
      <div className="panel-apuesta__fila">
        <Boton variante="secundario" className="panel-apuesta__borrar" aria-label="Borrar apuesta" disabled={cantidad === 0} onClick={() => onCambiar(0)}>
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
