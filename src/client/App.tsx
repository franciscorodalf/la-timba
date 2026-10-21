import { useState } from "react";
import { Link, Redirect, Route, Switch } from "wouter";
import { Aviso } from "./componentes/Aviso";
import { Boton } from "./componentes/Boton";
import { Cargando } from "./componentes/Cargando";
import { Entrada } from "./pantallas/Entrada";
import { Inicio } from "./pantallas/Inicio";
import { MesaBlackjack } from "./pantallas/MesaBlackjack";
import { MesaCarrera } from "./pantallas/MesaCarrera";
import { Sala } from "./pantallas/Sala";
import { PartidaProvider } from "./red/usePartida";
import { SesionProvider, useSesion } from "./red/sesion";

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
      <Route path="/ranking">
        <Pendiente nombre="Ranking" />
      </Route>
      <Route path="/perfil">
        <Pendiente nombre="Perfil" />
      </Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  );
}

/**
 * Todo lo que cuelga de `/p/:codigo`: la sala y las mesas comparten el mismo socket de sala, que no se cierra al ir de una a
 * otra. Las rutas de dentro son relativas a `/p/:codigo`. El código se escribe en mayúsculas aunque el enlace venga en minúsculas.
 */
function LayoutPartida({ codigo }: { codigo: string }) {
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

// Pantallas que aún no existen: sus rutas ya están, cada tarea reemplaza la suya.
function Pendiente({ nombre }: { nombre: string }) {
  return (
    <main className="pantalla">
      <h1 className="cabecera__logo">{nombre}</h1>
      <p className="saludo">Esta pantalla llega pronto.</p>
      <Link href="/" className="boton boton--secundario">
        Volver
      </Link>
    </main>
  );
}
