import { type ReactNode, useEffect, useState } from "react";
import { Link } from "wouter";
import type { IdJuego, ResumenMesa } from "../../shared/juegos/tipos";
import { cuentaAtras } from "../formato";
import { Avatar } from "./Avatar";

interface Props {
  juego: IdJuego;
  resumen: ResumenMesa;
}

const NOMBRES: Record<IdJuego, string> = { blackjack: "Blackjack", carrera: "Carrera" };

/** Cuántos avatares caben en la tarjeta antes de resumir el resto en «+N». */
const AVATARES_VISIBLES = 5;

/** Lo que dice la tarjeta en cada fase, con la cuenta atrás ya escrita. Una fase que no está aquí se muestra como «En juego». */
const FASES: Record<IdJuego, Record<string, (cuenta: ReactNode) => ReactNode>> = {
  blackjack: {
    apuestas: (c) => <>Reparte en {c}</>,
    decisiones: (c) => <>Jugando · {c}</>,
    banca: () => "Juega la banca",
    resultado: (c) => <>Nueva ronda en {c}</>,
  },
  carrera: {
    apuestas: (c) => <>Sale en {c}</>,
    carrera: () => "¡Corren los caballos!",
    resultado: (c) => <>Nueva carrera en {c}</>,
  },
};

/** El reloj de la tarjeta: solo late (cuatro veces por segundo, para no atrasarse un segundo entero) mientras haya una cuenta atrás. */
function useAhora(activo: boolean): number {
  const [ahora, setAhora] = useState(Date.now);
  useEffect(() => {
    if (!activo) return;
    setAhora(Date.now());
    const reloj = setInterval(() => setAhora(Date.now()), 250);
    return () => clearInterval(reloj);
  }, [activo]);
  return ahora;
}

/** Pica para el blackjack y herradura para la carrera. */
function Icono({ juego }: { juego: IdJuego }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" focusable="false">
      {juego === "blackjack" ? (
        <path
          fill="currentColor"
          d="M12 2.5C12 2.5 4 8.6 4 13.6a4.2 4.2 0 0 0 7.2 2.9c-.1 1.7-.7 3.2-2.2 5h6c-1.5-1.8-2.1-3.3-2.2-5A4.2 4.2 0 0 0 20 13.6C20 8.6 12 2.5 12 2.5Z"
        />
      ) : (
        <>
          <path fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" d="M6.5 4.5v7a5.5 5.5 0 0 0 11 0v-7" />
          <g className="mesa__clavos">
            <circle cx="6.5" cy="7" r="0.9" />
            <circle cx="6.5" cy="10.5" r="0.9" />
            <circle cx="17.5" cy="7" r="0.9" />
            <circle cx="17.5" cy="10.5" r="0.9" />
          </g>
        </>
      )}
    </svg>
  );
}

/** Una mesa de la sala: quién está sentado, en qué fase va, cuánto falta y el acceso. Toda la tarjeta lleva a la mesa. */
export function TarjetaMesa({ juego, resumen }: Props) {
  const nombre = NOMBRES[juego];
  const { jugadores, fase, finFase } = resumen;
  const ahora = useAhora(finFase !== null);

  let estado: ReactNode;
  if (fase === "esperando") estado = jugadores.length === 0 ? "Mesa libre" : "Esperando apuestas";
  else {
    const texto = FASES[juego][fase] ?? (() => "En juego");
    estado = texto(finFase === null ? null : <b className="mesa__cuenta">{cuentaAtras(finFase - ahora)}</b>);
  }

  return (
    <article className="mesa">
      <div className="mesa__icono">
        <Icono juego={juego} />
      </div>
      <div className="mesa__cuerpo">
        <h3 className="mesa__nombre">{nombre}</h3>
        <p className="mesa__estado">
          {fase !== "esperando" && (
            <span className="mesa__vivo" aria-hidden="true">
              ●
            </span>
          )}
          <span>{estado}</span>
        </p>
        {jugadores.length > 0 && (
          <ul className="avatares" aria-label={`Sentados en ${nombre}`}>
            {jugadores.slice(0, AVATARES_VISIBLES).map((apodo) => (
              <li key={apodo}>
                <Avatar apodo={apodo} />
                <span className="solo-lectores">{apodo}</span>
              </li>
            ))}
            {jugadores.length > AVATARES_VISIBLES && (
              <li className="avatares__mas">
                <span aria-hidden="true">+{jugadores.length - AVATARES_VISIBLES}</span>
                <span className="solo-lectores">y {jugadores.length - AVATARES_VISIBLES} más</span>
              </li>
            )}
          </ul>
        )}
      </div>
      <Link href={`/${juego}`} className="mesa__ir" aria-label={`Entrar en ${nombre}`}>
        Entrar
      </Link>
    </article>
  );
}
