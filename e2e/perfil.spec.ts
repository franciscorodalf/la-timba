import { expect, type Page, test } from "@playwright/test";
import type { Perfil } from "../src/shared/api";
import { abrirPartida, aplazada, apodoUnico, barra, conSesion, jugadoresFalsos, registrar, sinDesplazamientoHorizontal } from "./ayudas";

/** La lista del ranking de fichas (la pestaña que se abre por defecto). */
const listaDeFichas = (pagina: Page) => pagina.getByRole("list", { name: "Ranking: Fichas" });

// ---------------------------------------------------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------------------------------------------------

const perfilDe = (apodo: string, resto: Partial<Perfil> = {}): Perfil => ({
  id: 1,
  apodo,
  fichas: 1000,
  quiebras: 0,
  rachaActual: 0,
  mejorRacha: 0,
  partidas: 0,
  gananciasTotales: 0,
  mayorPremio: 0,
  porJuego: { blackjack: { partidas: 0, victorias: 0 }, carrera: { partidas: 0, victorias: 0 } },
  ...resto,
});

const estadisticas = (pagina: Page) => pagina.getByRole("region", { name: "Estadísticas" });
const porJuego = (pagina: Page, juego: "Blackjack" | "Carrera") => pagina.getByRole("region", { name: juego, exact: true });
const dato = (zona: ReturnType<Page["locator"]>, etiqueta: string) => zona.locator(".perfil-dato").filter({ has: zona.page().getByText(etiqueta, { exact: true }) }).locator("dd");
const fichasDelPerfil = (pagina: Page) => pagina.locator(".perfil-fichas .contador");
const botonRescate = (pagina: Page) => pagina.getByRole("button", { name: "Pedir rescate (+200)" });

/** `/api/yo` devuelve lo que valga `actual()` en cada petición. */
async function simularPerfil(pagina: Page, actual: () => Perfil): Promise<{ peticiones: () => number }> {
  let peticiones = 0;
  await pagina.route("**/api/yo", (ruta) => {
    peticiones++;
    return ruta.fulfill({ json: actual() });
  });
  return { peticiones: () => peticiones };
}

test.describe("Perfil", () => {
  test("un jugador nuevo: apodo, 1.000 fichas, todo a cero y sin rescate", async ({ page, request }) => {
    const apodo = apodoUnico();
    await conSesion(page, await registrar(request, apodo, "1234"));
    await page.goto("/perfil");

    await expect(page.getByRole("heading", { level: 1, name: apodo })).toBeVisible();
    await expect(fichasDelPerfil(page)).toHaveText("1.000");
    for (const etiqueta of ["Rondas jugadas", "Ganancias totales", "Mayor premio", "Mejor racha", "Racha actual", "Quiebras"]) {
      await expect(dato(estadisticas(page), etiqueta), etiqueta).toHaveText("0");
    }
    for (const juego of ["Blackjack", "Carrera"] as const) {
      await expect(dato(porJuego(page, juego), "Rondas jugadas")).toHaveText("0");
      await expect(dato(porJuego(page, juego), "Victorias")).toHaveText("0");
      await expect(dato(porJuego(page, juego), "% victorias")).toHaveText("—");
    }
    await expect(botonRescate(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    expect(await sinDesplazamientoHorizontal(page)).toBe(true);
  });

  test("enseña las estadísticas generales y por juego, con el menos de verdad en las ganancias negativas", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    await conSesion(page, sesion);
    const datos = perfilDe(sesion.jugador.apodo, {
      id: sesion.jugador.id,
      fichas: 12345,
      quiebras: 2,
      rachaActual: 3,
      mejorRacha: 9,
      partidas: 20,
      gananciasTotales: -1250,
      mayorPremio: 5400,
      porJuego: { blackjack: { partidas: 12, victorias: 8 }, carrera: { partidas: 8, victorias: 1 } },
    });
    await simularPerfil(page, () => datos);
    await page.goto("/perfil");

    await expect(fichasDelPerfil(page)).toHaveText("12.345");
    const general = estadisticas(page);
    await expect(dato(general, "Rondas jugadas")).toHaveText("20");
    await expect(dato(general, "Ganancias totales")).toHaveText("−1.250");
    await expect(dato(general, "Mayor premio")).toHaveText("5.400");
    await expect(dato(general, "Mejor racha")).toHaveText("9");
    await expect(dato(general, "Racha actual")).toHaveText("3");
    await expect(dato(general, "Quiebras")).toHaveText("2");

    await expect(dato(porJuego(page, "Blackjack"), "Rondas jugadas")).toHaveText("12");
    await expect(dato(porJuego(page, "Blackjack"), "Victorias")).toHaveText("8");
    await expect(dato(porJuego(page, "Blackjack"), "% victorias")).toHaveText("67 %");
    await expect(dato(porJuego(page, "Carrera"), "Rondas jugadas")).toHaveText("8");
    await expect(dato(porJuego(page, "Carrera"), "Victorias")).toHaveText("1");
    await expect(dato(porJuego(page, "Carrera"), "% victorias")).toHaveText("13 %");
    await expect(botonRescate(page)).toHaveCount(0);
  });

  test("cada vez que se entra se vuelven a pedir las estadísticas: lo jugado entre medias se ve", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    await conSesion(page, sesion);
    let datos = perfilDe(sesion.jugador.apodo, { id: sesion.jugador.id, partidas: 3 });
    await simularPerfil(page, () => datos);
    await page.goto("/perfil");
    await expect(dato(estadisticas(page), "Rondas jugadas")).toHaveText("3");

    await barra(page).getByRole("link", { name: "Ranking" }).click();
    await expect(page).toHaveURL("/ranking");
    datos = { ...datos, partidas: 5, mayorPremio: 800 };
    await barra(page).getByRole("link", { name: "Perfil" }).click();

    await expect(dato(estadisticas(page), "Rondas jugadas")).toHaveText("5");
    await expect(dato(estadisticas(page), "Mayor premio")).toHaveText("800");
  });

  test("si el perfil no se puede cargar lo dice con «Reintentar»", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    await conSesion(page, sesion);
    const datos = perfilDe(sesion.jugador.apodo, { id: sesion.jugador.id, partidas: 7 });
    let respuesta: "falla" | "bien" = "bien";
    await page.route("**/api/yo", (ruta) =>
      respuesta === "falla" ? ruta.fulfill({ status: 503, json: { error: "descansando" } }) : ruta.fulfill({ json: datos }),
    );
    await page.route(/\/api\/ranking\?/, (ruta) => ruta.fulfill({ json: { top: jugadoresFalsos(3), yo: null } }));
    await page.goto("/ranking");
    await expect(listaDeFichas(page)).toBeVisible();
    respuesta = "falla";
    await barra(page).getByRole("link", { name: "Perfil" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "La Timba está descansando, vuelve mañana" })).toBeVisible();
    await expect(estadisticas(page)).toHaveCount(0);

    respuesta = "bien";
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(dato(estadisticas(page), "Rondas jugadas")).toHaveText("7");
  });

  test("«Reintentar» no deja el foco en el aire: pasa a la zona de las estadísticas mientras carga y al llegar", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    await conSesion(page, sesion);
    const datos = perfilDe(sesion.jugador.apodo, { id: sesion.jugador.id, partidas: 7 });
    let respuesta: "falla" | "bien" | "aplazada" = "bien";
    const llegada = aplazada();
    await page.route("**/api/yo", async (ruta) => {
      if (respuesta === "falla") return ruta.fulfill({ status: 503, json: { error: "descansando" } });
      if (respuesta === "aplazada") await llegada.espera;
      return ruta.fulfill({ json: datos });
    });
    await page.route(/\/api\/ranking\?/, (ruta) => ruta.fulfill({ json: { top: jugadoresFalsos(3), yo: null } }));
    await page.goto("/ranking");
    await expect(listaDeFichas(page)).toBeVisible();
    respuesta = "falla";
    await barra(page).getByRole("link", { name: "Perfil" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "La Timba está descansando, vuelve mañana" })).toBeVisible();

    respuesta = "aplazada";
    await page.getByRole("button", { name: "Reintentar" }).focus();
    await page.keyboard.press("Enter");
    // Mientras carga, el botón ya no está y el foco no se ha ido al cuerpo de la página.
    await expect(page.getByRole("status", { name: "Cargando tu perfil" })).toBeVisible();
    await expect(page.locator(".perfil-zona")).toBeFocused();
    llegada.soltar();
    await expect(dato(estadisticas(page), "Rondas jugadas")).toHaveText("7");
    await expect(page.locator(".perfil-zona")).toBeFocused();
  });

  test("el esqueleto de carga del perfil se anuncia con texto", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    await conSesion(page, sesion);
    const llegada = aplazada();
    let aplazar = false;
    await page.route("**/api/yo", async (ruta) => {
      if (aplazar) await llegada.espera;
      return ruta.fulfill({ json: perfilDe(sesion.jugador.apodo, { id: sesion.jugador.id }) });
    });
    await page.route(/\/api\/ranking\?/, (ruta) => ruta.fulfill({ json: { top: jugadoresFalsos(3), yo: null } }));
    await page.goto("/ranking");
    await expect(listaDeFichas(page)).toBeVisible();
    aplazar = true;
    await barra(page).getByRole("link", { name: "Perfil" }).click();
    await expect(page.getByRole("status", { name: "Cargando tu perfil" })).toContainText("Cargando…");
    llegada.soltar();
    await expect(estadisticas(page)).toBeVisible();
  });

  test("«Cerrar sesión» vuelve a la entrada y borra el token", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await page.goto("/perfil");

    await page.getByRole("button", { name: "Cerrar sesión" }).click();

    await expect(page.getByRole("heading", { name: "Siéntate a la mesa" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("timba.token"))).toBeNull();
    await expect(page).toHaveURL("/");
    await expect(barra(page)).toHaveCount(0);
  });

  test("al cerrar sesión se olvida la última partida de la pestaña: quien entre después no vuelve a la sala del anterior", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    await page.goto(`/p/${codigo}`);
    await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("timba.partida"))).toBe(codigo);

    await barra(page).getByRole("link", { name: "Perfil" }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await expect(page.getByRole("heading", { name: "Siéntate a la mesa" })).toBeVisible();

    expect(await page.evaluate(() => sessionStorage.getItem("timba.partida"))).toBeNull();
  });

  test("si el servidor rechaza el token (sesión caducada) también se olvida la última partida", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    await page.goto(`/p/${codigo}`);
    await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("timba.partida"))).toBe(codigo);

    await barra(page).getByRole("link", { name: "Ranking" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ranking" })).toBeVisible();
    await page.route("**/api/yo", (ruta) => ruta.fulfill({ status: 401, json: { error: "no_autenticado" } }));
    await barra(page).getByRole("link", { name: "Perfil" }).click();

    await expect(page.getByRole("heading", { name: "Siéntate a la mesa" })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem("timba.partida"))).toBeNull();
  });

  test.describe("rescate", () => {
    /** Un jugador con 0 fichas: el servidor de desarrollo da 1.000 a todos, así que `/api/yo` y `/api/rescate` se simulan. */
    async function sinFichas(page: Page, request: Parameters<typeof registrar>[0]) {
      const sesion = await registrar(request, apodoUnico(), "1234");
      await conSesion(page, sesion);
      const estado = { perfil: perfilDe(sesion.jugador.apodo, { id: sesion.jugador.id, fichas: 0, quiebras: 1, partidas: 4 }), rescates: 0 };
      await simularPerfil(page, () => estado.perfil);
      return { sesion, estado };
    }

    test("con 0 fichas ofrece el rescate; al pedirlo las fichas suben contando, se avisa y el botón desaparece", async ({ page, request }) => {
      const { estado } = await sinFichas(page, request);
      const respuesta = aplazada(); // el rescate tarda lo que la prueba quiera: el segundo toque llega con el primero en camino
      await page.route("**/api/rescate", async (ruta) => {
        estado.rescates++;
        await respuesta.espera;
        estado.perfil = { ...estado.perfil, fichas: 200, quiebras: estado.perfil.quiebras + 1 };
        await ruta.fulfill({ json: { fichas: 200 } });
      });
      await page.goto("/perfil");

      await expect(fichasDelPerfil(page)).toHaveText("0");
      await expect(botonRescate(page)).toBeVisible();
      expect((await botonRescate(page).boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
      await expect(dato(estadisticas(page), "Quiebras")).toHaveText("1");
      // Se anotan los valores que enseña el contador, para ver que sube contando y no de golpe.
      await page.evaluate(() => {
        const contador = document.querySelector(".perfil-fichas .contador")!;
        const vistos: string[] = [];
        (window as unknown as { vistos: string[] }).vistos = vistos;
        new MutationObserver(() => vistos.push(contador.textContent ?? "")).observe(contador, { childList: true, characterData: true, subtree: true });
      });

      await botonRescate(page).dblclick(); // un doble toque pide una sola vez
      respuesta.soltar();
      await expect(page.getByRole("status").filter({ hasText: "Rescate concedido" })).toBeVisible();
      await expect(fichasDelPerfil(page)).toHaveText("200");
      await expect(botonRescate(page)).toHaveCount(0);
      await expect(dato(estadisticas(page), "Quiebras")).toHaveText("2");
      expect(estado.rescates).toBe(1);

      const vistos = await page.evaluate(() => (window as unknown as { vistos: string[] }).vistos);
      expect(vistos.at(-1)).toBe("200");
      expect(vistos.some((v) => Number(v) > 0 && Number(v) < 200), `el contador sube pasando por valores intermedios: ${vistos.join(", ")}`).toBe(true);
    });

    test("mientras el rescate está en camino el botón no deja pedir otra vez", async ({ page, request }) => {
      const { estado } = await sinFichas(page, request);
      const respuesta = aplazada();
      await page.route("**/api/rescate", async (ruta) => {
        estado.rescates++;
        await respuesta.espera;
        estado.perfil = { ...estado.perfil, fichas: 200 };
        await ruta.fulfill({ json: { fichas: 200 } });
      });
      await page.goto("/perfil");

      const boton = botonRescate(page);
      await boton.click();
      await expect(boton).toHaveAttribute("aria-busy", "true");
      await boton.click({ force: true });
      await boton.press("Enter");
      await page.waitForTimeout(300); // una segunda petición habría llegado ya
      expect(estado.rescates).toBe(1);

      respuesta.soltar();
      await expect(fichasDelPerfil(page)).toHaveText("200");
      expect(estado.rescates).toBe(1);
    });

    test("con apuestas pendientes dice que esperes a que acabe la ronda y deja volver a intentarlo", async ({ page, request }) => {
      const { estado } = await sinFichas(page, request);
      await page.route("**/api/rescate", (ruta) => {
        estado.rescates++;
        return ruta.fulfill({ status: 409, json: { error: "apuestas_pendientes" } });
      });
      await page.goto("/perfil");

      await botonRescate(page).click();
      await expect(page.getByRole("alert")).toHaveText("Espera a que acabe tu ronda");
      await expect(fichasDelPerfil(page)).toHaveText("0");
      await expect(botonRescate(page)).toBeEnabled();
      await expect(botonRescate(page)).not.toHaveAttribute("aria-busy", "true");

      await botonRescate(page).click();
      await expect.poll(() => estado.rescates).toBe(2);
    });

    test("si en realidad ya tenías fichas, se pone al día y el botón desaparece", async ({ page, request }) => {
      const { estado } = await sinFichas(page, request);
      await page.route("**/api/rescate", (ruta) => {
        estado.rescates++;
        estado.perfil = { ...estado.perfil, fichas: 500 }; // las ganó en otra pestaña
        return ruta.fulfill({ status: 409, json: { error: "tiene_fichas" } });
      });
      await page.goto("/perfil");

      await botonRescate(page).click();
      await expect(fichasDelPerfil(page)).toHaveText("500");
      await expect(botonRescate(page)).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(estado.rescates).toBe(1);
      // El botón se ha ido con el foco dentro: el foco se queda en la tarjeta de las fichas, como cuando el rescate sale bien.
      await expect(page.locator(".perfil-fichas")).toBeFocused();
    });

    test("un fallo del servidor usa el texto general", async ({ page, request }) => {
      await sinFichas(page, request);
      await page.route("**/api/rescate", (ruta) => ruta.fulfill({ status: 503, json: { error: "descansando" } }));
      await page.goto("/perfil");

      await botonRescate(page).click();
      await expect(page.getByRole("alert")).toHaveText("La Timba está descansando, vuelve mañana");
      await expect(botonRescate(page)).toBeEnabled();
    });
  });
});
