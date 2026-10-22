import { useEffect, useState } from "react";
import type { Evento } from "../../shared/juegos/tipos";
import { useDespues } from "./useDespues";

/** Lo que dura el aviso «Barajando». */
export const BARAJADO_MS = 1_600;

/** `true` unos instantes tras un evento `barajado` en el lote: el mazo se agita y se avisa. */
export function useBarajando(lote: Evento[]): boolean {
  const despues = useDespues();
  const [barajando, setBarajando] = useState(false);
  useEffect(() => {
    if (!lote.some((e) => e.tipo === "barajado")) return;
    setBarajando(true);
    despues(BARAJADO_MS, () => setBarajando(false));
  }, [lote, despues]);
  return barajando;
}
