import { useAnimate } from "motion/react";
import { type ComponentType, type CSSProperties, type SVGProps, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type Carta, codigoCarta, type Palo, type Valor } from "../../shared/cartas";
import { useMovimientoReducido } from "../efectos/movimiento";

// Las caras son de `@letele/playing-cards` (diseño de Adrian Kennard, CC0). El paquete pesa ~550 KB: se descarga en
// diferido la primera vez que hace falta y queda en memoria para el resto de cartas y mesas.

type Baraja = Record<string, ComponentType<SVGProps<SVGSVGElement>>>;

let baraja: Baraja | null = null;
let cargando: Promise<Baraja> | null = null;

/** Descarga las caras de las cartas (una sola vez). Si falla, el siguiente intento vuelve a probar. */
export function cargarBaraja(): Promise<Baraja> {
  cargando ??= import("@letele/playing-cards").then(
    (modulo) => (baraja = modulo as unknown as Baraja),
    (e: unknown) => {
      cargando = null;
      throw e;
    },
  );
  return cargando;
}

/** Las caras ya descargadas, o `null` mientras llegan. */
function useBaraja(): Baraja | null {
  const [cargada, setCargada] = useState(baraja);
  useEffect(() => {
    if (cargada !== null) return;
    let vigente = true;
    cargarBaraja().then(
      (b) => vigente && setCargada(b),
      () => {},
    );
    return () => {
      vigente = false;
    };
  }, [cargada]);
  return cargada;
}

/** Pide las caras de las cartas al entrar en una mesa, para tenerlas antes de la primera carta. */
export function usePrecargarBaraja(): void {
  useEffect(() => {
    cargarBaraja().catch(() => {});
  }, []);
}

const PALOS: Record<Palo, { nombre: string; simbolo: string; rojo: boolean }> = {
  H: { nombre: "corazones", simbolo: "♥︎", rojo: true },
  D: { nombre: "diamantes", simbolo: "♦︎", rojo: true },
  C: { nombre: "tréboles", simbolo: "♣︎", rojo: false },
  S: { nombre: "picas", simbolo: "♠︎", rojo: false },
};
const FIGURAS: Partial<Record<Valor, string>> = { A: "As", J: "Jota", Q: "Reina", K: "Rey" };

/** «As de picas», «10 de corazones», «Reina de tréboles». */
export const nombreCarta = (carta: Carta): string => `${FIGURAS[carta.valor] ?? carta.valor} de ${PALOS[carta.palo].nombre}`;

/** Mientras llegan las caras (o si no llegan): el valor y el palo sobre blanco, para que la mano se pueda leer igual. */
function CaraProvisional({ carta }: { carta: Carta }) {
  const palo = PALOS[carta.palo];
  return (
    <span className={`naipe__provisional${palo.rojo ? " naipe__provisional--rojo" : ""}`}>
      <b>{carta.valor}</b>
      <span>{palo.simbolo}</span>
    </span>
  );
}

/** El reverso propio: granate, celosía dorada, filete y una pica en el centro. Decorativo. */
export function Reverso() {
  return (
    <div className="naipe__reverso" aria-hidden="true">
      <svg className="naipe__pica" viewBox="0 0 24 24" focusable="false">
        <path d="M12 2.5C12 2.5 4 8.6 4 13.6a4.2 4.2 0 0 0 7.2 2.9c-.1 1.7-.7 3.2-2.2 5h6c-1.5-1.8-2.1-3.3-2.2-5A4.2 4.2 0 0 0 20 13.6C20 8.6 12 2.5 12 2.5Z" />
      </svg>
    </div>
  );
}

const VUELO_S = 0.48;
const CURVA_VUELO = [0.2, 0.8, 0.2, 1] as const;
const GIRO_S = 0.55;
const CURVA_GIRO = [0.3, 0.7, 0.2, 1.1] as const;
const FUNDIDO_S = 0.3;
/** La cara (un SVG pesado) de una carta que espera su turno se pinta este rato antes de salir del mazo, no al aparecer. */
const ANTELACION_CARA_MS = 80;

/** Para devolverla desde un efecto: al desmontar (o repetir el efecto) la animación se para donde iba. */
const detener = (animacion: { stop(): void }) => () => animacion.stop();

interface Props {
  /** La carta boca arriba, o `null` boca abajo. Al pasar de `null` a una carta, se gira. */
  carta: Carta | null;
  /** Ancho en píxeles; el alto sale de la proporción 5:7. */
  ancho: number;
  /** Milisegundos que espera antes de salir del mazo. Solo cuenta al aparecer. */
  retardo?: number;
  /** Dónde está el mazo: si viene, la carta aparece volando desde ahí. Sin él, aparece ya en su sitio. Solo cuenta al aparecer. */
  origen?: DOMRect | null;
  /** Cómo la llama la mesa (`data-clave`): así se la encuentra en el DOM, por ejemplo para deslizarla de una mano a otra. */
  clave?: string;
}

/**
 * Una carta de la mesa. Al aparecer con `origen`, sale del mazo girada y pequeña y llega a su sitio en 480 ms; al pasar de
 * boca abajo a boca arriba, da la vuelta en 3D (550 ms). Con movimiento reducido, en ambos casos solo se funde.
 */
export function Naipe({ carta, ancho, retardo = 0, origen = null, clave }: Props) {
  const reducido = useMovimientoReducido();
  const caras = useBaraja();
  const [caja, animar] = useAnimate<HTMLDivElement>();
  const giro = useRef<HTMLDivElement>(null);
  const cara = useRef<HTMLDivElement>(null);
  // La entrada se decide con los valores con los que aparece la carta; después ya está en su sitio.
  const [entrada] = useState(() => ({ origen, retardo }));
  const tapada = carta === null;
  const estabaTapada = useRef(tapada);
  // En un reparto aparecen todas las cartas a la vez, cada una con su espera: montar todas las caras de golpe sería una
  // tarea larga. Cada una pinta su cara poco antes de salir, mientras las anteriores vuelan.
  const [caraLista, setCaraLista] = useState(() => entrada.origen === null || entrada.retardo <= ANTELACION_CARA_MS);
  useEffect(() => {
    if (caraLista) return;
    const espera = setTimeout(() => setCaraLista(true), entrada.retardo - ANTELACION_CARA_MS);
    return () => clearTimeout(espera);
  }, [caraLista, entrada]);

  useLayoutEffect(() => {
    const el = caja.current;
    if (entrada.origen === null || el === null) return;
    const delay = entrada.retardo / 1000;
    // Oculta desde ya (antes de pintar): la animación empieza en el siguiente fotograma y no debe verse un destello en su sitio.
    el.style.opacity = "0";
    if (reducido) return detener(animar(el, { opacity: [0, 1] }, { duration: FUNDIDO_S, delay, ease: "easeOut" }));

    // Se mide sin ningún desplazamiento: si el efecto se repite (el modo estricto de React en desarrollo lo monta dos veces), la
    // animación anterior, al pararse, deja puesto su primer fotograma y la carta se mediría ya junto al mazo.
    el.style.transform = "";
    const r = el.getBoundingClientRect();
    const dx = entrada.origen.left + entrada.origen.width / 2 - (r.left + r.width / 2);
    const dy = entrada.origen.top + entrada.origen.height / 2 - (r.top + r.height / 2);
    const enElMazo = `translate(${dx}px, ${dy}px) rotate(-25deg) scale(0.6)`;
    // La misma forma en los dos extremos: con `none` al final, Motion interpolaría hacia `scale(0)`.
    const enSuSitio = "translate(0px, 0px) rotate(0deg) scale(1)";
    // El primer fotograma clave rellena la espera (oculta); al salir aparece en el mazo a 0,6 de opacidad.
    return detener(
      animar(el, { transform: [enElMazo, enElMazo, enSuSitio], opacity: [0, 0.6, 1] }, { duration: VUELO_S, delay, ease: CURVA_VUELO, times: [0, 0.001, 1] }),
    );
    // Solo al aparecer: `entrada` no cambia y `reducido` cuenta como estaba en ese momento.
  }, []);

  useLayoutEffect(() => {
    const antes = estabaTapada.current;
    estabaTapada.current = tapada;
    if (!antes || tapada) return;
    if (reducido) {
      if (cara.current) return detener(animar(cara.current, { opacity: [0, 1] }, { duration: FUNDIDO_S, ease: "easeOut" }));
    } else if (giro.current) {
      return detener(animar(giro.current, { transform: ["rotateY(180deg)", "rotateY(0deg)"] }, { duration: GIRO_S, ease: CURVA_GIRO }));
    }
  }, [tapada, reducido, animar]);

  const Cara = carta !== null && caras !== null ? caras[codigoCarta(carta)] : undefined;
  return (
    <div
      ref={caja}
      className={`naipe${tapada ? " naipe--tapada" : ""}`}
      style={{ "--ancho": `${ancho}px` } as CSSProperties}
      data-clave={clave}
      role="img"
      aria-label={carta === null ? "Carta boca abajo" : nombreCarta(carta)}
    >
      <div ref={giro} className="naipe__giro">
        <div ref={cara} className="naipe__cara">
          {carta !== null && caraLista && (Cara ? <Cara aria-hidden="true" focusable="false" /> : <CaraProvisional carta={carta} />)}
        </div>
        <Reverso />
      </div>
    </div>
  );
}
