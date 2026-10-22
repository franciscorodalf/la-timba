import { usePartySocket } from "partysocket/react";
import { createContext, createElement, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { MensajeSala } from "../../shared/api";
import { Cargando } from "../componentes/Cargando";
import { PartidaInexistente, PartidaSinRespuesta } from "../pantallas/PartidaNoDisponible";
import { api, mensajeError } from "./api";
import { registrarHoraServidor } from "./reloj";
import { useSesion } from "./sesion";
import { leerToken } from "./token";
import { olvidarPartida } from "./ultimaPartida";

export interface EstadoPartida {
  /** Lo último que mandó la sala; `null` hasta que llega el primer mensaje. Se conserva mientras se reconecta. */
  sala: MensajeSala | null;
  /** El socket de la sala está abierto ahora mismo. */
  conectado: boolean;
}

const ContextoPartida = createContext<EstadoPartida | null>(null);

/** La sala de la partida en curso. Solo dentro de `<PartidaProvider>`. */
export function usePartida(): EstadoPartida {
  const partida = useContext(ContextoPartida);
  if (partida === null) throw new Error("usePartida debe usarse dentro de <PartidaProvider>");
  return partida;
}

/** El mensaje de sala dentro de un frame del socket, o `null` si no es JSON o no tiene la forma de `MensajeSala`. */
export function leerMensajeSala(datos: unknown): MensajeSala | null {
  if (typeof datos !== "string") return null;
  let mensaje: unknown;
  try {
    mensaje = JSON.parse(datos);
  } catch {
    return null;
  }
  const esObjeto = (valor: unknown): valor is Record<string, any> => typeof valor === "object" && valor !== null;
  if (!esObjeto(mensaje) || mensaje.t !== "sala" || typeof mensaje.codigo !== "string" || typeof mensaje.ahora !== "number") return null;
  if (!Array.isArray(mensaje.conectados) || !Array.isArray(mensaje.rankingNoche)) return null;
  if (!esObjeto(mensaje.mesas) || !esObjeto(mensaje.mesas.blackjack) || !esObjeto(mensaje.mesas.carrera)) return null;
  return mensaje as unknown as MensajeSala;
}

/** Mantiene abierto el socket de la sala y reparte lo que llega. Solo existe mientras la partida existe. */
function ConexionSala({ codigo, alCerrarse, children }: { codigo: string; alCerrarse: () => void; children: ReactNode }) {
  const [sala, setSala] = useState<MensajeSala | null>(null);
  const [conectado, setConectado] = useState(false);
  // Declarado antes que el socket: al desmontar, esto se apaga antes de que el socket se cierre y no se confunde con una caída.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  usePartySocket({
    party: "partida",
    room: codigo,
    // Cada intento de conexión lee el token del momento: el Worker lo valida en el apretón de manos.
    query: () => ({ token: leerToken() }),
    onOpen: () => setConectado(true),
    onClose: () => {
      setConectado(false);
      if (montado.current) alCerrarse();
    },
    onMessage: (evento) => {
      const mensaje = leerMensajeSala(evento.data);
      if (mensaje === null) return;
      registrarHoraServidor(mensaje.ahora);
      setSala(mensaje);
    },
  });

  const valor = useMemo(() => ({ sala, conectado }), [sala, conectado]);
  return createElement(ContextoPartida.Provider, { value: valor }, children);
}

type Existencia = { estado: "comprobando" } | { estado: "existe" } | { estado: "no_existe" } | { estado: "fallo"; mensaje: string };

/**
 * Mantiene abierto el socket de la sala de la partida `codigo` mientras haya algo montado dentro (la sala y, más adelante, las
 * mesas): al ir de una pantalla a otra de la misma partida no se reconecta. Antes de abrirlo comprueba que la partida existe,
 * porque `partysocket` reintentaría para siempre una conexión que el servidor rechaza con un 404. Si no existe, o no se puede
 * comprobar, muestra su propia pantalla en lugar de `children`.
 */
export function PartidaProvider({ codigo, children }: { codigo: string; children: ReactNode }) {
  const { refrescar } = useSesion();
  const [existencia, setExistencia] = useState<Existencia>({ estado: "comprobando" });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setExistencia((anterior) => (anterior.estado === "comprobando" ? anterior : { estado: "comprobando" }));
    api.existePartida(codigo).then(
      ({ existe }) => vigente && setExistencia({ estado: existe ? "existe" : "no_existe" }),
      (e) => vigente && setExistencia({ estado: "fallo", mensaje: mensajeError(e) }),
    );
    return () => {
      vigente = false;
    };
  }, [codigo, intento]);

  // Una partida que no existe no es a la que volver desde el «Sala» del ranking y del perfil.
  useEffect(() => {
    if (existencia.estado === "no_existe") olvidarPartida(codigo);
  }, [existencia.estado, codigo]);

  // Se perdió la conexión y hay que saber si merece la pena reintentarla:
  // - Si la partida se cerró mientras tanto (30 min sin nadie), el servidor la rechazará siempre: se deja de reintentar.
  // - Si el token caducó o se rotó, también la rechazará siempre, y la consulta de existencia no lo delata porque no lleva
  //   token: `refrescar` sí (su 401 cierra la sesión y se vuelve a la entrada).
  // Si no se puede saber (sin red), el socket sigue reintentando por su cuenta y se vuelve a comprobar en la siguiente caída.
  const comprobando = useRef(false);
  const alCerrarse = useCallback(async () => {
    if (comprobando.current) return;
    comprobando.current = true;
    try {
      const [existe] = await Promise.all([
        api.existePartida(codigo).then(({ existe }) => existe, () => true),
        refrescar(),
      ]);
      if (!existe) setExistencia({ estado: "no_existe" });
    } finally {
      comprobando.current = false;
    }
  }, [codigo, refrescar]);

  switch (existencia.estado) {
    case "comprobando":
      return createElement(Cargando);
    case "no_existe":
      return createElement(PartidaInexistente);
    case "fallo":
      return createElement(PartidaSinRespuesta, { mensaje: existencia.mensaje, onReintentar: () => setIntento((n) => n + 1) });
    case "existe":
      return createElement(ConexionSala, { codigo, alCerrarse, children });
  }
}
