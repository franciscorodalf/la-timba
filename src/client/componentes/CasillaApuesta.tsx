import { motion } from "motion/react";
import { type CSSProperties, forwardRef } from "react";
import { useMovimientoReducido } from "../efectos/movimiento";
import { miles } from "../formato";
import { Ficha } from "./Ficha";
import { desglose } from "./pila";

/** Lo que tarda en caer en la pila la ficha que sale de la bandeja (lo que dura su vuelo). */
export const CAIDA_S = 0.26;

interface Props {
  /** Lo que ya está apostado y cobrado en esta casilla. */
  apostado: number;
  /** Lo que llevas preparado y aún no has apostado. */
  preparado: number;
  /** Lo preparado es todo lo que tienes. */
  todo?: boolean;
  /** La versión pequeña, para un carril de la carrera. */
  compacta?: boolean;
}

type Estado = "vacia" | "preparada" | "apostada";

const ETIQUETAS = { vacia: "Tu apuesta", preparada: "Preparada", apostada: "Apostada" } as const;

/**
 * Tu casilla de apuesta en el tapete: el aro, la pila de fichas de lo que apuestas y la cantidad en grande. Lo preparado se
 * ve con el aro punteado; lo apostado, con el aro dorado. Cada ficha nueva cae en la pila (justo cuando llega la que vuela
 * desde la bandeja) y la cantidad da un salto. Con movimiento reducido las fichas aparecen sin caer.
 */
export const CasillaApuesta = forwardRef<HTMLDivElement, Props>(function CasillaApuesta({ apostado, preparado, todo = false, compacta = false }, ref) {
  const reducido = useMovimientoReducido();
  const total = apostado + preparado;
  const estado: Estado = total === 0 ? "vacia" : preparado > 0 ? "preparada" : "apostada";
  const lado = compacta ? 28 : 50;
  const conTodo = todo && estado === "preparada";
  const pila = desglose(total);
  return (
    <div ref={ref} className={`casilla casilla--${estado}${compacta ? " casilla--compacta" : ""}${conTodo ? " casilla--todo" : ""}`} data-estado={estado} data-cantidad={total}>
      <div className="casilla__aro" aria-hidden="true">
        <div className="casilla__pila" style={{ "--ficha": `${lado}px`, "--n": Math.max(pila.length, 1) } as CSSProperties}>
          {pila.map((valor, i) => (
            <motion.span
              key={`${i}:${valor}`}
              className="casilla__ficha"
              style={{ "--i": i } as CSSProperties}
              initial={reducido ? { opacity: 0 } : { opacity: 0, transform: "translateY(-16px) scale(1.12)" }}
              animate={reducido ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px) scale(1)" }}
              transition={reducido ? { duration: 0.15 } : { delay: CAIDA_S, duration: 0.2, ease: [0.2, 0.8, 0.2, 1.25] }}
            >
              <Ficha valor={valor} tamaño={lado} />
            </motion.span>
          ))}
        </div>
      </div>
      <div className="casilla__texto">
        <span className="casilla__estado">{conTodo ? "¡Todo!" : ETIQUETAS[estado]}</span>
        {total > 0 && (
          <motion.b
            key={total}
            className="casilla__cantidad"
            initial={reducido ? { opacity: 0.4 } : { transform: "scale(1.25)" }}
            animate={reducido ? { opacity: 1 } : { transform: "scale(1)" }}
            transition={{ delay: reducido ? 0 : CAIDA_S, duration: 0.24, ease: [0.2, 0.8, 0.2, 1.3] }}
          >
            {miles(total)}
          </motion.b>
        )}
        {apostado > 0 && preparado > 0 && <span className="casilla__mas">+{miles(preparado)} por apostar</span>}
      </div>
    </div>
  );
});
