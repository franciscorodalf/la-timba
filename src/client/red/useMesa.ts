import { usePartySocket } from "partysocket/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { MensajeMesa } from "../../shared/api";
import type { CodigoError, Evento } from "../../shared/juegos/tipos";
import { registrarHoraServidor } from "./reloj";
import { leerToken } from "./token";

/** Cierre de quien no consigue asiento (mesa llena): no tiene sentido reintentar. */
const CIERRE_SIN_ASIENTO = 4003;
/** Cierre de una conexión sin identidad: tampoco se arregla reintentando. */
const CIERRE_NO_AUTENTICADO = 4401;
/** Lo que dura a la vista un error de la mesa (salvo «mesa llena», que se queda). */
const ERROR_MS = 4_000;

/** El lote antes del primer mensaje. */
export const SIN_EVENTOS: Evento[] = [];

/** Lo último que se sabe de la mesa: la vista del jugador, los eventos aún sin pintar y cuántos mensajes van. */
export interface Recibido<V> {
  vista: V | null;
  lote: Evento[];
  n: number;
}

/**
 * El estado tras un mensaje nuevo: su vista sustituye a la anterior (cada mensaje la trae completa) y sus eventos forman el
 * lote nuevo. Si el mensaje anterior aún no se había pintado (`pintado` es el `n` del último pintado; React juntó los dos
 * mensajes en un solo pintado), sus eventos se conservan delante: ninguno se queda sin animar.
 */
export function recibir<V>(previo: Recibido<V>, vista: V, eventos: Evento[], pintado: number): Recibido<V> {
  const lote = previo.n !== pintado ? [...previo.lote, ...eventos] : eventos;
  return { vista, lote, n: previo.n + 1 };
}

const esObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null && !Array.isArray(valor);

/** El mensaje de mesa dentro de un frame del socket, o `null` si no es JSON o no tiene la forma de `MensajeMesa`. */
export function leerMensajeMesa(datos: unknown): MensajeMesa<unknown> | null {
  if (typeof datos !== "string") return null;
  let mensaje: unknown;
  try {
    mensaje = JSON.parse(datos);
  } catch {
    return null;
  }
  if (!esObjeto(mensaje)) return null;
  if (mensaje.t === "error") return typeof mensaje.codigo === "string" ? (mensaje as MensajeMesa<unknown>) : null;
  if (mensaje.t !== "estado" || typeof mensaje.version !== "number" || typeof mensaje.ahora !== "number" || !esObjeto(mensaje.vista)) return null;
  if (!Array.isArray(mensaje.eventos) || !mensaje.eventos.every((e) => esObjeto(e) && typeof e.tipo === "string")) return null;
  return mensaje as MensajeMesa<unknown>;
}

export interface Mesa<V, A> {
  /** La vista de este jugador según el último mensaje; `null` hasta el primero. Se conserva mientras se reconecta. */
  vista: V | null;
  /** Los eventos del último mensaje (o de los últimos, si llegaron juntos), en orden: lo que hay que animar. */
  lote: Evento[];
  /** Manda una acción si el socket está abierto. Sin conexión se descarta: no se encola para cuando vuelva. */
  enviar(accion: A): void;
  /** El último error de la mesa durante unos segundos (`demasiados_mensajes` no se cuenta). `mesa_llena` se queda. */
  error: CodigoError | null;
  /** La acción (su `t`) a la que responde `error`; `null` si no responde a ninguna tuya (p. ej. al llegar a la mesa). */
  errorDe: string | null;
  /** El socket de la mesa está abierto ahora mismo. */
  conectado: boolean;
}

/**
 * Conexión con una mesa de la partida `codigo` (`/parties/<party>/<codigo>`). No supone que el primer mensaje sea la foto
 * inicial: cada `estado` trae la vista completa y sus eventos. Cada mensaje pone al día la hora del servidor.
 */
export function useMesa<V, A extends { t: string }>(party: "mesa-blackjack" | "mesa-carrera", codigo: string): Mesa<V, A> {
  const [recibido, setRecibido] = useState<Recibido<V>>({ vista: null, lote: SIN_EVENTOS, n: 0 });
  const pintado = useRef(0);
  useLayoutEffect(() => {
    pintado.current = recibido.n;
  }, [recibido.n]);

  const [error, setError] = useState<CodigoError | null>(null);
  const [errorDe, setErrorDe] = useState<string | null>(null);
  /** La última acción mandada a la que aún no ha respondido un error: el siguiente error es de ella. */
  const enVuelo = useRef<string | null>(null);
  const [conectado, setConectado] = useState(false);
  const [llena, setLlena] = useState(false);
  const borrado = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(borrado.current), []);

  const avisar = useCallback((codigoError: CodigoError) => {
    clearTimeout(borrado.current);
    setErrorDe(enVuelo.current);
    enVuelo.current = null;
    setError(codigoError);
    if (codigoError !== "mesa_llena") borrado.current = setTimeout(() => setError(null), ERROR_MS);
  }, []);

  const socket = usePartySocket({
    party,
    room: codigo,
    // Cada intento lee el token del momento: el Worker lo valida en el apretón de manos.
    query: () => ({ token: leerToken() }),
    enabled: !llena,
    shouldReconnectOnClose: (evento) => evento.code !== CIERRE_SIN_ASIENTO && evento.code !== CIERRE_NO_AUTENTICADO,
    onOpen: () => {
      // Lo que se mandó antes de caerse la conexión ya no tiene respuesta: un error al llegar es de la llegada.
      enVuelo.current = null;
      setConectado(true);
    },
    onClose: (evento) => {
      setConectado(false);
      if (evento.code === CIERRE_SIN_ASIENTO) {
        setLlena(true);
        avisar("mesa_llena");
      }
    },
    onMessage: (evento) => {
      const mensaje = leerMensajeMesa(evento.data);
      if (mensaje === null) return;
      if (mensaje.t === "error") {
        if (mensaje.codigo !== "demasiados_mensajes") avisar(mensaje.codigo);
        return;
      }
      registrarHoraServidor(mensaje.ahora);
      setRecibido((previo) => recibir(previo, mensaje.vista as V, mensaje.eventos, pintado.current));
    },
  });

  const enviar = useCallback(
    (accion: A) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      clearTimeout(borrado.current);
      setError((actual) => (actual === "mesa_llena" ? actual : null));
      enVuelo.current = accion.t;
      socket.send(JSON.stringify(accion));
    },
    [socket],
  );

  return { vista: recibido.vista, lote: recibido.lote, enviar, error, errorDe, conectado };
}
