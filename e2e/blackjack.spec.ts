import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import type { RespuestaSesion } from "../src/shared/api";
import type { Carta } from "../src/shared/cartas";
import type { VistaBJ } from "../src/shared/juegos/blackjack";
import { abrirPartida, apodoUnico, carta, conSesion, entrarSimulada as baseEntrarSimulada, fichasDeApi, mensajeEstado, registrar, sinDesplazamientoHorizontal } from "./ayudas";

// La mesa anima sin parar (la barra del temporizador se vacía durante 15 s): las capturas continuas de la traza, con
// varios trabajadores en paralelo, saturan la máquina y retrasan los clics más que la ventana de decisiones. La traza se
// conserva igual al fallar, con sus instantáneas del DOM pero sin película.
test.use({ trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true } });

/** Un entero con punto de millares, como lo enseña el contador (`1.050`). */
const miles = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");

const contador = (pagina: Page): Locator => pagina.getByText(/^Tienes [\d.]+ fichas$/);
const tuMano = (pagina: Page): Locator => pagina.getByRole("group", { name: "Tu mano" }).getByRole("img");
const banca = (pagina: Page): Locator => pagina.getByRole("group", { name: "Banca" }).getByRole("img");
const resultado = (pagina: Page): Locator => pagina.getByText(/^(Ganas \d+|Pierdes \d+|Empate)$/);

/** Otro contexto con el mismo dispositivo que el proyecto (en `movil`, también un móvil). */
async function otroContexto(browser: Browser): Promise<BrowserContext> {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, baseURL } = test.info().project.use;
  return browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, locale, baseURL });
}

async function apostar(pagina: Page, cantidad: number): Promise<void> {
  await pagina.getByRole("button", { name: `Añadir ${cantidad}`, exact: true }).click();
  await pagina.getByRole("button", { name: `Apostar ${cantidad}` }).click();
}

/** Lo que gana o pierde el jugador según el resultado que enseña la mesa. */
async function netoMostrado(pagina: Page): Promise<number> {
  const texto = (await resultado(pagina).textContent()) ?? "";
  if (texto === "Empate") return 0;
  const [, verbo, cantidad] = /^(Ganas|Pierdes) (\d+)$/.exec(texto) ?? [];
  return verbo === "Ganas" ? Number(cantidad) : -Number(cantidad);
}

test("tres jugadores (tres navegadores) apuestan 50, se plantan y cobran lo que enseña la mesa; recargar a mitad de ronda devuelve la mano", async ({
  page,
  browser,
  request,
}) => {
  const sesiones = [await registrar(request, apodoUnico(), "1234"), await registrar(request, apodoUnico(), "1234"), await registrar(request, apodoUnico(), "1234")];
  const codigo = await abrirPartida(request, sesiones[0]);
  await conSesion(page, sesiones[0]);
  const contextos = [await otroContexto(browser), await otroContexto(browser)];
  try {
    const paginas = [page, await contextos[0].newPage(), await contextos[1].newPage()];
    for (const [i, p] of paginas.entries()) if (i > 0) await conSesion(p, sesiones[i]);

    await Promise.all(paginas.map((p) => p.goto(`/p/${codigo}/blackjack`)));
    for (const p of paginas) await expect(contador(p)).toHaveText("Tienes 1.000 fichas");
    // Los tres sentados antes de apostar: cada uno ve a los otros dos en la mesa.
    for (const [i, p] of paginas.entries()) {
      for (const [j, otra] of sesiones.entries()) if (j !== i) await expect(p.getByText(otra.jugador.apodo, { exact: true }).first()).toBeVisible();
    }

    await Promise.all(paginas.map((p) => apostar(p, 50)));
    for (const p of paginas) await expect(contador(p)).toHaveText("Tienes 950 fichas");

    // El reparto llega al cerrarse la ventana de apuestas (15 s): dos cartas para cada uno y la banca con una tapada.
    for (const p of paginas) {
      await expect(tuMano(p)).toHaveCount(2, { timeout: 30_000 });
      await expect(banca(p)).toHaveCount(2);
      await expect(p.getByRole("group", { name: "Banca" }).getByRole("img", { name: "Carta boca abajo" })).toHaveCount(1);
    }

    // Tras el reparto la mesa puede estar en tres sitios, todos legítimos con un zapato al azar: en las decisiones (lo normal), en el
    // seguro de 10 s (la banca enseña un as, ~8 %) o con la ronda ya decidida (la banca tiene blackjack con un 10 o una figura, ~5 %).
    const plantarse = (p: Page) => p.getByRole("button", { name: "Plantarse" });
    const no = (p: Page) => p.getByRole("button", { name: "No", exact: true });
    for (const p of paginas) await expect(plantarse(p).or(no(p)).or(resultado(p))).toBeVisible();

    // Con el seguro abierto se recarga a alguien: la mano y las fichas vuelven. Quien se desconecta en el seguro cuenta como «no» (así lo
    // pide el diseño), de modo que quien recarga no tiene nada que contestar y los otros dos dicen «No».
    const enSeguro: Page[] = [];
    for (const p of paginas) if (await no(p).isVisible()) enSeguro.push(p);
    if (enSeguro.length > 0) {
      test.info().annotations.push({ type: "nota", description: "La banca enseña un as: la ronda pasa por el seguro (dos contestan «No» y quien recarga cuenta como «no»)." });
      const recargada = paginas[2];
      const antes = await tuMano(recargada).evaluateAll((cartas) => cartas.map((c) => c.getAttribute("aria-label")));
      await recargada.reload();
      await expect(tuMano(recargada)).toHaveCount(2);
      expect(await tuMano(recargada).evaluateAll((cartas) => cartas.map((c) => c.getAttribute("aria-label")))).toEqual(antes);
      await expect(contador(recargada)).toHaveText("Tienes 950 fichas");
      for (const p of paginas.slice(0, 2)) await no(p).click();
      // Han contestado todos: la banca mira al momento y sigue a las decisiones o, con blackjack, a un resultado sin decisiones.
      for (const p of paginas) await expect(plantarse(p).or(resultado(p))).toBeVisible();
    }

    // Se recarga a alguien mientras otro aún decide: la ronda sigue en decisiones mientras tanto.
    // Si la ronda ya ha pasado de las decisiones, el botón ya no está: no se espera a que vuelva.
    const decide = async (p: Page) => (await plantarse(p).isVisible()) && (await plantarse(p).isEnabled({ timeout: 1_000 }).catch(() => false));
    const quienDecide: Page[] = [];
    for (const p of paginas) if (await decide(p)) quienDecide.push(p);
    const recargada = quienDecide.length === 0 ? null : paginas.find((p) => p !== quienDecide[0])!;
    if (recargada === null) {
      // La ronda está decidida sin decisiones: o los tres tienen blackjack o lo tiene la banca (que se decide al repartir y dura 4 s, así que
      // recargar ahora podría pillar ya la ronda siguiente). Cada uno ve su resultado igualmente.
      test.info().annotations.push({ type: "nota", description: "Ronda decidida al repartir (blackjack de la banca o de los tres): no hay decisiones durante las que recargar." });
    } else {
      const antes = await tuMano(recargada).evaluateAll((cartas) => cartas.map((c) => c.getAttribute("aria-label")));
      await recargada.reload();
      await expect(tuMano(recargada)).toHaveCount(2);
      expect(await tuMano(recargada).evaluateAll((cartas) => cartas.map((c) => c.getAttribute("aria-label")))).toEqual(antes);
      await expect(contador(recargada)).toHaveText("Tienes 950 fichas");
    }

    // Se mira quién decide antes de que nadie actúe: en cuanto se planta el último que decidía, la ronda sigue sin esperar.
    const deciden: boolean[] = [];
    for (const p of paginas) deciden.push(await decide(p));
    for (const [i, p] of paginas.entries()) if (deciden[i]) await plantarse(p).click();

    for (const p of paginas) {
      await resultado(p).waitFor({ timeout: 30_000 });
      const neto = await netoMostrado(p);
      await expect(contador(p)).toHaveText(`Tienes ${miles(1000 + neto)} fichas`);
    }
  } finally {
    for (const contexto of contextos) await contexto.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Con la mesa simulada: el socket de la mesa no llega al servidor y la prueba decide qué manda la mesa.
// ---------------------------------------------------------------------------------------------------------------------

const c = carta;
/** Una mesa de prueba: el jugador que mira (`yo`) sentado, con lo que se cambie. */
function vista(sesion: RespuestaSesion, resto: Partial<VistaBJ> = {}): VistaBJ {
  return {
    ronda: 1,
    fase: "apuestas",
    finFase: Date.now() + 15_000,
    banca: [],
    totalBanca: null,
    manos: [],
    sentados: [sesion.jugador.apodo],
    yo: sesion.jugador.id,
    opciones: null,
    miSeguro: null,
    casillasLibres: 7,
    ...resto,
  };
}

const estado = mensajeEstado<VistaBJ>;

async function entrarSimulada(pagina: Page, request: Parameters<typeof registrar>[0]) {
  return baseEntrarSimulada<VistaBJ>(pagina, request, "mesa-blackjack");
}

test.describe("mesa simulada", () => {
  test("la mesa dormida invita a apostar y deja las fichas activas; «Apostar» manda la apuesta", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion, { fase: "esperando", finFase: null })));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(page.getByText("Apuesta para empezar la ronda")).toBeVisible();
    for (const valor of [10, 25, 50, 100, 500]) await expect(page.getByRole("button", { name: `Añadir ${valor}`, exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Añadir 25", exact: true }).click();
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    await page.getByRole("button", { name: "Apostar 75" }).click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "apostar", cantidad: 75 });
  });

  test("lo que preparas se apila en tu casilla del tapete, en grande; «Todo» prepara todas tus fichas; al apostar queda apostada y al repartir se va", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);
    const casilla = page.locator(".bj-yo .casilla, .bj-asiento--yo .casilla");

    await expect(contador(page)).toHaveText("Tienes 1.000 fichas");
    await expect(casilla).toHaveAttribute("data-estado", "vacia");
    await expect(casilla).toContainText("Tu apuesta");

    await page.getByRole("button", { name: "Añadir 100", exact: true }).click();
    await page.getByRole("button", { name: "Añadir 25", exact: true }).click();
    await expect(casilla).toHaveAttribute("data-estado", "preparada");
    await expect(casilla).toContainText("Preparada");
    await expect(casilla).toContainText("125");
    await expect(casilla.locator(".casilla__ficha")).toHaveCount(2);
    // La cantidad se ve en grande: más que el texto normal de la mesa.
    const alto = await casilla.locator(".casilla__cantidad").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(alto).toBeGreaterThanOrEqual(32);

    // Sin tope: «Todo» prepara tus 1.000 y apaga el resto de fichas.
    await page.getByRole("button", { name: "Todo", exact: true }).click();
    await expect(casilla).toContainText("¡Todo!");
    await expect(casilla).toContainText("1.000");
    for (const valor of [10, 25, 50, 100, 500]) await expect(page.getByRole("button", { name: `Añadir ${valor}`, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Apostar 1.000" }).click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "apostar", cantidad: 1000 });

    // La mesa confirma: tu casilla pasa a apostada (aro dorado).
    const mano = { jugadorId: sesion.jugador.id, apodo: sesion.jugador.apodo, casilla: 0, indice: 0, apuesta: 1000, cartas: [], estado: "jugando" as const, doblada: false, dividida: false, total: 0 };
    mesa.enviar(estado(vista(sesion, { manos: [mano] })));
    await expect(casilla).toHaveAttribute("data-estado", "apostada");
    await expect(casilla).toContainText("Apostada");

    // Al repartir, la casilla deja su sitio a tus cartas; tu apuesta sigue junto a tu total.
    mesa.enviar(estado(vista(sesion, { fase: "decisiones", manos: [{ ...mano, cartas: [carta("10H"), carta("9C")], total: 19 }] })));
    await expect(casilla).toHaveCount(0);
    await expect(page.locator(".bj-etiqueta .bj-apuesta").first()).toContainText("1.000");
  });

  // ---- Apostar con dos manos ----

  const segundaMano = (pagina: Page): Locator => pagina.getByRole("button", { name: "+ Segunda mano", exact: true });
  const casillaDe = (pagina: Page, cual: "primera" | "segunda"): Locator => pagina.getByRole("button", { name: `Casilla de la ${cual} mano` });
  /** Tus casillas del tapete (la pila, la cantidad y su estado), en orden. */
  const misCasillas = (pagina: Page): Locator => pagina.locator(".bj-yo .casilla, .bj-asiento--yo .casilla");
  const apuestasMandadas = (mesa: { recibidas: unknown[] }) => mesa.recibidas.filter((m) => (m as { t: string }).t === "apostar");
  /** Una mano recién apostada, sin cartas: la que enseña la mesa al confirmar una apuesta. */
  const manoApostada = (sesion: RespuestaSesion, casilla: number, indice: number, apuesta: number): VistaBJ["manos"][number] => ({
    jugadorId: sesion.jugador.id,
    apodo: sesion.jugador.apodo,
    casilla,
    indice,
    apuesta,
    cartas: [],
    estado: "jugando",
    doblada: false,
    dividida: false,
    total: 0,
  });

  test("con casillas libres se juega una segunda mano: «Apostar 100 + 50» manda la primera y, confirmada, la segunda", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(contador(page)).toHaveText("Tienes 1.000 fichas");
    // Con una sola casilla no hay nada que elegir: la casilla no es un botón.
    await expect(casillaDe(page, "primera")).toHaveCount(0);

    await page.getByRole("button", { name: "Añadir 100", exact: true }).click();
    await segundaMano(page).click();
    // Aparece la segunda casilla, elegida: las fichas van a ella.
    await expect(casillaDe(page, "primera")).toHaveAttribute("aria-pressed", "false");
    await expect(casillaDe(page, "segunda")).toHaveAttribute("aria-pressed", "true");
    await expect(segundaMano(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    await expect(misCasillas(page).nth(0)).toContainText("100");
    await expect(misCasillas(page).nth(1)).toContainText("50");

    await page.getByRole("button", { name: "Apostar 100 + 50" }).click();
    await expect.poll(() => apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 100 }]);
    // Hasta que la mesa no confirma la primera, la segunda no sale.
    await page.waitForTimeout(300);
    expect(apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 100 }]);

    // La mesa confirma la primera: la segunda se manda sola, con `segunda: true`.
    mesa.enviar(estado(vista(sesion, { casillasLibres: 6, manos: [manoApostada(sesion, 0, 0, 100)] })));
    await expect.poll(() => apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 100 }, { t: "apostar", cantidad: 50, segunda: true }]);
    const casillas = misCasillas(page);
    await expect(casillas).toHaveCount(2);
    await expect(casillas.nth(0)).toHaveAttribute("data-estado", "apostada");
    await expect(casillas.nth(1)).toHaveAttribute("data-estado", "preparada");

    // Confirmada la segunda, las dos casillas quedan apostadas y la barra de tus fichas se pone al día.
    mesa.enviar(estado(vista(sesion, { casillasLibres: 5, manos: [manoApostada(sesion, 0, 0, 100), manoApostada(sesion, 1, 1, 50)] })));
    await expect(casillas.nth(1)).toHaveAttribute("data-estado", "apostada");
    await expect(casillas.nth(0)).toContainText("100");
    await expect(casillas.nth(1)).toContainText("50");
    expect(apuestasMandadas(mesa)).toHaveLength(2);
  });

  test("las fichas y «Todo» van a la casilla elegida; «Todo» pone ahí lo que te queda", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(contador(page)).toHaveText("Tienes 1.000 fichas");

    await page.getByRole("button", { name: "Añadir 100", exact: true }).click();
    await segundaMano(page).click();
    await page.getByRole("button", { name: "Todo", exact: true }).click();
    // Quedaban 900: la segunda casilla se lleva todo eso y la primera sigue con sus 100.
    await expect(misCasillas(page).nth(1)).toContainText("900");
    await expect(misCasillas(page).nth(1)).toContainText("¡Todo!");
    await expect(misCasillas(page).nth(0)).toContainText("100");
    await expect(misCasillas(page).nth(0)).not.toContainText("¡Todo!");
    await expect(page.getByRole("button", { name: "Apostar 100 + 900" })).toBeEnabled();
    // No queda nada que sumar a ninguna de las dos.
    for (const valor of [10, 25, 50, 100, 500]) await expect(page.getByRole("button", { name: `Añadir ${valor}`, exact: true })).toBeDisabled();

    // Elegir la primera: sigue sin haber fichas libres, pero «Borrar» solo la vacía a ella.
    await casillaDe(page, "primera").click();
    await expect(casillaDe(page, "primera")).toHaveAttribute("aria-pressed", "true");
    await expect(casillaDe(page, "segunda")).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Borrar apuesta" }).click();
    await expect(misCasillas(page).nth(0)).not.toContainText("100");
    await expect(misCasillas(page).nth(1)).toContainText("900");
    await expect(page.getByRole("button", { name: "Elige tu apuesta" })).toBeDisabled();
    // Ahora sí hay 100 libres para la primera.
    await page.getByRole("button", { name: "Añadir 100", exact: true }).click();
    await expect(page.getByRole("button", { name: "Apostar 100 + 900" })).toBeEnabled();
  });

  test("una segunda casilla vacía se quita con «Quitar segunda mano» y apostar manda solo la primera", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);

    await page.getByRole("button", { name: "Añadir 25", exact: true }).click();
    await segundaMano(page).click();
    await expect(casillaDe(page, "segunda")).toBeVisible();
    // Sin nada preparado en la segunda, «Apostar» manda solo la primera.
    await expect(page.getByRole("button", { name: "Apostar 25", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Quitar segunda mano" }).click();
    await expect(casillaDe(page, "segunda")).toHaveCount(0);
    await expect(segundaMano(page)).toBeVisible();

    await page.getByRole("button", { name: "Apostar 25", exact: true }).click();
    await expect.poll(() => apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 25 }]);
    mesa.enviar(estado(vista(sesion, { casillasLibres: 6, manos: [manoApostada(sesion, 0, 0, 25)] })));
    await expect(misCasillas(page)).toHaveAttribute("data-estado", "apostada");
    await page.waitForTimeout(300);
    expect(apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 25 }]);
  });

  test("sin casillas libres no aparece «+ Segunda mano»", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion, { casillasLibres: 0 })));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(page.getByText("Haz tu apuesta")).toBeVisible();
    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeEnabled();
    await expect(segundaMano(page)).toHaveCount(0);
    // Con una sola libre tampoco: la primera apuesta se la llevaría y la segunda no tendría casilla.
    mesa.enviar(estado(vista(sesion, { casillasLibres: 1 })));
    await expect(page.getByText("Haz tu apuesta")).toBeVisible();
    await expect(segundaMano(page)).toHaveCount(0);
    mesa.enviar(estado(vista(sesion, { casillasLibres: 2 })));
    await expect(segundaMano(page)).toBeVisible();
  });

  test("la segunda recibe sin_casilla: aviso «Ya no quedan casillas libres» y te quedas con una mano", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);

    await page.getByRole("button", { name: "Añadir 100", exact: true }).click();
    await segundaMano(page).click();
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    await page.getByRole("button", { name: "Apostar 100 + 50" }).click();
    mesa.enviar(estado(vista(sesion, { casillasLibres: 1, manos: [manoApostada(sesion, 0, 0, 100)] })));
    await expect.poll(() => apuestasMandadas(mesa)).toHaveLength(2);

    // Otro jugador se llevó la última casilla en el mismo instante.
    mesa.enviar({ t: "error", codigo: "sin_casilla" });
    await expect(page.getByText("Ya no quedan casillas libres")).toBeVisible();
    const casillas = misCasillas(page);
    await expect(casillas).toHaveCount(1);
    await expect(casillas).toHaveAttribute("data-estado", "apostada");
    await expect(casillas).toContainText("100");
    await expect(casillaDe(page, "segunda")).toHaveCount(0);
    // Y no se reintenta sola.
    await page.waitForTimeout(300);
    expect(apuestasMandadas(mesa)).toHaveLength(2);
  });

  test("si la primera apuesta falla, la segunda no sale y se puede volver a intentar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);

    await page.getByRole("button", { name: "Añadir 100", exact: true }).click();
    await segundaMano(page).click();
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    const apostar = page.getByRole("button", { name: "Apostar 100 + 50" });
    await apostar.click();
    await expect.poll(() => apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 100 }]);
    mesa.enviar({ t: "error", codigo: "sin_fichas" });
    await expect(page.getByText("No tienes fichas suficientes")).toBeVisible();
    // Las dos casillas siguen como estaban y el botón vuelve a estar listo.
    await expect(misCasillas(page)).toHaveCount(2);
    await expect(apostar).toBeEnabled();
    await page.waitForTimeout(300);
    expect(apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 100 }]);

    await apostar.click();
    await expect.poll(() => apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 100 }, { t: "apostar", cantidad: 100 }]);
    mesa.enviar(estado(vista(sesion, { casillasLibres: 6, manos: [manoApostada(sesion, 0, 0, 100)] })));
    await expect.poll(() => apuestasMandadas(mesa).at(-1)).toEqual({ t: "apostar", cantidad: 50, segunda: true });
  });

  test("un doble toque en «Apostar 100 + 50» manda cada apuesta una sola vez", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);

    await page.getByRole("button", { name: "Añadir 100", exact: true }).click();
    await segundaMano(page).click();
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    await page.getByRole("button", { name: "Apostar 100 + 50" }).dblclick();
    await expect.poll(() => apuestasMandadas(mesa).length).toBe(1);
    await page.waitForTimeout(300);
    expect(apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 100 }]);

    // Confirmada la primera: la segunda sale una vez, y otra novedad de la mesa con la misma mano no la repite.
    const confirmada = vista(sesion, { casillasLibres: 6, manos: [manoApostada(sesion, 0, 0, 100)] });
    mesa.enviar(estado(confirmada));
    await expect.poll(() => apuestasMandadas(mesa).length).toBe(2);
    mesa.enviar(estado({ ...confirmada, sentados: [sesion.jugador.apodo, "Otro"] }));
    await page.waitForTimeout(300);
    expect(apuestasMandadas(mesa)).toEqual([{ t: "apostar", cantidad: 100 }, { t: "apostar", cantidad: 50, segunda: true }]);
  });

  test("las fichas que no puedes pagar no se pueden pulsar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 60);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(contador(page)).toHaveText("Tienes 60 fichas");
    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Añadir 100", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Añadir 500", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    // 50 + 25 pasaría de 60: ya no se puede añadir.
    await expect(page.getByRole("button", { name: "Añadir 25", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Añadir 10", exact: true })).toBeEnabled();
  });

  test("errores de la mesa: textos para el jugador, y el exceso de mensajes no se enseña", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByText("Haz tu apuesta")).toBeVisible();

    // Solo, el exceso de mensajes no enseña nada. Detrás va un cambio visible por el mismo socket: cuando se ve, el error
    // ya se ha atendido (y, si se enseñara, seguiría a la vista 4 s). Se cuenta en ese momento, sin reintentos: esperar a
    // que el recuento baje a 0 daría por buena también una alerta que se va sola.
    mesa.enviar({ t: "error", codigo: "demasiados_mensajes" });
    mesa.enviar(estado(vista(sesion, { fase: "esperando", finFase: null })));
    await expect(page.getByText("Apuesta para empezar la ronda")).toBeVisible();
    expect(await page.getByRole("alert").count()).toBe(0);

    mesa.enviar({ t: "error", codigo: "sin_fichas" });
    await expect(page.getByText("No tienes fichas suficientes")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(1);

    // La mesa no pudo atender y no respondía a nada tuyo (al llegar): el texto general.
    mesa.enviar({ t: "error", codigo: "no_disponible" });
    await expect(page.getByText("Algo ha salido mal. Inténtalo de nuevo")).toBeVisible();
    // Responde a tu apuesta: entonces sí es la apuesta lo que no se hizo.
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    await page.getByRole("button", { name: "Apostar 50" }).click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "apostar", cantidad: 50 });
    mesa.enviar({ t: "error", codigo: "no_disponible" });
    await expect(page.getByText("No se pudo hacer la apuesta. Inténtalo de nuevo")).toBeVisible();

    mesa.enviar({ t: "error", codigo: "fase_incorrecta" });
    await expect(page.getByText("No puedes hacer eso ahora")).toBeVisible();
  });

  test("si la mesa no puede atender una decisión, lo dice con el texto general (no el de la apuesta) y se puede volver a pedir", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const mano = { jugadorId: sesion.jugador.id, apodo: sesion.jugador.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: [c("10H"), c("2C")], estado: "jugando" as const, doblada: false, dividida: false, total: 12 };
    mesa.alConectar(estado(vista(sesion, { fase: "decisiones", banca: [c("6S"), null], totalBanca: 6, manos: [mano] })));
    await page.goto(`/p/${codigo}/blackjack`);
    const pedir = page.getByRole("button", { name: "Pedir" });
    await pedir.click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "pedir" });
    await expect(pedir).toBeDisabled();

    mesa.enviar({ t: "error", codigo: "no_disponible" });
    await expect(page.getByText("Algo ha salido mal. Inténtalo de nuevo")).toBeVisible();
    await expect(page.getByText("No se pudo hacer la apuesta. Inténtalo de nuevo")).toHaveCount(0);
    await expect(pedir).toBeEnabled();
  });

  test("con la mesa llena lo dice y no reintenta", async ({ page, request }) => {
    const { codigo, mesa } = await entrarSimulada(page, request);
    await page.goto(`/p/${codigo}/blackjack`);
    await expect.poll(() => mesa.conexiones()).toBeGreaterThan(0);
    // En desarrollo, el modo estricto de React abre y cierra una primera conexión: se espera a que se asiente.
    await page.waitForTimeout(500);
    const abiertas = mesa.conexiones();
    mesa.enviar({ t: "error", codigo: "mesa_llena" });
    await mesa.cerrar(4003);

    await expect(page.getByText("La mesa está llena")).toBeVisible();
    // partysocket reintenta en 1–5 s: pasado ese rato no debe haber ninguna conexión nueva.
    await page.waitForTimeout(6_000);
    expect(mesa.conexiones()).toBe(abiertas);
    await page.getByRole("link", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
  });

  test("reparto, giro de la tapada y premio: «¡Ganas +50!», el resultado y el contador al día", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const yo = sesion.jugador.id;
    const fichas = await fichasDeApi(page, 950);
    const mano = (cartas: Carta[], total: number, estadoMano: VistaBJ["manos"][number]["estado"] = "jugando") => ({
      jugadorId: yo,
      apodo: sesion.jugador.apodo,
      casilla: 0,
      indice: 0,
      apuesta: 50,
      cartas,
      estado: estadoMano,
      doblada: false,
      dividida: false,
      total,
    });
    mesa.alConectar(estado(vista(sesion, { manos: [mano([], 0)] })));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByText("Apuesta hecha")).toBeVisible();

    // Reparto: jugador, banca, jugador, banca tapada.
    mesa.enviar(
      estado(vista(sesion, { fase: "decisiones", banca: [c("6S"), null], totalBanca: 6, manos: [mano([c("10H"), c("9C")], 19)] }), [
        { tipo: "carta_repartida", a: yo, oculta: false, carta: c("10H") },
        { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("6S") },
        { tipo: "carta_repartida", a: yo, oculta: false, carta: c("9C") },
        { tipo: "carta_repartida", a: "banca", oculta: true },
      ]),
    );
    await expect(tuMano(page)).toHaveCount(2);
    await expect(page.getByRole("img", { name: "10 de corazones" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Carta boca abajo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Plantarse" })).toBeEnabled();

    await page.getByRole("button", { name: "Plantarse" }).click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "plantarse" });

    // La banca gira 10 de diamantes (16), pide un 9 y se pasa: gana el jugador.
    fichas.poner(1050);
    mesa.enviar(
      estado(
        vista(sesion, {
          fase: "resultado",
          finFase: Date.now() + 4_000,
          banca: [c("6S"), c("10D"), c("9C")],
          totalBanca: 25,
          manos: [mano([c("10H"), c("9C")], 19, "plantado")],
        }),
        [
          { tipo: "carta_girada", carta: c("10D") },
          { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("9C") },
          { tipo: "pago", jugadorId: yo, neto: 50 },
        ],
      ),
    );
    await expect(page.getByRole("img", { name: "Carta boca abajo" })).toHaveCount(0);
    await expect(page.getByText("¡Ganas +50!")).toBeVisible();
    await expect(resultado(page)).toHaveText("Ganas 50");
    await expect(contador(page)).toHaveText("Tienes 1.050 fichas");
    // La cuenta atrás va pegada a su frase («Nueva ronda en 0:04»), no al otro extremo de la línea.
    const piezas = page.locator(".estado-mesa__fila > *");
    expect(await piezas.allInnerTexts()).toEqual(["Nueva ronda en", expect.stringMatching(/^\d:\d\d$/)]);
    const [frase, cuenta] = await Promise.all([0, 1].map((i) => piezas.nth(i).boundingBox()));
    expect(cuenta!.x - (frase!.x + frase!.width)).toBeLessThan(20);
  });

  test("«← Sala» con apuesta en juego pide confirmación y manda salir; sin apuesta sale sin preguntar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const conApuesta = vista(sesion, {
      fase: "decisiones",
      banca: [c("6S"), null],
      totalBanca: 6,
      manos: [{ jugadorId: sesion.jugador.id, apodo: sesion.jugador.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: [c("10H"), c("9C")], estado: "jugando", doblada: false, dividida: false, total: 19 }],
    });
    mesa.alConectar(estado(conApuesta));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(tuMano(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Volver a la sala" }).click();
    const dialogo = page.getByRole("dialog", { name: "¿Salir de la mesa?" });
    await expect(dialogo.getByText("Si sales ahora pierdes tu apuesta")).toBeVisible();
    await dialogo.getByRole("button", { name: "Seguir jugando" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page).toHaveURL(`/p/${codigo}/blackjack`);
    expect(mesa.recibidas).not.toContainEqual({ t: "salir" });

    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await dialogo.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    const salidas = () => mesa.recibidas.filter((m) => (m as { t: string }).t === "salir").length;
    await expect.poll(salidas).toBe(1);

    // Sin apuesta: directo a la sala, y también deja el asiento.
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByText("Haz tu apuesta")).toBeVisible();
    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    await expect.poll(salidas).toBe(2);
  });

  test("durante la banca la ronda ya está decidida: «← Sala» sale sin preguntar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const mano = { jugadorId: sesion.jugador.id, apodo: sesion.jugador.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: [c("10H"), c("9C")], estado: "plantado" as const, doblada: false, dividida: false, total: 19 };
    mesa.alConectar(estado(vista(sesion, { fase: "banca", finFase: Date.now() + 60_000, banca: [c("6S"), null], totalBanca: 6, manos: [mano] })));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(tuMano(page)).toHaveCount(2);

    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    await expect(page.getByRole("dialog", { name: "¿Salir de la mesa?" })).toHaveCount(0);
    await expect.poll(() => mesa.recibidas.filter((m) => (m as { t: string }).t === "salir").length).toBe(1);
  });

  test("el contador se pone al día al reconectar con la ronda ya liquidada (sin evento de pago) y al cambiar de ronda", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const fichas = await fichasDeApi(page, 950);
    const mano = { jugadorId: sesion.jugador.id, apodo: sesion.jugador.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: [c("10H"), c("9C")], estado: "plantado" as const, doblada: false, dividida: false, total: 19 };
    mesa.alConectar(estado(vista(sesion, { fase: "banca", finFase: Date.now() + 1_000, banca: [c("6S"), null], totalBanca: 6, manos: [mano] })));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(contador(page)).toHaveText("Tienes 950 fichas");
    await page.waitForLoadState("networkidle");

    // La ronda se paga con la conexión caída: al volver, la mesa manda la foto ya en «resultado», sin eventos.
    fichas.poner(1050);
    mesa.alConectar(
      estado(vista(sesion, { fase: "resultado", finFase: Date.now() + 4_000, banca: [c("6S"), c("KD"), c("9C")], totalBanca: 25, manos: [mano] })),
    );
    await mesa.cerrar(1001);
    await expect(contador(page)).toHaveText("Tienes 1.050 fichas", { timeout: 15_000 });

    // Un pago que llega tarde (reintento de la liquidación) no trae evento: la ronda siguiente vuelve a leer las fichas.
    fichas.poner(1100);
    mesa.enviar(estado(vista(sesion, { ronda: 2 })));
    await expect(contador(page)).toHaveText("Tienes 1.100 fichas");
  });

  test("mientras «Pedir» espera respuesta, una novedad de otro jugador no lo reactiva: un doble toque pide una sola carta", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const yo = sesion.jugador.id;
    const mia = (cartas: Carta[]) => ({ jugadorId: yo, apodo: sesion.jugador.apodo, casilla: 0, indice: 0, apuesta: 50, cartas, estado: "jugando" as const, doblada: false, dividida: false, total: 0 });
    const otra = (cartas: Carta[]) => ({ jugadorId: 900, apodo: "Otro", casilla: 0, indice: 0, apuesta: 50, cartas, estado: "jugando" as const, doblada: false, dividida: false, total: 0 });
    const mesaCon = (mias: Carta[], otras: Carta[]) =>
      vista(sesion, { fase: "decisiones", banca: [c("6S"), null], totalBanca: 6, sentados: [sesion.jugador.apodo, "Otro"], manos: [mia(mias), otra(otras)] });
    mesa.alConectar(estado(mesaCon([c("10H"), c("2C")], [c("5D"), c("3S")])));
    await page.goto(`/p/${codigo}/blackjack`);
    const pedir = page.getByRole("button", { name: "Pedir" });
    const pedidas = () => mesa.recibidas.filter((m) => (m as { t: string }).t === "pedir").length;
    await expect(pedir).toBeEnabled();

    await pedir.click();
    await expect.poll(pedidas).toBe(1);
    // Antes de contestar, la mesa difunde que el otro jugador ha pedido carta.
    mesa.enviar(estado(mesaCon([c("10H"), c("2C")], [c("5D"), c("3S"), c("KH")]), [{ tipo: "carta_repartida", a: 900, oculta: false, carta: c("KH") }]));
    if (test.info().project.name === "desktop") await expect(page.getByRole("group", { name: "Mano de Otro" }).getByRole("img")).toHaveCount(3);
    else await expect(page.getByRole("list", { name: "Otros jugadores" }).getByText("18")).toBeVisible();
    await expect(pedir).toBeDisabled();
    await pedir.click({ force: true });
    await page.waitForTimeout(300);
    expect(pedidas()).toBe(1);

    // Llega tu carta: ya se puede volver a pedir.
    mesa.enviar(estado(mesaCon([c("10H"), c("2C"), c("4D")], [c("5D"), c("3S"), c("KH")]), [{ tipo: "carta_repartida", a: yo, oculta: false, carta: c("4D") }]));
    await expect(pedir).toBeEnabled();
  });

  test("si la mesa no llega a contestar, lo dice y deja volver a la sala", async ({ page, request }) => {
    const { codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(null);
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByText("No conseguimos sentarte en la mesa")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
  });

  test("si la mesa cierra la primera conexión sin reintento posible (4401), lo dice y deja volver a la sala", async ({ page, request }) => {
    const { codigo, mesa } = await entrarSimulada(page, request);
    mesa.cerrarAlConectar(4401);
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByText("No conseguimos sentarte en la mesa")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Volver a la sala" })).toBeVisible();
  });

  // ---- Varias manos, dividir y rendirse ----

  type ManoDeLaVista = VistaBJ["manos"][number];
  type Opciones = NonNullable<VistaBJ["opciones"]>;
  /** Lo que permiten las reglas: por defecto, pedir, plantarse y doblar. */
  const opciones = (resto: Partial<Opciones> = {}): Opciones => ({ pedir: true, plantarse: true, doblar: true, dividir: false, rendirse: false, seguro: null, ...resto });
  /** Una mano de un jugador: por defecto, tuya y de 50 fichas. */
  const mano = (jugador: { id: number; apodo: string }, indice: number, cartas: Carta[], resto: Partial<ManoDeLaVista> = {}): ManoDeLaVista => ({
    jugadorId: jugador.id,
    apodo: jugador.apodo,
    casilla: indice,
    indice,
    apuesta: 50,
    cartas,
    estado: "jugando",
    doblada: false,
    dividida: false,
    total: 0,
    ...resto,
  });
  /** La mesa en las decisiones, con la banca enseñando un 6. */
  const enDecisiones = (sesion: RespuestaSesion, manos: ManoDeLaVista[], resto: Partial<VistaBJ> = {}): VistaBJ =>
    vista(sesion, { fase: "decisiones", banca: [c("6S"), null], totalBanca: 6, manos, opciones: opciones(), ...resto });
  const botonDe = (pagina: Page, nombre: string): Locator => pagina.getByRole("button", { name: nombre, exact: true });
  const tuManoN = (pagina: Page, n: number): Locator => pagina.getByRole("group", { name: `Tu mano ${n}`, exact: true });
  const nombresDe = (grupo: Locator): Promise<(string | null)[]> => grupo.getByRole("img").evaluateAll((cartas) => cartas.map((x) => x.getAttribute("aria-label")));

  /**
   * Un bucle de fotogramas que anota, en cada uno, dónde está cada carta de `nombres` (las que están en una mano de la mesa): su
   * caja, su opacidad y su `transform` (una animación de transform sin cambiar la opacidad también se cuenta), y cuántas manos tuyas
   * se ven. Para ver si una carta se desliza, si desaparece en algún fotograma o si sale volando desde el mazo.
   */
  async function muestrearCartas(pagina: Page, nombres: string[]): Promise<void> {
    await pagina.evaluate((nombresAMirar) => {
      const w = window as unknown as { __muestras: Muestra[] };
      w.__muestras = [];
      const fotograma = (t: number) => {
        const cartas: Muestra["cartas"] = {};
        for (const nombre of nombresAMirar) {
          cartas[nombre] = [...document.querySelectorAll(".bj-mano [role=img]")]
            .filter((el) => el.getAttribute("aria-label") === nombre)
            .map((el) => {
              const r = el.getBoundingClientRect();
              const estilo = getComputedStyle(el);
              return { x: r.x + r.width / 2, y: r.y + r.height / 2, ancho: r.width, opacidad: Number(estilo.opacity), transform: estilo.transform };
            });
        }
        const manos = [...document.querySelectorAll("[role=group]")].filter((el) => /^Tu mano \d/.test(el.getAttribute("aria-label") ?? "")).length;
        w.__muestras.push({ t, manos, cartas });
        requestAnimationFrame(fotograma);
      };
      requestAnimationFrame(fotograma);
    }, nombres);
  }
  interface Muestra {
    t: number;
    /** Cuántas manos tuyas («Tu mano 1», «Tu mano 2»…) se ven en ese fotograma. */
    manos: number;
    cartas: Record<string, { x: number; y: number; ancho: number; opacidad: number; transform: string }[]>;
  }
  const muestras = (pagina: Page): Promise<Muestra[]> => pagina.evaluate(() => (window as unknown as { __muestras: Muestra[] }).__muestras);
  const cuantasMuestras = (pagina: Page): Promise<number> => pagina.evaluate(() => (window as unknown as { __muestras: unknown[] }).__muestras.length);
  /** Las muestras de una carta desde la muestra `desde`, ya sin las vacías: dónde estaba en cada fotograma. */
  const sitiosDe = (todas: Muestra[], nombre: string, desde = 0) => todas.slice(desde).map((m) => m.cartas[nombre]);

  test("al dividir se ven dos manos: la segunda carta se desliza a la nueva y llegan las cartas nuevas", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 900);
    const yo = sesion.jugador;
    mesa.alConectar(estado(enDecisiones(sesion, [mano(yo, 0, [c("8S"), c("8C")], { casilla: 0 })], { opciones: opciones({ dividir: true, rendirse: true }) })));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(tuMano(page)).toHaveCount(2);
    await expect(botonDe(page, "Dividir")).toBeEnabled();

    // Se mira, fotograma a fotograma, la que se va a la mano nueva y las dos que llegan del mazo.
    await muestrearCartas(page, ["8 de tréboles", "3 de corazones", "5 de diamantes"]);
    await botonDe(page, "Dividir").click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "dividir" });
    await page.waitForTimeout(300);
    const marca = await cuantasMuestras(page);
    mesa.enviar(
      estado(
        enDecisiones(
          sesion,
          [mano(yo, 0, [c("8S"), c("3H")], { casilla: 0, dividida: true, apuesta: 50 }), mano(yo, 1, [c("8C"), c("5D")], { casilla: 0, dividida: true, apuesta: 50 })],
          { opciones: opciones() },
        ),
        [
          { tipo: "mano_dividida", jugadorId: yo.id, casilla: 0, indice: 0 },
          { tipo: "carta_repartida", a: yo.id, mano: 0, oculta: false, carta: c("3H") },
          { tipo: "carta_repartida", a: yo.id, mano: 1, oculta: false, carta: c("5D") },
        ],
      ),
    );
    await expect(tuManoN(page, 2).getByRole("img")).toHaveCount(2);
    await expect(tuManoN(page, 1).getByRole("img")).toHaveCount(2);
    // Cuando han llegado las cartas nuevas y se ha parado todo.
    await page.waitForTimeout(1_800);

    // Cada carta, en su mano: la que se movió (el 8 de tréboles) y la nueva (el 5 de diamantes) en la segunda; el 3 de corazones, en la primera.
    expect(await nombresDe(tuManoN(page, 1))).toEqual(["8 de picas", "3 de corazones"]);
    expect(await nombresDe(tuManoN(page, 2))).toEqual(["8 de tréboles", "5 de diamantes"]);
    await expect(page.getByText("Mano 1 de 2")).toBeVisible();

    const todas = await muestras(page);
    // El 8 de tréboles existe, una sola vez y visible, en todos los fotogramas: antes, durante y después de dividir.
    const movida = sitiosDe(todas, "8 de tréboles", Math.max(marca - 10, 0));
    expect(movida.length).toBeGreaterThan(30);
    for (const [i, sitios] of movida.entries()) {
      expect(sitios, `fotograma ${i}: el 8 de tréboles debe estar una vez`).toHaveLength(1);
      expect(sitios[0].opacidad, `fotograma ${i}: el 8 de tréboles debe verse`).toBeGreaterThan(0.99);
    }
    // Y se desliza: parte de un sitio, acaba en otro y pasa por sitios intermedios (no salta).
    const trayecto = movida.map((sitios) => sitios[0]);
    const final = trayecto.at(-1)!;
    const distancia = (p: { x: number; y: number }) => Math.hypot(p.x - final.x, p.y - final.y);
    const recorrido = Math.max(...trayecto.map(distancia));
    expect(recorrido, "la carta se mueve de verdad").toBeGreaterThan(8);
    const intermedios = trayecto.filter((p) => distancia(p) > 2 && distancia(p) < recorrido - 2);
    expect(intermedios.length, "pasa por sitios intermedios").toBeGreaterThanOrEqual(2);
    expect(distancia(trayecto.at(-1)!)).toBeLessThan(1);

    // Las cartas nuevas vuelan desde el mazo: la primera vez que se ven, lejos de su sitio.
    for (const nombre of ["3 de corazones", "5 de diamantes"]) {
      const trayectoNueva = sitiosDe(todas, nombre, marca).filter((sitios) => sitios.length === 1 && sitios[0].opacidad > 0).map((sitios) => sitios[0]);
      expect(trayectoNueva.length, `${nombre} aparece`).toBeGreaterThan(5);
      const llegada = trayectoNueva.at(-1)!;
      expect(Math.hypot(trayectoNueva[0].x - llegada.x, trayectoNueva[0].y - llegada.y), `${nombre} sale lejos de su sitio (el mazo)`).toBeGreaterThan(40);
    }
  });

  test.describe("con movimiento reducido", () => {
    test.use({ reducedMotion: "reduce" });

    test("dividir no desliza ni hace volar nada: la carta cambia de mano de golpe y las nuevas aparecen en su sitio", async ({ page, request }) => {
      const { sesion, codigo, mesa } = await entrarSimulada(page, request);
      await fichasDeApi(page, 900);
      const yo = sesion.jugador;
      mesa.alConectar(estado(enDecisiones(sesion, [mano(yo, 0, [c("8S"), c("8C")])], { opciones: opciones({ dividir: true }) })));
      await page.goto(`/p/${codigo}/blackjack`);
      await expect(tuMano(page)).toHaveCount(2);

      await muestrearCartas(page, ["8 de tréboles", "3 de corazones", "5 de diamantes"]);
      await page.waitForTimeout(300);
      const marca = await cuantasMuestras(page);
      mesa.enviar(
        estado(
          enDecisiones(sesion, [mano(yo, 0, [c("8S"), c("3H")], { dividida: true }), mano(yo, 1, [c("8C"), c("5D")], { dividida: true })]),
          [
            { tipo: "mano_dividida", jugadorId: yo.id, casilla: 0, indice: 0 },
            { tipo: "carta_repartida", a: yo.id, mano: 0, oculta: false, carta: c("3H") },
            { tipo: "carta_repartida", a: yo.id, mano: 1, oculta: false, carta: c("5D") },
          ],
        ),
      );
      await expect(tuManoN(page, 2).getByRole("img")).toHaveCount(2);
      await page.waitForTimeout(1_500);

      const todas = await muestras(page);
      // La carta movida está en un sitio antes y en otro después, sin pasar por ninguno intermedio y sin dejar de verse.
      const movida = sitiosDe(todas, "8 de tréboles", marca).map((sitios) => sitios[0]);
      expect(movida.every((p) => p !== undefined && p.opacidad > 0.99)).toBe(true);
      expect(new Set(movida.map((p) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.ancho)}`)).size, "solo el sitio de antes y el de después").toBeLessThanOrEqual(2);
      // Las nuevas se funden donde van a quedar: no se mueven en ningún fotograma.
      for (const nombre of ["3 de corazones", "5 de diamantes"]) {
        const vistas = sitiosDe(todas, nombre, marca).filter((sitios) => sitios.length === 1 && sitios[0].opacidad > 0).map((sitios) => sitios[0]);
        expect(vistas.length, `${nombre} aparece`).toBeGreaterThan(3);
        for (const p of vistas) expect(Math.hypot(p.x - vistas[0].x, p.y - vistas[0].y) + Math.abs(p.ancho - vistas[0].ancho), `${nombre} no se mueve`).toBeLessThan(0.5);
      }
      expect(await page.locator(".bj-mano .naipe").evaluateAll((cartas) => cartas.map((x) => getComputedStyle(x).transform))).toEqual(["none", "none", "none", "none", "none", "none"]);
    });
  });

  test("la mano activa va subrayada con «Mano 2 de 3» y Pedir actúa sobre ella", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 800);
    const yo = sesion.jugador;
    const manos = (estados: ManoDeLaVista["estado"][]) =>
      [[c("10H"), c("9C")], [c("5S"), c("6D")], [c("8C"), c("2H")]].map((cartas, i) => mano(yo, i, cartas, { casilla: i === 2 ? 1 : 0, dividida: i < 2, estado: estados[i] }));
    mesa.alConectar(estado(enDecisiones(sesion, manos(["plantado", "jugando", "jugando"]))));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(page.getByText("Mano 2 de 3")).toBeVisible();
    // Solo la segunda mano lleva el subrayado dorado; las otras dos, atenuadas.
    const columnas = page.locator(".bj-yo .bj-col, .bj-asiento--yo .bj-col");
    await expect(columnas).toHaveCount(3);
    await expect(columnas.nth(1)).toHaveClass(/bj-col--activa/);
    await expect(columnas.nth(1).locator(".bj-col__subrayado")).toHaveCSS("opacity", "1");
    await expect(columnas.nth(0).locator(".bj-col__subrayado")).toHaveCSS("opacity", "0");
    await expect(columnas.nth(1)).toHaveCSS("opacity", "1");
    await expect(columnas.nth(0)).toHaveCSS("opacity", "0.6");
    await expect(columnas.nth(2)).toHaveCSS("opacity", "0.6");
    await expect(page.locator(".bj-col--activa")).toHaveCount(1);

    // Pedir no dice qué mano: el servidor la aplica a la activa.
    await page.getByRole("button", { name: "Pedir" }).click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "pedir" });
    mesa.enviar(estado(enDecisiones(sesion, manos(["plantado", "plantado", "jugando"]))));
    await expect(page.getByText("Mano 3 de 3")).toBeVisible();
    await expect(columnas.nth(2)).toHaveClass(/bj-col--activa/);
    await expect(columnas.nth(1)).toHaveCSS("opacity", "0.6");

    // Sin ninguna en juego ya no hay activa: ni etiqueta ni atenuadas; los botones se quedan, apagados.
    mesa.enviar(estado(enDecisiones(sesion, manos(["plantado", "plantado", "plantado"]), { opciones: opciones({ pedir: false, plantarse: false, doblar: false }) })));
    await expect(page.getByText(/^Mano \d de 3$/)).toHaveCount(0);
    await expect(page.locator(".bj-col--activa")).toHaveCount(0);
    await expect(columnas.nth(0)).toHaveCSS("opacity", "1");
    await expect(page.getByRole("button", { name: "Pedir" })).toBeDisabled();
  });

  test("Dividir y Rendirse solo aparecen cuando se pueden usar y si tienes fichas", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const fichas = await fichasDeApi(page, 950);
    const yo = sesion.jugador;
    const conOpciones = (o: Partial<Opciones>, ronda = 1) =>
      estado(enDecisiones(sesion, [mano(yo, 0, [c("8S"), c("8C")])], { ronda, opciones: opciones(o) }));
    mesa.alConectar(conOpciones({ dividir: true, rendirse: true }));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(contador(page)).toHaveText("Tienes 950 fichas");
    await expect(botonDe(page, "Dividir")).toBeEnabled();
    await expect(botonDe(page, "Rendirse")).toBeEnabled();
    await expect(botonDe(page, "Doblar")).toBeEnabled();
    // La fila de debajo ocupa su sitio: el panel mide lo mismo con y sin ellos (la mesa no salta).
    const altoPanel = async () => (await page.getByRole("region", { name: "Tu jugada" }).boundingBox())!.height;
    const conAmbos = await altoPanel();

    // Las reglas no los permiten: no están (y el panel no cambia).
    mesa.enviar(conOpciones({ dividir: false, rendirse: false }));
    await expect(botonDe(page, "Dividir")).toHaveCount(0);
    await expect(botonDe(page, "Rendirse")).toHaveCount(0);
    await expect(botonDe(page, "Pedir")).toBeEnabled();
    expect(await altoPanel()).toBe(conAmbos);
    mesa.enviar(conOpciones({ dividir: true, rendirse: false }));
    await expect(botonDe(page, "Dividir")).toBeVisible();
    await expect(botonDe(page, "Rendirse")).toHaveCount(0);
    mesa.enviar(conOpciones({ dividir: false, rendirse: true }));
    await expect(botonDe(page, "Rendirse")).toBeVisible();
    await expect(botonDe(page, "Dividir")).toHaveCount(0);

    // Las reglas sí, pero las fichas no cubren otra apuesta de 50: no se ofrece dividir (ni doblar), pero rendirse sí.
    fichas.poner(30);
    mesa.enviar(conOpciones({ dividir: true, rendirse: true }, 2));
    await expect(contador(page)).toHaveText("Tienes 30 fichas");
    await expect(botonDe(page, "Dividir")).toHaveCount(0);
    await expect(botonDe(page, "Doblar")).toBeDisabled();
    await expect(botonDe(page, "Rendirse")).toBeEnabled();
    expect(await altoPanel()).toBe(conAmbos);

    // Con 50 justas sí.
    fichas.poner(50);
    mesa.enviar(conOpciones({ dividir: true, rendirse: true }, 3));
    await expect(contador(page)).toHaveText("Tienes 50 fichas");
    await expect(botonDe(page, "Dividir")).toBeEnabled();
    await expect(botonDe(page, "Doblar")).toBeEnabled();

    // Dividir manda la acción y espera; si la mesa dice que no hay fichas (el cobro lo comprueba de nuevo), el botón vuelve.
    await botonDe(page, "Dividir").click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "dividir" });
    await expect(botonDe(page, "Dividir")).toBeDisabled();
    mesa.enviar({ t: "error", codigo: "sin_fichas" });
    await expect(page.getByText("No tienes fichas suficientes")).toBeVisible();
    await expect(botonDe(page, "Dividir")).toBeEnabled();
    await botonDe(page, "Rendirse").click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "rendirse" });
  });

  test("con dos manos, Dividir y Doblar se ofrecen según la apuesta de la mano ACTIVA, no según el total de tus apuestas", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    // 60 fichas: cubren la apuesta de 50 de una mano, pero no la de 1.000 de la otra ni la suma de las dos.
    await fichasDeApi(page, 60);
    const yo = sesion.jugador;
    const manos = (primera: ManoDeLaVista["estado"], segunda: ManoDeLaVista["estado"], apuestas: [number, number]) => [
      mano(yo, 0, [c("8S"), c("8C")], { estado: primera, apuesta: apuestas[0], casilla: 0 }),
      mano(yo, 1, [c("9D"), c("9H")], { estado: segunda, apuesta: apuestas[1], casilla: 1 }),
    ];
    const mesaCon = (...argumentos: Parameters<typeof manos>) => estado(enDecisiones(sesion, manos(...argumentos), { opciones: opciones({ dividir: true, rendirse: true }) }));
    mesa.alConectar(mesaCon("jugando", "jugando", [50, 1_000]));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(contador(page)).toHaveText("Tienes 60 fichas");

    // La activa es la de 50: se puede dividir y doblar, aunque lo apostado en total (1.050) no quepa en tus 60.
    await expect(page.getByText("Mano 1 de 2")).toBeVisible();
    await expect(botonDe(page, "Dividir")).toBeEnabled();
    await expect(botonDe(page, "Doblar")).toBeEnabled();

    // La activa pasa a ser la de 1.000 (la primera ya se ha plantado): ya no se ofrece dividir y doblar se apaga; rendirse sigue.
    mesa.enviar(mesaCon("plantado", "jugando", [50, 1_000]));
    await expect(page.getByText("Mano 2 de 2")).toBeVisible();
    await expect(botonDe(page, "Dividir")).toHaveCount(0);
    await expect(botonDe(page, "Doblar")).toBeDisabled();
    await expect(botonDe(page, "Rendirse")).toBeEnabled();

    // Y al revés: la activa es la primera y es la grande.
    mesa.enviar(mesaCon("jugando", "plantado", [1_000, 50]));
    await expect(page.getByText("Mano 1 de 2")).toBeVisible();
    await expect(botonDe(page, "Dividir")).toHaveCount(0);
    await expect(botonDe(page, "Doblar")).toBeDisabled();
    // Con la segunda ya sin jugar, ni la suma ni la otra apuesta cuentan: solo la activa (50 cabe en 60).
    mesa.enviar(mesaCon("plantado", "jugando", [1_000, 50]));
    await expect(page.getByText("Mano 2 de 2")).toBeVisible();
    await expect(botonDe(page, "Dividir")).toBeEnabled();
    await expect(botonDe(page, "Doblar")).toBeEnabled();
  });

  test("rendirse: la mano se ve rendida y al final cobra la mitad", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const fichas = await fichasDeApi(page, 950);
    const yo = sesion.jugador;
    const cartas = [c("10H"), c("6D")];
    mesa.alConectar(estado(enDecisiones(sesion, [mano(yo, 0, cartas)], { opciones: opciones({ rendirse: true }) })));
    await page.goto(`/p/${codigo}/blackjack`);
    await botonDe(page, "Rendirse").click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "rendirse" });

    // La mesa confirma: la mano queda rendida y ya no hay nada que decidir.
    mesa.enviar(
      estado(enDecisiones(sesion, [mano(yo, 0, cartas, { estado: "rendido" })], { opciones: opciones({ pedir: false, plantarse: false, doblar: false }) }), [
        { tipo: "rendido", jugadorId: yo.id, indice: 0 },
      ]),
    );
    await expect(page.getByText("Rendida", { exact: true })).toBeVisible();
    await expect(page.getByText("Te has rendido. Esperando al resto")).toBeVisible();
    await expect(botonDe(page, "Pedir")).toBeDisabled();
    await expect(botonDe(page, "Rendirse")).toHaveCount(0);

    // Al cerrarse la ronda se devuelve la mitad de 50: pierdes 25.
    fichas.poner(975);
    mesa.enviar(
      estado(vista(sesion, { fase: "resultado", finFase: Date.now() + 4_000, banca: [c("6S"), c("10D")], totalBanca: 16, manos: [mano(yo, 0, cartas, { estado: "rendido" })] }), [
        { tipo: "carta_girada", carta: c("10D") },
        { tipo: "pago", jugadorId: yo.id, neto: -25 },
      ]),
    );
    await expect(resultado(page)).toHaveText("Pierdes 25");
    await expect(page.getByText("Rendida", { exact: true })).toBeVisible();
    await expect(contador(page)).toHaveText("Tienes 975 fichas");
  });

  test("al reconectar con manos divididas se ven tal cual, sin animación ni sonido", async ({ page, request }) => {
    // Cada fuente de sonido (oscilador o ruido) que arranca se cuenta; el audio se despierta con un toque en la página.
    await page.addInitScript(() => {
      const w = window as unknown as { __sonidos: number; __audio: AudioContext | null };
      w.__sonidos = 0;
      w.__audio = null;
      const crear = AudioContext.prototype.createDynamicsCompressor;
      AudioContext.prototype.createDynamicsCompressor = function (...args) {
        w.__audio = this;
        return crear.apply(this, args);
      };
      const arrancar = AudioScheduledSourceNode.prototype.start;
      AudioScheduledSourceNode.prototype.start = function (...args) {
        w.__sonidos++;
        return arrancar.apply(this, args);
      };
    });
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 900);
    const yo = sesion.jugador;
    const dividida = (ronda: number) =>
      enDecisiones(
        sesion,
        [mano(yo, 0, [c("8S"), c("3H")], { dividida: true }), mano(yo, 1, [c("8C"), c("5D")], { dividida: true }), mano(yo, 2, [c("KD"), c("7H")], { casilla: 1 })],
        { ronda },
      );
    // La mesa se abre con una sola mano; mientras tanto el jugador despierta el audio.
    mesa.alConectar(estado(enDecisiones(sesion, [mano(yo, 0, [c("8S"), c("8C")], { casilla: 0 })], { opciones: opciones({ dividir: true }) })));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(tuMano(page)).toHaveCount(2);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __audio: AudioContext | null }).__audio?.state ?? "sin audio"), { timeout: 15_000 }).toBe("running");
    const sonidos = () => page.evaluate(() => (window as unknown as { __sonidos: number }).__sonidos);
    const antes = await sonidos();
    // Que la mesa haya acabado de entrar (su fundido de entrada y el de la ronda 0 que se retira): lo que se mide después es solo la reconexión.
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => {
        const objetivo = (a.effect as KeyframeEffect | null)?.target;
        return a.playState !== "running" || !(objetivo instanceof Element) || objetivo.closest(".bj-mesa") === null;
      }),
    );

    // Se cae la conexión y al volver la mesa manda la foto con las manos ya divididas, sin eventos.
    const nombres = ["8 de picas", "3 de corazones", "8 de tréboles", "5 de diamantes", "Rey de diamantes", "7 de corazones"];
    mesa.alConectar(estado(dividida(1)));
    await muestrearCartas(page, nombres);
    await mesa.cerrar(1001);
    await expect(tuManoN(page, 3).getByRole("img")).toHaveCount(2, { timeout: 15_000 });
    await expect(tuManoN(page, 1).getByRole("img")).toHaveCount(2);
    await expect(tuManoN(page, 2).getByRole("img")).toHaveCount(2);
    // La mesa sigue donde estaba: la mano activa es la primera y se puede decidir.
    await expect(page.getByText("Mano 1 de 3")).toBeVisible();
    await expect(page.getByText("Tu turno: ¿pides o te plantas?")).toBeVisible();
    for (const nombre of ["Plantarse", "Pedir", "Doblar"]) await expect(botonDe(page, nombre)).toBeEnabled();
    await expect(page.locator(".bj-col--activa")).toHaveCount(1);
    await page.waitForTimeout(1_000);

    // Desde el primer fotograma con las tres manos a la vista, cada carta está una sola vez, del todo opaca, sin ningún transform y en el mismo
    // sitio que en el primer fotograma, y así en todos los demás: saltó a la vista sin animar (un deslizamiento solo de transform también se vería aquí).
    const todas = await muestras(page);
    const despues = todas.filter((m) => m.manos === 3);
    expect(despues.length, "fotogramas con las tres manos a la vista").toBeGreaterThan(30);
    for (const nombre of nombres) {
      const sitios = despues.map((m) => m.cartas[nombre]);
      for (const [i, delFotograma] of sitios.entries()) expect(delFotograma, `${nombre}, fotograma ${i}: una sola vez`).toHaveLength(1);
      const primera = sitios[0][0];
      for (const [i, [p]] of sitios.entries()) {
        expect(p.opacidad, `${nombre}, fotograma ${i}: opaca`).toBe(1);
        expect(p.transform, `${nombre}, fotograma ${i}: sin transform`).toBe("none");
        expect(Math.abs(p.x - primera.x) + Math.abs(p.y - primera.y) + Math.abs(p.ancho - primera.ancho), `${nombre}, fotograma ${i}: no se ha movido`).toBeLessThan(0.5);
      }
    }
    expect(await sonidos(), "al reconectar no suena nada").toBe(antes);
  });

  test("cuatro manos tuyas y cinco jugadores más caben en 360×640: sin desplazamiento horizontal y botones de 44 px o más", async ({ page, request }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 5_000);
    const yo = sesion.jugador;
    const otro = (id: number, apodo: string, indice: number, cartas: Carta[], resto: Partial<ManoDeLaVista> = {}) => mano({ id, apodo }, indice, cartas, { casilla: indice, ...resto });
    const mias = [
      mano(yo, 0, [c("8S"), c("3H"), c("2C")], { dividida: true, apuesta: 1_000, casilla: 0 }),
      mano(yo, 1, [c("8C"), c("5D")], { dividida: true, apuesta: 1_000, casilla: 0 }),
      mano(yo, 2, [c("KD"), c("7H"), c("AS")], { apuesta: 250, casilla: 1 }),
      mano(yo, 3, [c("9D"), c("9S")], { apuesta: 50, casilla: 2 }),
    ];
    const demas = [
      otro(11, "Ana", 0, [c("5H"), c("10C")], { estado: "plantado" }),
      otro(11, "Ana", 1, [c("9S"), c("10D")], { estado: "plantado" }),
      otro(12, "Bartolomé", 0, [c("KH"), c("QC"), c("4D")], { estado: "pasado" }),
      otro(13, "Cristina", 0, [c("AH"), c("KC")], { estado: "blackjack" }),
      otro(14, "Dani", 0, [c("6H"), c("2C")]),
      otro(14, "Dani", 1, [c("7S"), c("2D")]),
      otro(14, "Dani", 2, [c("8S"), c("3D")]),
      otro(15, "Eli", 0, [c("10H"), c("7C")]),
      otro(16, "Fran", 0, [c("3H"), c("4C")]),
    ];
    mesa.alConectar(
      estado(
        enDecisiones(sesion, [...mias, ...demas], {
          sentados: [yo.apodo, "Ana", "Bartolomé", "Cristina", "Dani", "Eli", "Fran"],
          opciones: opciones({ dividir: true, rendirse: true }),
        }),
      ),
    );
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByText("Mano 1 de 4")).toBeVisible();
    await expect(tuManoN(page, 4).getByRole("img")).toHaveCount(2);
    await expect(page.getByRole("list", { name: "Otros jugadores" }).getByRole("listitem")).toHaveCount(6);
    for (const nombre of ["Dividir", "Rendirse", "Plantarse", "Pedir", "Doblar"]) await expect(botonDe(page, nombre)).toBeVisible();
    await page.waitForTimeout(700);

    expect(await sinDesplazamientoHorizontal(page)).toBe(true);
    // Ninguna carta se sale de la pantalla por los lados.
    const salidas = await page.evaluate(
      () => [...document.querySelectorAll(".bj-mano .naipe")].map((el) => el.getBoundingClientRect()).filter((r) => r.left < -0.5 || r.right > window.innerWidth + 0.5).length,
    );
    expect(salidas).toBe(0);
    // Todo lo que se pulsa mide al menos 44 px.
    const bajos = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("button")]
        .filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && el.closest("[aria-hidden=true], [inert]") === null)
        .map((el) => ({ nombre: el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "", alto: el.getBoundingClientRect().height }))
        .filter((b) => b.alto < 43.99),
    );
    expect(bajos).toEqual([]);
  });

  // Ventanas de escritorio de la más estrecha (la mesa de ordenador empieza en 900 px) a la más común (1920×1080), con alturas bajas y altas.
  // El diseño depende del tamaño de la ventana, no del dispositivo: basta con el proyecto de escritorio.
  for (const [ancho, alto] of [[960, 700], [1024, 768], [1100, 700], [1280, 720], [1440, 900], [1920, 1080]]) {
    test(`ordenador ${ancho}×${alto}, mesa llena: tus 2, 3 y 4 manos no tocan a los vecinos ni a la banca, no se salen y sus cartas siguen legibles (≥ 36 px)`, async ({ page, request }, info) => {
      test.skip(info.project.name !== "desktop", "el diseño depende del tamaño de la ventana, no del dispositivo");
      await page.setViewportSize({ width: ancho, height: alto });
      const { sesion, codigo, mesa } = await entrarSimulada(page, request);
      await fichasDeApi(page, 5_000);
      const yo = sesion.jugador;
      const otro = (id: number, apodo: string, indice: number, cartas: Carta[], resto: Partial<ManoDeLaVista> = {}) => mano({ id, apodo }, indice, cartas, { casilla: indice, ...resto });
      // Cinco jugadores más: uno con dos manos a un lado, otro con una apuesta de 1.000 al otro, uno con tres manos…
      const demas = [
        otro(11, "Ana", 0, [c("5H"), c("10C")], { estado: "plantado" }),
        otro(11, "Ana", 1, [c("9S"), c("10D")], { estado: "plantado" }),
        otro(12, "Bartolomé", 0, [c("KH"), c("QC"), c("4D")], { estado: "pasado", apuesta: 1_000 }),
        otro(13, "Cristina", 0, [c("AH"), c("KC")], { estado: "blackjack" }),
        otro(14, "Dani", 0, [c("6H"), c("2C")]),
        otro(14, "Dani", 1, [c("7S"), c("2D")]),
        otro(14, "Dani", 2, [c("8S"), c("3D")]),
        otro(15, "Eli", 0, [c("10H"), c("7C")]),
      ];
      const suyas = [
        mano(yo, 0, [c("8S"), c("3H"), c("2C")], { dividida: true, apuesta: 1_000, casilla: 0 }),
        mano(yo, 1, [c("8C"), c("5D")], { dividida: true, apuesta: 1_000, casilla: 0 }),
        mano(yo, 2, [c("KD"), c("7H")], { apuesta: 250, casilla: 1 }),
        mano(yo, 3, [c("9D"), c("9S")], { apuesta: 50, casilla: 2 }),
      ];
      const sentados = [yo.apodo, "Ana", "Bartolomé", "Cristina", "Dani", "Eli"];
      const conManos = (n: number) => estado(enDecisiones(sesion, [...suyas.slice(0, n), ...demas], { sentados, opciones: opciones({ dividir: true }) }));
      mesa.alConectar(conManos(2));
      await page.goto(`/p/${codigo}/blackjack`);
      await expect(page.getByText("Mano 1 de 2")).toBeVisible();

      /** Lo que se ve (cartas, líneas de total y apuesta, nombres), en cajas de la ventana: lo tuyo, lo de los demás y lo de la banca. */
      const cajas = () =>
        page.evaluate(() => {
          const cajasDe = (raiz: Element, selector: string) =>
            [...raiz.querySelectorAll(selector)]
              .map((el) => ({ el, r: el.getBoundingClientRect() }))
              .filter(({ r }) => r.width > 0 && r.height > 0)
              .map(({ el, r }) => ({ que: String(el.className || el.getAttribute("aria-label") || el.tagName), x: r.x, y: r.y, ancho: r.width, alto: r.height }));
          const visible = ".naipe, .bj-col__pie > *, .bj-etiqueta > *";
          return {
            mias: cajasDe(document.querySelector(".bj-asiento--yo")!, visible),
            ajenas: [...document.querySelectorAll(".bj-asiento:not(.bj-asiento--yo)")].flatMap((asiento) => cajasDe(asiento, visible)),
            banca: cajasDe(document.querySelector(".bj-banca")!, ".naipe, .bj-etiqueta > *, .mazo"),
            cartasMias: [...document.querySelectorAll(".bj-asiento--yo .naipe")].map((el) => el.getBoundingClientRect().width),
            ventana: { ancho: window.innerWidth, desplazamiento: document.documentElement.scrollWidth - window.innerWidth },
          };
        });
      const tocan = (a: { x: number; y: number; ancho: number; alto: number }, b: typeof a) => a.x < b.x + b.ancho + 1 && b.x < a.x + a.ancho + 1 && a.y < b.y + b.alto + 1 && b.y < a.y + a.alto + 1;
      for (const n of [2, 3, 4]) {
        mesa.enviar(conManos(n));
        await expect(page.getByText(`Mano 1 de ${n}`)).toBeVisible();
        await page.waitForTimeout(700);
        const { mias, ajenas, banca, cartasMias, ventana } = await cajas();
        expect(mias.length, `${n} manos: tus cajas`).toBeGreaterThan(n * 2);
        expect(ajenas.length).toBeGreaterThan(10);
        const choques = [...ajenas.map((b) => ({ b, de: "vecino" })), ...banca.map((b) => ({ b, de: "banca" }))].flatMap(({ b, de }) =>
          mias.filter((a) => tocan(a, b)).map((a) => `${n} manos: «${a.que}» (${Math.round(a.x)},${Math.round(a.y)}) toca ${de} «${b.que}» (${Math.round(b.x)},${Math.round(b.y)})`),
        );
        expect(choques).toEqual([]);
        // Las cartas siguen siendo útiles: con 36 px aún se ve el palo y el valor de la esquina; por debajo, no.
        expect(Math.min(...cartasMias), `${n} manos: la carta más pequeña`).toBeGreaterThanOrEqual(35.5);
        // Y nada se sale por los lados de la ventana ni la desplaza.
        expect(mias.filter((a) => a.x < -0.5 || a.x + a.ancho > ventana.ancho + 0.5).map((a) => `${a.que}@${Math.round(a.x)}`), `${n} manos: fuera de la ventana`).toEqual([]);
        expect(ventana.desplazamiento, `${n} manos: desplazamiento horizontal`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("las pastillas de los demás enseñan cada mano", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 950);
    const yo = sesion.jugador;
    const otro = (id: number, apodo: string, indice: number, cartas: Carta[], resto: Partial<ManoDeLaVista> = {}) => mano({ id, apodo }, indice, cartas, { casilla: indice, ...resto });
    const demas = [
      otro(11, "Ana", 0, [c("5H"), c("10C")], { estado: "plantado" }),
      otro(11, "Ana", 1, [c("9S"), c("10D")], { estado: "plantado" }),
      otro(12, "Bea", 0, [c("10H"), c("6C")], { estado: "rendido" }),
      otro(12, "Bea", 1, [c("9H"), c("9C")]),
      otro(13, "Cris", 0, [c("KH"), c("QC"), c("4D")], { estado: "pasado" }),
      otro(14, "Dani", 0, [c("8S"), c("3D"), c("2C")], { estado: "jugando" }),
    ];
    mesa.alConectar(
      estado(enDecisiones(sesion, [mano(yo, 0, [c("10S"), c("4D")]), ...demas], { sentados: [yo.apodo, "Ana", "Bea", "Cris", "Dani", "Eli"] })),
    );
    await page.goto(`/p/${codigo}/blackjack`);
    const pastilla = (nombre: string) => page.getByRole("list", { name: "Otros jugadores" }).getByRole("listitem").filter({ hasText: nombre });

    // «Ana · 15 / 19 ✓»: el total de cada mano y el ✓ cuando ya no juega ninguna.
    await expect(pastilla("Ana")).toContainText(/Ana\s*15 \/ 19\s*✓/);
    // Con una rendida y otra en juego: «rendida / 18», sin ✓.
    await expect(pastilla("Bea")).toContainText(/Bea\s*rendida \/ 18/);
    await expect(pastilla("Bea")).not.toContainText("✓");
    // Una sola mano se lee como siempre; la pasada, tachada.
    await expect(pastilla("Dani")).toContainText(/Dani\s*13/);
    await expect(pastilla("Cris").locator(".bj-pastilla__pasado")).toHaveText(/^24/);
    // Quien solo mira no enseña manos.
    await expect(pastilla("Eli")).toHaveText("Eli");

    // En el ordenador, cada asiento muestra sus manos con cartas pequeñas, hasta dos.
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByRole("group", { name: "Mano 1 de Ana" }).getByRole("img")).toHaveCount(2);
    await expect(page.getByRole("group", { name: "Mano 2 de Ana" }).getByRole("img")).toHaveCount(2);
    await expect(page.getByRole("group", { name: "Mano 1 de Bea" }).getByRole("img")).toHaveCount(2);
    await expect(page.getByRole("group", { name: "Mano de Dani" }).getByRole("img")).toHaveCount(3);
    const asientoAna = page.locator(".bj-asiento", { hasText: "Ana" });
    await expect(asientoAna.locator(".bj-col__pie")).toHaveText([/^Total 15$/, /^Total 19$/]);
    const anchoCartaAna = (await asientoAna.getByRole("img").first().boundingBox())!.width;
    const anchoCartaDani = (await page.locator(".bj-asiento", { hasText: "Dani" }).getByRole("img").first().boundingBox())!.width;
    expect(anchoCartaAna, "con dos manos las cartas son más pequeñas").toBeLessThan(anchoCartaDani);
  });

  // ---- Seguro y la banca que mira su carta ----

  /** La mesa en el seguro: la banca enseña un as y el jugador aún no ha contestado; `coste` es lo que cuesta asegurarse. */
  const enSeguro = (sesion: RespuestaSesion, manos: ManoDeLaVista[], coste: number | null = 50, resto: Partial<VistaBJ> = {}): VistaBJ =>
    vista(sesion, {
      fase: "seguro",
      finFase: Date.now() + 10_000,
      banca: [c("AS"), null],
      totalBanca: 11,
      manos,
      opciones: opciones({ pedir: false, plantarse: false, doblar: false, seguro: coste }),
      ...resto,
    });
  const preguntaSeguro = (pagina: Page, n: number): Locator => pagina.getByText(`La banca enseña un as. ¿Seguro por ${miles(n)}?`);

  interface FotogramaBanca {
    /** El estado dice «La banca mira su carta…». */
    mira: boolean;
    /** Cuántas cartas de la banca se ven boca abajo. */
    tapadas: number;
    /** Dónde está la tapada (su arriba), o `null` si ya no hay. */
    y: number | null;
  }
  /** Anota, en cada fotograma, si la banca está mirando y dónde está su carta tapada: para ver que sube, baja y se gira a su hora. */
  async function vigilarBanca(pagina: Page): Promise<void> {
    await pagina.evaluate(() => {
      const w = window as unknown as { __banca: FotogramaBanca[] };
      w.__banca = [];
      const fotograma = () => {
        const tapadas = [...document.querySelectorAll('[role=group][aria-label="Banca"] [role=img][aria-label="Carta boca abajo"]')];
        w.__banca.push({ mira: document.querySelector(".estado-mesa__texto")?.textContent === "La banca mira su carta…", tapadas: tapadas.length, y: tapadas[0]?.getBoundingClientRect().y ?? null });
        requestAnimationFrame(fotograma);
      };
      requestAnimationFrame(fotograma);
    });
  }
  const fotogramasBanca = (pagina: Page): Promise<FotogramaBanca[]> => pagina.evaluate(() => (window as unknown as { __banca: FotogramaBanca[] }).__banca);

  test("con un as visible sale el panel del seguro: «Sí, seguro (50)» manda { t: \"seguro\", tomar: true } y pasa a «Esperando a los demás…»", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const fichas = await fichasDeApi(page, 900);
    const yo = sesion.jugador;
    const cartas = [c("10S"), c("6D")];
    mesa.alConectar(estado(enSeguro(sesion, [mano(yo, 0, cartas, { apuesta: 100 })])));
    await page.goto(`/p/${codigo}/blackjack`);

    // La pregunta con lo que cuesta (la mitad de 100), su cuenta atrás y los dos botones; no hay botones de decisión.
    await expect(preguntaSeguro(page, 50)).toBeVisible();
    await expect(page.locator(".estado-mesa__cuenta")).toHaveText(/^0:\d\d$/);
    await expect(botonDe(page, "No")).toBeEnabled();
    await expect(botonDe(page, "Sí, seguro (50)")).toBeEnabled();
    await expect(botonDe(page, "Pedir")).toHaveCount(0);
    // La tapada sigue sin salir de la mesa.
    await expect(page.getByRole("group", { name: "Banca" }).getByRole("img", { name: "Carta boca abajo" })).toHaveCount(1);

    // Un doble toque manda una sola vez, y «No» queda apagado mientras la mesa contesta.
    await botonDe(page, "Sí, seguro (50)").dblclick();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "seguro", tomar: true });
    expect(mesa.recibidas.filter((m) => (m as { t: string }).t === "seguro")).toHaveLength(1);
    await expect(botonDe(page, "No")).toBeDisabled();

    // La mesa cobra el seguro: ya no hay nada que contestar y el contador baja.
    fichas.poner(850);
    mesa.enviar(estado(enSeguro(sesion, [mano(yo, 0, cartas, { apuesta: 100 })], null, { miSeguro: 50 })));
    await expect(page.getByText("Esperando a los demás…")).toBeVisible();
    await expect(botonDe(page, "No")).toHaveCount(0);
    await expect(botonDe(page, "Sí, seguro (50)")).toHaveCount(0);
    await expect(contador(page)).toHaveText("Tienes 850 fichas");
  });

  test("«No» al seguro manda { t: \"seguro\", tomar: false } y espera a los demás", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 950);
    const yo = sesion.jugador;
    mesa.alConectar(estado(enSeguro(sesion, [mano(yo, 0, [c("10S"), c("6D")])], 25)));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(preguntaSeguro(page, 25)).toBeVisible();
    await botonDe(page, "No").click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "seguro", tomar: false });

    mesa.enviar(estado(enSeguro(sesion, [mano(yo, 0, [c("10S"), c("6D")])], null)));
    await expect(page.getByText("Esperando a los demás…")).toBeVisible();
    await expect(botonDe(page, "No")).toHaveCount(0);
  });

  test("al reconectar a mitad del seguro, la espera está a la vista sin más", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 950);
    const yo = sesion.jugador;
    const cartas = [c("10S"), c("6D")];
    mesa.alConectar(estado(enSeguro(sesion, [mano(yo, 0, cartas)], 25)));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(botonDe(page, "Sí, seguro (25)")).toBeEnabled();

    // Se cae la conexión y, al volver, ya habías contestado que sí.
    mesa.alConectar(estado(enSeguro(sesion, [mano(yo, 0, cartas)], null, { miSeguro: 25 })));
    await mesa.cerrar(1001);
    await expect(page.getByText("Esperando a los demás…")).toBeVisible({ timeout: 15_000 });
    await expect(botonDe(page, "Sí, seguro (25)")).toHaveCount(0);
  });

  test("la banca mira: sin blackjack la tapada se levanta y vuelve a bajar; con blackjack se gira y se cobra el seguro", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const fichas = await fichasDeApi(page, 850);
    const yo = sesion.jugador;
    const cartas = [c("10S"), c("6D")];
    mesa.alConectar(estado(enSeguro(sesion, [mano(yo, 0, cartas, { apuesta: 100 })], null, { miSeguro: 50 })));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByText("Esperando a los demás…")).toBeVisible();
    await expect(tuMano(page)).toHaveCount(2);
    await page.waitForTimeout(600);

    // Sin blackjack: los seguros se pierden y empiezan las decisiones. Durante la mirada el estado lo dice y la tapada sube y baja.
    await vigilarBanca(page);
    mesa.enviar(estado(enDecisiones(sesion, [mano(yo, 0, cartas, { apuesta: 100 })], { banca: [c("AS"), null], totalBanca: 11 }), [{ tipo: "banca_mira", blackjack: false }]));
    await expect(page.getByText("La banca mira su carta…")).toBeVisible();
    await expect(page.getByText("Tu turno: ¿pides o te plantas?")).toBeVisible();
    await page.waitForTimeout(300);
    const sin = (await fotogramasBanca(page)).filter((f) => f.tapadas > 0);
    const base = sin[0].y!;
    expect(sin.some((f) => f.mira), "hubo fotogramas mirando").toBe(true);
    expect(Math.min(...sin.map((f) => f.y!)) - base, "la tapada sube").toBeLessThan(-4);
    expect(sin.every((f) => f.tapadas === 1), "siempre una tapada: no se gira").toBe(true);
    expect(Math.abs(sin.at(-1)!.y! - base), "y vuelve a bajar").toBeLessThan(0.5);

    // Otra ronda, esta vez con blackjack de la banca: mira, la gira y el seguro cobra (2:1) con tu blackjack empatado.
    const blackjack = [c("10H"), c("AC")];
    const conSeguro = enSeguro(sesion, [mano(yo, 0, blackjack, { apuesta: 100, estado: "blackjack" })], null, { ronda: 2, miSeguro: 50 });
    mesa.enviar(estado(conSeguro));
    await expect(page.getByRole("group", { name: "Banca" }).getByRole("img", { name: "Carta boca abajo" })).toHaveCount(1);
    await page.waitForTimeout(600);
    await vigilarBanca(page);
    fichas.poner(1050);
    mesa.enviar(
      estado(
        vista(sesion, {
          ronda: 2,
          fase: "resultado",
          finFase: Date.now() + 4_000,
          banca: [c("AS"), c("KD")],
          totalBanca: 21,
          manos: [mano(yo, 0, blackjack, { apuesta: 100, estado: "blackjack" })],
          miSeguro: 50,
        }),
        [
          { tipo: "banca_mira", blackjack: true },
          { tipo: "carta_girada", carta: c("KD") },
          { tipo: "seguro_pagado", jugadorId: yo.id, cantidad: 150 },
          { tipo: "pago", jugadorId: yo.id, neto: 100 },
        ],
      ),
    );
    await expect(page.getByText("La banca mira su carta…")).toBeVisible();
    // Hasta que no ha terminado de mirar sigue boca abajo; después se gira, se cobra y se ve el premio.
    await expect(page.getByRole("img", { name: "Rey de diamantes" })).toBeVisible();
    await expect(resultado(page)).toHaveText("Ganas 100");
    await expect(contador(page)).toHaveText("Tienes 1.050 fichas");
    const con = await fotogramasBanca(page);
    const ultimaMirada = con.map((f) => f.mira).lastIndexOf(true);
    expect(ultimaMirada, "hubo fotogramas mirando").toBeGreaterThan(0);
    expect(con.slice(0, ultimaMirada + 1).every((f) => f.tapadas === 1), "boca abajo mientras mira").toBe(true);
    expect(con.at(-1)!.tapadas, "después se gira").toBe(0);
    const miradas = con.filter((f) => f.mira && f.tapadas > 0).map((f) => f.y!);
    expect(Math.min(...miradas) - miradas[0], "también sube al mirar").toBeLessThan(-4);
  });

  test("sin fichas para el seguro, «Sí, seguro» no se puede pulsar y «No» sí", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 20);
    const yo = sesion.jugador;
    mesa.alConectar(estado(enSeguro(sesion, [mano(yo, 0, [c("10S"), c("6D")], { apuesta: 100 })], 50)));
    await page.goto(`/p/${codigo}/blackjack`);
    // El contador ya tiene las 20 fichas que quedan: se espera a verlo antes de mirar los botones.
    await expect(contador(page)).toHaveText("Tienes 20 fichas");
    await expect(preguntaSeguro(page, 50)).toBeVisible();
    await expect(botonDe(page, "Sí, seguro (50)")).toBeDisabled();
    await expect(page.getByText("No te llegan las fichas para el seguro")).toBeVisible();
    await botonDe(page, "No").click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "seguro", tomar: false });
    expect(mesa.recibidas).not.toContainEqual({ t: "seguro", tomar: true });
  });

  test("salir con dos manos y seguro pide confirmación y manda salir", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 850);
    const yo = sesion.jugador;
    const manos = [mano(yo, 0, [c("10S"), c("6D")], { casilla: 0 }), mano(yo, 1, [c("8C"), c("9H")], { casilla: 1 })];
    mesa.alConectar(estado(enSeguro(sesion, manos, 50)));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(preguntaSeguro(page, 50)).toBeVisible();

    await page.getByRole("button", { name: "Volver a la sala" }).click();
    const dialogo = page.getByRole("dialog", { name: "¿Salir de la mesa?" });
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { name: "Seguir jugando" }).click();
    await expect(page).toHaveURL(`/p/${codigo}/blackjack`);
    expect(mesa.recibidas).not.toContainEqual({ t: "salir" });

    // También con el seguro ya cogido: se pierde todo y se pregunta igual.
    mesa.enviar(estado(enSeguro(sesion, manos, null, { miSeguro: 50 })));
    await expect(page.getByText("Esperando a los demás…")).toBeVisible();
    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await dialogo.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    await expect.poll(() => mesa.recibidas.filter((m) => (m as { t: string }).t === "salir").length).toBe(1);
  });

  test.describe("con movimiento reducido", () => {
    test.use({ reducedMotion: "reduce" });

    test("la banca mira sin moverse: solo se lee el texto", async ({ page, request }) => {
      const { sesion, codigo, mesa } = await entrarSimulada(page, request);
      await fichasDeApi(page, 900);
      const yo = sesion.jugador;
      const cartas = [c("10S"), c("6D")];
      mesa.alConectar(estado(enSeguro(sesion, [mano(yo, 0, cartas)], null, { miSeguro: 25 })));
      await page.goto(`/p/${codigo}/blackjack`);
      await expect(page.getByText("Esperando a los demás…")).toBeVisible();
      await expect(tuMano(page)).toHaveCount(2);
      await page.waitForTimeout(600);

      await vigilarBanca(page);
      mesa.enviar(estado(enDecisiones(sesion, [mano(yo, 0, cartas)], { banca: [c("AS"), null], totalBanca: 11 }), [{ tipo: "banca_mira", blackjack: false }]));
      await expect(page.getByText("La banca mira su carta…")).toBeVisible();
      await expect(page.getByText("Tu turno: ¿pides o te plantas?")).toBeVisible();
      await page.waitForTimeout(300);
      const fotogramas = (await fotogramasBanca(page)).filter((f) => f.tapadas > 0);
      expect(fotogramas.some((f) => f.mira), "se leyó el texto").toBe(true);
      expect(fotogramas.filter((f) => Math.abs(f.y! - fotogramas[0].y!) > 0.01), "la tapada no se mueve").toEqual([]);
      expect(await page.locator(".bj-banca .naipe").evaluateAll((cartasBanca) => cartasBanca.map((x) => getComputedStyle(x).transform))).toEqual(["none", "none"]);
    });
  });
});
