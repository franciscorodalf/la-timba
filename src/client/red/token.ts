// El token de sesión vive en localStorage (clave `timba.token`). Con el almacenamiento bloqueado (ventana privada,
// datos de sitio desactivados) la sesión dura lo que dure la pestaña, guardada en memoria.

const CLAVE = "timba.token";

let enMemoria: string | null = null;

export function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return enMemoria;
  }
}

export function guardarToken(token: string | null): void {
  enMemoria = token;
  try {
    if (token === null) localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, token);
  } catch {
    // Sin almacenamiento: queda el valor en memoria.
  }
}
