import { useEffect, useState } from "react";
import { Redirect, Route, Switch } from "wouter";
import { Aviso } from "./componentes/Aviso";
import { Boton } from "./componentes/Boton";
import { Cargando } from "./componentes/Cargando";
import { Entrada } from "./pantallas/Entrada";
import { Inicio } from "./pantallas/Inicio";
import { MesaBlackjack } from "./pantallas/MesaBlackjack";
import { MesaCarrera } from "./pantallas/MesaCarrera";
import { MesaPoker } from "./pantallas/MesaPoker";
import { Perfil } from "./pantallas/Perfil";
import { Ranking } from "./pantallas/Ranking";
import { Sala } from "./pantallas/Sala";
import { PartidaProvider } from "./red/usePartida";
import { SesionProvider, useSesion } from "./red/sesion";
import { recordarPartida } from "./red/ultimaPartida";

export function App() {
  return (
    <SesionProvider>
      <Pantallas />
    </SesionProvider>
  );
}

function Pantallas() {
  const { jugador, cargando, fallo } = useSesion();
  if (cargando) return <Cargando />;
  // Sin sesión, cualquier dirección (p. ej. /p/KXP4) enseña la entrada; al entrar, esa misma dirección pasa a mostrar su pantalla.
  // Si hay un token guardado pero el servidor no contesta, no se pide entrar de nuevo: se avisa y se deja reintentar.
  if (jugador === null) return fallo === null ? <Entrada /> : <NoDisponible />;
  return (
    <Switch>
      <Route path="/" component={Inicio} />
      <Route path="/p/:codigo" nest>
        {({ codigo }) => <LayoutPartida codigo={codigo.toUpperCase()} />}
      </Route>
      <Route path="/ranking" component={Ranking} />
      <Route path="/perfil" component={Perfil} />
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  );
}

/**
 * Todo lo que cuelga de `/p/:codigo`: el socket de la sala (`PartidaProvider`) se mantiene abierto al ir de la sala a una mesa y
 * de una mesa a otra; cada mesa abre además el suyo. Las rutas de dentro son relativas a `/p/:codigo`. El código se escribe en mayúsculas aunque el enlace venga en minúsculas.
 */
function LayoutPartida({ codigo }: { codigo: string }) {
  // El «Sala» del ranking y del perfil vuelve a la última partida visitada en esta pestaña.
  useEffect(() => recordarPartida(codigo), [codigo]);
  return (
    <PartidaProvider key={codigo} codigo={codigo}>
      <Switch>
        <Route path="/">
          <Sala codigo={codigo} />
        </Route>
        <Route path="/blackjack">
          <MesaBlackjack codigo={codigo} />
        </Route>
        <Route path="/carrera">
          <MesaCarrera codigo={codigo} />
        </Route>
        <Route path="/poker">
          <MesaPoker codigo={codigo} />
        </Route>
        <Route>
          <Redirect to="/" replace />
        </Route>
      </Switch>
    </PartidaProvider>
  );
}

function NoDisponible() {
  const { fallo, refrescar } = useSesion();
  const [reintentando, setReintentando] = useState(false);
  async function reintentar() {
    setReintentando(true);
    await refrescar();
    setReintentando(false);
  }
  return (
    <main className="pantalla pantalla--entrada">
      <h1 className="marca__logo aparece">La Timba</h1>
      <section className="panel aparece">
        <Aviso>{fallo}</Aviso>
        <Boton ancho cargando={reintentando} onClick={reintentar}>
          Reintentar
        </Boton>
      </section>
    </main>
  );
}
