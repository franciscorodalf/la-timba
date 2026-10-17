import type { ReactNode } from "react";
import { Link } from "wouter";
import type { IdJuego, ResumenMesa } from "../../shared/juegos/tipos";
import { cuentaAtras } from "../formato";
import { useAhoraServidor } from "../red/reloj";
import { Avatar } from "./Avatar";

interface Props {
  juego: IdJuego;
  resumen: ResumenMesa;
}

const NOMBRES: Record<IdJuego, string> = { blackjack: "Blackjack", carrera: "Carrera" };

/** Cuántos avatares caben en la tarjeta antes de resumir el resto en «+N». */
const AVATARES_VISIBLES = 5;

interface TextoFase {
  /** La fase tiene una cuenta atrás que enseñar. Las que no (`banca`, `carrera`) duran un instante: su `finFase` es el siguiente paso. */
  cuenta: boolean;
  texto: (cuenta: ReactNode) => ReactNode;
}

/** Lo que dice la tarjeta en cada fase. Una fase que no está aquí se muestra como «En juego». */
const FASES: Record<IdJuego, Record<string, TextoFase>> = {
  blackjack: {
    apuestas: { cuenta: true, texto: (c) => <>Reparte en {c}</> },
    decisiones: { cuenta: true, texto: (c) => <>Jugando · {c}</> },
    banca: { cuenta: false, texto: () => "Juega la banca" },
    resultado: { cuenta: true, texto: (c) => <>Nueva ronda en {c}</> },
  },
  carrera: {
    apuestas: { cuenta: true, texto: (c) => <>Sale en {c}</> },
    carrera: { cuenta: false, texto: () => "¡Corren los caballos!" },
    resultado: { cuenta: true, texto: (c) => <>Nueva carrera en {c}</> },
  },
};
const FASE_DESCONOCIDA: TextoFase = { cuenta: false, texto: () => "En juego" };

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
          <g className="sala-mesa__clavos">
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
  const textoFase = FASES[juego][fase] ?? FASE_DESCONOCIDA;
  const conCuenta = finFase !== null && textoFase.cuenta;
  const ahora = useAhoraServidor(conCuenta);

  let estado: ReactNode;
  if (fase === "esperando") estado = jugadores.length === 0 ? "Mesa libre" : "Esperando apuestas";
  else estado = textoFase.texto(conCuenta ? <b className="sala-mesa__cuenta">{cuentaAtras(finFase - ahora)}</b> : null);

  return (
    <article className="sala-mesa">
      <div className="sala-mesa__icono">
        <Icono juego={juego} />
      </div>
      <div className="sala-mesa__cuerpo">
        <h3 className="sala-mesa__nombre">{nombre}</h3>
        <p className="sala-mesa__estado">
          {fase !== "esperando" && (
            <span className="sala-mesa__vivo" aria-hidden="true">
              ●
            </span>
          )}
          <span>{estado}</span>
        </p>
        {jugadores.length > 0 && (
          <ul className="sala-avatares" aria-label={`Sentados en ${nombre}`}>
            {jugadores.slice(0, AVATARES_VISIBLES).map((apodo) => (
              <li key={apodo}>
                <Avatar apodo={apodo} />
                <span className="solo-lectores">{apodo}</span>
              </li>
            ))}
            {jugadores.length > AVATARES_VISIBLES && (
              <li className="sala-avatares__mas">
                <span aria-hidden="true">+{jugadores.length - AVATARES_VISIBLES}</span>
                <span className="solo-lectores">y {jugadores.length - AVATARES_VISIBLES} más</span>
              </li>
            )}
          </ul>
        )}
      </div>
      <Link href={`/${juego}`} className="sala-mesa__ir" aria-label={`Entrar en ${nombre}`}>
        Entrar
      </Link>
    </article>
  );
}
