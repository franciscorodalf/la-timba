import { motion } from "motion/react";
import { type CSSProperties, type Ref, useLayoutEffect, useState } from "react";
import type { Carta } from "../../../shared/cartas";
import type { VistaPoker } from "../../../shared/juegos/poker";
import { Ficha } from "../../componentes/Ficha";
import { Mazo } from "../../componentes/Mazo";
import { Naipe } from "../../componentes/Naipe";
import { useMovimientoReducido } from "../../efectos/movimiento";
import { miles } from "../../formato";
import { ApuestaAsiento, Asiento } from "./Asiento";
import { type AsientoColocado, colocarAsientos, PUNTO_BOTE, type Punto } from "./asientos";
import { VUELO_BOTE_MS, VUELO_FICHAS_MS } from "./guion";
import { cartaDelGuion, type Reloj } from "./useGuion";

/** Las cartas de la mesa: cinco huecos, de los que se llenan los que ya han salido. */
const CARTAS_DE_LA_MESA = 5;
/** Las fichas que salen de un bote hacia quien gana, una detrás de otra. */
const FICHAS_DE_UN_BOTE = 4;
/** Entre una ficha de un bote y la siguiente. */
const ENTRE_FICHAS_DE_BOTE_MS = 45;
const CURVA_VUELO = [0.4, 0, 0.2, 1] as const;

/** Con movimiento reducido la carta se funde en su sitio: `Naipe` lo hace con cualquier origen. */
const SIN_ORIGEN = new DOMRect();

interface VueloFichas {
  clave: string;
  desde: Punto;
  hasta: Punto;
  ms: number;
  copias: number;
}

/** Las fichas que están en el aire a estas alturas del guion, de sitio a sitio del tapete. Las tuyas, al ganar, las lleva `FichasVolando`. */
function vuelosEnElAire(reloj: Reloj, puestos: AsientoColocado[], bote: Punto, yo: VistaPoker["yo"]): VueloFichas[] {
  const { guion, hito } = reloj;
  const enElAire = (en: number, ms: number) => hito >= en && hito < en + ms;
  const puesto = (jugadorId: number) => puestos.find((p) => p.asiento.jugadorId === jugadorId);
  const vuelos: VueloFichas[] = [];
  for (const { jugadorId, en } of guion.fichas) {
    const p = puesto(jugadorId);
    if (p && enElAire(en, VUELO_FICHAS_MS)) vuelos.push({ clave: `apuesta:${en}:${jugadorId}`, desde: p, hasta: p.apuesta, ms: VUELO_FICHAS_MS, copias: 1 });
  }
  for (const en of guion.barridos) {
    if (!enElAire(en, VUELO_FICHAS_MS)) continue;
    for (const p of puestos) if (p.asiento.apostado > 0) vuelos.push({ clave: `barrido:${en}:${p.asiento.jugadorId}`, desde: p.apuesta, hasta: bote, ms: VUELO_FICHAS_MS, copias: 1 });
  }
  for (const { jugadorId, en } of guion.devueltos) {
    const p = puesto(jugadorId);
    if (p && enElAire(en, VUELO_FICHAS_MS)) vuelos.push({ clave: `devuelto:${en}:${jugadorId}`, desde: p.apuesta, hasta: p, ms: VUELO_FICHAS_MS, copias: 1 });
  }
  for (const { jugadorId, en } of guion.premios) {
    const p = puesto(jugadorId);
    if (p && jugadorId !== yo && enElAire(en, VUELO_BOTE_MS)) vuelos.push({ clave: `premio:${en}:${jugadorId}`, desde: bote, hasta: p, ms: VUELO_BOTE_MS, copias: FICHAS_DE_UN_BOTE });
  }
  return vuelos;
}

/** Una capa del tamaño del tapete que va de un sitio a otro: el porcentaje de un `translate` es de la propia capa, y por tanto del tapete. */
function Vuelo({ desde, hasta, ms, copias }: Omit<VueloFichas, "clave">) {
  return Array.from({ length: copias }, (_, i) => {
    const retardo = i * ENTRE_FICHAS_DE_BOTE_MS;
    return (
      <motion.span
        key={i}
        className="pk-vuelo"
        initial={{ transform: `translate(${desde.x}%, ${desde.y}%)` }}
        animate={{ transform: `translate(${hasta.x}%, ${hasta.y}%)` }}
        transition={{ duration: (ms - retardo) / 1000, delay: retardo / 1000, ease: CURVA_VUELO }}
      >
        <Ficha tamaño={16} />
      </motion.span>
    );
  });
}

/** Una carta de la mesa. Si sale en el guion aparece boca abajo y se gira (`Naipe` gira al pasar de boca abajo a boca arriba); con movimiento reducido, se funde. */
function CartaDeLaMesa({ carta, ancho, sale }: { carta: Carta; ancho: number; sale: boolean }) {
  const reducido = useMovimientoReducido();
  const [girada, setGirada] = useState(!sale || reducido);
  useLayoutEffect(() => setGirada(true), []);
  return <Naipe carta={girada ? carta : null} ancho={ancho} origen={sale && reducido ? SIN_ORIGEN : null} />;
}

interface Props {
  /** Lo que se enseña ahora: la vista con lo que el guion aún retiene. */
  vista: VistaPoker;
  ordenador: boolean;
  reloj: Reloj;
  refMazo: Ref<HTMLDivElement>;
  refBote: Ref<HTMLParagraphElement>;
}

/**
 * El tapete ovalado, vertical en el móvil y horizontal en el ordenador: los asientos alrededor con tú abajo, lo apostado en la
 * ronda entre cada uno y el centro, y en el centro las cinco cartas de la mesa con el bote debajo y el mazo al lado.
 */
export function Tapete({ vista, ordenador, reloj, refMazo, refBote }: Props) {
  const reducido = useMovimientoReducido();
  const puestos = colocarAsientos(vista.asientos, vista.yo, ordenador);
  const bote = vista.botes.reduce((suma, b) => suma + b.cantidad, 0);
  const anchoCarta = ordenador ? 56 : 28;
  const anchoMini = ordenador ? 30 : 18;
  const anchoMazo = ordenador ? 30 : 16;
  const turno = vista.turno;
  const vuelos = reducido || reloj.ronda !== vista.ronda ? [] : vuelosEnElAire(reloj, puestos, PUNTO_BOTE[ordenador ? "ordenador" : "movil"], vista.yo);

  return (
    <div className="pk-tapete">
      <ul className="pk-asientos" aria-label="Asientos">
        {puestos.map((p) => (
          <Asiento key={p.asiento.jugadorId} colocado={p} esYo={p.asiento.jugadorId === vista.yo} enTurno={p.asiento.jugadorId === turno} anchoCarta={anchoMini} ronda={vista.ronda} reloj={reloj} />
        ))}
      </ul>
      <ul className="pk-apuestas" aria-label="Apuestas de la ronda">
        {puestos.map((p) => (
          <ApuestaAsiento key={p.asiento.jugadorId} colocado={p} />
        ))}
      </ul>
      <div className="pk-centro" style={{ "--alto-mesa": `${anchoCarta * 1.4}px` } as CSSProperties}>
        <div className="pk-mesa-cartas" role="group" aria-label="Cartas de la mesa" style={{ "--ancho-carta": `${anchoCarta}px` } as CSSProperties}>
          {Array.from({ length: CARTAS_DE_LA_MESA }, (_, i) => {
            const carta = vista.mesa[i];
            if (!carta) return <span key={i} className="pk-hueco" aria-hidden="true" />;
            return <CartaDeLaMesa key={`${vista.ronda}:${i}`} carta={carta} ancho={anchoCarta} sale={cartaDelGuion(reloj, vista.ronda, carta.palo, carta.valor)} />;
          })}
        </div>
        <p ref={refBote} className={`pk-bote${bote <= 0 ? " pk-bote--vacio" : ""}`}>
          Bote <b>{miles(bote)}</b>
        </p>
        <div className="pk-mazo">
          <Mazo ref={refMazo} ancho={anchoMazo} />
        </div>
      </div>
      <div className="pk-vuelos" aria-hidden="true">
        {vuelos.map(({ clave, ...vuelo }) => (
          <Vuelo key={clave} {...vuelo} />
        ))}
      </div>
    </div>
  );
}
