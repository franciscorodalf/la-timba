import { motion } from "motion/react";
import { type RefObject, useState } from "react";
import { createPortal } from "react-dom";
import { useMovimientoReducido } from "../efectos/movimiento";
import { sonidos } from "../efectos/sonidos";
import { vibrar } from "../efectos/vibrar";
import { CAIDA_S } from "./CasillaApuesta";
import { Ficha } from "./Ficha";
import { desglose, VALORES_FICHA } from "./pila";

export { VALORES_FICHA } from "./pila";

const LADO_VUELO = 34;

interface Vuelo {
  id: number;
  valor: number | "todo";
  x: number;
  y: number;
  dx: number;
  dy: number;
  retraso: number;
}

interface Props {
  /** Lo que ya has preparado para apostar. */
  montante: number;
  /** Lo máximo que puede sumar `montante`: tus fichas. Las fichas que lo pasarían se apagan. */
  tope: number;
  /** La apuesta mínima: con menos fichas que esto, «Todo» no se puede. */
  minimo: number;
  activo: boolean;
  onCambiar(montante: number): void;
  /** Adónde vuelan las fichas al tocarlas: tu casilla de apuesta en el tapete. */
  destino?: RefObject<HTMLElement | null>;
}

let siguienteVuelo = 1;

/**
 * Las fichas de 10 a 500 para ir sumando una apuesta y la dorada de «Todo», que prepara todas tus fichas. Cada toque suena,
 * vibra un poco y lanza la ficha a tu casilla del tapete. No dejan pasar de `tope`.
 */
export function FichasApuesta({ montante, tope, minimo, activo, onCambiar, destino }: Props) {
  const reducido = useMovimientoReducido();
  const [vuelos, setVuelos] = useState<Vuelo[]>([]);

  const lanzar = (desde: HTMLElement, valores: (number | "todo")[]) => {
    sonidos.reproducir("fichas");
    vibrar(12);
    const hasta = destino?.current;
    if (reducido || !hasta) return;
    const a = desde.getBoundingClientRect();
    const b = hasta.querySelector(".casilla__aro")?.getBoundingClientRect() ?? hasta.getBoundingClientRect();
    const x = a.left + a.width / 2 - LADO_VUELO / 2;
    const y = a.top + a.height / 2 - LADO_VUELO / 2;
    const dx = b.left + b.width / 2 - LADO_VUELO / 2 - x;
    const dy = b.top + b.height / 2 - LADO_VUELO / 2 - y;
    setVuelos((actuales) => [...actuales, ...valores.map((valor, i) => ({ id: siguienteVuelo++, valor, x, y, dx, dy, retraso: i * 0.05 }))]);
  };

  const todoDisponible = activo && tope >= minimo && montante !== tope;
  return (
    <div className="fichas-apuesta" role="group" aria-label="Fichas para apostar">
      {VALORES_FICHA.map((valor) => (
        <button
          key={valor}
          type="button"
          className={`ficha-apuesta ficha-apuesta--${valor}`}
          aria-label={`Añadir ${valor}`}
          disabled={!activo || montante + valor > tope}
          onClick={(evento) => {
            onCambiar(montante + valor);
            lanzar(evento.currentTarget, [valor]);
          }}
        >
          <Ficha tamaño={50} valor={valor} />
          <span className="ficha-apuesta__valor" aria-hidden="true">
            {valor}
          </span>
        </button>
      ))}
      <button
        type="button"
        className="ficha-apuesta ficha-apuesta--todo"
        aria-label="Todo"
        disabled={!todoDisponible}
        onClick={(evento) => {
          onCambiar(tope);
          lanzar(evento.currentTarget, ["todo", ...desglose(tope).slice(0, 3)]);
        }}
      >
        <Ficha tamaño={50} valor="todo" />
        <span className="ficha-apuesta__valor" aria-hidden="true">
          TODO
        </span>
      </button>
      {/* Por encima de todo y fuera del panel: un antecesor con `transform` descolocaría un `position: fixed`. */}
      {vuelos.length > 0 &&
        createPortal(
          <div className="vuelos-ficha" aria-hidden="true">
            {vuelos.map((v) => (
              <motion.span
                key={v.id}
                className="vuelos-ficha__ficha"
                style={{ left: v.x, top: v.y }}
                initial={{ opacity: 1, transform: "translate(0px, 0px) scale(1)" }}
                animate={{
                  opacity: [1, 1, 0.9],
                  transform: ["translate(0px, 0px) scale(1)", `translate(${(v.dx * 0.5).toFixed(1)}px, ${(v.dy * 0.5 - 46).toFixed(1)}px) scale(1.12)`, `translate(${v.dx.toFixed(1)}px, ${v.dy.toFixed(1)}px) scale(0.85)`],
                }}
                transition={{ duration: CAIDA_S, delay: v.retraso, ease: [0.3, 0, 0.3, 1], times: [0, 0.5, 1] }}
                onAnimationComplete={() => setVuelos((actuales) => actuales.filter((otro) => otro.id !== v.id))}
              >
                <Ficha tamaño={LADO_VUELO} valor={v.valor} />
              </motion.span>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
