import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { type CSSProperties, Fragment, type ReactNode, type Ref, useId } from "react";
import type { Carta } from "../../../shared/cartas";
import type { JugadorId } from "../../../shared/juegos/tipos";
import { Ficha } from "../../componentes/Ficha";
import { Naipe } from "../../componentes/Naipe";
import { useMovimientoReducido } from "../../efectos/movimiento";
import { miles } from "../../formato";
import { claveCarta } from "./guion";
import type { ManoVista } from "./manos";
import { claveNaipe, type Reloj } from "./useGuion";

// Las piezas de la mesa de blackjack: manos, totales, apuestas y resultados, y la leyenda del tapete.

/** Lo de una ronda (las cartas de una mano o la fila de manos entera). Al cambiar de ronda, lo de la anterior se retira con un fundido. */
function CapaMano({ children, className = "bj-mano__cartas" }: { children: ReactNode; className?: string }) {
  const presente = useIsPresent();
  const reducido = useMovimientoReducido();
  return (
    <motion.div
      className={className}
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
  /** A cuál de las manos de ese jugador pertenece (su `indice`). La banca solo tiene la 0. */
  mano?: number;
  /** El margen entre cartas, en anchos de carta (negativo: se tapan). Por defecto, el de una mano sola. */
  solape?: number;
  /** La banca está mirando su carta tapada: la segunda carta, si sigue tapada, se levanta un poco. */
  espiando?: boolean;
}

export function Mano({ cartas, de, ronda, ancho, reloj, etiqueta, mano = 0, solape, espiando = false }: ManoProps) {
  const estilo = { "--ancho": `${ancho}px`, "--solape": solape ?? (cartas.length > 5 ? -0.62 : -0.42) } as CSSProperties;
  return (
    <div className="bj-mano" role="group" aria-label={etiqueta} style={estilo}>
      <AnimatePresence initial={false}>
        <CapaMano key={ronda}>
          {cartas.map((carta, i) => {
            const clave = claveCarta(ronda, de, mano, i);
            const salida = reloj.guion.cartas.get(clave);
            // Solo cuenta para las cartas que aparecen ahora (las del último lote): esperan lo que le falta a su salida.
            const retardo = salida === undefined ? undefined : Math.max(0, salida - reloj.desde);
            return <Naipe key={claveNaipe(reloj, clave)} clave={clave} carta={carta} ancho={ancho} retardo={retardo} origen={salida === undefined ? null : reloj.origen} espiando={espiando && i === 1 && carta === null} />;
          })}
        </CapaMano>
      </AnimatePresence>
    </div>
  );
}

interface FilaManosProps {
  /** Las manos de un jugador, en orden; ninguna si aún no ha apostado (se dibuja el hueco de una). */
  manos: ManoVista[];
  de: JugadorId;
  ronda: number;
  ancho: number;
  solape?: number;
  /** Lo que mide cada columna (con varias manos): lo que sus cartas o lo que pide lo de debajo. Sin él, se ajusta al contenido. */
  columnas?: number[];
  reloj: Reloj;
  /** El nombre de cada mano para quien no la ve (`lugar`: su posición en `manos`). */
  etiqueta(lugar: number): string;
  /** El lugar de la mano activa en `manos`; con una activa, las demás se atenúan y ella lleva el subrayado dorado. */
  activa?: number;
  /** Lo que va debajo de cada mano (su total y su apuesta). */
  pie?(mano: ManoVista, lugar: number): ReactNode;
  className?: string;
}

/**
 * Las manos de un jugador en fila, cada una con lo suyo debajo. Con varias, la activa lleva un subrayado dorado y las demás se
 * atenúan. Al cambiar de ronda la fila entera se retira con un fundido, también si tenía varias manos.
 */
export function FilaManos({ manos, de, ronda, ancho, solape, columnas, reloj, etiqueta, activa = -1, pie, className }: FilaManosProps) {
  const varias = manos.length > 1;
  return (
    <div className={`bj-manos${className ? ` ${className}` : ""}`}>
      <AnimatePresence initial={false}>
        <CapaMano key={ronda} className={`bj-fila${varias ? ` bj-fila--varias bj-fila--manos-${manos.length}` : ""}`}>
          {(manos.length === 0 ? [undefined] : manos).map((m, lugar) => (
            <div
              key={m?.indice ?? 0}
              className={`bj-col${varias && activa === lugar ? " bj-col--activa" : ""}${varias && activa >= 0 && activa !== lugar ? " bj-col--atenuada" : ""}`}
              aria-current={varias && activa === lugar ? "true" : undefined}
              style={varias && columnas?.[lugar] !== undefined ? { width: columnas[lugar] } : undefined}
            >
              <Mano cartas={m?.cartas ?? []} de={de} mano={m?.indice ?? 0} ronda={ronda} ancho={ancho} solape={solape} reloj={reloj} etiqueta={etiqueta(lugar)} />
              {varias && <span className="bj-col__subrayado" aria-hidden="true" />}
              {m && pie?.(m, lugar)}
            </div>
          ))}
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

/** Las fichas apostadas en una mano: una pila y la cantidad. `corta`: la de debajo de cada mano cuando hay varias, sin pila. */
export function Apuesta({ cantidad, refPila, corta = false }: { cantidad: number; refPila?: Ref<HTMLSpanElement>; corta?: boolean }) {
  const reducido = useMovimientoReducido();
  return (
    <span className={`bj-apuesta${corta ? " bj-apuesta--corta" : ""}`} ref={refPila}>
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

/** La mano que se ha rendido: se recupera la mitad de la apuesta. */
export function Rendida() {
  return <span className="bj-rendida">Rendida</span>;
}

/**
 * Lo que dice la pastilla de otro jugador (móvil) de sus manos: el total de cada una separado por « / » y, cuando ya no juega
 * ninguna y se han visto todas, un ✓. Una mano rendida dice «rendida» en vez de su total. `total` es el total que ya se ve.
 */
export function ResumenManos({ manos, total }: { manos: ManoVista[]; total: (mano: ManoVista) => number | null }) {
  const totales = manos.map(total);
  if (totales.every((t) => t === null)) return null;
  const plantado = manos.every((m) => m.estado !== "jugando") && totales.every((t) => t !== null) && manos.some((m) => m.estado === "plantado");
  return (
    <>
      <b className="bj-pastilla__total">
        {manos.map((m, i) => (
          <Fragment key={m.indice}>
            {i > 0 && <span aria-hidden="true"> / </span>}
            {m.estado === "rendido" ? (
              <span className="bj-pastilla__rendida">rendida</span>
            ) : (
              <span className={totales[i] !== null && totales[i]! > 21 ? "bj-pastilla__pasado" : undefined}>
                {totales[i] ?? "–"}
                {totales[i] !== null && totales[i]! > 21 && <span className="solo-lectores"> se pasa</span>}
              </span>
            )}
          </Fragment>
        ))}
      </b>
      {plantado && (
        <span className="bj-pastilla__simbolo">
          ✓<span className="solo-lectores"> se planta</span>
        </span>
      )}
    </>
  );
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
