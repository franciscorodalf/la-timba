interface Props {
  /** Lado en píxeles. */
  tamaño?: number;
}

/** La ficha roja de casino: aro de muescas crema, anillo interior y centro oscuro. Decorativa: el importe va siempre en texto. */
export function Ficha({ tamaño = 20 }: Props) {
  return (
    <svg className="ficha" viewBox="0 0 32 32" width={tamaño} height={tamaño} aria-hidden="true" focusable="false">
      <circle className="ficha__cuerpo" cx="16" cy="16" r="15" />
      <circle className="ficha__muescas" cx="16" cy="16" r="12.6" />
      <circle className="ficha__anillo" cx="16" cy="16" r="8.2" />
      <circle className="ficha__centro" cx="16" cy="16" r="5.4" />
    </svg>
  );
}
