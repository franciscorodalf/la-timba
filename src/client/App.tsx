import { Redirect, Route, Switch } from "wouter";
import { Boton } from "./componentes/Boton";
import { miles } from "./formato";
import { Entrada } from "./pantallas/Entrada";
import { SesionProvider, useSesion } from "./red/sesion";

export function App() {
  return (
    <SesionProvider>
      <Pantallas />
    </SesionProvider>
  );
}

function Pantallas() {
  const { jugador, cargando } = useSesion();
  if (cargando) return <Cargando />;
  // Sin sesión, cualquier dirección (p. ej. /p/KXP4) enseña la entrada; al entrar, esa misma dirección pasa a mostrar su pantalla.
  if (jugador === null) return <Entrada />;
  return (
    <Switch>
      <Route path="/" component={Inicio} />
      <Route path="/p/:codigo">
        <Pendiente nombre="Sala" />
      </Route>
      <Route path="/p/:codigo/blackjack">
        <Pendiente nombre="Blackjack" />
      </Route>
      <Route path="/p/:codigo/carrera">
        <Pendiente nombre="Carrera" />
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

function Cargando() {
  return (
    <main className="pantalla" aria-busy="true">
      <div className="giro" role="status" aria-label="Cargando" />
    </main>
  );
}

// Pantalla provisional: la sustituye el Inicio de verdad (Task 13).
function Inicio() {
  const { jugador, salir } = useSesion();
  return (
    <main className="pantalla">
      <header className="cabecera">
        <h1 className="cabecera__logo">La Timba</h1>
        <Boton variante="secundario" onClick={salir}>
          Salir
        </Boton>
      </header>
      <p className="saludo">
        Hola, tienes <b>{miles(jugador?.fichas ?? 0)}</b> fichas
      </p>
    </main>
  );
}

// Pantallas que aún no existen: sus rutas ya están, cada tarea reemplaza la suya.
function Pendiente({ nombre }: { nombre: string }) {
  return (
    <main className="pantalla">
      <h1 className="cabecera__logo">{nombre}</h1>
      <p className="saludo">Esta pantalla llega pronto.</p>
    </main>
  );
}
