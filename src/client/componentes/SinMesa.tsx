import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Aviso } from "./Aviso";

/** Sin ninguna vista de la mesa en este rato (no contesta, o cerró sin reintento), se avisa y se ofrece volver. */
const SIN_MESA_MS = 5_000;

/** `true` cuando la mesa lleva `SIN_MESA_MS` sin dar ninguna vista (`hayVista` falso); en cuanto llega una, vuelve a `false`. */
export function useSinMesa(hayVista: boolean): boolean {
  const [sinMesa, setSinMesa] = useState(false);
  useEffect(() => {
    setSinMesa(false);
    if (hayVista) return;
    const espera = setTimeout(() => setSinMesa(true), SIN_MESA_MS);
    return () => clearTimeout(espera);
  }, [hayVista]);
  return sinMesa;
}

/** «No conseguimos sentarte en la mesa» y el camino de vuelta a la sala de la partida `codigo`. */
export function SinMesa({ codigo }: { codigo: string }) {
  return (
    <div className="sin-mesa">
      <Aviso tipo="info">No conseguimos sentarte en la mesa. Puedes esperar un poco o volver a la sala.</Aviso>
      <Link href={`~/p/${codigo}`} className="boton boton--secundario boton--ancho">
        Volver a la sala
      </Link>
    </div>
  );
}
