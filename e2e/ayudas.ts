import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { RespuestaSesion } from "../src/shared/api";

/** Un apodo válido (3–16 caracteres) distinto en cada ejecución: el servidor de desarrollo conserva el estado entre ejecuciones. */
export function apodoUnico(): string {
  const azar = Math.random().toString(36).slice(2, 6);
  return `${Date.now().toString(36)}${azar}`.slice(0, 16);
}

/** Registra un jugador por la API y comprueba que el servidor lo crea (201). Devuelve su token y su perfil. */
export async function registrar(request: APIRequestContext, apodo: string, pin: string): Promise<RespuestaSesion> {
  const respuesta = await request.post("/api/registro", { data: { apodo, pin } });
  expect(respuesta.status()).toBe(201);
  return respuesta.json();
}

/** Abre una partida por la API en nombre de un jugador ya registrado y devuelve su código. */
export async function abrirPartida(request: APIRequestContext, { token }: RespuestaSesion): Promise<string> {
  const respuesta = await request.post("/api/partidas", { headers: { Authorization: `Bearer ${token}` } });
  expect(respuesta.status()).toBe(201);
  return (await respuesta.json()).codigo;
}

/** Deja la sesión de ese jugador guardada en el navegador antes de que cargue ninguna página: la app arranca ya dentro. */
export async function conSesion(pagina: Page, { token }: RespuestaSesion): Promise<void> {
  await pagina.addInitScript((t) => localStorage.setItem("timba.token", t), token);
}
