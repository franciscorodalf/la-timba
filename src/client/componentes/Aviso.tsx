import type { ReactNode } from "react";

interface Props {
  /** `error` se anuncia al instante (`role="alert"`); `info` espera su turno (`role="status"`). */
  tipo?: "error" | "info";
  children: ReactNode;
}

export function Aviso({ tipo = "error", children }: Props) {
  return (
    <p className={`aviso aviso--${tipo}`} role={tipo === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}
