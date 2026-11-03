import { useCallback, useEffect, useState } from "react";
import type { CodigoError } from "../../shared/juegos/tipos";

/**
 * La guarda contra el doble envío, igual en todas las mesas. Tras mandar una acción (`marcarEnviado`), `esperando` es verdadero
 * hasta que cambie la `firma` de lo TUYO en la mesa (tus cartas, tus apuestas…): las novedades de otros jugadores no lo
 * levantan, así que un doble toque no manda dos acciones. También se libera con un error de la mesa (la acción no se hizo) y al
 * caerse o volver la conexión (la respuesta pudo perderse).
 */
export function useEnvioUnico(firma: string | null, error: CodigoError | null, conectado: boolean): { esperando: boolean; marcarEnviado(): void } {
  const [enviadoCon, setEnviadoCon] = useState<string | null>(null);
  useEffect(() => {
    if (error !== null) setEnviadoCon(null);
  }, [error]);
  useEffect(() => {
    setEnviadoCon(null);
  }, [conectado]);
  // Cuando lo tuyo ya ha cambiado, la espera se acaba para siempre: si más tarde vuelve a ser igual (te sientas, te levantas y
  // vuelves a sentarte), no es la respuesta de aquel envío, y el botón no debe quedarse esperando.
  useEffect(() => {
    if (enviadoCon !== null && firma !== enviadoCon) setEnviadoCon(null);
  }, [firma, enviadoCon]);
  const marcarEnviado = useCallback(() => setEnviadoCon(firma), [firma]);
  return { esperando: enviadoCon !== null && enviadoCon === firma, marcarEnviado };
}
