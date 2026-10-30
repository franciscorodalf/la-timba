import { expect, type Locator, type Page, test } from "@playwright/test";
import type { VistaBJ } from "../src/shared/juegos/blackjack";
import type { VistaCarrera } from "../src/shared/juegos/carrera";
import { abrirPartida, apodoUnico, carta as c, conSesion, entrarSimulada, fichasDeApi, mensajeEstado, registrar } from "./ayudas";

// La mesa anima sin parar: las capturas continuas de la traza saturan la máquina con varios trabajadores (ver blackjack.spec.ts).
test.use({ trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true } });

// ---------------------------------------------------------------------------------------------------------------------
// Movimiento reducido: nada vuela desde el mazo, las cartas aparecen en su sitio.
// ---------------------------------------------------------------------------------------------------------------------

/** Lo que mide una carta en el instante en que se empieza a ver y 300 ms después (`getBoundingClientRect`, en píxeles). */
interface Medida {
  nombre: string;
  /** La mano a la que pertenece («Tu mano», «Banca») y el `transform` que llevaba en ese instante. */
  mano: string;
  transform: string;
  t: number;
  x: number;
  y: number;
  ancho: number;
  alto: number;
}
interface Seguimiento {
  nombre: string;
  alAparecer: Medida;
  despues: Medida | null;
  /** La posición vertical más alta y más baja que ha tenido la carta mientras estaba en la mesa. */
  yMin: number;
  yMax: number;
}

/**
 * Antes de que cargue la página: un bucle de fotogramas que anota, de cada carta de las manos, su caja en el primer
 * fotograma en que se ve (opacidad > 0) y otra vez 300 ms más tarde. Una carta que sale volando desde el mazo se mediría
 * lejos de su sitio al aparecer; una que ya está en su sitio, no.
 */
async function seguirCartas(pagina: Page): Promise<void> {
  await pagina.addInitScript(() => {
    const w = window as unknown as { __seguimientos: Seguimiento[] };
    w.__seguimientos = [];
    const vistas = new WeakMap<Element, Seguimiento>();
    const medir = (el: Element): Medida => {
      const r = el.getBoundingClientRect();
      return {
        nombre: el.getAttribute("aria-label") ?? "",
        mano: el.closest("[role=group]")?.getAttribute("aria-label") ?? "",
        transform: getComputedStyle(el).transform,
        t: Math.round(performance.now()),
        x: r.x,
        y: r.y,
        ancho: r.width,
        alto: r.height,
      };
    };
    const vistaEn = new WeakMap<Element, number>();
    const fotograma = (ahora: number) => {
      for (const el of document.querySelectorAll(".bj-mano [role=img]")) {
        const previo = vistas.get(el);
        if (previo === undefined) {
          if (Number(getComputedStyle(el).opacity) <= 0) continue;
          const alAparecer = medir(el);
          const seguimiento = { nombre: alAparecer.nombre, alAparecer, despues: null, yMin: alAparecer.y, yMax: alAparecer.y };
          vistas.set(el, seguimiento);
          vistaEn.set(el, ahora);
          w.__seguimientos.push(seguimiento);
        } else {
          const { y } = el.getBoundingClientRect();
          previo.yMin = Math.min(previo.yMin, y);
          previo.yMax = Math.max(previo.yMax, y);
          if (previo.despues === null && ahora - (vistaEn.get(el) ?? ahora) >= 300) previo.despues = medir(el);
        }
      }
      requestAnimationFrame(fotograma);
    };
    requestAnimationFrame(fotograma);
  });
}

const contador = (pagina: Page): Locator => pagina.getByText(/^Tienes [\d.]+ fichas$/);
const tuMano = (pagina: Page): Locator => pagina.getByRole("group", { name: "Tu mano" }).getByRole("img");
const resultado = (pagina: Page): Locator => pagina.getByText(/^(Ganas \d+|Pierdes \d+|Empate)$/);

test.describe("con movimiento reducido", () => {
  test.use({ reducedMotion: "reduce" });

  test("una ronda de blackjack se completa y cada carta aparece ya en su sitio (no vuela desde el mazo)", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    await seguirCartas(page);

    await page.goto(`/p/${codigo}/blackjack`);
    await expect(contador(page)).toHaveText("Tienes 1.000 fichas");
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    await page.getByRole("button", { name: "Apostar 50" }).click();
    await expect(contador(page)).toHaveText("Tienes 950 fichas");

    // El reparto llega al cerrarse la ventana de apuestas (15 s); si hay decisión, se planta.
    await expect(tuMano(page)).toHaveCount(2, { timeout: 30_000 });
    const plantarse = page.getByRole("button", { name: "Plantarse" });
    await expect(plantarse.or(resultado(page))).toBeVisible({ timeout: 30_000 });
    // Se espera a que cada carta del reparto cumpla sus 300 ms antes de actuar: al plantarse llegan las cartas de la banca y su mano
    // se vuelve a centrar, un movimiento lateral legítimo que no debe caer dentro de la ventana de ninguna carta ya medida.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __seguimientos: Seguimiento[] }).__seguimientos.every((s) => s.despues !== null)), { timeout: 10_000 })
      .toBe(true);
    if (await plantarse.isEnabled().catch(() => false)) await plantarse.click();
    await resultado(page).waitFor({ timeout: 30_000 });
    // Que se cobra lo que enseña la mesa: la ronda se ha completado de verdad.
    const [, verbo, cantidad] = /^(Ganas|Pierdes) (\d+)$|^Empate$/.exec((await resultado(page).textContent()) ?? "") ?? [];
    const neto = verbo === "Ganas" ? Number(cantidad) : verbo === "Pierdes" ? -Number(cantidad) : 0;
    await expect(contador(page)).toHaveText(`Tienes ${String(1000 + neto).replace(/\B(?=(\d{3})+(?!\d))/g, ".")} fichas`);
    // La última carta cumple sus 300 ms.
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __seguimientos: Seguimiento[] }).__seguimientos.every((s) => s.despues !== null)), { timeout: 10_000 })
      .toBe(true);

    const seguimientos = await page.evaluate(() => (window as unknown as { __seguimientos: Seguimiento[] }).__seguimientos);
    // Dos cartas del jugador y dos de la banca como mínimo.
    expect(seguimientos.length).toBeGreaterThanOrEqual(4);
    for (const { nombre, alAparecer, despues, yMin, yMax } of seguimientos) {
      expect(despues, `la carta «${nombre}» no se midió 300 ms después`).not.toBeNull();
      for (const lado of ["x", "y", "ancho", "alto"] as const) {
        expect(Math.abs(despues![lado] - alAparecer[lado]), `«${nombre}» (${alAparecer.mano}): ${lado} al aparecer ${alAparecer[lado]} (${alAparecer.transform}) y después ${despues![lado]} (${despues!.transform})`).toBeLessThanOrEqual(1);
      }
      // Y la mesa no se recoloca por debajo: una carta no sube ni baja mientras dura la ronda (un cambio de alto del panel de
      // botones, por ejemplo, la movería de golpe). A los lados sí puede moverse: las manos se centran al llegar otra carta.
      expect(yMax - yMin, `«${nombre}» (${alAparecer.mano}) se movió ${(yMax - yMin).toFixed(1)} px en vertical durante la ronda`).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Tipografía del cartel: Playfair Display 800 (¡Ganas +N!, el ganador de la carrera) se pide al abrir la mesa.
// ---------------------------------------------------------------------------------------------------------------------

test.describe("letras grandes del premio", () => {
  // Sin esto el navegador descarga ese peso al ganar, a media animación: con la red lenta el cartel sale en la fuente de reserva y
  // cambia de letra de golpe, y la primera vez que se pinta cuesta una tarea larga justo en el momento más cargado de la mesa.
  for (const [mesa, party] of [["blackjack", "mesa-blackjack"], ["carrera", "mesa-carrera"]] as const) {
    test(`la mesa de ${mesa} descarga Playfair Display 800 al abrirse, sin esperar a que haya un premio`, async ({ page, request }) => {
      const { codigo, mesa: simulada } = await entrarSimulada<VistaBJ | VistaCarrera>(page, request, party);
      await fichasDeApi(page, 1000);
      simulada.alConectar(null); // la mesa no contesta: no hay ronda, ni premio, ni ganador
      const pedidas: string[] = [];
      page.on("request", (r) => {
        if (/playfair-display-latin-800/.test(r.url())) pedidas.push(r.url());
      });

      await page.goto(`/p/${codigo}/${mesa}`);
      await expect(page.getByRole("button", { name: "Volver a la sala" })).toBeVisible();

      await expect.poll(() => pedidas.length, { message: "se pide la fuente del cartel" }).toBeGreaterThan(0);
      // Y llega entera (no solo se pide): el navegador la da por cargada.
      await expect.poll(() => page.evaluate(() => document.fonts.check('800 48px "Playfair Display"', "¡Ganas +150!"))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Botones táctiles: todo lo que se pulsa mide al menos 44 px de alto en el móvil.
// ---------------------------------------------------------------------------------------------------------------------

const ALTO_MINIMO = 44;

/** Los botones (y enlaces con aspecto de botón) visibles de la página que miden menos de 44 px de alto, con su nombre. */
async function botonesBajos(pagina: Page): Promise<string[]> {
  return pagina.evaluate((minimo) => {
    const candidatos = document.querySelectorAll<HTMLElement>('button, [role="button"], [role="tab"], a[href], input[type="button"], input[type="submit"]');
    const bajos: string[] = [];
    for (const el of candidatos) {
      const estilo = getComputedStyle(el);
      if (estilo.visibility === "hidden" || estilo.display === "none" || el.closest("[inert], [aria-hidden=true]") !== null) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const nombre = el.getAttribute("aria-label") ?? el.textContent?.trim().replace(/\s+/g, " ") ?? "";
      if (r.height < minimo - 0.01) bajos.push(`«${nombre}» <${el.tagName.toLowerCase()} class="${el.className}"> mide ${r.height.toFixed(1)} px`);
    }
    return bajos;
  }, ALTO_MINIMO);
}

/** Cuenta cuántos botones táctiles se han mirado (para que la prueba no pase sin mirar nada). */
async function hayBotones(pagina: Page): Promise<number> {
  return pagina.locator('button:visible, [role="button"]:visible, [role="tab"]:visible, a[href]:visible').count();
}

async function comprobar(pagina: Page, donde: string): Promise<void> {
  expect(await hayBotones(pagina), `${donde}: no hay ningún botón que mirar`).toBeGreaterThan(0);
  expect(await botonesBajos(pagina), `${donde}: botones de menos de ${ALTO_MINIMO} px`).toEqual([]);
}

test.describe("botones de al menos 44 px en el móvil", () => {
  test.skip(({ isMobile }) => !isMobile, "solo se comprueba en el proyecto móvil");

  test("Entrada (formulario y confirmación)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel("Apodo")).toBeVisible();
    await comprobar(page, "Entrada");

    await page.getByLabel("Apodo").fill(apodoUnico());
    await page.getByLabel("PIN").fill("1234");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByRole("button", { name: "Sí" })).toBeVisible();
    await comprobar(page, "Entrada (¿crear el perfil?)");
  });

  test("Inicio, Sala (con el diálogo de invitar), Ranking y Perfil", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Crear partida" })).toBeVisible();
    await comprobar(page, "Inicio");

    await page.goto(`/p/${codigo}`);
    await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
    await comprobar(page, "Sala");
    await page.getByRole("button", { name: /Invitar/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await comprobar(page, "Sala (invitar)");

    await page.goto("/ranking");
    await expect(page.getByRole("tab", { name: "Fichas" })).toBeVisible();
    await comprobar(page, "Ranking");

    await page.goto("/perfil");
    await expect(page.getByRole("heading", { name: "Tus fichas" })).toBeVisible();
    await comprobar(page, "Perfil");
  });

  test("Perfil sin fichas (rescate)", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    await conSesion(page, sesion);
    await fichasDeApi(page, 0);
    await page.goto("/perfil");
    await expect(page.getByRole("button", { name: "Pedir rescate (+200)" })).toBeVisible();
    await comprobar(page, "Perfil sin fichas");
  });

  test("mesa de blackjack: apostar, decidir y salir", async ({ page, request }) => {
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
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeVisible();
    await comprobar(page, "Blackjack (apuestas)");

    mesa.enviar(
      mensajeEstado<VistaBJ>(
        vista({
          fase: "decisiones",
          banca: [c("6S"), null],
          totalBanca: 6,
          manos: [{ jugadorId: yo, apodo: sesion.jugador.apodo, casilla: 0, indice: 0, apuesta: 50, cartas: [c("5H"), c("6C")], estado: "jugando", doblada: false, dividida: false, total: 11 }],
        }),
        [
          { tipo: "carta_repartida", a: yo, oculta: false, carta: c("5H") },
          { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("6S") },
          { tipo: "carta_repartida", a: yo, oculta: false, carta: c("6C") },
          { tipo: "carta_repartida", a: "banca", oculta: true },
        ],
      ),
    );
    await expect(page.getByRole("button", { name: "Pedir" })).toBeEnabled();
    await comprobar(page, "Blackjack (decisiones)");

    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await comprobar(page, "Blackjack (confirmar salida)");
  });

  test("mesa de la carrera: elegir caballo y apostar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada<VistaCarrera>(page, request, "mesa-carrera");
    await fichasDeApi(page, 1000);
    const vista: VistaCarrera = {
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
    };
    mesa.alConectar(mensajeEstado<VistaCarrera>(vista));
    await page.goto(`/p/${codigo}/carrera`);
    await page.getByRole("button", { name: /^Caballo de corazones/ }).click();
    await expect(page.getByRole("button", { name: "Añadir 50", exact: true })).toBeVisible();
    await comprobar(page, "Carrera (apuestas)");
  });
});
