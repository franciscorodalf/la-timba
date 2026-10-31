import { expect, type Page, test } from "@playwright/test";
import type { VistaBJ } from "../src/shared/juegos/blackjack";
import type { VistaCarrera } from "../src/shared/juegos/carrera";
import type { VistaPoker } from "../src/shared/juegos/poker";
import { abrirPartida, apodoUnico, carta as c, conSesion, entrarSimulada, fichasDeApi, mensajeEstado, registrar } from "./ayudas";

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
    mesa.alConectar(mensajeEstado<VistaBJ>({ ronda: 1, fase: "apuestas", finFase: Date.now() + 15_000, banca: [], totalBanca: null, manos: [], sentados: [sesion.jugador.apodo], yo: sesion.jugador.id, opciones: null, miSeguro: null, casillasLibres: 7 }));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(aviso(page)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: AVISO })).toBeVisible();
    // Con su icono (un móvil que gira) y a pantalla completa, sin otra cosa encima.
    await expect(page.locator(".girar-movil svg")).toBeVisible();
    const caja = (await page.locator(".girar-movil").boundingBox())!;
    expect(caja).toMatchObject({ x: 0, y: 0, width: APAISADO.width, height: APAISADO.height });
    // La mesa de escritorio con scroll no se enseña: ni sus fichas, ni su cabecera, ni nada que se desplace. Está montada (en el DOM)
    // y escondida: sin eso, «oculto» valdría también para una mesa que aún no ha llegado.
    // (`getByRole` no encuentra lo escondido: con `includeHidden` se comprueba primero que está en el DOM y después que no se ve.)
    const fichas = page.getByRole("button", { name: "Añadir 50", exact: true, includeHidden: true });
    await expect(fichas).toBeAttached();
    await expect(fichas).toBeHidden();
    const volver = page.getByRole("button", { name: "Volver a la sala", includeHidden: true });
    await expect(volver).toBeAttached();
    await expect(volver).toBeHidden();
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
        tramos: Array(6).fill(null),
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
    const pista = page.locator(".carrera-mesa");
    await expect(pista).toBeAttached();
    await expect(pista).toBeHidden();
    const volver = page.getByRole("button", { name: "Volver a la sala", includeHidden: true });
    await expect(volver).toBeAttached();
    await expect(volver).toBeHidden();
    expect(await alturaDeLaPagina(page)).toBeLessThanOrEqual(APAISADO.height);
  });

  test("en la mesa de póker también", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaPoker>(page, request, "mesa-poker");
    await fichasDeApi(page, 1000);
    mesa.alConectar(
      mensajeEstado<VistaPoker>({ ronda: 0, fase: "esperando", calle: null, finFase: null, mesa: [], botes: [], turno: null, asientos: [], asientosLibres: 8, yo: sesion.jugador.id, misCartas: null, opciones: null, porEntrar: 0 }),
    );
    await page.goto(`/p/${codigo}/poker`);

    await expect(aviso(page)).toBeVisible();
    const caja = (await page.locator(".girar-movil").boundingBox())!;
    expect(caja).toMatchObject({ x: 0, y: 0, width: APAISADO.width, height: APAISADO.height });
    const tapete = page.locator(".pk-tapete");
    await expect(tapete).toBeAttached();
    await expect(tapete).toBeHidden();
    const volver = page.getByRole("button", { name: "Volver a la sala", includeHidden: true });
    await expect(volver).toBeAttached();
    await expect(volver).toBeHidden();
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
      tramos: Array(6).fill(null),
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

  test("la carrera que se abre con el móvil tumbado se pinta entera al ponerlo de pie (los caballos se miden entonces)", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaCarrera>(page, request, "mesa-carrera");
    await fichasDeApi(page, 950);
    mesa.alConectar(
      mensajeEstado<VistaCarrera>({
        ronda: 1,
        fase: "carrera",
        finFase: Date.now() + 800,
        posiciones: { H: 3, D: 2, C: 1, S: 0 },
        tramos: Array(6).fill(null),
        ultimaCarta: null,
        misApuestas: [{ caballo: "H", cantidad: 50 }],
        totalesPorCaballo: { H: 50, D: 0, C: 0, S: 0 },
        sentados: [sesion.jugador.apodo],
        ganador: null,
      }),
    );
    await page.goto(`/p/${codigo}/carrera`);
    await expect(aviso(page)).toBeVisible();

    await page.setViewportSize(VERTICAL);
    await expect(aviso(page)).toBeHidden();
    const corazones = page.locator('[data-caballo="H"]');
    await expect(corazones).toBeVisible();
    await expect(corazones).toHaveAttribute("data-casilla", "3");
    const caja = (await corazones.boundingBox())!;
    expect(caja.width).toBeGreaterThan(20);
    expect(caja.x + caja.width).toBeLessThanOrEqual(VERTICAL.width);
    expect(mesa.conexiones()).toBe(1);
  });

  test("mientras el aviso tapa la mesa no suena ni vibra nada, y al volver a ponerlo de pie no se repite lo que pasó mientras tanto", async ({ page, request }) => {
    // Cada sonido crea sus osciladores: se cuentan, y las vibraciones se anotan (como en carrera.spec.ts).
    await page.addInitScript(() => {
      const w = window as unknown as { __osciladores: number; __vibraciones: number[]; __audio: AudioContext | null };
      w.__osciladores = 0;
      w.__vibraciones = [];
      w.__audio = null;
      const crear = AudioContext.prototype.createDynamicsCompressor;
      AudioContext.prototype.createDynamicsCompressor = function (...args) {
        w.__audio = this;
        return crear.apply(this, args);
      };
      const original = AudioContext.prototype.createOscillator;
      AudioContext.prototype.createOscillator = function (...args) {
        w.__osciladores++;
        return original.apply(this, args);
      };
      navigator.vibrate = (ms) => (w.__vibraciones.push(ms as number), true);
    });
    const { sesion, codigo, mesa } = await entrarSimulada<VistaCarrera>(page, request, "mesa-carrera");
    const yo = sesion.jugador.id;
    await fichasDeApi(page, 950);
    const vista = (resto: Partial<VistaCarrera>): VistaCarrera => ({
      ronda: 1,
      fase: "carrera",
      finFase: Date.now() + 800,
      posiciones: { H: 1, D: 2, C: 2, S: 2 },
      tramos: Array(6).fill(null),
      ultimaCarta: null,
      misApuestas: [{ caballo: "H", cantidad: 50 }],
      totalesPorCaballo: { H: 50, D: 0, C: 0, S: 0 },
      sentados: [sesion.jugador.apodo],
      ganador: null,
      ...resto,
    });
    mesa.alConectar(mensajeEstado<VistaCarrera>(vista({})));
    await page.setViewportSize(VERTICAL);
    await page.goto(`/p/${codigo}/carrera`);
    await expect(page.locator('[data-caballo="H"]')).toHaveAttribute("data-casilla", "1");
    // El audio solo despierta con un toque del jugador.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __audio: AudioContext | null }).__audio?.state ?? "sin audio"), { timeout: 15_000 }).toBe("running");
    const osciladores = () => page.evaluate(() => (window as unknown as { __osciladores: number }).__osciladores);
    const vibraciones = () => page.evaluate(() => (window as unknown as { __vibraciones: number[] }).__vibraciones);

    // Control: de pie, un paso de la carrera suena (si no, el resto de la prueba no demostraría nada).
    mesa.enviar(mensajeEstado<VistaCarrera>(vista({ posiciones: { H: 2, D: 2, C: 2, S: 2 }, ultimaCarta: c("5H") }), [{ tipo: "caballo_avanza", palo: "H", carta: c("5H") }]));
    await expect.poll(osciladores).toBeGreaterThan(0);
    const conSonido = await osciladores();

    // Tumbado: un paso y la victoria del jugador (carta, arpegio y vibración de 80 ms de haber estado a la vista). No suena ni vibra nada.
    await page.setViewportSize(APAISADO);
    await expect(aviso(page)).toBeVisible();
    mesa.enviar(mensajeEstado<VistaCarrera>(vista({ posiciones: { H: 3, D: 2, C: 2, S: 2 }, ultimaCarta: c("6H") }), [{ tipo: "caballo_avanza", palo: "H", carta: c("6H") }]));
    await page.waitForTimeout(900);
    mesa.enviar(
      mensajeEstado<VistaCarrera>(vista({ fase: "resultado", finFase: Date.now() + 8_000, posiciones: { H: 8, D: 2, C: 2, S: 2 }, ultimaCarta: c("KH"), ganador: "H" }), [
        { tipo: "caballo_avanza", palo: "H", carta: c("KH") },
        { tipo: "ganador", palo: "H" },
        { tipo: "pago", jugadorId: yo, neto: 150 },
      ]),
    );
    await page.waitForTimeout(2_000);
    expect(await osciladores(), "nada suena con el aviso puesto").toBe(conSonido);
    expect(await vibraciones(), "nada vibra con el aviso puesto").toEqual([]);

    // De pie otra vez: la mesa enseña cómo está ahora (ha ganado corazones) y no se repite ni un sonido ni una vibración.
    await page.setViewportSize(VERTICAL);
    await expect(aviso(page)).toBeHidden();
    await expect(page.getByText("¡Gana el caballo de corazones!")).toBeVisible();
    await expect(page.locator('[data-caballo="H"]')).toHaveAttribute("data-casilla", "8");
    await page.waitForTimeout(1_000);
    expect(await osciladores(), "al volver no se repite lo que sonó").toBe(conSonido);
    expect(await vibraciones()).toEqual([]);
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
      opciones: null,
      miSeguro: null,
      casillasLibres: 7,
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
    mesa.enviar(mensajeEstado<VistaBJ>(vista({ manos: [{ jugadorId: yo, apodo: sesion.jugador.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: [], estado: "jugando", doblada: false, dividida: false, total: 0 }] })));
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
    expect(await alturaDeLaPagina(page)).toBeGreaterThan(APAISADO.height);
    await page.mouse.wheel(0, 300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

    await page.goto("/ranking");
    await expect(page.getByRole("tab", { name: "Fichas", exact: true })).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
    expect(await alturaDeLaPagina(page)).toBeGreaterThan(APAISADO.height);
    await page.mouse.wheel(0, 800);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    // En una pantalla tan baja la barra de pestañas no se queda fija (se comería la mitad de la lista): se va con el desplazamiento.
    expect((await page.getByRole("tab", { name: "Fichas", exact: true }).boundingBox())!.y).toBeLessThan(0);

    await page.goto("/perfil");
    await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
    await expect(aviso(page)).toHaveCount(0);
    expect(await alturaDeLaPagina(page)).toBeGreaterThan(APAISADO.height);
  });
});

test.describe("móvil tumbado pero alto (una tableta)", () => {
  test.skip(() => test.info().project.name !== "movil", "solo se comprueba en el proyecto móvil");
  test.use({ viewport: { width: 1024, height: 768 } });

  test("con un puntero táctil pero más de 500 px de alto no se pide girar nada: la mesa se enseña", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaBJ>(page, request, "mesa-blackjack");
    await fichasDeApi(page, 1000);
    mesa.alConectar(mensajeEstado<VistaBJ>({ ronda: 1, fase: "apuestas", finFase: Date.now() + 15_000, banca: [], totalBanca: null, manos: [], sentados: [sesion.jugador.apodo], yo: sesion.jugador.id, opciones: null, miSeguro: null, casillasLibres: 7 }));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeVisible();
    await expect(aviso(page)).toBeHidden();
  });
});

test.describe("ventana baja con ratón", () => {
  test.skip(() => test.info().project.name !== "desktop", "solo se comprueba en el proyecto de escritorio");
  test.use({ viewport: APAISADO });

  test("con un puntero fino (el ratón) no se pide girar nada: la mesa se enseña aunque la ventana sea baja", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaBJ>(page, request, "mesa-blackjack");
    await fichasDeApi(page, 1000);
    mesa.alConectar(mensajeEstado<VistaBJ>({ ronda: 1, fase: "apuestas", finFase: Date.now() + 15_000, banca: [], totalBanca: null, manos: [], sentados: [sesion.jugador.apodo], yo: sesion.jugador.id, opciones: null, miSeguro: null, casillasLibres: 7 }));
    await page.goto(`/p/${codigo}/blackjack`);

    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeVisible();
    await expect(aviso(page)).toBeHidden();
  });
});
