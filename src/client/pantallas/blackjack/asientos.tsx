import type { CSSProperties, Ref } from "react";
import type { JugadorId } from "../../../shared/juegos/tipos";
import { Ficha } from "../../componentes/Ficha";
import { Neto } from "../../componentes/Resultado";
import { miles } from "../../formato";
import type { Disposicion, ManoVista, Otro } from "./manos";
import { Apuesta, FilaManos, Rendida, ResumenManos, Total, tonoDe } from "./piezas";
import type { Reloj } from "./useGuion";

// Lo que la mesa de blackjack enseña de cada jugador: tus manos en fila, el asiento de otro en el ordenador y su pastilla en el móvil.

/** El total que se ve de una mano (el de las cartas que ya han llegado). */
type TotalDe = (mano: ManoVista) => number | null;

/** El total de una mano o, si se ha rendido, «Rendida». */
function TotalOEstado({ mano, total, neto }: { mano: ManoVista | undefined; total: number | null; neto?: number }) {
  if (mano?.estado === "rendido") return <Rendida />;
  return <Total valor={total} tono={tonoDe(mano, total, neto)} />;
}

/** Lo que va debajo de una mano cuando hay varias: su total (o «Rendida») y, si se pide, su apuesta. */
function PieMano({ mano, total, conApuesta = false, refApuesta }: { mano: ManoVista; total: number | null; conApuesta?: boolean; refApuesta?: Ref<HTMLSpanElement> }) {
  return (
    <div className="bj-col__pie">
      <TotalOEstado mano={mano} total={total} />
      {conApuesta && <Apuesta cantidad={mano.apuesta} corta refPila={refApuesta} />}
    </div>
  );
}

interface MisManosProps {
  manos: ManoVista[];
  jugadorId: JugadorId;
  ronda: number;
  reloj: Reloj;
  /** El ancho de carta, el solape y lo que ocupa cada columna (`disponerManos`). */
  disposicion: Disposicion;
  /** El lugar de la mano activa en `manos`, o `-1`. */
  activa: number;
  totalDe: TotalDe;
  /** La pila de fichas de la primera mano, de donde salen las fichas que vuelan al cobrar (solo con varias manos). */
  refApuesta: Ref<HTMLSpanElement>;
}

/** Tus manos en fila. Con una sola, el total y la apuesta van en la línea de tu nombre; con varias, debajo de cada mano. */
export function MisManos({ manos, jugadorId, ronda, reloj, disposicion, activa, totalDe, refApuesta }: MisManosProps) {
  const varias = manos.length > 1;
  return (
    <FilaManos
      manos={manos}
      de={jugadorId}
      ronda={ronda}
      ancho={disposicion.ancho}
      solape={disposicion.solape}
      columnas={disposicion.columnas}
      reloj={reloj}
      etiqueta={(lugar) => (varias ? `Tu mano ${lugar + 1}` : "Tu mano")}
      activa={activa}
      pie={varias ? (mano, lugar) => <PieMano mano={mano} total={totalDe(mano)} conApuesta refApuesta={lugar === 0 ? refApuesta : undefined} /> : undefined}
      className="bj-manos--mias"
    />
  );
}

interface AsientoOtroProps {
  otro: Otro;
  /** Dónde está su asiento en el arco. */
  estilo: CSSProperties;
  ronda: number;
  reloj: Reloj;
  /** El ancho de carta de una sola mano; con varias, algo menos. */
  ancho: number;
  totalDe: TotalDe;
  /** Lo que se ha llevado cada jugador en la ronda que acaba de terminar, o `null` mientras no se ha pagado. */
  netos: Map<JugadorId, number> | null;
}

/** El asiento de otro jugador en el ordenador: hasta dos manos con cartas pequeñas y, debajo, su nombre, su total y su apuesta. */
export function AsientoOtro({ otro, estilo, ronda, reloj, ancho, totalDe, netos }: AsientoOtroProps) {
  const varias = otro.manos.length > 1;
  const dueño = otro.manos[0]?.jugadorId;
  const neto = dueño !== undefined && netos !== null ? netos.get(dueño) : undefined;
  const apostado = otro.manos.reduce((suma, m) => suma + m.apuesta, 0);
  // Hasta dos manos con sus cartas; las demás, solo su total.
  const sinCartas = otro.manos.slice(2);
  return (
    <li className={`bj-asiento${varias ? " bj-asiento--varias" : ""}${otro.manos.length > 0 ? "" : " bj-asiento--mira"}`} style={estilo}>
      <FilaManos
        manos={otro.manos.slice(0, 2)}
        de={dueño ?? -1}
        ronda={ronda}
        ancho={varias ? Math.round(ancho * 0.8) : ancho}
        reloj={reloj}
        etiqueta={(lugar) => (varias ? `Mano ${lugar + 1} de ${otro.apodo}` : `Mano de ${otro.apodo}`)}
        pie={varias ? (mano) => <PieMano mano={mano} total={totalDe(mano)} /> : undefined}
      />
      <div className="bj-etiqueta">
        <span className="bj-asiento__apodo">{otro.apodo}</span>
        {!varias && <TotalOEstado mano={otro.manos[0]} total={otro.manos[0] ? totalDe(otro.manos[0]) : null} neto={neto} />}
        {sinCartas.length > 0 && (
          <span className="bj-asiento__mas">{`+ ${sinCartas.map((m) => (m.estado === "rendido" ? "rendida" : (totalDe(m) ?? "–"))).join(" / ")}`}</span>
        )}
        {neto !== undefined && <Neto neto={neto} />}
        {otro.manos.length > 0 && <Apuesta cantidad={apostado} />}
      </div>
    </li>
  );
}

/** La pastilla de otro jugador en el móvil: su nombre, la apuesta mientras no hay cartas, el total de cada mano y lo que se lleva. */
export function PastillaOtro({ otro, totalDe, netos }: { otro: Otro; totalDe: TotalDe; netos: Map<JugadorId, number> | null }) {
  const { apodo, manos } = otro;
  const neto = manos[0] && netos !== null ? netos.get(manos[0].jugadorId) : undefined;
  return (
    <li className={`bj-pastilla${manos.length > 0 ? "" : " bj-pastilla--mira"}`}>
      <span className="bj-pastilla__apodo">{apodo}</span>
      {manos.length > 0 && manos.every((m) => m.cartas.length === 0) && (
        <span className="bj-pastilla__apuesta">
          <Ficha tamaño={12} />
          <span className="solo-lectores">apuesta </span>
          {miles(manos.reduce((suma, m) => suma + m.apuesta, 0))}
        </span>
      )}
      <ResumenManos manos={manos} total={totalDe} />
      {neto !== undefined && <Neto neto={neto} />}
    </li>
  );
}
