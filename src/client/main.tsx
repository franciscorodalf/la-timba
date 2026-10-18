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
import "./tema/pendiente.css";
import "./tema/naipe.css";
import "./tema/temporizador.css";
import "./tema/destellos.css";
import "./tema/confirmar.css";
import "./tema/barra-mesa.css";
import "./tema/mesa-blackjack.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
