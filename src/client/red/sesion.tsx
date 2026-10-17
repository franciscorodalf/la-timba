import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { JugadorPublico } from "../../shared/api";
import { alSesionInvalida, api, ErrorApi, mensajeError } from "./api";
import { alCambiarToken, guardarToken, leerToken } from "./token";

export interface Sesion {
  token: string | null;
  jugador: JugadorPublico | null;
  /** Hay token y aún no se sabe quién es: el servidor no ha contestado todavía a `GET /api/yo`. */
  cargando: boolean;
  /** Por qué no se pudo comprobar la sesión guardada (servidor caído, sin red…), con el texto para el jugador. El token se conserva. */
  fallo: string | null;
  entrar(token: string, jugador: JugadorPublico): void;
  salir(): void;
  /**
   * Vuelve a leer el jugador (sus fichas) del servidor. Devuelve `true` si el servidor confirma la sesión y `false` si el token
   * ya no vale (la sesión se cierra) o si no se pudo comprobar (queda en `fallo`). Nunca rechaza: vale `void refrescar()`.
   */
  refrescar(): Promise<boolean>;
}

const ContextoSesion = createContext<Sesion | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  // El token de verdad está en `token.ts`; el estado de React solo lo refleja para repintar.
  const [token, setToken] = useState<string | null>(leerToken);
  const [jugador, setJugador] = useState<JugadorPublico | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  const cargando = token !== null && jugador === null && fallo === null;

  const entrar = useCallback((nuevoToken: string, nuevoJugador: JugadorPublico) => {
    guardarToken(nuevoToken);
    setToken(nuevoToken);
    setJugador(nuevoJugador);
    setFallo(null);
  }, []);

  const salir = useCallback(() => {
    guardarToken(null);
    setToken(null);
    setJugador(null);
    setFallo(null);
  }, []);

  const refrescar = useCallback(async () => {
    const consultado = leerToken();
    if (consultado === null) return false;
    try {
      const { id, apodo, fichas } = await api.yo();
      // Si mientras tanto se salió o se entró con otro perfil, esta respuesta ya no es de la sesión actual.
      if (leerToken() !== consultado) return false;
      setJugador({ id, apodo, fichas });
      setFallo(null);
      return true;
    } catch (e) {
      if (leerToken() !== consultado) return false;
      if (e instanceof ErrorApi && e.status === 401) salir();
      else setFallo(mensajeError(e));
      return false;
    }
  }, [salir]);

  // Cualquier llamada autenticada que el servidor rechace con 401 cierra la sesión (token caducado, secreto rotado…).
  useEffect(
    () =>
      alSesionInvalida((usado) => {
        if (leerToken() === usado) salir();
      }),
    [salir],
  );

  // Otra pestaña inicia o cierra sesión: esta se pone al día con el nuevo token.
  useEffect(
    () =>
      alCambiarToken((nuevo) => {
        setToken(nuevo);
        setJugador(null);
        setFallo(null);
        void refrescar();
      }),
    [refrescar],
  );

  // Al abrir la app con una sesión guardada: averiguar quién es.
  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  const valor = useMemo(() => ({ token, jugador, cargando, fallo, entrar, salir, refrescar }), [token, jugador, cargando, fallo, entrar, salir, refrescar]);
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): Sesion {
  const sesion = useContext(ContextoSesion);
  if (sesion === null) throw new Error("useSesion debe usarse dentro de <SesionProvider>");
  return sesion;
}
