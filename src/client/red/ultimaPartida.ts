// La última partida que se visitó en esta pestaña (sessionStorage, clave `timba.partida`): el «Sala» del ranking y del perfil
// vuelve a ella, para mirar el ranking a mitad de la noche y regresar con un toque. Si el almacenamiento falla (datos de
// sitio bloqueados) dura lo que la página, en una copia en memoria.

const CLAVE = "timba.partida";
const CODIGO = /^[A-Z0-9]{4}$/;

let enMemoria: string | null = null;

/** El código de la última partida visitada, o `null` si no hay ninguna (o lo guardado no es un código). */
export function ultimaPartida(): string | null {
  let guardado: string | null;
  try {
    guardado = sessionStorage.getItem(CLAVE);
  } catch {
    guardado = enMemoria;
  }
  return guardado !== null && CODIGO.test(guardado) ? guardado : null;
}

export function recordarPartida(codigo: string): void {
  enMemoria = codigo;
  try {
    sessionStorage.setItem(CLAVE, codigo);
  } catch {
    // Sin almacenamiento: queda la copia en memoria.
  }
}

/** Olvida la partida `codigo` (por ejemplo, porque ya no existe); si la última es otra, no la toca. */
export function olvidarPartida(codigo: string): void {
  if (enMemoria === codigo) enMemoria = null;
  try {
    if (sessionStorage.getItem(CLAVE) === codigo) sessionStorage.removeItem(CLAVE);
  } catch {
    // Sin almacenamiento: ya está olvidada en memoria.
  }
}
