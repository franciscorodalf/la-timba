// El token de sesión se guarda en localStorage (clave `timba.token`) para sobrevivir a recargas y compartirse entre pestañas.
// La copia en memoria es la que manda: se carga una vez al arrancar y la actualizan `guardarToken` y los cambios de otras
// pestañas. Así, si el almacenamiento falla (ventana privada, cuota, datos de sitio desactivados) la sesión dura lo que la pestaña.

const CLAVE = "timba.token";

function leerAlmacen(): string | null {
  try {
    return localStorage.getItem(CLAVE);
  } catch {
    return null;
  }
}

let actual: string | null = leerAlmacen();

export const leerToken = (): string | null => actual;

export function guardarToken(token: string | null): void {
  actual = token;
  try {
    if (token === null) localStorage.removeItem(CLAVE);
    else localStorage.setItem(CLAVE, token);
  } catch {
    // Sin almacenamiento: queda la copia en memoria.
  }
}

/**
 * Avisa cuando otra pestaña inicia o cierra sesión (evento `storage`), con el token nuevo o `null`. Cuando se avisa,
 * `leerToken()` ya devuelve el valor nuevo. Devuelve la función para dejar de escuchar.
 */
export function alCambiarToken(avisar: (token: string | null) => void): () => void {
  const escuchar = (evento: StorageEvent) => {
    if (evento.key !== null && evento.key !== CLAVE) return; // `key` es null cuando otra pestaña vacía todo el almacenamiento
    const nuevo = leerAlmacen();
    if (nuevo === actual) return;
    actual = nuevo;
    avisar(nuevo);
  };
  window.addEventListener("storage", escuchar);
  return () => window.removeEventListener("storage", escuchar);
}
