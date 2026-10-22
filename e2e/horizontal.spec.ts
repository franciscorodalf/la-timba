import { expect, type Page, test } from "@playwright/test";
import type { VistaBJ } from "../src/shared/juegos/blackjack";
import type { VistaCarrera } from "../src/shared/juegos/carrera";
import { abrirPartida, apodoUnico, conSesion, entrarSimulada, fichasDeApi, mensajeEstado, registrar } from "./ayudas";

// Un móvil de pie (el Pixel 7) y el mismo, girado: 915×412 con puntero táctil. Solo en el proyecto `movil`: el de escritorio
// tiene un puntero fino y el aviso no debe salirle aunque tenga la ventana baja (último test).
const VERTICAL = { width: 412, height: 915 };
const APAISADO = { width: 915, height: 412 };
const AVISO = "Gira el móvil para jugar";

const aviso = (pagina: Page) => pagina.getByText(AVISO);
/** El tamaño de la página entera: si es mayor que la ventana, se desplaza. */
const alturaDeLaPagina = (pagina: Page) => pagina.evaluate(() => document.documentElement.scrollHeight);

test.describe("móvil apaisado", () => {
  test.skip(() => test.info().project.name !== "movil", "solo se comprueba en el proyecto móvil");
  test.use({ viewport: APAISADO });

  test("en la mesa de blackjack se pide girar el móvil: pantalla completa, sin la mesa y sin que la página se desplace", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaBJ>(page, request, "mesa-blackjack");
    await fichasDeApi(page, 1000);
    mesa.alConectar(mensajeEstado<VistaBJ>({ ronda: 1, fase: "apuestas", finFase: Date.now() + 15_000, banca: [], totalBanca: null, manos: [], sentados: [sesion.jugador.apodo], yo: sesion.jugador.id }));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(aviso(page)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: AVISO })).toBeVisible();
    // Con su icono (un móvil que gira) y a pantalla completa, sin otra cosa encima.
    await expect(page.locator(".girar-movil svg")).toBeVisible();
    const caja = (await page.locator(".girar-movil").boundingBox())!;
    expect(caja).toMatchObject({ x: 0, y: 0, width: APAISADO.width, height: APAISADO.height });
    // La mesa de escritorio con scroll no se enseña: ni sus fichas, ni su cabecera, ni nada que se desplace.
    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Volver a la sala" })).toBeHidden();
    expect(await alturaDeLaPagina(page)).toBeLessThanOrEqual(APAISADO.height);
  });

  test("en la mesa de la carrera también", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaCarrera>(page, request, "mesa-carrera");
    await fichasDeApi(page, 1000);
    mesa.alConectar(
      mensajeEstado<VistaCarrera>({
        ronda: 1,
        fase: "apuestas",
        finFase: Date.now() + 20_000,
        posiciones: { H: 0, D: 0, C: 0, S: 0 },
        tramos: Array(7).fill(null),
        ultimaCarta: null,
        misApuestas: [],
        totalesPorCaballo: { H: 0, D: 0, C: 0, S: 0 },
        sentados: [sesion.jugador.apodo],
        ganador: null,
      }),
    );
    await page.goto(`/p/${codigo}/carrera`);

    await expect(aviso(page)).toBeVisible();
    await expect(page.locator(".girar-movil svg")).toBeVisible();
    const caja = (await page.locator(".girar-movil").boundingBox())!;
    expect(caja).toMatchObject({ x: 0, y: 0, width: APAISADO.width, height: APAISADO.height });
    await expect(page.locator("[data-caballo]").first()).toBeHidden();
    await expect(page.getByRole("button", { name: "Volver a la sala" })).toBeHidden();
    expect(await alturaDeLaPagina(page)).toBeLessThanOrEqual(APAISADO.height);
  });

  test("la carrera sigue su curso mientras el aviso tapa la mesa: al ponerlo de pie los caballos están donde toca y no hubo reconexión", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaCarrera>(page, request, "mesa-carrera");
    await fichasDeApi(page, 950);
    const vista = (posiciones: VistaCarrera["posiciones"]): VistaCarrera => ({
      ronda: 1,
      fase: "carrera",
      finFase: Date.now() + 800,
      posiciones,
      tramos: Array(7).fill(null),
      ultimaCarta: null,
      misApuestas: [{ caballo: "H", cantidad: 50 }],
      totalesPorCaballo: { H: 50, D: 0, C: 0, S: 0 },
      sentados: [sesion.jugador.apodo],
      ganador: null,
    });
    mesa.alConectar(mensajeEstado<VistaCarrera>(vista({ H: 1, D: 2, C: 1, S: 0 })));
    await page.setViewportSize(VERTICAL);
    await page.goto(`/p/${codigo}/carrera`);
    await expect(page.locator('[data-caballo="D"]')).toHaveAttribute("data-casilla", "2");

    await page.setViewportSize(APAISADO);
    await expect(aviso(page)).toBeVisible();
    mesa.enviar(mensajeEstado<VistaCarrera>(vista({ H: 3, D: 2, C: 1, S: 0 }), [{ tipo: "caballo_avanza", palo: "H", carta: { palo: "H", valor: "5" } }]));
    await page.waitForTimeout(500);

    await page.setViewportSize(VERTICAL);
    await expect(aviso(page)).toBeHidden();
    const corazones = page.locator('[data-caballo="H"]');
    await expect(corazones).toHaveAttribute("data-casilla", "3");
    // La pista se ha vuelto a medir: el caballo se ve, con tamaño, dentro de la pantalla.
    const caja = (await corazones.boundingBox())!;
    expect(caja.width).toBeGreaterThan(20);
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(VERTICAL.width);
    expect(mesa.conexiones()).toBe(1);
  });

  test("el aviso no suelta al jugador: el socket de la mesa sigue abierto y la mesa sigue sentada al girar de un lado a otro", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaBJ>(page, request, "mesa-blackjack");
    await fichasDeApi(page, 950);
    const yo = sesion.jugador.id;
    const vista = (resto: Partial<VistaBJ> = {}): VistaBJ => ({
      ronda: 1,
      fase: "apuestas",
      finFase: Date.now() + 15_000,
      banca: [],
      totalBanca: null,
      manos: [],
      sentados: [sesion.jugador.apodo],
      yo,
      ...resto,
    });
    mesa.alConectar(mensajeEstado<VistaBJ>(vista()));
    await page.setViewportSize(VERTICAL);
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeVisible();
    expect(mesa.conexiones()).toBe(1);

    // Se gira el móvil: aparece el aviso y la mesa sigue recibiendo lo que pasa mientras tanto.
    await page.setViewportSize(APAISADO);
    await expect(aviso(page)).toBeVisible();
    mesa.enviar(mensajeEstado<VistaBJ>(vista({ manos: [{ jugadorId: yo, apodo: sesion.jugador.apodo, apuesta: 50, cartas: [], estado: "jugando", doblada: false, total: 0 }] })));
    await page.waitForTimeout(500);

    // Se vuelve a poner de pie: la mesa está como la dejó la última novedad, sin haberse levantado ni reconectado.
    await page.setViewportSize(VERTICAL);
    await expect(aviso(page)).toBeHidden();
    await expect(page.getByText("Apuesta hecha")).toBeVisible();
    expect(mesa.conexiones()).toBe(1);
    expect(mesa.recibidas).not.toContainEqual({ t: "salir" });
  });

  test("Sala, Ranking y Perfil no piden girar nada: se desplazan con normalidad", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    await page.route(/\/api\/ranking\?/, (ruta) =>
      ruta.fulfill({ json: { top: Array.from({ length: 50 }, (_, i) => ({ posicion: i + 1, apodo: `jugador${i + 1}`, valor: 5000 - i * 10 })), yo: null } }),
    );

    await page.goto(`/p/${codigo}`);
    await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);

    await page.goto("/ranking");
    await expect(page.getByRole("tab", { name: "Fichas", exact: true })).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
    expect(await alturaDeLaPagina(page)).toBeGreaterThan(APAISADO.height);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);

    await page.goto("/perfil");
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
    expect(await alturaDeLaPagina(page)).toBeGreaterThan(APAISADO.height);
  });
});

test.describe("ventana baja con ratón", () => {
  test.skip(() => test.info().project.name !== "desktop", "solo se comprueba en el proyecto de escritorio");
  test.use({ viewport: APAISADO });

  test("con un puntero fino (el ratón) no se pide girar nada: la mesa se enseña aunque la ventana sea baja", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaBJ>(page, request, "mesa-blackjack");
    await fichasDeApi(page, 1000);
    mesa.alConectar(mensajeEstado<VistaBJ>({ ronda: 1, fase: "apuestas", finFase: Date.now() + 15_000, banca: [], totalBanca: null, manos: [], sentados: [sesion.jugador.apodo], yo: sesion.jugador.id }));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeVisible();
    await expect(aviso(page)).toBeHidden();
  });
});
