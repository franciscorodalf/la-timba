import type { FilaRanking, OrdenRanking, RespuestaRanking } from "../../../shared/api";
import { retardo } from "../../animacion";
import { Avatar } from "../../componentes/Avatar";
import { Ficha } from "../../componentes/Ficha";
import { useSesion } from "../../red/sesion";
import { PESTANAS, textoSinPuesto, valorRanking } from "./pestanas";

/** Cuántas filas se escalonan al entrar; las siguientes entran con la última (la cascada no pasa de ~300 ms). */
const FILAS_ESCALONADAS = 10;
const PASO_ESCALON_MS = 30;

const MEDALLAS: Record<number, "oro" | "plata" | "bronce"> = { 1: "oro", 2: "plata", 3: "bronce" };

/** El color del valor de las ganancias: verde si ganas, rojo si pierdes. */
function tono(orden: OrdenRanking, valor: number): string {
  if (orden !== "ganancias" || valor === 0) return "";
  return valor > 0 ? " ranking-fila__valor--sube" : " ranking-fila__valor--baja";
}

function Contenido({ orden, fila, propia }: { orden: OrdenRanking; fila: FilaRanking; propia: boolean }) {
  const medalla = MEDALLAS[fila.posicion];
  return (
    <>
      <span className={`ranking-fila__pos${medalla === undefined ? "" : ` ranking-fila__pos--${medalla}`}`}>{fila.posicion}</span>
      <Avatar apodo={fila.apodo} />
      <span className="ranking-fila__quien">
        <span className="ranking-fila__nombre">{fila.apodo}</span>
        {propia && <small className="ranking-fila__tu">tú</small>}
      </span>
      <span className={`ranking-fila__valor${orden === "fichas" ? " ranking-fila__valor--ficha" : ""}${tono(orden, fila.valor)}`}>
        {orden === "fichas" && <Ficha tamaño={18} />}
        {valorRanking(orden, fila.valor)}
      </span>
    </>
  );
}

/** Tu fila, siempre a la vista justo encima de la barra: tu puesto aunque no estés en el top, o por qué aún no tienes. */
function FilaPropia({ orden, yo }: { orden: OrdenRanking; yo: FilaRanking | null }) {
  const { jugador } = useSesion();
  const explicacion = textoSinPuesto(orden);
  return (
    <div className="ranking-fila ranking-fila--yo ranking-fila--fija" role="group" aria-label="Tu posición" aria-current="true" style={retardo(250)}>
      {yo !== null ? (
        <Contenido orden={orden} fila={yo} propia />
      ) : (
        <>
          <Avatar apodo={jugador?.apodo ?? ""} />
          <span className="ranking-fila__explicacion">{explicacion}</span>
        </>
      )}
    </div>
  );
}

/** Los marcadores de lo que aún no ha llegado. */
export function EsqueletoRanking() {
  return (
    <div className="ranking-esqueleto" role="status" aria-label="Cargando el ranking">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="ranking-esqueleto__fila" key={i} />
      ))}
    </div>
  );
}

/**
 * El top (con medallas en los tres primeros) y tu fila: resaltada en la lista si estás en ella; si no, fija sobre la barra.
 * Si no clasificas en este orden, la fila fija lo explica cuando hay una explicación.
 */
export function Filas({ orden, datos }: { orden: OrdenRanking; datos: RespuestaRanking }) {
  const { top, yo } = datos;
  const etiqueta = PESTANAS.find((p) => p.orden === orden)?.etiqueta ?? orden;
  const enLaLista = yo !== null && yo.posicion <= top.length;
  const sinPuesto = yo === null && textoSinPuesto(orden) !== null;

  return (
    <>
      {top.length === 0 ? (
        <p className="ranking-vacio">Todavía no hay nadie en este ranking.</p>
      ) : (
        <ol className="ranking-lista" aria-label={`Ranking: ${etiqueta}`}>
          {top.map((fila, i) => {
            const propia = enLaLista && fila.posicion === yo.posicion;
            const medalla = MEDALLAS[fila.posicion];
            const clases = ["ranking-fila", medalla && `ranking-fila--${medalla}`, propia && "ranking-fila--yo"].filter(Boolean).join(" ");
            return (
              <li key={fila.posicion} className={clases} aria-current={propia ? "true" : undefined} style={retardo(Math.min(i, FILAS_ESCALONADAS) * PASO_ESCALON_MS)}>
                <Contenido orden={orden} fila={fila} propia={propia} />
              </li>
            );
          })}
        </ol>
      )}
      {((yo !== null && !enLaLista) || sinPuesto) && <FilaPropia orden={orden} yo={yo} />}
    </>
  );
}
