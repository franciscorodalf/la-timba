import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VistaCarrera } from "../../../shared/juegos/carrera";
import type { Evento } from "../../../shared/juegos/tipos";
import { sonidos } from "../../efectos/sonidos";
import { aplicarMarco, type Escena, escenaDeVista, type Marco, planDeLote } from "./escena";

/** Una carta suena como mucho cada tanto: un paso con giros no debe ser una ráfaga. */
const SONIDO_MIN_MS = 140;

interface Pendiente {
  reloj: ReturnType<typeof setTimeout>;
  marco: Marco;
  /** Cuándo se aplica (`performance.now()`). */
  vence: number;
}

/**
 * La escena de la pista: lo que se ve en cada momento. Cada lote de eventos que llega (un paso de la carrera por mensaje)
 * se convierte en un guion (`planDeLote`) cuyos cambios se aplican a su hora.
 *
 * Un guion en marcha no se corta: el lote siguiente se planea sobre cómo va a quedar la escena al acabarlo. Un mensaje sin
 * ningún paso nuevo (alguien se sienta, otro vuelve a conectar) cuadra con eso y no cambia nada; un paso nuevo se pone detrás
 * del que está en marcha, como las cartas del blackjack. Solo una vista que no cuadra (se volvió de una desconexión) lo da por
 * visto y salta: la pista siempre acaba en las casillas de la última vista.
 *
 * Devuelve `null` hasta la primera vista. `mazo` es de donde salen las cartas.
 */
export function useEscena(lote: Evento[], vista: VistaCarrera | null, mazo: RefObject<HTMLElement | null>): Escena | null {
  const [escena, setEscena] = useState<Escena | null>(null);
  const actual = useRef<Escena | null>(null);
  const pendientes = useRef<Pendiente[]>([]);
  const sonidosPendientes = useRef(new Set<ReturnType<typeof setTimeout>>());
  const ultimoSonido = useRef(0);

  const aplicar = useCallback(
    (marco: Marco) => {
      let parche = marco.parche;
      // La carta nueva sale del mazo donde está ahora.
      if (!marco.salto && parche.n !== undefined) parche = { ...parche, origen: mazo.current?.getBoundingClientRect() ?? null };
      const siguiente = actual.current === null ? (parche as Escena) : aplicarMarco(actual.current, { ...marco, parche });
      actual.current = siguiente;
      setEscena(siguiente);
    },
    [mazo],
  );

  const sonar = useCallback(() => {
    const ahora = performance.now();
    if (ahora - ultimoSonido.current < SONIDO_MIN_MS) return;
    ultimoSonido.current = ahora;
    sonidos.reproducir("carta");
  }, []);

  /** Lo que falta por aplicar del guion en marcha se da por visto ya. */
  const terminar = useCallback(() => {
    for (const p of pendientes.current) {
      clearTimeout(p.reloj);
      aplicar(p.marco);
    }
    pendientes.current = [];
  }, [aplicar]);

  // Solo al llegar un lote nuevo: la vista es la que llegó con él.
  useEffect(() => {
    if (vista === null) return;
    const ahora = performance.now();
    // La escena como va a quedar al acabar el guion en marcha: sobre ella se planea el lote nuevo.
    const enOrden = [...pendientes.current].sort((a, b) => a.vence - b.vence);
    let plan = planDeLote(
      actual.current === null ? null : enOrden.reduce((e, p) => aplicarMarco(e, p.marco), actual.current),
      lote,
      vista,
    );
    if (plan.marcos.some((m) => m.salto)) {
      // Una vista que no cuadra con lo que se iba a ver: el guion en marcha ya no vale.
      terminar();
      plan = planDeLote(actual.current, lote, vista);
    }
    // Lo nuevo sale cuando acaba lo que está en marcha.
    const espera = Math.max(0, ...pendientes.current.map((p) => p.vence - ahora));

    for (const marco of plan.marcos) {
      if (marco.en + espera <= 0) {
        aplicar(marco);
        continue;
      }
      const pendiente: Pendiente = {
        marco,
        vence: ahora + espera + marco.en,
        reloj: setTimeout(() => {
          pendientes.current = pendientes.current.filter((p) => p !== pendiente);
          aplicar(marco);
        }, espera + marco.en),
      };
      pendientes.current.push(pendiente);
    }
    for (const en of plan.sonidos) {
      if (en + espera <= 0) {
        sonar();
        continue;
      }
      const reloj = setTimeout(() => {
        sonidosPendientes.current.delete(reloj);
        sonar();
      }, espera + en);
      sonidosPendientes.current.add(reloj);
    }
  }, [lote]);

  // Al salir de la pantalla no queda nada por aplicar ni por sonar.
  useEffect(
    () => () => {
      for (const p of pendientes.current) clearTimeout(p.reloj);
      pendientes.current = [];
      sonidosPendientes.current.forEach(clearTimeout);
      sonidosPendientes.current.clear();
    },
    [],
  );

  // Hasta que el efecto aplica la primera vista se enseña tal cual, para no pintar una pista vacía.
  const inicial = useMemo(() => (vista === null ? null : escenaDeVista(vista)), [vista === null]);
  return escena ?? inicial;
}
