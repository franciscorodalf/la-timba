import { Ficha } from "./Ficha";

/** Los valores de las fichas de las mesas. */
export const VALORES_FICHA = [10, 25, 50, 100, 500] as const;

interface Props {
  /** Lo que ya has preparado para apostar. */
  montante: number;
  /** Lo máximo que puede sumar `montante` (el tope de la mesa o tus fichas, el menor): las fichas que lo pasarían se apagan. */
  tope: number;
  activo: boolean;
  onCambiar(montante: number): void;
}

/** Las fichas de 10 a 500 para ir sumando una apuesta; no dejan pasar de `tope`. */
export function FichasApuesta({ montante, tope, activo, onCambiar }: Props) {
  return (
    <div className="fichas-apuesta" role="group" aria-label="Fichas para apostar">
      {VALORES_FICHA.map((valor) => (
        <button
          key={valor}
          type="button"
          className={`ficha-apuesta ficha-apuesta--${valor}`}
          aria-label={`Añadir ${valor}`}
          disabled={!activo || montante + valor > tope}
          onClick={() => onCambiar(montante + valor)}
        >
          <Ficha tamaño={50} />
          <span className="ficha-apuesta__valor" aria-hidden="true">
            {valor}
          </span>
        </button>
      ))}
    </div>
  );
}
