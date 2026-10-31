import { useRef, useState } from "react";
import { POKER, type VistaPoker } from "../../../shared/juegos/poker";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton";
import { FichasApuesta } from "../../componentes/FichasApuesta";
import { miles } from "../../formato";

// Lo de debajo del tapete: sentarse y el texto de la línea de estado. Decidir y subir, tus cartas y las demás piezas se añaden aquí.

interface PropsSentarse {
  /** Tus fichas: lo máximo con lo que te puedes sentar. La mesa rechaza sin preguntar lo que pasa de ahí. */
  fichas: number;
  activo: boolean;
  /** Esperando a que la mesa confirme que te ha sentado. */
  esperando: boolean;
  onSentarse(fichas: number): void;
}

/** Las fichas con las que te sientas (desde `COMPRA_MIN`, sin pasar de las que tienes) y «Sentarme con N». */
export function Sentarse({ fichas, activo, esperando, onSentarse }: PropsSentarse) {
  const [montante, setMontante] = useState(0);
  // Si tienes menos fichas que lo preparado (acabas de gastarlas en otra mesa), lo preparado no vale.
  const cantidad = montante <= fichas ? montante : 0;
  // Las fichas vuelan hasta el botón: es lo que vas a pagar.
  const destino = useRef<HTMLDivElement>(null);
  return (
    <div className="panel-apuesta pk-sentarse">
      <FichasApuesta montante={cantidad} tope={fichas} minimo={POKER.COMPRA_MIN} activo={activo} onCambiar={setMontante} destino={destino} />
      <div className="panel-apuesta__fila" ref={destino}>
        <Boton variante="secundario" className="panel-apuesta__borrar" aria-label="Borrar fichas" disabled={cantidad === 0} onClick={() => setMontante(0)}>
          Borrar
        </Boton>
        <Boton disabled={!activo || cantidad < POKER.COMPRA_MIN} cargando={esperando} onClick={() => onSentarse(cantidad)}>
          {cantidad > 0 ? `Sentarme con ${miles(cantidad)}` : "Sentarme"}
        </Boton>
      </div>
    </div>
  );
}

/** Quien mira: sentarse, o que la mesa está completa. */
export function Mirando({ libres, ...resto }: PropsSentarse & { libres: number }) {
  if (libres <= 0) return <Aviso tipo="info">Podrás sentarte en cuanto se libere un asiento.</Aviso>;
  return <Sentarse {...resto} />;
}

/** El texto de la fase para la línea de estado. */
export function textoEstado(vista: VistaPoker | null): string {
  if (vista === null) return "Entrando en la mesa…";
  const mio = vista.asientos.find((a) => a.jugadorId === vista.yo);
  if (mio === undefined) return vista.asientosLibres <= 0 ? "La mesa está completa. Estás mirando" : "Estás mirando. Siéntate para jugar";
  if (vista.fase === "esperando") return "Esperando rivales";
  if (vista.fase === "resultado") return "Nueva mano en";
  if (mio.estado === "fuera") return "Juegas en la mano siguiente";
  if (vista.turno === vista.yo) return "Tu turno";
  const habla = vista.asientos.find((a) => a.jugadorId === vista.turno);
  if (mio.estado === "retirado") return "Te has retirado de esta mano";
  return habla === undefined ? "Se reparte la mano" : `Habla ${habla.apodo}`;
}
