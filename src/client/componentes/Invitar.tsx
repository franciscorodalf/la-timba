import { QRCodeSVG } from "qrcode.react";
import { useEffect, useId, useRef, useState } from "react";
import { Boton } from "./Boton";

interface Props {
  codigo: string;
  /** Se llama al cerrar, con Esc, con el botón o pulsando fuera. El diálogo vive mientras esté montado. */
  onCerrar: () => void;
}

type Copia = "nada" | "copiado" | "fallo";

/** Copia con la API del portapapeles y, si el navegador no la deja (página sin HTTPS, permisos), con un área de texto temporal. */
async function copiar(texto: string, dentro: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Sigue con la vía antigua.
  }
  // El área va dentro del diálogo: en un diálogo modal el resto de la página es inerte y no se podría seleccionar.
  const area = document.createElement("textarea");
  area.value = texto;
  area.readOnly = true;
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  dentro.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, texto.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Diálogo modal (nativo: atrapa el foco y se cierra con Esc) con el código de la partida, su QR y el botón para copiar el enlace. */
export function Invitar({ codigo, onCerrar }: Props) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const idTitulo = useId();
  const [copia, setCopia] = useState<Copia>("nada");
  const enlace = `${location.origin}/p/${codigo}`;

  useEffect(() => {
    if (dialogo.current?.open === false) dialogo.current.showModal();
  }, []);

  useEffect(() => {
    if (copia === "nada") return;
    const espera = setTimeout(() => setCopia("nada"), 3000);
    return () => clearTimeout(espera);
  }, [copia]);

  async function alCopiar() {
    if (dialogo.current === null) return;
    setCopia((await copiar(enlace, dialogo.current)) ? "copiado" : "fallo");
  }

  return (
    <dialog
      ref={dialogo}
      className="invitar"
      aria-labelledby={idTitulo}
      onClose={onCerrar}
      // Pulsar fuera: el fondo del diálogo modal cuenta como el propio diálogo, que no tiene relleno.
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) dialogo.current?.close();
      }}
    >
      <div className="invitar__cuerpo">
        <h2 className="panel__titulo" id={idTitulo}>
          Invita a tus amigos
        </h2>
        <p className="panel__texto">Dales este código o que escaneen el QR para sentarse en tu partida.</p>
        <p className="invitar__codigo">{codigo}</p>
        <div className="invitar__qr">
          <QRCodeSVG value={enlace} size={212} level="M" marginSize={4} bgColor="#f3e7c4" fgColor="#08361f" title={`Código QR para unirse a la partida ${codigo}`} />
        </div>
        <p className="invitar__enlace">{enlace}</p>
        <Boton ancho onClick={alCopiar}>
          Copiar enlace
        </Boton>
        <p className="invitar__estado" role="status">
          {copia === "copiado" && "Enlace copiado"}
          {copia === "fallo" && "No se pudo copiar: mantén pulsado el enlace para copiarlo"}
        </p>
        <button type="button" className="invitar__cerrar" aria-label="Cerrar" onClick={() => dialogo.current?.close()}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>
    </dialog>
  );
}
