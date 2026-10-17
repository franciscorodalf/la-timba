import { useEffect, useRef, useState } from "react";
import { miles, valorAnimado } from "../formato";

interface Props {
  valor: number;
  /** Duración de la cuenta cuando `valor` cambia. */
  ms?: number;
}

const movimientoReducido = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Un número con punto de millares que, al cambiar, cuenta hasta el valor nuevo (frena al final, sin salirse nunca del
 * camino). Al aparecer enseña su valor sin animar, y con `prefers-reduced-motion` salta directo. Si cambia a mitad de
 * cuenta, sigue desde donde iba.
 */
export function Contador({ valor, ms = 700 }: Props) {
  const [enseñado, setEnseñado] = useState(valor);
  const actual = useRef(valor);

  useEffect(() => {
    if (valor === actual.current) return;
    if (ms <= 0 || movimientoReducido()) {
      actual.current = valor;
      setEnseñado(valor);
      return;
    }
    const desde = actual.current;
    const inicio = performance.now();
    let cuadro = 0;
    const paso = (ahora: number) => {
      actual.current = valorAnimado(desde, valor, ahora - inicio, ms);
      setEnseñado(actual.current);
      if (actual.current !== valor) cuadro = requestAnimationFrame(paso);
    };
    cuadro = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(cuadro);
  }, [valor, ms]);

  return <span className="contador">{miles(enseñado)}</span>;
}
