import { useEffect, useId, useRef } from "react";
import { CATEGORIAS, type Jugada } from "../../../shared/juegos/poker-jugadas";
import { Boton } from "../../componentes/Boton";
import { CuentaTurno } from "./controles";

interface Props {
  abierta: boolean;
  /** La jugada que tienes ahora, o `null` si no hay nada que resaltar (no estás en la mano o tienes las cartas tapadas). */
  jugada: Jugada | null;
  onCerrar(): void;
  /** La cuenta atrás de tu turno (`0:13`), o `null` si no te toca: la tabla es modal y tapa la línea de estado de la mesa. */
  aviso: string | null;
}

/**
 * Las diez jugadas de mayor a menor, con la tuya resaltada. Diálogo modal nativo, como `Confirmar`: atrapa el foco, se cierra con su
 * botón, con Esc o pulsando fuera, y al cerrar el foco vuelve al botón que lo abrió. Está siempre montada y se abre con `abierta`.
 */
export function TablaJugadas({ abierta, jugada, onCerrar, aviso }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();

  useEffect(() => {
    const el = dialogo.current;
    if (el === null) return;
    if (abierta && !el.open) el.showModal();
    else if (!abierta && el.open) el.close();
  }, [abierta]);

  return (
    <dialog
      ref={dialogo}
      className="tabla-jugadas"
      aria-label="Tabla de jugadas"
      onClose={onCerrar}
      onClick={(evento) => {
        // El fondo del diálogo modal cuenta como el propio diálogo, que no tiene relleno.
        if (evento.target === evento.currentTarget) dialogo.current?.close();
      }}
    >
      {/* Cerrada no lleva contenido: ni el aviso ni la lista están en la página (ni para los lectores de pantalla ni para quien la busque). */}
      {abierta && (
        <div className="tabla-jugadas__cuerpo">
          <header className="tabla-jugadas__cabeza">
            <h2 className="tabla-jugadas__titulo" id={idTitulo}>
              Jugadas
            </h2>
            <Boton variante="secundario" className="tabla-jugadas__cerrar" autoFocus onClick={() => dialogo.current?.close()}>
              Cerrar
            </Boton>
          </header>
          {/* El aviso reserva su sitio: que te toque no mueve la tabla. El lector de pantalla oye «Es tu turno» una vez, no cada segundo. */}
          <div className="tabla-jugadas__aviso">
            <CuentaTurno cuenta={aviso} />
            <p role="status" className="solo-lectores">
              {aviso !== null ? "Es tu turno" : ""}
            </p>
          </div>
          <ol className="tabla-jugadas__lista" role="list" aria-labelledby={idTitulo}>
            {CATEGORIAS.map(({ categoria, nombre, descripcion }) => {
              const tuya = jugada?.categoria === categoria;
              return (
                <li key={categoria} className={`tabla-jugadas__fila${tuya ? " tabla-jugadas__fila--tuya" : ""}`} aria-current={tuya ? "true" : undefined}>
                  <span className="tabla-jugadas__nombre">{nombre}</span>
                  <span className="tabla-jugadas__desc">{descripcion}</span>
                  {tuya && <span className="tabla-jugadas__tienes">tienes esta</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </dialog>
  );
}
