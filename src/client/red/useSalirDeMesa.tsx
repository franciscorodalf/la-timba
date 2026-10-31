import { type ReactNode, useState } from "react";
import { useLocation } from "wouter";
import { Confirmar } from "../componentes/Confirmar";

interface Opciones {
  /** La partida a la que se vuelve. */
  codigo: string;
  enviar(accion: { t: "salir" }): void;
  /** Hay una apuesta tuya en juego: salir ahora la pierde. */
  apuestaEnJuego: boolean;
  /** Lo que se pierde al salir, si no es solo «tu apuesta» (por ejemplo, con un seguro cogido). */
  perdidas?: string;
}

/**
 * «← Sala», igual en todas las mesas: con una apuesta en juego pregunta antes (`dialogo` hay que pintarlo) y, sin ella o al
 * aceptar, manda `salir` (libera el asiento al momento) y vuelve a la sala.
 */
export function useSalirDeMesa({ codigo, enviar, apuestaEnJuego, perdidas = "tu apuesta" }: Opciones): { alVolver(): void; dialogo: ReactNode } {
  const [, navegar] = useLocation();
  const [confirmando, setConfirmando] = useState(false);
  const salir = () => {
    enviar({ t: "salir" });
    navegar(`~/p/${codigo}`);
  };
  const dialogo = confirmando ? (
    <Confirmar titulo="¿Salir de la mesa?" texto={`Si sales ahora pierdes ${perdidas}`} aceptar="Salir" cancelar="Seguir jugando" onAceptar={salir} onCancelar={() => setConfirmando(false)} />
  ) : null;
  return { alVolver: () => (apuestaEnJuego ? setConfirmando(true) : salir()), dialogo };
}
