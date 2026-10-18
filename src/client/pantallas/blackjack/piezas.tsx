import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { type CSSProperties, type ReactNode, type Ref, useId } from "react";
import type { Carta } from "../../../shared/cartas";
import type { VistaBJ } from "../../../shared/juegos/blackjack";
import type { JugadorId } from "../../../shared/juegos/tipos";
import { Ficha } from "../../componentes/Ficha";
import { Naipe } from "../../componentes/Naipe";
import { useMovimientoReducido } from "../../efectos/movimiento";
import { miles } from "../../formato";
import { claveCarta } from "./guion";
import type { Reloj } from "./useGuion";

// Las piezas de la mesa de blackjack: manos, totales, apuestas y resultados, y la leyenda del tapete.

export type ManoVista = VistaBJ["manos"][number];

/** Las cartas de una ronda. Al cambiar de ronda, las de la anterior se retiran con un fundido. */
function CapaMano({ children }: { children: ReactNode }) {
  const presente = useIsPresent();
  const reducido = useMovimientoReducido();
  return (
    <motion.div
      className="bj-mano__cartas"
      aria-hidden={presente ? undefined : true}
      exit={reducido ? { opacity: 0 } : { opacity: 0, transform: "translateY(-12px) scale(0.94)" }}
      transition={{ duration: 0.32, ease: "easeIn" }}
    >
      {children}
    </motion.div>
  );
}

interface ManoProps {
  cartas: (Carta | null)[];
  de: JugadorId | "banca";
  ronda: number;
  ancho: number;
  reloj: Reloj;
  etiqueta: string;
}

export function Mano({ cartas, de, ronda, ancho, reloj, etiqueta }: ManoProps) {
  const estilo = { "--ancho": `${ancho}px`, "--solape": cartas.length > 5 ? -0.62 : -0.42 } as CSSProperties;
  return (
    <div className="bj-mano" role="group" aria-label={etiqueta} style={estilo}>
      <AnimatePresence initial={false}>
        <CapaMano key={ronda}>
          {cartas.map((carta, i) => {
            const clave = claveCarta(ronda, de, i);
            const salida = reloj.guion.cartas.get(clave);
            // Solo cuenta para las cartas que aparecen ahora (las del último lote): esperan lo que le falta a su salida.
            const retardo = salida === undefined ? undefined : Math.max(0, salida - reloj.desde);
            return <Naipe key={clave} carta={carta} ancho={ancho} retardo={retardo} origen={salida === undefined ? null : reloj.origen} />;
          })}
        </CapaMano>
      </AnimatePresence>
    </div>
  );
}

export type Tono = "normal" | "pasado" | "gana" | "blackjack";

/** El total de una mano, que aparece con un pequeño rebote cada vez que cambia. */
export function Total({ valor, tono = "normal" }: { valor: number | null; tono?: Tono }) {
  const reducido = useMovimientoReducido();
  if (valor === null) return null;
  return (
    <motion.span
      key={valor}
      className={`bj-total bj-total--${tono}`}
      initial={reducido ? { opacity: 0 } : { transform: "scale(0.2)" }}
      animate={reducido ? { opacity: 1 } : { transform: ["scale(0.2)", "scale(1.15)", "scale(1)"] }}
      transition={{ duration: reducido ? 0.2 : 0.38, ease: [0.2, 0.8, 0.2, 1.4], times: reducido ? undefined : [0, 0.6, 1] }}
    >
      <span className="solo-lectores">Total </span>
      {valor}
    </motion.span>
  );
}

/** Las fichas apostadas en una mano: una pila y la cantidad. */
export function Apuesta({ cantidad, refPila }: { cantidad: number; refPila?: Ref<HTMLSpanElement> }) {
  const reducido = useMovimientoReducido();
  return (
    <span className="bj-apuesta" ref={refPila}>
      <span className="bj-apuesta__pila" aria-hidden="true">
        <Ficha tamaño={18} />
        <Ficha tamaño={18} />
        <Ficha tamaño={18} />
      </span>
      <span className="solo-lectores">Apuesta </span>
      <motion.b key={cantidad} initial={reducido ? { opacity: 0 } : { transform: "scale(0.6)" }} animate={reducido ? { opacity: 1 } : { transform: "scale(1)" }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1.4] }}>
        {miles(cantidad)}
      </motion.b>
    </span>
  );
}

export function tonoDe(mano: ManoVista | undefined, total: number | null, neto: number | undefined): Tono {
  if (total !== null && total > 21) return "pasado";
  if (mano?.estado === "blackjack" && total === 21) return "blackjack";
  if (neto !== undefined && neto > 0) return "gana";
  return "normal";
}

/** Texto corto del estado de otra mano para su pastilla. */
export function SimboloMano({ mano, total }: { mano: ManoVista; total: number | null }) {
  if (mano.estado === "plantado" && total !== null) return <span className="bj-pastilla__simbolo">✓<span className="solo-lectores"> se planta</span></span>;
  if (mano.estado === "pasado" && total !== null && total > 21) return <span className="solo-lectores">se pasa</span>;
  return null;
}

/** El arco dorado impreso en el tapete. Decorativo. */
export function Leyenda() {
  const id = useId();
  return (
    <svg className="bj-leyenda" viewBox="0 0 340 74" aria-hidden="true" focusable="false">
      <path id={id} d="M 12 10 Q 170 84 328 10" fill="none" />
      <text className="bj-leyenda__arco">
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          Blackjack paga 3 a 2
        </textPath>
      </text>
      <text className="bj-leyenda__linea" x="170" y="68" textAnchor="middle">
        La banca se planta en 17
      </text>
    </svg>
  );
}
