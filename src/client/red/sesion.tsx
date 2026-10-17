import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { JugadorPublico } from "../../shared/api";
import { api, ErrorApi } from "./api";
import { guardarToken, leerToken } from "./token";

export interface Sesion {
  token: string | null;
  jugador: JugadorPublico | null;
  /** Hay token guardado y aún no se sabe quién es: el servidor no ha respondido a `GET /api/yo`. */
  cargando: boolean;
  entrar(token: string, jugador: JugadorPublico): void;
  salir(): void;
  /** Vuelve a leer el jugador (sus fichas) del servidor. Si el token ya no vale, cierra la sesión. */
  refrescar(): Promise<void>;
}

const ContextoSesion = createContext<Sesion | null>(null);

export function SesionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(leerToken);
  const [jugador, setJugador] = useState<JugadorPublico | null>(null);
  const [cargando, setCargando] = useState(() => leerToken() !== null);

  const entrar = useCallback((nuevoToken: string, nuevoJugador: JugadorPublico) => {
    guardarToken(nuevoToken);
    setToken(nuevoToken);
    setJugador(nuevoJugador);
    setCargando(false);
  }, []);

  const salir = useCallback(() => {
    guardarToken(null);
    setToken(null);
    setJugador(null);
    setCargando(false);
  }, []);

  const refrescar = useCallback(async () => {
    const consultado = leerToken();
    if (consultado === null) return;
    try {
      const { id, apodo, fichas } = await api.yo();
      // Si mientras tanto se salió o se entró con otro perfil, esta respuesta ya no es de la sesión actual.
      if (leerToken() === consultado) setJugador({ id, apodo, fichas });
    } catch (e) {
      if (e instanceof ErrorApi && e.status === 401) {
        if (leerToken() === consultado) salir();
        return;
      }
      throw e;
    }
  }, [salir]);

  useEffect(() => {
    if (leerToken() === null) return;
    // Un fallo que no sea 401 (servidor caído, sin red) deja el token guardado: al recargar se reintenta.
    refrescar()
      .catch(() => {})
      .finally(() => setCargando(false));
  }, [refrescar]);

  const valor = useMemo(() => ({ token, jugador, cargando, entrar, salir, refrescar }), [token, jugador, cargando, entrar, salir, refrescar]);
  return <ContextoSesion.Provider value={valor}>{children}</ContextoSesion.Provider>;
}

export function useSesion(): Sesion {
  const sesion = useContext(ContextoSesion);
  if (sesion === null) throw new Error("useSesion debe usarse dentro de <SesionProvider>");
  return sesion;
}
