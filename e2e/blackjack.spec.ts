import { type Browser, type BrowserContext, expect, type Locator, type Page, test } from "@playwright/test";
import type { RespuestaSesion } from "../src/shared/api";
import type { Carta } from "../src/shared/cartas";
import type { VistaBJ } from "../src/shared/juegos/blackjack";
import { abrirPartida, apodoUnico, carta, conSesion, entrarSimulada as baseEntrarSimulada, fichasDeApi, mensajeEstado, registrar } from "./ayudas";

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

    // Se recarga a alguien mientras otro aún decide: la ronda sigue en decisiones mientras tanto.
    const plantarse = (p: Page) => p.getByRole("button", { name: "Plantarse" });
    // Si la ronda ya ha pasado de las decisiones, el botón ya no está: no se espera a que vuelva.
    const decide = async (p: Page) => (await plantarse(p).isVisible()) && (await plantarse(p).isEnabled({ timeout: 1_000 }).catch(() => false));
    for (const p of paginas) await expect(plantarse(p).or(resultado(p))).toBeVisible();
    const quienDecide: Page[] = [];
    for (const p of paginas) if (await decide(p)) quienDecide.push(p);
    const recargada = quienDecide.length === 0 ? null : paginas.find((p) => p !== quienDecide[0])!;
    if (recargada === null) {
      test.info().annotations.push({ type: "nota", description: "Los tres tienen blackjack: no hay decisiones durante las que recargar." });
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
});
