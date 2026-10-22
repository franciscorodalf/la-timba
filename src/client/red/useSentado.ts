import { useSesion } from "./sesion";

/** Estás entre los sentados de la mesa (por apodo, sin distinguir mayúsculas). */
export function useSentado(sentados: string[] | undefined): boolean {
  const { jugador } = useSesion();
  const yo = jugador?.apodo.toLowerCase();
  return sentados?.some((apodo) => apodo.toLowerCase() === yo) ?? false;
}
