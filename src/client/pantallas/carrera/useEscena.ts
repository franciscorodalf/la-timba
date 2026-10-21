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
}

/**
 * La escena de la pista: lo que se ve en cada momento. Cada lote de eventos que llega (un paso de la carrera por mensaje)
 * se convierte en un guion (`planDeLote`) cuyos cambios se aplican a su hora. Si llega otro mensaje con el guion a medias,
 * lo que faltaba se da por visto al instante y el nuevo empieza desde ahí: la pista siempre acaba en las casillas de la
 * última vista. La primera vista, y la que llega tras una desconexión sin eventos, se enseñan de golpe.
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

  // Solo al llegar un lote nuevo: la vista es la que llegó con él.
  useEffect(() => {
    if (vista === null) return;
    // Lo que quedaba del guion anterior se da por visto: el nuevo empieza desde ahí.
    for (const p of pendientes.current) {
      clearTimeout(p.reloj);
      aplicar(p.marco);
    }
    pendientes.current = [];

    const plan = planDeLote(actual.current, lote, vista);
    for (const marco of plan.marcos) {
      if (marco.en <= 0) {
        aplicar(marco);
        continue;
      }
      const pendiente: Pendiente = {
        marco,
        reloj: setTimeout(() => {
          pendientes.current = pendientes.current.filter((p) => p !== pendiente);
          aplicar(marco);
        }, marco.en),
      };
      pendientes.current.push(pendiente);
    }
    for (const en of plan.sonidos) {
      if (en <= 0) {
        sonar();
        continue;
      }
      const reloj = setTimeout(() => {
        sonidosPendientes.current.delete(reloj);
        sonar();
      }, en);
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
