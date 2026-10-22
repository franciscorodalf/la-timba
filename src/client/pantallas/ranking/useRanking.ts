import { useCallback, useEffect, useRef, useState } from "react";
import type { OrdenRanking, RespuestaRanking } from "../../../shared/api";
import { api, mensajeError } from "../../red/api";

export type EstadoRanking = { estado: "cargando" } | { estado: "listo"; datos: RespuestaRanking } | { estado: "error"; mensaje: string };

/**
 * El ranking del orden `orden`. Cada orden se pide la primera vez que se enseña y se guarda mientras la pantalla esté abierta:
 * volver a una pestaña ya vista la enseña al instante, sin pedirla otra vez ni pasar por la carga. Un fallo no se guarda:
 * `reintentar` lo vuelve a pedir.
 */
export function useRanking(orden: OrdenRanking): EstadoRanking & { reintentar(): void } {
  const [estados, setEstados] = useState<Partial<Record<OrdenRanking, EstadoRanking>>>({});
  // Los órdenes pedidos y no fallidos (en vuelo o ya guardados): evita pedir dos veces lo mismo.
  const pedidos = useRef(new Set<OrdenRanking>());
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const pedir = useCallback((o: OrdenRanking) => {
    if (pedidos.current.has(o)) return;
    pedidos.current.add(o);
    setEstados((antes) => ({ ...antes, [o]: { estado: "cargando" } }));
    api.ranking(o).then(
      (datos) => montado.current && setEstados((antes) => ({ ...antes, [o]: { estado: "listo", datos } })),
      (e) => {
        pedidos.current.delete(o);
        if (montado.current) setEstados((antes) => ({ ...antes, [o]: { estado: "error", mensaje: mensajeError(e) } }));
      },
    );
  }, []);

  useEffect(() => pedir(orden), [orden, pedir]);
  const reintentar = useCallback(() => pedir(orden), [orden, pedir]);

  return { ...(estados[orden] ?? { estado: "cargando" }), reintentar };
}
