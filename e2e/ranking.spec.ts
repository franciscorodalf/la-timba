import { expect, type Page, test } from "@playwright/test";
import { ORDENES_RANKING, type OrdenRanking, type RespuestaRanking } from "../src/shared/api";
import { abrirPartida, aplazada, apodoUnico, barra, conSesion, jugadoresFalsos, registrar, sinDesplazamientoHorizontal } from "./ayudas";

const ETIQUETA: Record<OrdenRanking, string> = { fichas: "Fichas", ganancias: "Ganancias", victorias: "% victorias", premio: "Mayor premio", racha: "Mejor racha", quiebras: "Quiebras" };
const pestana = (pagina: Page, orden: OrdenRanking) => pagina.getByRole("tab", { name: ETIQUETA[orden], exact: true });
const lista = (pagina: Page, orden: OrdenRanking) => pagina.getByRole("list", { name: `Ranking: ${ETIQUETA[orden]}` });
const filaFija = (pagina: Page) => pagina.getByRole("group", { name: "Tu posición" });
/** La fila del jugador: resaltada dentro de la lista o, si no está en el top 50, la fija sobre la barra. Nunca hay dos. */
const filaPropia = (pagina: Page) => pagina.locator('[aria-current="true"]');

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

/** Lo que contesta `simularRanking`: la respuesta tal cual, o esa misma cuando se cumpla `espera` (la prueba decide cuándo llega). */
type Contestacion = RespuestaRanking | { espera: Promise<unknown>; cuerpo: RespuestaRanking };

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

    // El perfil no tiene rondas jugadas y, con fichas, no ofrece el rescate.
    await barra(page).getByRole("link", { name: "Perfil" }).click();
    await expect(page).toHaveURL("/perfil");
    await expect(page.getByRole("heading", { level: 1, name: apodo })).toBeVisible();
    const rondas = page.getByRole("region", { name: "Estadísticas" }).locator(".perfil-dato", { hasText: "Rondas jugadas" });
    await expect(rondas.locator("dd")).toHaveText("0");
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

  test("las teclas con Alt, Ctrl, Cmd o Mayús no mueven las pestañas ni se tragan el atajo del navegador", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await simularRanking(page, (orden) => ({ top: [{ posicion: 1, apodo: `de_${orden}`, valor: 1 }], yo: null }));
    await page.goto("/ranking");
    await expect(lista(page, "fichas")).toBeVisible();
    // Quién llega a escuchar la tecla sin que nadie la haya cancelado: es lo que pasa para que el navegador vuelva atrás con Alt+←.
    await page.evaluate(() => {
      const w = window as unknown as { __teclas: { tecla: string; cancelada: boolean }[] };
      w.__teclas = [];
      document.addEventListener("keydown", (e) => w.__teclas.push({ tecla: e.key, cancelada: e.defaultPrevented }));
    });

    await pestana(page, "fichas").focus();
    for (const combinacion of ["Alt+ArrowRight", "Alt+ArrowLeft", "Control+ArrowRight", "Meta+ArrowLeft", "Shift+ArrowRight", "Alt+Home", "Control+End"]) {
      await page.keyboard.press(combinacion);
      await expect(pestana(page, "fichas"), combinacion).toHaveAttribute("aria-selected", "true");
      await expect(pestana(page, "fichas"), combinacion).toBeFocused();
    }
    const teclas = await page.evaluate(() => (window as unknown as { __teclas: { tecla: string; cancelada: boolean }[] }).__teclas);
    expect(teclas.filter((t) => t.tecla !== "Alt" && t.tecla !== "Control" && t.tecla !== "Meta" && t.tecla !== "Shift")).toHaveLength(7);
    expect(teclas.filter((t) => t.cancelada)).toEqual([]);

    // Sin modificadores siguen funcionando.
    await page.keyboard.press("ArrowRight");
    await expect(pestana(page, "ganancias")).toHaveAttribute("aria-selected", "true");
  });

  test("la barra de pestañas se queda arriba al recorrer la lista, con fondo sólido: las filas pasan por debajo sin verse", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await simularRanking(page, () => ({ top: jugadoresFalsos(50), yo: { posicion: 80, apodo: "yo_mismo", valor: 1000 } }));
    await page.goto("/ranking");
    await expect(lista(page, "fichas").getByRole("listitem")).toHaveCount(50);

    await page.mouse.wheel(0, 2400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1500);
    for (const orden of ORDENES_RANKING) {
      const caja = (await pestana(page, orden).boundingBox())!;
      expect(caja.y, `${ETIQUETA[orden]} sigue a la vista arriba`).toBeGreaterThanOrEqual(0);
      expect(caja.y + caja.height, `${ETIQUETA[orden]} sigue a la vista arriba`).toBeLessThan(130);
    }
    // Fondo opaco (sin transparencia): una fila que pasa por debajo no se ve a través de la barra.
    const barraFija = page.locator(".ranking__barra");
    const fondo = await barraFija.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(fondo, "color de fondo sólido").toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // Y en un punto de la barra, lo que hay encima del todo es la barra (no una fila de la lista).
    const caja = (await barraFija.boundingBox())!;
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest(".ranking__barra") !== null, [caja.x + 2, caja.y + caja.height - 2])).toBe(true);
  });

  test("la lista es una lista para los lectores de pantalla aunque no lleve viñetas, y la carga se anuncia con texto", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    const respuesta = aplazada();
    await simularRanking(page, () => ({ espera: respuesta.espera, cuerpo: { top: jugadoresFalsos(3), yo: null } }));
    await page.goto("/ranking");

    // Safari y VoiceOver quitan la semántica de lista a las listas sin viñetas si no se la devuelve `role="list"`.
    await expect(page.getByRole("status", { name: "Cargando el ranking" })).toContainText("Cargando…");
    respuesta.soltar();
    await expect(lista(page, "fichas").getByRole("listitem")).toHaveCount(3);
    await expect(page.locator("ol.ranking-lista")).toHaveAttribute("role", "list");
  });

  test("«Reintentar» no deja el foco en el aire: al pulsarlo (con el teclado) el foco pasa al panel del ranking", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    let caido = true;
    const respuesta = aplazada();
    await page.route(/\/api\/ranking\?/, async (ruta) => {
      if (caido) return ruta.fulfill({ status: 503, json: { error: "descansando" } });
      await respuesta.espera;
      return ruta.fulfill({ json: { top: jugadoresFalsos(4), yo: null } });
    });
    await page.goto("/ranking");
    await expect(page.getByRole("alert")).toHaveText("La Timba está descansando, vuelve mañana");

    caido = false;
    await page.getByRole("button", { name: "Reintentar" }).focus();
    await page.keyboard.press("Enter");
    // Mientras carga, el botón ya no está y el foco no se ha ido al cuerpo de la página.
    await expect(page.getByRole("status", { name: "Cargando el ranking" })).toBeVisible();
    await expect(page.getByRole("tabpanel")).toBeFocused();
    respuesta.soltar();
    await expect(lista(page, "fichas").getByRole("listitem")).toHaveCount(4);
    await expect(page.getByRole("tabpanel")).toBeFocused();
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
