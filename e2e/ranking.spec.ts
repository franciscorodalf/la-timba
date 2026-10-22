import { expect, type Page, test } from "@playwright/test";
import { type FilaRanking, ORDENES_RANKING, type OrdenRanking, type Perfil, type RespuestaRanking } from "../src/shared/api";
import { abrirPartida, apodoUnico, conSesion, registrar } from "./ayudas";

const ETIQUETA: Record<OrdenRanking, string> = { fichas: "Fichas", ganancias: "Ganancias", victorias: "% victorias", premio: "Mayor premio", racha: "Mejor racha", quiebras: "Quiebras" };
const pestana = (pagina: Page, orden: OrdenRanking) => pagina.getByRole("tab", { name: ETIQUETA[orden], exact: true });
const barra = (pagina: Page) => pagina.getByRole("navigation", { name: "Principal" });
const lista = (pagina: Page, orden: OrdenRanking) => pagina.getByRole("list", { name: `Ranking: ${ETIQUETA[orden]}` });
const filaFija = (pagina: Page) => pagina.getByRole("group", { name: "Tu posición" });
/** La fila del jugador: resaltada dentro de la lista o, si no está en el top 50, la fija sobre la barra. Nunca hay dos. */
const filaPropia = (pagina: Page) => pagina.locator('[aria-current="true"]');

const sinDesplazamientoHorizontal = (pagina: Page) => pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

// ---------------------------------------------------------------------------------------------------------------------
// Respuestas del ranking: las del servidor (copiadas para saber qué debe enseñar la pantalla) o inventadas.
// ---------------------------------------------------------------------------------------------------------------------

interface Copia {
  orden: OrdenRanking;
  cuerpo: RespuestaRanking;
}

/**
 * Deja pasar `/api/ranking` al servidor de verdad y guarda cada respuesta. El servidor de desarrollo conserva a todos los
 * jugadores de otras ejecuciones (y de otras pruebas a la vez): el puesto del jugador nuevo no se puede suponer, pero lo que
 * la pantalla enseña tiene que ser exactamente lo que dice la respuesta que recibió.
 */
async function copiarRanking(pagina: Page): Promise<Copia[]> {
  const copias: Copia[] = [];
  await pagina.route(/\/api\/ranking\?/, async (ruta) => {
    const respuesta = await ruta.fetch();
    const cuerpo: RespuestaRanking = await respuesta.json();
    copias.push({ orden: new URL(ruta.request().url()).searchParams.get("orden") as OrdenRanking, cuerpo });
    await ruta.fulfill({ response: respuesta, json: cuerpo });
  });
  return copias;
}

async function respuestaDe(copias: Copia[], orden: OrdenRanking): Promise<RespuestaRanking> {
  await expect.poll(() => copias.some((c) => c.orden === orden), { message: `llega la respuesta de ${orden}` }).toBe(true);
  return copias.filter((c) => c.orden === orden).at(-1)!.cuerpo;
}

/** Comprueba la fila propia: su puesto, su apodo y su valor, y que está resaltada en la lista o fija sobre la barra según el puesto. */
async function comprobarFilaPropia(pagina: Page, copias: Copia[], orden: OrdenRanking, apodo: string, valor: string): Promise<{ enLaLista: boolean }> {
  const { top, yo } = await respuestaDe(copias, orden);
  expect(yo, "el servidor da la posición del jugador").not.toBeNull();
  expect(yo!.apodo).toBe(apodo);

  const fila = filaPropia(pagina);
  await expect(fila).toHaveCount(1);
  await expect(fila.locator(".ranking-fila__pos")).toHaveText(String(yo!.posicion));
  await expect(fila.locator(".ranking-fila__nombre")).toContainText(apodo);
  await expect(fila.locator(".ranking-fila__valor")).toHaveText(valor);

  const enLaLista = yo!.posicion <= top.length;
  if (enLaLista) {
    await expect(lista(pagina, orden).locator('[aria-current="true"]')).toHaveCount(1);
    await expect(filaFija(pagina)).toHaveCount(0);
  } else {
    await expect(filaFija(pagina)).toBeVisible();
    await expect(lista(pagina, orden).locator('[aria-current="true"]')).toHaveCount(0);
    await comprobarSobreLaBarra(pagina, filaFija(pagina));
  }
  return { enLaLista };
}

/** La fila está entera en pantalla y justo encima de la barra inferior, sin taparla. */
async function comprobarSobreLaBarra(pagina: Page, fila: ReturnType<Page["locator"]>) {
  const caja = (await fila.boundingBox())!;
  const nav = (await barra(pagina).boundingBox())!;
  expect(caja.y).toBeGreaterThanOrEqual(0);
  expect(caja.y + caja.height).toBeLessThanOrEqual(nav.y + 0.5);
  expect(nav.y - (caja.y + caja.height), "queda cerca de la barra").toBeLessThan(24);
}

const jugadoresFalsos = (n: number, valor: (i: number) => number = (i) => 5000 - i * 10): FilaRanking[] =>
  Array.from({ length: n }, (_, i) => ({ posicion: i + 1, apodo: `jugador${i + 1}`, valor: valor(i) }));

/** Lo que contesta `simularRanking`: la respuesta tal cual, o esa misma cuando se cumpla `espera` (la prueba decide cuándo llega). */
type Contestacion = RespuestaRanking | { espera: Promise<unknown>; cuerpo: RespuestaRanking };

/** Una promesa que la prueba cumple cuando quiere. */
function aplazada(): { espera: Promise<void>; soltar(): void } {
  let soltar!: () => void;
  const espera = new Promise<void>((resolver) => (soltar = resolver));
  return { espera, soltar };
}

/** Sustituye `/api/ranking`: `respuesta` decide qué contesta a cada orden. Devuelve, en orden, los órdenes que se han pedido. */
async function simularRanking(pagina: Page, respuesta: (orden: OrdenRanking) => Contestacion): Promise<{ pedidas: OrdenRanking[] }> {
  const pedidas: OrdenRanking[] = [];
  await pagina.route(/\/api\/ranking\?/, async (ruta) => {
    const orden = new URL(ruta.request().url()).searchParams.get("orden") as OrdenRanking;
    pedidas.push(orden);
    const contestacion = respuesta(orden);
    if ("cuerpo" in contestacion) {
      await contestacion.espera;
      await ruta.fulfill({ json: contestacion.cuerpo });
    } else await ruta.fulfill({ json: contestacion });
  });
  return { pedidas };
}

test.describe("Ranking", () => {
  test("tras registrarse, enseña al jugador con 1.000 fichas y su puesto resaltado; Quiebras y el perfil sin rescate", async ({ page, request }) => {
    const apodo = apodoUnico();
    await conSesion(page, await registrar(request, apodo, "1234"));
    const copias = await copiarRanking(page);

    await page.goto("/ranking");
    await expect(page.getByRole("heading", { level: 1, name: "Ranking" })).toBeVisible();
    await expect(pestana(page, "fichas")).toHaveAttribute("aria-selected", "true");
    await comprobarFilaPropia(page, copias, "fichas", apodo, "1.000");

    // Todos los jugadores nuevos empiezan con cero quiebras.
    await pestana(page, "quiebras").click();
    await expect(pestana(page, "quiebras")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAccessibleName("Quiebras");
    await comprobarFilaPropia(page, copias, "quiebras", apodo, "0");
    expect(await sinDesplazamientoHorizontal(page)).toBe(true);

    // El perfil no tiene partidas y, con fichas, no ofrece el rescate.
    await barra(page).getByRole("link", { name: "Perfil" }).click();
    await expect(page).toHaveURL("/perfil");
    await expect(page.getByRole("heading", { level: 1, name: apodo })).toBeVisible();
    const partidas = page.getByRole("region", { name: "Estadísticas" }).locator(".perfil-dato", { hasText: "Partidas" });
    await expect(partidas.locator("dd")).toHaveText("0");
    await expect(page.getByRole("button", { name: /Pedir rescate/ })).toHaveCount(0);
  });

  test("seis pestañas con sus textos; cada una pide su orden y solo se pide una vez", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    const falso = await simularRanking(page, () => ({ top: jugadoresFalsos(5), yo: null }));
    await page.goto("/ranking");

    await expect(page.getByRole("tablist")).toBeVisible();
    await expect(page.getByRole("tab")).toHaveText(["Fichas", "Ganancias", "% victorias", "Mayor premio", "Mejor racha", "Quiebras"]);

    for (const orden of ORDENES_RANKING) {
      await pestana(page, orden).click();
      await expect(pestana(page, orden)).toHaveAttribute("aria-selected", "true");
      await expect(lista(page, orden).getByRole("listitem")).toHaveCount(5);
    }
    expect(falso.pedidas).toEqual([...ORDENES_RANKING]);
  });

  test("los tres primeros llevan medalla de oro, plata y bronce; el resto, no", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await simularRanking(page, () => ({ top: jugadoresFalsos(10), yo: null }));
    await page.goto("/ranking");

    const filas = lista(page, "fichas").getByRole("listitem");
    await expect(filas).toHaveCount(10);
    await expect(filas.nth(0).locator(".ranking-fila__pos--oro")).toHaveCount(1);
    await expect(filas.nth(1).locator(".ranking-fila__pos--plata")).toHaveCount(1);
    await expect(filas.nth(2).locator(".ranking-fila__pos--bronce")).toHaveCount(1);
    await expect(page.locator(".ranking-fila__pos--oro, .ranking-fila__pos--plata, .ranking-fila__pos--bronce")).toHaveCount(3);
    await expect(filas.nth(0).locator(".ranking-fila__pos")).toHaveText("1");
    await expect(filas.nth(3).locator(".ranking-fila__pos")).toHaveText("4");
    await expect(filas.nth(3).locator(".ranking-fila__nombre")).toHaveText("jugador4");
  });

  test("fuera del top 50, la fila propia queda fija sobre la barra aunque la lista se recorra entera", async ({ page, request }) => {
    const apodo = apodoUnico();
    await conSesion(page, await registrar(request, apodo, "1234"));
    await simularRanking(page, () => ({ top: jugadoresFalsos(50), yo: { posicion: 1234, apodo, valor: 1000 } }));
    await page.goto("/ranking");

    await expect(lista(page, "fichas").getByRole("listitem")).toHaveCount(50);
    await expect(lista(page, "fichas").locator('[aria-current="true"]')).toHaveCount(0);
    const fila = filaFija(page);
    await expect(fila).toBeVisible();
    await expect(fila.locator(".ranking-fila__pos")).toHaveText("1234");
    await expect(fila.locator(".ranking-fila__nombre")).toContainText(apodo);
    await expect(fila.locator(".ranking-fila__valor")).toHaveText("1.000");
    await comprobarSobreLaBarra(page, fila);

    // Sigue ahí al bajar hasta el final, sin tapar la última fila ni la barra.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await comprobarSobreLaBarra(page, fila);
    const ultima = (await lista(page, "fichas").getByRole("listitem").last().boundingBox())!;
    const caja = (await fila.boundingBox())!;
    expect(ultima.y + ultima.height).toBeLessThanOrEqual(caja.y + 0.5);
    expect(await sinDesplazamientoHorizontal(page)).toBe(true);
  });

  test("dentro del top 50, la fila propia se resalta en la lista y no hay fila fija", async ({ page, request }) => {
    const apodo = apodoUnico();
    await conSesion(page, await registrar(request, apodo, "1234"));
    const top = jugadoresFalsos(50);
    top[6] = { posicion: 7, apodo, valor: 4930 };
    await simularRanking(page, () => ({ top, yo: top[6] }));
    await page.goto("/ranking");

    const propia = lista(page, "fichas").locator('[aria-current="true"]');
    await expect(propia).toHaveCount(1);
    await expect(propia.locator(".ranking-fila__pos")).toHaveText("7");
    await expect(propia.locator(".ranking-fila__nombre")).toContainText(apodo);
    await expect(propia.locator(".ranking-fila__valor")).toHaveText("4.930");
    await expect(filaFija(page)).toHaveCount(0);
  });

  test("cada pestaña da formato a su valor: miles, menos de verdad, «NN %» y enteros", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    const valores: Record<OrdenRanking, number> = { fichas: 12345, ganancias: -1250, victorias: 67, premio: 5400, racha: 7, quiebras: 3 };
    await simularRanking(page, (orden) => ({ top: [{ posicion: 1, apodo: "ana", valor: valores[orden] }], yo: null }));
    await page.goto("/ranking");

    const textos: Record<OrdenRanking, string> = { fichas: "12.345", ganancias: "−1.250", victorias: "67 %", premio: "5.400", racha: "7", quiebras: "3" };
    for (const orden of ORDENES_RANKING) {
      await pestana(page, orden).click();
      const valor = lista(page, orden).getByRole("listitem").first().locator(".ranking-fila__valor");
      await expect(valor).toHaveText(textos[orden]);
      // Solo las fichas llevan el icono de la ficha.
      await expect(valor.locator("svg.ficha")).toHaveCount(orden === "fichas" ? 1 : 0);
    }
  });

  test("el jugador sin puesto en % victorias o Mayor premio lo ve explicado en la fila fija", async ({ page, request }) => {
    const apodo = apodoUnico();
    await conSesion(page, await registrar(request, apodo, "1234"));
    const copias = await copiarRanking(page);
    await page.goto("/ranking");

    await pestana(page, "victorias").click();
    expect((await respuestaDe(copias, "victorias")).yo).toBeNull();
    await expect(filaFija(page)).toContainText("Juega 10 rondas para entrar en este ranking");
    await expect(filaPropia(page)).toHaveCount(1);
    await comprobarSobreLaBarra(page, filaFija(page));

    await pestana(page, "premio").click();
    expect((await respuestaDe(copias, "premio")).yo).toBeNull();
    await expect(filaFija(page)).toContainText("Gana una ronda para entrar en este ranking");

    // En un orden donde sí clasifica, ya no hay explicación.
    await pestana(page, "racha").click();
    await expect(filaPropia(page)).toContainText(apodo);
    await expect(page.getByText("para entrar en este ranking")).toHaveCount(0);
  });

  test("las pestañas se manejan con el teclado: flechas, Inicio y Fin; la lista cambia con ellas", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await simularRanking(page, (orden) => ({ top: [{ posicion: 1, apodo: `de_${orden}`, valor: 1 }], yo: null }));
    await page.goto("/ranking");
    await expect(lista(page, "fichas")).toBeVisible();

    // Solo la pestaña activa está en el orden del tabulador.
    await expect(pestana(page, "fichas")).toHaveAttribute("tabindex", "0");
    await expect(pestana(page, "quiebras")).toHaveAttribute("tabindex", "-1");

    await pestana(page, "fichas").focus();
    await page.keyboard.press("ArrowRight");
    await expect(pestana(page, "ganancias")).toHaveAttribute("aria-selected", "true");
    await expect(pestana(page, "ganancias")).toBeFocused();
    await expect(page.getByRole("tabpanel")).toHaveAccessibleName("Ganancias");
    await expect(lista(page, "ganancias").getByText("de_ganancias")).toBeVisible();
    await expect(pestana(page, "fichas")).toHaveAttribute("tabindex", "-1");

    await page.keyboard.press("End");
    await expect(pestana(page, "quiebras")).toBeFocused();
    await expect(pestana(page, "quiebras")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowRight"); // da la vuelta
    await expect(pestana(page, "fichas")).toBeFocused();
    await expect(pestana(page, "fichas")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft"); // y de vuelta hacia atrás
    await expect(pestana(page, "quiebras")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(pestana(page, "fichas")).toBeFocused();
    await expect(lista(page, "fichas").getByText("de_fichas")).toBeVisible();

    // Del tabulador se pasa a la lista, no a las otras pestañas.
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel")).toBeFocused();
  });

  test("al volver a una pestaña ya vista no se pide otra vez ni hay carga, aunque otra siga pidiéndose", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    const ganancias = aplazada();
    const falso = await simularRanking(page, (orden) =>
      orden === "ganancias" ? { espera: ganancias.espera, cuerpo: { top: [{ posicion: 1, apodo: "de_ganancias", valor: 1 }], yo: null } } : { top: [{ posicion: 1, apodo: `de_${orden}`, valor: 1 }], yo: null },
    );
    await page.goto("/ranking");
    await expect(lista(page, "fichas").getByText("de_fichas")).toBeVisible();

    await pestana(page, "ganancias").click();
    await expect(page.getByRole("status", { name: "Cargando el ranking" })).toBeVisible();

    // Con Ganancias aún cargando, Fichas aparece de golpe: sin estado de carga en medio.
    await pestana(page, "fichas").click();
    await expect(lista(page, "fichas").getByText("de_fichas")).toBeVisible();
    await expect(page.getByRole("status", { name: "Cargando el ranking" })).toHaveCount(0);

    // Cuando llega Ganancias, no cambia lo que se está viendo.
    const llegada = page.waitForResponse(/orden=ganancias/);
    ganancias.soltar();
    await llegada;
    await expect(lista(page, "fichas").getByText("de_fichas")).toBeVisible();
    await expect(pestana(page, "fichas")).toHaveAttribute("aria-selected", "true");

    await pestana(page, "ganancias").click();
    await expect(lista(page, "ganancias").getByText("de_ganancias")).toBeVisible();
    await expect(page.getByRole("status", { name: "Cargando el ranking" })).toHaveCount(0);
    expect(falso.pedidas).toEqual(["fichas", "ganancias"]);
  });

  test("la primera carga enseña un estado de carga y después la lista", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    const respuesta = aplazada();
    await simularRanking(page, () => ({ espera: respuesta.espera, cuerpo: { top: jugadoresFalsos(3), yo: null } }));
    await page.goto("/ranking");

    await expect(page.getByRole("status", { name: "Cargando el ranking" })).toBeVisible();
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-busy", "true");
    await expect(lista(page, "fichas")).toHaveCount(0);

    respuesta.soltar();
    await expect(lista(page, "fichas").getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("status", { name: "Cargando el ranking" })).toHaveCount(0);
    await expect(page.getByRole("tabpanel")).not.toHaveAttribute("aria-busy", "true");
  });

  test("si el ranking falla lo dice con «Reintentar», que vuelve a pedirlo", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    let caido = true;
    await page.route(/\/api\/ranking\?/, (ruta) =>
      caido ? ruta.fulfill({ status: 503, json: { error: "descansando" } }) : ruta.fulfill({ json: { top: jugadoresFalsos(4), yo: null } }),
    );
    await page.goto("/ranking");

    await expect(page.getByRole("alert")).toHaveText("La Timba está descansando, vuelve mañana");
    await expect(lista(page, "fichas")).toHaveCount(0);

    caido = false;
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(lista(page, "fichas").getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("sin red lo dice con el texto de la conexión", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await page.route(/\/api\/ranking\?/, (ruta) => ruta.abort("connectionrefused"));
    await page.goto("/ranking");

    await expect(page.getByRole("alert")).toHaveText("No hay conexión con La Timba. Revisa tu red e inténtalo de nuevo");
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  });

  test("las filas entran escalonadas con un tope, y con movimiento reducido no se animan", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await simularRanking(page, () => ({ top: jugadoresFalsos(50), yo: null }));
    await page.goto("/ranking");
    await expect(lista(page, "fichas").getByRole("listitem")).toHaveCount(50);

    const animaciones = await page.locator(".ranking-fila").evaluateAll((filas) =>
      filas.map((f) => ({ nombre: getComputedStyle(f).animationName, retardo: parseFloat(getComputedStyle(f).animationDelay) })),
    );
    expect(animaciones.every((a) => a.nombre !== "none")).toBe(true);
    expect(animaciones[0].retardo).toBe(0);
    expect(animaciones[1].retardo).toBeGreaterThan(0);
    expect(animaciones.map((a) => a.retardo)).toEqual([...animaciones.map((a) => a.retardo)].sort((a, b) => a - b));
    expect(animaciones[49].retardo).toBe(animaciones[20].retardo); // el escalón tiene tope
    expect(animaciones[49].retardo).toBeLessThanOrEqual(0.4);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducido = await page.locator(".ranking-fila").evaluateAll((filas) => filas.map((f) => getComputedStyle(f).animationName));
    expect(reducido.every((nombre) => nombre === "none")).toBe(true);
  });

  test("las pestañas y los enlaces miden al menos 44 px y nada se sale de la pantalla", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    const apodo = apodoUnico();
    await simularRanking(page, () => ({ top: jugadoresFalsos(50), yo: { posicion: 80, apodo, valor: 1000 } }));
    await page.goto("/ranking");
    await expect(lista(page, "fichas").getByRole("listitem")).toHaveCount(50);

    for (const orden of ORDENES_RANKING) {
      const caja = (await pestana(page, orden).boundingBox())!;
      // 44 px de CSS; con 2,625 píxeles por píxel de CSS (Pixel 7) el navegador lo da como 43,99999: se admite esa décima de redondeo.
      expect(caja.height, ETIQUETA[orden]).toBeGreaterThanOrEqual(43.9);
      expect(caja.x).toBeGreaterThanOrEqual(0);
      expect(caja.x + caja.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    }
    expect(await sinDesplazamientoHorizontal(page)).toBe(true);
  });

  test.describe("«Sala» en la barra", () => {
    test("vuelve a la última partida visitada en esta pestaña", async ({ page, request }) => {
      const sesion = await registrar(request, apodoUnico(), "1234");
      const codigo = await abrirPartida(request, sesion);
      await conSesion(page, sesion);

      await page.goto(`/p/${codigo.toLowerCase()}`);
      await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem("timba.partida"))).toBe(codigo);

      await barra(page).getByRole("link", { name: "Ranking" }).click();
      await expect(page).toHaveURL("/ranking");
      await expect(barra(page).getByRole("link", { name: "Ranking" })).toHaveAttribute("aria-current", "page");
      await expect(barra(page).getByRole("link", { name: "Sala" })).toHaveAttribute("href", `/p/${codigo}`);

      await barra(page).getByRole("link", { name: "Perfil" }).click();
      await expect(page).toHaveURL("/perfil");
      await expect(barra(page).getByRole("link", { name: "Sala" })).toHaveAttribute("href", `/p/${codigo}`);

      await barra(page).getByRole("link", { name: "Sala" }).click();
      await expect(page).toHaveURL(`/p/${codigo}`);
      await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
    });

    test("sin partida visitada lleva al inicio", async ({ page, request }) => {
      await conSesion(page, await registrar(request, apodoUnico(), "1234"));
      await page.goto("/ranking");

      await expect(barra(page).getByRole("link", { name: "Sala" })).toHaveAttribute("href", "/");
      await barra(page).getByRole("link", { name: "Sala" }).click();
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("button", { name: "Crear partida" })).toBeVisible();
    });

    test("una partida que no existe se olvida y la sala lleva al inicio", async ({ page, request }) => {
      await conSesion(page, await registrar(request, apodoUnico(), "1234"));

      await page.goto("/p/ZZZZ");
      await expect(page.getByText("Esa partida no existe")).toBeVisible();
      expect(await page.evaluate(() => sessionStorage.getItem("timba.partida"))).toBeNull();

      await page.goto("/ranking");
      await expect(barra(page).getByRole("link", { name: "Sala" })).toHaveAttribute("href", "/");
    });

    test("el código se guarda en la pestaña y no entre pestañas", async ({ page, context, request }) => {
      const sesion = await registrar(request, apodoUnico(), "1234");
      const codigo = await abrirPartida(request, sesion);
      await conSesion(page, sesion);
      await page.goto(`/p/${codigo}`);
      await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();

      const otra = await context.newPage();
      await otra.goto("/ranking");
      await expect(barra(otra).getByRole("link", { name: "Sala" })).toHaveAttribute("href", "/");
    });
  });
});

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
    for (const etiqueta of ["Partidas", "Ganancias totales", "Mayor premio", "Mejor racha", "Racha actual", "Quiebras"]) {
      await expect(dato(estadisticas(page), etiqueta), etiqueta).toHaveText("0");
    }
    for (const juego of ["Blackjack", "Carrera"] as const) {
      await expect(dato(porJuego(page, juego), "Partidas")).toHaveText("0");
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
    await expect(dato(general, "Partidas")).toHaveText("20");
    await expect(dato(general, "Ganancias totales")).toHaveText("−1.250");
    await expect(dato(general, "Mayor premio")).toHaveText("5.400");
    await expect(dato(general, "Mejor racha")).toHaveText("9");
    await expect(dato(general, "Racha actual")).toHaveText("3");
    await expect(dato(general, "Quiebras")).toHaveText("2");

    await expect(dato(porJuego(page, "Blackjack"), "Partidas")).toHaveText("12");
    await expect(dato(porJuego(page, "Blackjack"), "Victorias")).toHaveText("8");
    await expect(dato(porJuego(page, "Blackjack"), "% victorias")).toHaveText("67 %");
    await expect(dato(porJuego(page, "Carrera"), "Partidas")).toHaveText("8");
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
    await expect(dato(estadisticas(page), "Partidas")).toHaveText("3");

    await barra(page).getByRole("link", { name: "Ranking" }).click();
    await expect(page).toHaveURL("/ranking");
    datos = { ...datos, partidas: 5, mayorPremio: 800 };
    await barra(page).getByRole("link", { name: "Perfil" }).click();

    await expect(dato(estadisticas(page), "Partidas")).toHaveText("5");
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
    await expect(lista(page, "fichas")).toBeVisible();
    respuesta = "falla";
    await barra(page).getByRole("link", { name: "Perfil" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "La Timba está descansando, vuelve mañana" })).toBeVisible();
    await expect(estadisticas(page)).toHaveCount(0);

    respuesta = "bien";
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(dato(estadisticas(page), "Partidas")).toHaveText("7");
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
