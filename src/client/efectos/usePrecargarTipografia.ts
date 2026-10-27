import { useEffect } from "react";

/** Lo que se escribe con ese peso en las mesas: «¡Ganas +1.250!» y «¡Gana el caballo de tréboles!» (basta para elegir el subconjunto latino). */
const TEXTO = "¡Ganas +0123456789.! Gana el caballo de corazones diamantes tréboles picas";

/**
 * Pide al entrar en una mesa la tipografía grande del premio y del ganador (Playfair Display 800). El navegador solo descarga una
 * fuente cuando algo la usa, y en la carrera eso ocurre al llegar el ganador: a media animación, con la red lenta el cartel salía en
 * la fuente de reserva y cambiaba de letra de golpe, y su primer pintado caía en el momento más cargado de la mesa.
 */
export function usePrecargarTipografia(): void {
  useEffect(() => {
    void document.fonts?.load('800 3rem "Playfair Display"', TEXTO).catch(() => {});
  }, []);
}
