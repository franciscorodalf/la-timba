import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { JugadorPublico } from "../../shared/api";
import { alSesionInvalida, api, ErrorApi, mensajeError } from "./api";
import { alCambiarToken, guardarToken, leerToken } from "./token";
import { olvidarUltimaPartida } from "./ultimaPartida";

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
   * Comprueba la sesión con el servidor (`GET /api/yo`, el perfil entero): al abrir la app y al reintentar. Devuelve `true`
   * si el servidor la confirma y `false` si el token ya no vale (la sesión se cierra) o si no se pudo comprobar (queda en
   * `fallo`). Nunca rechaza: vale `void refrescar()`.
   */
  refrescar(): Promise<boolean>;
  /**
   * Vuelve a leer solo las fichas (`GET /api/fichas`, una fila): lo que necesitan las mesas, la sala y el inicio. Un 401
   * cierra la sesión; cualquier otro fallo deja el contador como estaba hasta la siguiente. Nunca rechaza.
   */
  refrescarFichas(): Promise<void>;
  /** Pone las fichas que ya trae otra respuesta (el perfil, el rescate), sin pedirlas otra vez. */
  fijarFichas(fichas: number): void;
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

  // También cubre los cierres por un 401 (token caducado): la partida de esta pestaña no sobrevive a la sesión.
  const salir = useCallback(() => {
    guardarToken(null);
    olvidarUltimaPartida();
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

  const fijarFichas = useCallback((fichas: number) => {
    setJugador((actual) => (actual === null || actual.fichas === fichas ? actual : { ...actual, fichas }));
  }, []);

  const refrescarFichas = useCallback(async () => {
    const consultado = leerToken();
    if (consultado === null) return;
    try {
      const { fichas } = await api.fichas();
      // Si mientras tanto se salió o se entró con otro perfil, esta respuesta ya no es de la sesión actual.
      if (leerToken() === consultado) fijarFichas(fichas);
    } catch {
      // El 401 ya cierra la sesión (`alSesionInvalida`); sin red o con el servidor caído, el contador espera a la siguiente.
    }
  }, [fijarFichas]);

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

  const valor = useMemo(
    () => ({ token, jugador, cargando, fallo, entrar, salir, refrescar, refrescarFichas, fijarFichas }),
    [token, jugador, cargando, fallo, entrar, salir, refrescar, refrescarFichas, fijarFichas],
  );
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): Sesion {
  const sesion = useContext(ContextoSesion);
  if (sesion === null) throw new Error("useSesion debe usarse dentro de <SesionProvider>");
  return sesion;
}
