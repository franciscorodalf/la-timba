import { useCallback, useEffect, useRef } from "react";

/**
 * `despues(ms, hacer)`: lo hace pasado ese rato, aunque llegue otro mensaje de la mesa entre medias (un premio no debe
 * cortarse porque alguien apueste). Todo lo pendiente se cancela al salir de la pantalla. La función es estable.
 */
export function useDespues(): (ms: number, hacer: () => void) => void {
  const pendientes = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const relojes = pendientes.current;
    return () => relojes.forEach(clearTimeout);
  }, []);
  return useCallback((ms, hacer) => {
    const id = setTimeout(() => {
      pendientes.current.delete(id);
      hacer();
    }, ms);
    pendientes.current.add(id);
  }, []);
}
