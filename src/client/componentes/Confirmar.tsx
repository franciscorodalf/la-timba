import { useEffect, useId, useRef } from "react";
import { Boton } from "./Boton";

interface Props {
  titulo: string;
  texto: string;
  /** Texto del botón que hace la acción. */
  aceptar: string;
  /** Texto del botón que deja las cosas como estaban (el que tiene el foco al abrir). */
  cancelar: string;
  onAceptar(): void;
  /** También al pulsar Esc o fuera del diálogo. */
  onCancelar(): void;
}

/** Pregunta antes de algo que no tiene vuelta atrás. Diálogo modal nativo: atrapa el foco, se cierra con Esc o pulsando fuera. */
export function Confirmar({ titulo, texto, aceptar, cancelar, onAceptar, onCancelar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const aceptado = useRef(false);
  const idTitulo = useId();
  const idTexto = useId();

  useEffect(() => {
    if (dialogo.current?.open === false) dialogo.current.showModal();
  }, []);

  return (
    <dialog
      ref={dialogo}
      className="confirmar"
      aria-labelledby={idTitulo}
      aria-describedby={idTexto}
      onClose={() => (aceptado.current ? onAceptar() : onCancelar())}
      onClick={(evento) => {
        // El fondo del diálogo modal cuenta como el propio diálogo, que no tiene relleno.
        if (evento.target === evento.currentTarget) dialogo.current?.close();
      }}
    >
      <div className="confirmar__cuerpo">
        <h2 className="panel__titulo" id={idTitulo}>
          {titulo}
        </h2>
        <p className="panel__texto" id={idTexto}>
          {texto}
        </p>
        <div className="confirmar__botones">
          <Boton variante="secundario" autoFocus onClick={() => dialogo.current?.close()}>
            {cancelar}
          </Boton>
          <Boton
            onClick={() => {
              aceptado.current = true;
              dialogo.current?.close();
            }}
          >
            {aceptar}
          </Boton>
        </div>
      </div>
    </dialog>
  );
}
