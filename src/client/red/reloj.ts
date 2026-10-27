import { useEffect, useState } from "react";

// Los instantes que manda el servidor (`finFase`) son de su reloj, y el del dispositivo puede ir minutos adelantado o
// atrasado. Cada mensaje de sala o de mesa trae la hora del servidor al enviarlo: aquí se guarda cuánto se aparta del
// reloj del cliente, y las cuentas atrás se calculan con la hora del servidor. El retardo de la red (decenas de
// milisegundos) queda dentro del desfase; no se compensa.

let desfase = 0;

/** Anota la hora del servidor (`ahora` de un mensaje) en el momento de recibirlo. El último mensaje manda. */
export function registrarHoraServidor(horaServidor: number): void {
  desfase = horaServidor - Date.now();
}

/** La hora del servidor ahora mismo (ms desde 1970). Sin mensajes todavía, la del cliente. */
export const ahoraServidor = (): number => Date.now() + desfase;

/** Cada cuánto se refresca una cuenta atrás en pantalla: cuatro veces por segundo, para no atrasarse un segundo entero. */
const LATIDO_MS = 250;

/**
 * La hora del servidor, que se lee en cada pintado; mientras `activo` hay un latido cada `LATIDO_MS` que vuelve a pintar.
 * Quien no tiene cuenta atrás que enseñar pasa `false` y no gasta un temporizador. La hora no se guarda en un estado: así
 * al activarse el primer pintado ya trae la hora de ahora, no la del último latido de hace rato.
 */
export function useAhoraServidor(activo: boolean): number {
  const [, latir] = useState(0);
  useEffect(() => {
    if (!activo) return;
    const reloj = setInterval(() => latir((n) => n + 1), LATIDO_MS);
    return () => clearInterval(reloj);
  }, [activo]);
  return ahoraServidor();
}
