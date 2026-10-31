import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// Primero lo compartido; después, un archivo por pantalla o componente (las reglas posteriores ganan a las anteriores).
import "./tema/base.css";
import "./tema/marca.css";
import "./tema/fichas.css";
import "./tema/avatar.css";
import "./tema/entrada.css";
import "./tema/inicio.css";
import "./tema/navegacion.css";
import "./tema/reconectando.css";
import "./tema/sala.css";
import "./tema/invitar.css";
import "./tema/ranking.css";
import "./tema/perfil.css";
import "./tema/naipe.css";
import "./tema/temporizador.css";
import "./tema/destellos.css";
import "./tema/confirmar.css";
import "./tema/barra-mesa.css";
import "./tema/marco-mesa.css";
import "./tema/girar-movil.css";
import "./tema/estado-mesa.css";
import "./tema/fichas-apuesta.css";
import "./tema/casilla-apuesta.css";
import "./tema/fichas-volando.css";
import "./tema/cartel-premio.css";
import "./tema/aviso-mesa.css";
import "./tema/resultado.css";
import "./tema/mesa-blackjack.css";
import "./tema/mesa-carrera.css";
import "./tema/mesa-carrera-caballos.css";
import "./tema/mesa-carrera-carta.css";
import "./tema/mesa-carrera-apuestas.css";
import "./tema/mesa-carrera-ordenador.css";
import "./tema/mesa-poker.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
