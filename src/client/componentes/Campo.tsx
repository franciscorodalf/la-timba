import { forwardRef, type InputHTMLAttributes, type ReactNode, useId } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  /** Texto bajo el campo: la regla que debe cumplir. Con `invalido` se pinta como error. */
  ayuda: string;
  invalido?: boolean;
  /** Un control a la derecha dentro del campo (por ejemplo, mostrar u ocultar lo escrito). */
  accion?: ReactNode;
}

export const Campo = forwardRef<HTMLInputElement, Props>(function Campo({ etiqueta, ayuda, invalido = false, accion, id, ...resto }, ref) {
  const idAutomatico = useId();
  const idCampo = id ?? idAutomatico;
  const idAyuda = `${idCampo}-ayuda`;
  return (
    <div className="campo" data-invalido={invalido || undefined}>
      <label className="campo__etiqueta" htmlFor={idCampo}>
        {etiqueta}
      </label>
      <div className="campo__control">
        <input ref={ref} id={idCampo} aria-invalid={invalido} aria-describedby={idAyuda} {...resto} />
        {accion}
      </div>
      <p className="campo__ayuda" id={idAyuda}>
        {ayuda}
      </p>
    </div>
  );
});
