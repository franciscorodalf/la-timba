import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";

/** El código no corresponde a ninguna partida abierta (mal escrito, o la partida ya se cerró). */
export function PartidaInexistente() {
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => titulo.current?.focus(), []);
  return (
    <main className="pantalla pantalla--entrada">
      <h1 className="marca__logo aparece">La Timba</h1>
      <section className="panel aparece" aria-labelledby="inexistente-titulo">
        <h2 className="panel__titulo" id="inexistente-titulo" ref={titulo} tabIndex={-1}>
          Esa partida no existe
        </h2>
        <p className="panel__texto">Puede que el código esté mal escrito o que la partida ya se haya cerrado. Pídele el código de nuevo a quien la creó, o abre una partida nueva.</p>
        {/* Un enlace con aspecto de botón: lleva a otra pantalla. `~` sale de la partida en la que está anidada esta pantalla. */}
        <Link href="~/" className="boton boton--principal boton--ancho">
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}

/** No se pudo comprobar si la partida existe (servidor caído, sin red). */
export function PartidaSinRespuesta({ mensaje, onReintentar }: { mensaje: string; onReintentar: () => void }) {
  return (
    <main className="pantalla pantalla--entrada">
      <h1 className="marca__logo aparece">La Timba</h1>
      <section className="panel aparece">
        <Aviso>{mensaje}</Aviso>
        <Boton ancho onClick={onReintentar}>
          Reintentar
        </Boton>
        <Link href="~/" className="boton boton--secundario boton--ancho">
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}
