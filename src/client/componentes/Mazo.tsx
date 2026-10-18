import { type CSSProperties, forwardRef } from "react";
import { Reverso } from "./Naipe";

interface Props {
  /** Ancho de cada carta en píxeles. */
  ancho: number;
  /** Se está barajando: el mazo se agita un momento. */
  barajando?: boolean;
}

/** El mazo de la mesa: tres reversos apilados. Las cartas salen volando desde aquí. Decorativo para los lectores de pantalla. */
export const Mazo = forwardRef<HTMLDivElement, Props>(function Mazo({ ancho, barajando = false }, ref) {
  return (
    <div ref={ref} className={`mazo${barajando ? " mazo--barajando" : ""}`} style={{ "--ancho": `${ancho}px` } as CSSProperties} aria-hidden="true">
      <Reverso />
      <Reverso />
      <Reverso />
    </div>
  );
});
