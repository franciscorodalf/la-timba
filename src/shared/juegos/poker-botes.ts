import type { JugadorId } from "./tipos";

/** Lo que cada jugador ha puesto en la mano. `vivo`: no se ha retirado ni levantado, así que puede ganar. */
export interface Aporte {
  jugadorId: JugadorId;
  aportado: number;
  vivo: boolean;
}

/** Un bote paralelo. `jugadores` son quienes pueden ganarlo, en el orden en que llegaron en `aportes`. */
export interface Bote {
  cantidad: number;
  jugadores: JugadorId[];
}

const mismosJugadores = (a: JugadorId[], b: JugadorId[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Divide lo aportado en botes paralelos, uno por cada nivel distinto de aportación entre los vivos.
 * Hace falta al menos un jugador vivo con aportación positiva (las ciegas lo garantizan). Si no lo hubiera, no habría a quién dar los botes y saldrían vacíos.
 * Lo repartido más lo devuelto suma siempre lo aportado.
 */
export function calcularBotes(aportes: Aporte[]): { botes: Bote[]; devuelto: { jugadorId: JugadorId; cantidad: number } | null } {
  let devuelto: { jugadorId: JugadorId; cantidad: number } | null = null;
  let restantes = aportes.map((a) => ({ ...a }));

  // Lo que nadie iguala vuelve a quien lo apostó, pero solo si sigue vivo: quien se levanta con la mayor aportación la pierde.
  const ordenadas = [...restantes].sort((a, b) => b.aportado - a.aportado);
  const [primera, segunda] = ordenadas;
  if (primera && primera.vivo && primera.aportado > (segunda?.aportado ?? 0)) {
    const cantidad = primera.aportado - (segunda?.aportado ?? 0);
    devuelto = { jugadorId: primera.jugadorId, cantidad };
    restantes = restantes.map((a) => (a.jugadorId === primera.jugadorId ? { ...a, aportado: a.aportado - cantidad } : a));
  }

  const niveles = [...new Set(restantes.filter((a) => a.vivo && a.aportado > 0).map((a) => a.aportado))].sort((a, b) => a - b);
  const botes: Bote[] = [];
  let anterior = 0;
  niveles.forEach((nivel, i) => {
    // En el último nivel lo que un no vivo puso por encima también entra: nadie más podría llevárselo.
    const tope = i === niveles.length - 1 ? Infinity : nivel;
    let cantidad = 0;
    for (const a of restantes) cantidad += Math.min(a.aportado, tope) - Math.min(a.aportado, anterior);
    const jugadores = restantes.filter((a) => a.vivo && a.aportado >= nivel).map((a) => a.jugadorId);
    anterior = nivel;
    const ultimo = botes[botes.length - 1];
    if (ultimo && mismosJugadores(ultimo.jugadores, jugadores)) ultimo.cantidad += cantidad;
    else botes.push({ cantidad, jugadores });
  });

  return { botes, devuelto };
}

/** Reparte a partes iguales; las fichas que sobran van de una en una a los primeros (`ganadores` viene ordenado desde la izquierda del botón). */
export function repartirBote(cantidad: number, ganadores: JugadorId[]): { jugadorId: JugadorId; cantidad: number }[] {
  if (ganadores.length === 0) return [];
  const base = Math.floor(cantidad / ganadores.length);
  const sobran = cantidad - base * ganadores.length;
  return ganadores.map((jugadorId, i) => ({ jugadorId, cantidad: base + (i < sobran ? 1 : 0) }));
}
