import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import type { IdJuego } from "../../shared/juegos/tipos";
import type { Perfil as DatosPerfil } from "../../shared/api";
import { retardo } from "../animacion";
import { Avatar } from "../componentes/Avatar";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { Contador } from "../componentes/Contador";
import { Ficha } from "../componentes/Ficha";
import { Navegacion } from "../componentes/Navegacion";
import { useDespues } from "../efectos/useDespues";
import { miles, milesConSigno, porcentajeVictorias } from "../formato";
import { api, mensajeError } from "../red/api";
import { useSesion } from "../red/sesion";
import { ultimaPartida } from "../red/ultimaPartida";
import { errorRescate } from "./perfil/rescate";

/** Cuánto se queda el aviso de que el rescate salió bien. */
const AVISO_RESCATE_MS = 6000;

const JUEGOS: { id: IdJuego; nombre: string }[] = [
  { id: "blackjack", nombre: "Blackjack" },
  { id: "carrera", nombre: "Carrera" },
];

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="perfil-dato">
      <dt>{etiqueta}</dt>
      <dd>{valor}</dd>
    </div>
  );
}

function Estadisticas({ perfil }: { perfil: DatosPerfil }) {
  return (
    <>
      <section className="aparece" style={retardo(160)} aria-labelledby="perfil-estadisticas">
        <h2 className="sala-etiqueta" id="perfil-estadisticas">
          Estadísticas
        </h2>
        <dl className="perfil-datos">
          <Dato etiqueta="Rondas jugadas" valor={miles(perfil.partidas)} />
          <Dato etiqueta="Ganancias totales" valor={milesConSigno(perfil.gananciasTotales)} />
          <Dato etiqueta="Mayor premio" valor={miles(perfil.mayorPremio)} />
          <Dato etiqueta="Mejor racha" valor={String(perfil.mejorRacha)} />
          <Dato etiqueta="Racha actual" valor={String(perfil.rachaActual)} />
          <Dato etiqueta="Quiebras" valor={String(perfil.quiebras)} />
        </dl>
      </section>

      <section className="aparece" style={retardo(220)} aria-labelledby="perfil-juegos">
        <h2 className="sala-etiqueta" id="perfil-juegos">
          Por juego
        </h2>
        <div className="perfil-juegos">
          {JUEGOS.map(({ id, nombre }) => {
            const { partidas, victorias } = perfil.porJuego[id];
            return (
              <section className="perfil-juego" key={id} aria-labelledby={`perfil-juego-${id}`}>
                <h3 className="perfil-juego__nombre" id={`perfil-juego-${id}`}>
                  {nombre}
                </h3>
                <dl className="perfil-datos perfil-datos--juego">
                  <Dato etiqueta="Rondas jugadas" valor={miles(partidas)} />
                  <Dato etiqueta="Victorias" valor={miles(victorias)} />
                  <Dato etiqueta="% victorias" valor={porcentajeVictorias(victorias, partidas)} />
                </dl>
              </section>
            );
          })}
        </div>
      </section>
    </>
  );
}

function EsqueletoPerfil() {
  return (
    <div className="perfil-esqueleto" role="status" aria-label="Cargando tu perfil">
      <span className="solo-lectores">Cargando…</span>
      <div className="perfil-esqueleto__bloque perfil-esqueleto__bloque--datos" />
      <div className="perfil-esqueleto__bloque perfil-esqueleto__bloque--juego" />
      <div className="perfil-esqueleto__bloque perfil-esqueleto__bloque--juego" />
    </div>
  );
}

/** Tu perfil: fichas (con el rescate si te quedas a cero), estadísticas generales y por juego, y cerrar sesión. */
export function Perfil() {
  const { jugador, refrescar, salir } = useSesion();
  const [, navegar] = useLocation();
  const despues = useDespues();
  const [partida] = useState(ultimaPartida);
  const [perfil, setPerfil] = useState<DatosPerfil | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const [rescatando, setRescatando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "info" | "error"; texto: string } | null>(null);
  const montado = useRef(true);
  const rescateEnCurso = useRef(false);
  const tarjetaFichas = useRef<HTMLElement>(null);
  const zonaEstadisticas = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const datos = await api.yo();
      if (!montado.current) return;
      setPerfil(datos);
      setFallo(null);
    } catch (e) {
      if (montado.current) setFallo(mensajeError(e));
    }
  }, []);

  // Al entrar: las estadísticas de ahora (lo jugado desde la última vez) y las fichas al día.
  useEffect(() => {
    montado.current = true;
    void cargar();
    void refrescar();
    return () => {
      montado.current = false;
    };
  }, [cargar, refrescar]);

  async function pedirRescate() {
    if (rescateEnCurso.current) return;
    rescateEnCurso.current = true;
    setRescatando(true);
    setAviso(null);
    try {
      const { fichas } = await api.rescate();
      setAviso({ tipo: "info", texto: `Rescate concedido: ya tienes ${miles(fichas)} fichas` });
      despues(AVISO_RESCATE_MS, () => setAviso((actual) => (actual?.tipo === "info" ? null : actual)));
      // El botón se va con las fichas nuevas: el foco se queda en la tarjeta y no se pierde.
      tarjetaFichas.current?.focus({ preventScroll: true });
      await refrescar(); // el contador cuenta de 0 a lo que haya ahora
      void cargar(); // y la quiebra anotada
    } catch (e) {
      const resultado = errorRescate(e);
      if (resultado.tipo === "tiene_fichas") {
        // Ya había fichas (las ganaste en otra pestaña): se pone al día y el botón se va solo, así que el foco pasa a la tarjeta.
        tarjetaFichas.current?.focus({ preventScroll: true });
        await refrescar();
        void cargar();
      } else setAviso({ tipo: "error", texto: resultado.texto });
    } finally {
      rescateEnCurso.current = false;
      if (montado.current) setRescatando(false);
    }
  }

  function cerrarSesion() {
    navegar("/", { replace: true });
    salir();
  }

  const apodo = jugador?.apodo ?? "";
  const sinFichas = jugador?.fichas === 0;

  return (
    <main className="con-navegacion perfil">
      <div className="con-navegacion__columna">
        <header className="perfil-cabecera aparece">
          <Avatar apodo={apodo} />
          <div className="perfil-cabecera__texto">
            <p className="perfil-cabecera__etiqueta">Tu perfil</p>
            <h1 className="perfil-cabecera__apodo">{apodo}</h1>
          </div>
        </header>

        <section className="panel perfil-fichas aparece" style={retardo(80)} aria-labelledby="perfil-fichas" ref={tarjetaFichas} tabIndex={-1}>
          <h2 className="sala-etiqueta" id="perfil-fichas">
            Tus fichas
          </h2>
          <p className="perfil-fichas__total">
            <Ficha tamaño={36} />
            <Contador valor={jugador?.fichas ?? 0} />
          </p>
          {sinFichas && (
            <div className="perfil-rescate">
              <p className="panel__texto">Te has quedado sin fichas. Un rescate te da 200 y suma una quiebra a tu perfil.</p>
              <Boton ancho cargando={rescatando} onClick={pedirRescate}>
                Pedir rescate (+200)
              </Boton>
            </div>
          )}
          {aviso !== null && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
        </section>

        {/* Un sitio fijo al que llevar el foco cuando «Reintentar» desaparece al empezar a cargar. */}
        <div className="perfil-zona" ref={zonaEstadisticas} tabIndex={-1}>
          {perfil !== null ? (
            <Estadisticas perfil={perfil} />
          ) : fallo !== null ? (
            <div className="perfil-fallo">
              <Aviso>{fallo}</Aviso>
              <Boton
                variante="secundario"
                ancho
                onClick={() => {
                  zonaEstadisticas.current?.focus({ preventScroll: true });
                  setFallo(null);
                  void cargar();
                }}
              >
                Reintentar
              </Boton>
            </div>
          ) : (
            <EsqueletoPerfil />
          )}
        </div>

        <Boton variante="secundario" ancho onClick={cerrarSesion}>
          Cerrar sesión
        </Boton>
      </div>

      <Navegacion activa="perfil" codigo={partida ?? undefined} />
    </main>
  );
}
