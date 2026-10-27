import type { CSSProperties } from "react";

/** Escalona la entrada de un elemento `.aparece`: empieza `ms` milisegundos más tarde. */
export const retardo = (ms: number): CSSProperties => ({ "--retardo": `${ms}ms` }) as CSSProperties;
