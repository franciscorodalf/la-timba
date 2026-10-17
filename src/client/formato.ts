/** Un entero con punto de millares, también en cuatro cifras (`1.000`): `Intl` en español no agrupa por debajo de 10.000. */
export const miles = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** La hora local de un instante (milisegundos desde 1970) como `HH:MM`. */
export function horaLocal(instante: number): string {
  const fecha = new Date(instante);
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}
