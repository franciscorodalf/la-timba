import { useEffect, useRef } from "react";
import { useSesion } from "./sesion";

/**
 * Mantiene al día las fichas del contador sin esperar a un evento de pago: se vuelven a leer al (re)conectar y al empezar
 * cada ronda. Un pago que no trae evento (la foto al reconectar con la ronda ya liquidada, una liquidación reintentada más
 * tarde) también llega así al contador.
 */
export function useFichasAlDia(conectado: boolean, ronda: number | undefined): void {
  const { refrescar } = useSesion();
  useEffect(() => {
    if (conectado) void refrescar();
  }, [conectado, refrescar]);
  const anterior = useRef(ronda);
  useEffect(() => {
    const antes = anterior.current;
    anterior.current = ronda;
    if (antes !== undefined && ronda !== antes) void refrescar();
  }, [ronda, refrescar]);
}
