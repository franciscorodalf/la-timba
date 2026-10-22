import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VistaCarrera } from "../../../shared/juegos/carrera";
import type { Evento } from "../../../shared/juegos/tipos";
import { sonidos } from "../../efectos/sonidos";
import { ColaDeMarcos, type Reloj } from "./cola";
import { aplicarMarco, type Escena, escenaDeVista, type Marco, planDeLote } from "./escena";

/** Una carta suena como mucho cada tanto: un paso con giros no debe ser una ráfaga. */
const SONIDO_MIN_MS = 140;

/** El reloj del navegador para la cola de fotogramas. */
const RELOJ: Reloj = {
  ahora: () => performance.now(),
  poner: (hacer, ms) => setTimeout(hacer, ms),
  quitar: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/**
 * La escena de la pista: lo que se ve en cada momento. Cada lote de eventos que llega (un paso de la carrera por mensaje)
 * se convierte en un guion (`planDeLote`) y sus fotogramas entran en una cola ordenada (`ColaDeMarcos`) que los aplica a su hora,
 * uno tras otro con un solo temporizador: el orden no depende de cómo disparen los temporizadores.
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
  const cola = useMemo(() => new ColaDeMarcos(aplicar, RELOJ), [aplicar]);

  const sonar = useCallback(() => {
    const ahora = performance.now();
    if (ahora - ultimoSonido.current < SONIDO_MIN_MS) return;
    ultimoSonido.current = ahora;
    sonidos.reproducir("carta");
  }, []);

  const callarPendientes = useCallback(() => {
    sonidosPendientes.current.forEach(clearTimeout);
    sonidosPendientes.current.clear();
  }, []);

  // Solo al llegar un lote nuevo: la vista es la que llegó con él.
  useEffect(() => {
    if (vista === null) return;
    // Lo que ya tocaba (un temporizador retrasado, una pestaña dormida) se aplica antes de planear nada.
    cola.vencidos();
    // El lote nuevo se planea sobre la escena como va a quedar al acabar el guion en marcha.
    let plan = planDeLote(actual.current === null ? null : cola.proyectar(actual.current), lote, vista);
    if (plan.marcos.some((m) => m.salto)) {
      // Una vista que no cuadra con lo que se iba a ver: el guion en marcha ya no vale (ni sus sonidos).
      cola.terminar();
      callarPendientes();
      plan = planDeLote(actual.current, lote, vista);
    }
    // Lo nuevo sale cuando acaba lo que está en marcha.
    const espera = cola.restante();
    cola.encolar(plan.marcos);
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
      cola.cancelar();
      callarPendientes();
    },
    [cola, callarPendientes],
  );

  // Hasta que el efecto aplica la primera vista se enseña tal cual, para no pintar una pista vacía.
  const inicial = useMemo(() => (vista === null ? null : escenaDeVista(vista)), [vista === null]);
  return escena ?? inicial;
}
