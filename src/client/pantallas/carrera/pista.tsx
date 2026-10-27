import { AnimatePresence, motion, useAnimate } from "motion/react";
import { type CSSProperties, forwardRef, memo, type Ref, type RefObject, useLayoutEffect, useRef } from "react";
import type { Carta, Palo } from "../../../shared/cartas";
import { CARRERA } from "../../../shared/juegos/carrera";
import { CasillaApuesta } from "../../componentes/CasillaApuesta";
import { Destellos } from "../../componentes/Destellos";
import { Ficha } from "../../componentes/Ficha";
import { Mazo } from "../../componentes/Mazo";
import { Naipe } from "../../componentes/Naipe";
import { useMovimientoReducido } from "../../efectos/movimiento";
import { miles } from "../../formato";
import { CABALLOS, type Escena } from "./escena";
import { AS_DE, esRojo, NOMBRE_PALO, SIMBOLO_PALO } from "./palos";

// Las piezas de la pista: los cuatro carriles con sus caballos, la franja de los tramos, las cabeceras (donde se apuesta) y
// el mazo con la última carta. Los caballos se mueven con una transición CSS de `transform` hacia la casilla que se les da:
// si llega otra casilla mientras se mueven, siguen desde donde van (el navegador reencamina la transición).

const nombreCaballo = (palo: Palo): string => `Caballo de ${NOMBRE_PALO[palo]}`;
const variable = (nombre: string, valor: string | number): CSSProperties => ({ [nombre]: valor }) as CSSProperties;

const detener = (animacion: { stop(): void }) => () => animacion.stop();

// ---------------------------------------------------------------------------------------------------------------------
// Caballo
// ---------------------------------------------------------------------------------------------------------------------

interface CaballoProps {
  palo: Palo;
  casilla: number;
  ganador: Palo | null;
  ancho: number;
}

/** El as de un palo, que corre por su carril. Salta un poco al avanzar y se tiñe de rojo un instante al retroceder. */
const Caballo = memo(function Caballo({ palo, casilla, ganador, ancho }: CaballoProps) {
  const reducido = useMovimientoReducido();
  const [salto, animarSalto] = useAnimate<HTMLDivElement>();
  const [aura, animarAura] = useAnimate<HTMLSpanElement>();
  const [estela, animarEstela] = useAnimate<HTMLSpanElement>();
  const previa = useRef(casilla);
  // Se lee antes de repintar: la clase de «va hacia atrás» cambia en el mismo pintado que la casilla. Volver más de una
  // casilla (una pista nueva) es un regreso largo, más pausado que el retroceso de una.
  const vuelta = previa.current - casilla;

  useLayoutEffect(() => {
    const antes = previa.current;
    previa.current = casilla;
    if (casilla === antes || reducido) return;
    if (casilla > antes && salto.current) {
      const inclinacion = casilla % 2 === 0 ? -3 : 3;
      const reposo = "translate(0px, 0px) scale(1) rotate(0deg)";
      const saltar = animarSalto(salto.current, { transform: [reposo, `translate(0px, -4px) scale(1.1) rotate(${inclinacion}deg)`, reposo] }, { duration: 0.42, ease: "easeOut" });
      // Y deja una estela dorada detrás, que se estira y se apaga.
      const rastro = estela.current ? animarEstela(estela.current, { opacity: [0, 0.85, 0], transform: ["scale(0.25)", "scale(1)", "scale(1)"] }, { duration: 0.55, ease: "easeOut", times: [0, 0.35, 1] }) : null;
      return () => {
        saltar.stop();
        rastro?.stop();
      };
    }
    if (casilla < antes && aura.current) return detener(animarAura(aura.current, { opacity: [0, 1, 0] }, { duration: 0.95, ease: "easeInOut" }));
  }, [casilla, reducido, salto, aura, estela, animarSalto, animarAura, animarEstela]);

  const clase = ["carrera-caballo", vuelta === 1 && "carrera-caballo--atras", vuelta > 1 && "carrera-caballo--regreso", ganador === palo && "carrera-caballo--ganador", ganador !== null && ganador !== palo && "carrera-caballo--atenuado"].filter(Boolean).join(" ");
  return (
    <div className={clase} data-caballo={palo} data-casilla={casilla} style={variable("--casilla", casilla)} role="group" aria-label={nombreCaballo(palo)}>
      <div ref={salto} className="carrera-caballo__salto">
        <span ref={estela} className="carrera-caballo__estela" aria-hidden="true" />
        <span ref={aura} className="carrera-caballo__aura" aria-hidden="true" />
        <span className="carrera-caballo__brillo" aria-hidden="true" />
        <Naipe carta={AS_DE[palo]} ancho={ancho} />
        <span className="carrera-caballo__sombra" aria-hidden="true" />
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Pista
// ---------------------------------------------------------------------------------------------------------------------

interface PistaProps {
  escena: Escena;
  /** El caballo elegido para apostar, o `null`. */
  elegido: Palo | null;
  /** Se puede elegir caballo (las apuestas están abiertas). */
  eligible: boolean;
  onElegir(palo: Palo): void;
  /** El ancho de los caballos, o `null` mientras no se ha medido la pista: sin medidas no se pintan (no deben deslizarse hasta su casilla). */
  caballoAncho: number | null;
  /**
   * Tus casillas de apuesta, mientras se apuesta (si no, `null`): una en cada carril donde has apostado y otra en el elegido,
   * con lo que llevas preparado. `ref` es la del elegido, adonde vuelan las fichas.
   */
  casillas: { mias: Record<Palo, number>; preparada: number; todo: boolean; ref: RefObject<HTMLDivElement> } | null;
}

/** Los cuatro carriles con sus caballos, las líneas de cada casilla (se iluminan al girarse su tramo) y la meta a cuadros. */
export const Pista = forwardRef<HTMLDivElement, PistaProps>(function Pista({ escena, elegido, eligible, onElegir, caballoAncho, casillas }, ref) {
  const reducido = useMovimientoReducido();
  return (
    <div ref={ref} className="carrera-pista">
      <div className="carrera-pista__marco">
        <div className="carrera-carriles">
          {CABALLOS.map((palo) => (
            // El carril entero es un blanco cómodo para elegir; el control accesible es la cabecera.
            <div
              key={`${escena.epoca}:${palo}`}
              className={`carrera-carril carrera-carril--${palo}${eligible && elegido === palo ? " carrera-carril--elegido" : ""}${eligible ? " carrera-carril--eligible" : ""}`}
              onClick={eligible ? () => onElegir(palo) : undefined}
            >
              {caballoAncho !== null && <Caballo palo={palo} casilla={escena.posiciones[palo]} ganador={escena.ganador} ancho={caballoAncho} />}
              <AnimatePresence>
                {casillas !== null && (casillas.mias[palo] > 0 || elegido === palo) && (
                  <motion.div key="casilla" className="carrera-casilla" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={reducido ? { opacity: 0 } : { opacity: 0, transform: "scale(0.85)" }} transition={{ duration: 0.2 }}>
                    <CasillaApuesta
                      compacta
                      ref={elegido === palo ? casillas.ref : undefined}
                      apostado={casillas.mias[palo]}
                      preparado={elegido === palo ? casillas.preparada : 0}
                      todo={elegido === palo && casillas.todo}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
        <div key={escena.epoca} className="carrera-lineas" aria-hidden="true">
          <span className="carrera-linea carrera-linea--salida" style={variable("--k", 0)} />
          {Array.from({ length: CARRERA.TRAMOS }, (_, i) => (
            <span key={i} className={`carrera-linea${i < escena.girados ? " carrera-linea--encendida" : ""}`} style={variable("--k", i + 1)} />
          ))}
          <span className="carrera-meta" />
        </div>
      </div>
      {/* Los destellos del ganador salen de la meta por encima del marco de la pista, que recorta lo suyo. */}
      <div className="carrera-festejos" aria-hidden="true">
        {CABALLOS.map((palo) => (
          <div key={palo} className="carrera-festejo">
            <Destellos disparo={escena.festejoDe === palo ? escena.festejo : 0} />
          </div>
        ))}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// Tramos
// ---------------------------------------------------------------------------------------------------------------------

interface TramoProps {
  indice: number;
  carta: Carta | null;
  revelado: boolean;
  ancho: number;
}

/** Un tramo: boca abajo hasta que lo gira el caballo más rezagado; al girarse destella en dorado. */
const Tramo = memo(function Tramo({ indice, carta, revelado, ancho }: TramoProps) {
  const reducido = useMovimientoReducido();
  const [brillo, animar] = useAnimate<HTMLSpanElement>();
  const antes = useRef(revelado);
  useLayoutEffect(() => {
    const estaba = antes.current;
    antes.current = revelado;
    if (!revelado || estaba || reducido || !brillo.current) return;
    return detener(animar(brillo.current, { opacity: [0, 1, 0] }, { duration: 1.1, ease: "easeOut" }));
  }, [revelado, reducido, brillo, animar]);
  return (
    <div className="carrera-tramo" style={{ ...variable("--k", indice + 1), ...variable("--i", indice), zIndex: CARRERA.TRAMOS - indice }}>
      <span ref={brillo} className="carrera-tramo__brillo" aria-hidden="true" />
      <Naipe carta={revelado ? carta : null} ancho={ancho} />
    </div>
  );
});

interface FranjaProps {
  escena: Escena;
  tramos: (Carta | null)[];
  ancho: number;
}

/** Los siete tramos, uno por casilla intermedia, alineados con su línea de la pista. Una pista nueva los coloca de uno en uno. */
export function Franja({ escena, tramos, ancho }: FranjaProps) {
  return (
    <div className="carrera-franja" role="group" aria-label="Tramos de la pista">
      <div key={`${escena.epoca}:${escena.ronda}`} className={`carrera-franja__tramos${escena.reparto ? " carrera-franja__tramos--reparto" : ""}`}>
        {tramos.map((carta, i) => (
          <Tramo key={i} indice={i} carta={carta} revelado={i < escena.girados} ancho={ancho} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Cabeceras
// ---------------------------------------------------------------------------------------------------------------------

interface CabecerasProps {
  elegido: Palo | null;
  /** Se puede elegir (las apuestas están abiertas y hay conexión). */
  activo: boolean;
  ganador: Palo | null;
  /** Lo tuyo y lo de toda la mesa en cada caballo. */
  mias: Record<Palo, number>;
  mesa: Record<Palo, number>;
  onElegir(palo: Palo): void;
  /** Para saber desde dónde vuelan las fichas del premio. */
  refs: { current: Partial<Record<Palo, HTMLButtonElement | null>> };
}

/** Debajo de cada carril, su caballo: elígelo para apostar y mira lo tuyo y lo que lleva la mesa. */
export function Cabeceras({ elegido, activo, ganador, mias, mesa, onElegir, refs }: CabecerasProps) {
  return (
    <div className="carrera-cabeceras" role="group" aria-label="Caballos">
      {CABALLOS.map((palo) => {
        const mia = mias[palo];
        const etiqueta = `${nombreCaballo(palo)}. ${mia > 0 ? `Tu apuesta ${mia}. ` : ""}En la mesa ${mesa[palo]}`;
        const clase = ["carrera-cabecera", `carrera-cabecera--${palo}`, activo && elegido === palo && "carrera-cabecera--elegida", ganador === palo && "carrera-cabecera--ganadora", ganador !== null && ganador !== palo && "carrera-cabecera--atenuada"]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={palo}
            ref={(el) => {
              refs.current[palo] = el;
            }}
            type="button"
            className={clase}
            aria-label={etiqueta}
            aria-pressed={activo ? elegido === palo : undefined}
            disabled={!activo}
            onClick={() => onElegir(palo)}
          >
            <span className={`carrera-cabecera__palo${esRojo(palo) ? " carrera-cabecera__palo--rojo" : ""}`} aria-hidden="true">
              {SIMBOLO_PALO[palo]}
            </span>
            <span className="carrera-cabecera__nombre" aria-hidden="true">
              {NOMBRE_PALO[palo]}
            </span>
            <span className="carrera-cabecera__datos" aria-hidden="true">
              <span className={`carrera-cabecera__mia${mia > 0 ? " carrera-cabecera__mia--hay" : ""}`}>
                {mia > 0 && <Ficha tamaño={12} />}
                {mia > 0 && `Tú ${miles(mia)}`}
              </span>
              <span className="carrera-cabecera__mesa">Mesa {miles(mesa[palo])}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Mazo y última carta
// ---------------------------------------------------------------------------------------------------------------------

interface EsquinaProps {
  escena: Escena;
  mazoAncho: number;
  mazo: Ref<HTMLDivElement>;
  barajando: boolean;
}

/** El mazo y, a su lado, la carta que acaba de salir (con la anterior debajo, un poco torcida). */
export function Esquina({ escena, mazoAncho, mazo, barajando }: EsquinaProps) {
  const reducido = useMovimientoReducido();
  return (
    <div className="carrera-esquina">
      <div className="carrera-esquina__mazo">
        <Mazo ref={mazo} ancho={mazoAncho} barajando={barajando && !reducido} />
        {barajando && <span className="carrera-esquina__barajando">Barajando</span>}
      </div>
      <div className="carrera-ultima" role="group" aria-label="Última carta" style={variable("--ancho", `${mazoAncho}px`)}>
        {escena.cartas.map((c, i) => (
          <div key={`${escena.epoca}:${c.id}`} className={`carrera-ultima__carta${i === escena.cartas.length - 1 ? "" : " carrera-ultima__carta--vieja"}`}>
            <Naipe carta={c.carta} ancho={mazoAncho} origen={c.id === escena.n ? escena.origen : null} />
          </div>
        ))}
      </div>
    </div>
  );
}
