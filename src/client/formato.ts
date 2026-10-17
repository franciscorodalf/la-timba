/** Un entero con punto de millares, también en cuatro cifras (`1.000`): `Intl` en español no agrupa por debajo de 10.000. */
export const miles = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** La hora local de un instante (milisegundos desde 1970) como `HH:MM`. */
export function horaLocal(instante: number): string {
  const fecha = new Date(instante);
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

/** El tiempo que falta como `m:ss` (`0:12`), con los segundos redondeados hacia arriba y sin bajar de `0:00`. */
export function cuentaAtras(ms: number): string {
  const segundos = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

/**
 * El valor de una cuenta animada de `desde` a `hasta` cuando han pasado `transcurrido` de `ms` milisegundos: frena al final
 * y nunca se sale del camino (un fotograma con marca de tiempo anterior al inicio no hace bajar de `desde`).
 */
export function valorAnimado(desde: number, hasta: number, transcurrido: number, ms: number): number {
  const avance = ms <= 0 ? 1 : Math.min(1, Math.max(0, transcurrido / ms));
  return avance === 1 ? hasta : desde + (hasta - desde) * (1 - (1 - avance) ** 3);
}
