import { useIsPresent } from "motion/react";
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
  /** Lo preparado en cada casilla (lo lleva la pantalla: también se ve en el tapete). La segunda es `null` mientras no la hayas pedido. */
  preparado: readonly [number, number | null];
  /** La casilla a la que van las fichas y «Todo». */
  elegida: 0 | 1;
  fichas: number;
  activo: boolean;
  esperando: boolean;
  /** Cambia lo preparado en la casilla elegida. */
  onCambiar(cantidad: number): void;
  /** Quita la segunda casilla (solo se ofrece cuando está elegida y vacía). */
  onQuitarSegunda(): void;
  /** Apuesta la primera casilla y, si hay, la segunda (`null`: solo una mano). */
  onApostar(primera: number, segunda: number | null): void;
  /** La casilla elegida del tapete, adonde vuelan las fichas. */
  destino: RefObject<HTMLElement | null>;
}

/**
 * Las fichas para ir sumando la apuesta (y «Todo»), «Borrar» y «Apostar N». No hay tope: solo tus fichas, que se reparten entre
 * las dos casillas si pides la segunda («Apostar A + B»). Con la segunda casilla elegida y vacía, «Borrar» pasa a quitarla.
 */
export function Apostar({ preparado, elegida, fichas, activo, esperando, onCambiar, onQuitarSegunda, onApostar, destino }: ApostarProps) {
  const [primera, segunda] = preparado;
  const hayDos = segunda !== null && segunda >= BJ.MIN;
  const actual = elegida === 0 ? primera : (segunda ?? 0);
  const otra = elegida === 0 ? (segunda ?? 0) : primera;
  const quita = elegida === 1 && actual === 0;
  return (
    <div className="panel-apuesta">
      <FichasApuesta montante={actual} tope={fichas - otra} minimo={BJ.MIN} activo={activo} onCambiar={onCambiar} destino={destino} />
      <div className="panel-apuesta__fila">
        <Boton
          variante="secundario"
          className="panel-apuesta__borrar"
          aria-label={quita ? "Quitar segunda mano" : "Borrar apuesta"}
          disabled={!quita && actual === 0}
          onClick={quita ? onQuitarSegunda : () => onCambiar(0)}
        >
          {quita ? "Quitar" : "Borrar"}
        </Boton>
        <Boton
          disabled={!activo || primera < BJ.MIN}
          cargando={esperando}
          onClick={() => {
            ultimaApuesta = primera;
            onApostar(primera, hayDos ? segunda : null);
          }}
        >
          {primera === 0 ? "Elige tu apuesta" : hayDos ? `Apostar ${miles(primera)} + ${miles(segunda)}` : `Apostar ${miles(primera)}`}
        </Boton>
      </div>
    </div>
  );
}

/**
 * Cuando juegas con dos casillas, un botón transparente sobre cada una para elegirla (aro dorado): las fichas van a la elegida.
 * Va encima de la casilla y no la envuelve, así la casilla no se vuelve a montar (sus fichas no caerían otra vez).
 */
export function ElegirCasilla({ cual, elegida, onElegir }: { cual: "primera" | "segunda"; elegida: boolean; onElegir(): void }) {
  // Las casillas se funden al repartir: mientras se van ya no se eligen (y el botón no se queda encogido en el árbol de accesibilidad).
  if (!useIsPresent()) return null;
  return <button type="button" className="bj-casilla__elegir" aria-pressed={elegida} aria-label={`Casilla de la ${cual} mano`} onClick={onElegir} />;
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
    case "seguro":
      return "Esperando al resto";
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
