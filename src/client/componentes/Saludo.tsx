import { useEffect } from "react";
import { useSesion } from "../red/sesion";
import { Contador } from "./Contador";
import { Ficha } from "./Ficha";

/**
 * «Hola, tienes N fichas». Al aparecer vuelve a leer las fichas del servidor: se llega aquí al volver de una mesa, y el
 * número que se tenía puede estar desfasado. Si cambió, el contador sube o baja contando.
 */
export function Saludo() {
  const { jugador, refrescarFichas } = useSesion();
  useEffect(() => {
    void refrescarFichas();
  }, [refrescarFichas]);

  return (
    <p className="saludo">
      <Ficha tamaño={22} />
      <span>
        Hola, tienes{" "}
        <b>
          <Contador valor={jugador?.fichas ?? 0} />
        </b>{" "}
        fichas
      </span>
    </p>
  );
}
