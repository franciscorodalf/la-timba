import { useState } from "react";
import type { FilaRankingPartida } from "../../shared/api";
import { Avatar } from "../componentes/Avatar";
import { Invitar } from "../componentes/Invitar";
import { Navegacion } from "../componentes/Navegacion";
import { Reconectando } from "../componentes/Reconectando";
import { Saludo } from "../componentes/Saludo";
import { TarjetaMesa } from "../componentes/TarjetaMesa";
import { retardo } from "../animacion";
import { miles } from "../formato";
import { usePartida } from "../red/usePartida";
import { useSesion } from "../red/sesion";

/** Cuántas filas enseña «Esta noche». */
const PUESTOS = 3;

function IconoQr() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.3" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.3" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.3" />
      <path d="M14 14h3v3h-3zM20.5 14v3M17 20.5h3.5" strokeLinecap="round" />
    </svg>
  );
}

function EnLaSala({ conectados }: { conectados: string[] }) {
  const { jugador } = useSesion();
  return (
    <section aria-labelledby="sala-conectados">
      <h2 className="sala-etiqueta" id="sala-conectados">
        En la sala <span className="sala-etiqueta__n">{conectados.length}</span>
      </h2>
      <ul className="sala-conectados" aria-label="Jugadores en la sala">
        {conectados.map((apodo) => (
          <li className="sala-pastilla" key={apodo}>
            <Avatar apodo={apodo} />
            <span>{apodo}</span>
            {apodo.toLowerCase() === jugador?.apodo.toLowerCase() && <small>tú</small>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PuestoNoche({ posicion, fila }: { posicion: number; fila: FilaRankingPartida }) {
  const { jugador } = useSesion();
  const yo = fila.apodo.toLowerCase() === jugador?.apodo.toLowerCase();
  const signo = fila.neto > 0 ? "+" : fila.neto < 0 ? "−" : "";
  return (
    <li className="sala-ranking__fila">
      <span className={`sala-ranking__pos sala-ranking__pos--${posicion}`}>{posicion}</span>
      <span className="sala-ranking__nombre">{yo ? "Tú" : fila.apodo}</span>
      <span className={`sala-ranking__valor ${fila.neto > 0 ? "sala-sube" : fila.neto < 0 ? "sala-baja" : ""}`}>
        {signo}
        {miles(Math.abs(fila.neto))}
      </span>
    </li>
  );
}

function Esqueleto() {
  return (
    <div className="sala-esqueletos" aria-hidden="true">
      <div className="sala-esqueleto sala-esqueleto--pastillas" />
      <div className="sala-esqueleto sala-esqueleto--mesa" />
      <div className="sala-esqueleto sala-esqueleto--mesa" />
      <div className="sala-esqueleto sala-esqueleto--ranking" />
    </div>
  );
}

/** La sala de la partida: quién hay, las mesas con su estado, los tres mejores de la noche y la barra de navegación. */
export function Sala({ codigo }: { codigo: string }) {
  const { sala } = usePartida();
  const [invitando, setInvitando] = useState(false);

  return (
    <main className="sala">
      <Reconectando />
      <div className="sala__columna">
        <header className="sala__cabecera aparece">
          <h1 className="marca__logo sala__logo">La Timba</h1>
          <button type="button" className="sala-codigo" aria-label={`Invitar amigos. Código ${codigo}`} aria-haspopup="dialog" onClick={() => setInvitando(true)}>
            <IconoQr />
            <span>{codigo}</span>
          </button>
        </header>

        <div className="aparece" style={retardo(80)}>
          <Saludo />
        </div>

        {sala === null ? (
          <Esqueleto />
        ) : (
          <>
            <div className="aparece" style={retardo(140)}>
              <EnLaSala conectados={sala.conectados} />
            </div>

            <section className="aparece" style={retardo(200)} aria-labelledby="sala-mesas">
              <h2 className="sala-etiqueta" id="sala-mesas">
                Mesas
              </h2>
              <div className="sala-mesas">
                <TarjetaMesa juego="blackjack" resumen={sala.mesas.blackjack} />
                <TarjetaMesa juego="carrera" resumen={sala.mesas.carrera} />
                <TarjetaMesa juego="poker" resumen={sala.mesas.poker} />
              </div>
            </section>

            <section className="aparece" style={retardo(260)} aria-labelledby="sala-noche">
              <h2 className="sala-etiqueta" id="sala-noche">
                Esta noche
              </h2>
              {sala.rankingNoche.length === 0 ? (
                <p className="sala-vacio">Aún no ha jugado nadie. Las ganancias de esta partida aparecen aquí.</p>
              ) : (
                <ol className="sala-ranking" aria-label="Ranking de esta noche">
                  {sala.rankingNoche.slice(0, PUESTOS).map((fila, i) => (
                    <PuestoNoche key={fila.apodo} posicion={i + 1} fila={fila} />
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </div>

      <Navegacion activa="sala" codigo={codigo} />
      {invitando && <Invitar codigo={codigo} onCerrar={() => setInvitando(false)} />}
    </main>
  );
}
