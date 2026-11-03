import { type RefObject, useEffect, useRef, useState } from "react";
import { BJ } from "../../../shared/juegos/blackjack";
import type { VistaPoker } from "../../../shared/juegos/poker";
import type { Evento, JugadorId } from "../../../shared/juegos/tipos";
import { sonidos } from "../../efectos/sonidos";
import { encolarGuion, type Foto, fotoAntesDeLaMano, fotoDeLaVista, GUION_VACIO, type GuionPoker, guionDelLote, guionSinNada, hitosDelGuion, salidasDeLaCalle, vistaEn } from "./guion";

export interface Reloj {
  lote: Evento[];
  /** La vista del último mensaje: de ahí arranca el guion del siguiente. */
  previa: VistaPoker | null;
  /** La ronda a la que pertenece el guion en curso: pasada esa ronda, lo que le queda ya no se enseña ni suena. */
  ronda: number;
  /** Los tiempos van en milisegundos desde `inicio`. */
  guion: GuionPoker;
  /** Lo que enseñaba la mesa al empezar el guion. */
  base: Foto | null;
  /** `performance.now()` cuando empezó el guion en curso. */
  inicio: number;
  /** Lo que llevaba el guion cuando llegó el último lote: lo que aparece ahora espera `salida − desde`. */
  desde: number;
  /** Milisegundos del guion que ya han pasado (a saltos: cada momento en que cambia lo que se ve). */
  hito: number;
  /** Dónde estaba el mazo cuando llegó el último lote: de ahí salen las cartas. */
  origen: DOMRect | null;
}

const SIN_GUION = { guion: GUION_VACIO, base: null, inicio: 0, desde: 0, hito: Infinity } as const;

/**
 * El guion de los lotes y su avance. Un lote de la misma mano que llega con un guion en marcha se pone detrás (`encolarGuion`) y
 * una mano nueva lo sustituye. Un lote sin nada que animar no toca el guion. Sin conexión lo que quedaba se abandona: lo que llegue
 * al reconectar no trae eventos y se salta a esa vista, sin animar ni sonar. Cada carta suena al salir y las fichas al apostar.
 * `alCobrar` recibe lo que has ganado en cuanto sale de los botes, una vez por mano.
 */
export function useGuion(lote: Evento[], vista: VistaPoker | null, mazo: RefObject<HTMLElement | null>, conectado: boolean, alCobrar: (cantidad: number) => void): Reloj {
  const [reloj, setReloj] = useState<Reloj>({ lote, previa: vista, ronda: vista?.ronda ?? 0, origen: null, ...SIN_GUION });
  let actual = reloj;
  if (lote !== reloj.lote) {
    const nuevo = guionDelLote(lote);
    if (vista === null || guionSinNada(nuevo)) {
      actual = { ...reloj, lote, previa: vista };
    } else {
      const ahora = performance.now();
      const origen = mazo.current?.getBoundingClientRect() ?? null;
      const transcurrido = ahora - reloj.inicio;
      const empiezaMano = lote.some((e) => e.tipo === "mano_empezada");
      const misma = reloj.previa?.ronda === vista.ronda;
      actual =
        !empiezaMano && misma && reloj.guion !== GUION_VACIO && reloj.ronda === vista.ronda && transcurrido < reloj.guion.fin
          ? { ...reloj, lote, previa: vista, guion: encolarGuion(reloj.guion, transcurrido, nuevo), desde: transcurrido, origen }
          : { lote, previa: vista, ronda: vista.ronda, guion: nuevo, base: !empiezaMano && misma && reloj.previa !== null ? fotoDeLaVista(reloj.previa) : fotoAntesDeLaMano(vista, nuevo), inicio: ahora, desde: 0, hito: 0, origen };
    }
    setReloj(actual);
  }
  if (!conectado && actual.guion !== GUION_VACIO) {
    actual = { ...actual, ...SIN_GUION };
    setReloj(actual);
  }

  // La ronda que se ve ahora: lo que quede de un guion que ya no es de esta ronda no suena ni se cobra.
  const rondaVista = useRef(vista?.ronda);
  rondaVista.current = vista?.ronda;
  const yo = useRef(vista?.yo);
  yo.current = vista?.yo;
  const cobrar = useRef(alCobrar);
  cobrar.current = alCobrar;
  const cobrada = useRef<number | null>(null);

  const { guion, inicio, desde, ronda: rondaDelGuion } = actual;
  useEffect(() => {
    if (guion === GUION_VACIO) return;
    // Al cambiar el guion se cancelan los relojes del anterior: aquí se vuelven a poner los que aún no han llegado.
    const pasado = performance.now() - inicio;
    const relojes: ReturnType<typeof setTimeout>[] = [];
    const cuando = (t: number, hacer: () => void) => relojes.push(setTimeout(hacer, Math.max(0, t - pasado)));

    for (const t of hitosDelGuion(guion)) cuando(t, () => setReloj((r) => (r.guion === guion ? { ...r, hito: Math.max(r.hito, t) } : r)));

    const sonar = (t: number, nombre: "carta" | "fichas") => {
      if (t >= desde) cuando(t, () => rondaVista.current === rondaDelGuion && sonidos.reproducir(nombre));
    };
    for (const t of [...guion.reparto.values()].flat()) sonar(t, "carta");
    for (const t of guion.calles.flatMap(salidasDeLaCalle)) sonar(t, "carta");
    for (const { en } of guion.fichas) sonar(en, "fichas");

    const mios = guion.premios.filter((p) => p.jugadorId === yo.current && p.en >= desde);
    if (mios.length > 0 && cobrada.current !== rondaDelGuion) {
      cuando(mios[0].en, () => {
        if (rondaVista.current !== rondaDelGuion) return;
        cobrada.current = rondaDelGuion;
        cobrar.current(mios.reduce((suma, p) => suma + p.cantidad, 0));
      });
    }
    return () => relojes.forEach(clearTimeout);
  }, [guion, inicio, desde, rondaDelGuion]);

  return actual;
}

/** La vista con lo que el guion aún retiene; un guion de otra ronda no retiene nada. */
export const vistaMostrada = (vista: VistaPoker, reloj: Reloj): VistaPoker => (reloj.ronda === vista.ronda ? vistaEn(vista, reloj.base, reloj.guion, reloj.hito) : vista);

/** Cómo entra la carta `indice` de `jugadorId`: la espera y de dónde sale, o en su sitio si no se reparte en este guion. */
export function entradaDeCarta(reloj: Reloj, ronda: number, jugadorId: JugadorId, indice: number): { retardo?: number; origen: DOMRect | null } {
  const salida = reloj.ronda === ronda ? reloj.guion.reparto.get(jugadorId)?.[indice] : undefined;
  return salida === undefined ? { origen: null } : { retardo: Math.max(0, salida - reloj.desde), origen: reloj.origen };
}

/** Las cartas de `jugadorId` ya están en su sitio (o no se reparten en el guion en curso). */
export function cartasRepartidas(reloj: Reloj, ronda: number, jugadorId: JugadorId): boolean {
  const salidas = reloj.ronda === ronda ? reloj.guion.reparto.get(jugadorId) : undefined;
  return salidas === undefined || reloj.hito >= Math.max(...salidas) + BJ.VUELO_MS;
}

/** La carta sale en el guion en curso: se abre girándose, no aparece ya vista. */
export const cartaDelGuion = (reloj: Reloj, ronda: number, palo: string, valor: string): boolean =>
  reloj.ronda === ronda && reloj.guion.calles.some((calle) => calle.cartas.some((c) => c.palo === palo && c.valor === valor));
