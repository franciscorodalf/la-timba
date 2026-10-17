import type { ButtonHTMLAttributes } from "react";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `principal`: oro macizo, la acción que se espera. `secundario`: solo el borde dorado. */
  variante?: "principal" | "secundario";
  /** Muestra un giro y no deja volver a pulsar; el botón sigue enfocable para no perder el foco del teclado. */
  cargando?: boolean;
  /** Ocupa todo el ancho disponible. */
  ancho?: boolean;
}

export function Boton({ variante = "principal", cargando = false, ancho = false, type = "button", className, onClick, children, ...resto }: Props) {
  const clases = ["boton", `boton--${variante}`, ancho && "boton--ancho", className].filter(Boolean).join(" ");
  return (
    <button
      type={type}
      className={clases}
      aria-busy={cargando || undefined}
      aria-disabled={cargando || undefined}
      onClick={(evento) => {
        if (cargando) evento.preventDefault();
        else onClick?.(evento);
      }}
      {...resto}
    >
      {cargando && <span className="boton__giro" aria-hidden="true" />}
      {children}
    </button>
  );
}
