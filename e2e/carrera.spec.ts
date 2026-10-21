import { expect, type Locator, type Page, test } from "@playwright/test";
import type { RespuestaSesion } from "../src/shared/api";
import type { Palo } from "../src/shared/cartas";
import type { VistaCarrera } from "../src/shared/juegos/carrera";
import { abrirPartida, apodoUnico, carta as c, conSesion, entrarSimulada, mensajeEstado, registrar } from "./ayudas";

// La mesa anima sin parar: las capturas continuas de la traza saturan la máquina con varios trabajadores (ver blackjack.spec.ts).
test.use({ trace: { mode: "retain-on-failure", screenshots: false, snapshots: true, sources: true } });

const contador = (pagina: Page): Locator => pagina.getByText(/^Tienes [\d.]+ fichas$/);
const caballo = (pagina: Page, palo: string): Locator => pagina.locator(`[data-caballo="${palo}"]`);
const cabecera = (pagina: Page, nombre: string): Locator => pagina.getByRole("button", { name: new RegExp(`^Caballo de ${nombre}`) });

/** Las casillas (0–8) de los cuatro caballos, en el orden de la mesa: corazones, diamantes, tréboles y picas. */
async function casillas(pagina: Page): Promise<number[]> {
  return Promise.all(["H", "D", "C", "S"].map(async (palo) => Number(await caballo(pagina, palo).getAttribute("data-casilla"))));
}

test("una carrera de verdad: apuesta 50 a corazones, los caballos avanzan, sale el ganador y el contador cuadra", async ({ page, request }) => {
  const sesion = await registrar(request, apodoUnico(), "1234");
  const codigo = await abrirPartida(request, sesion);
  await conSesion(page, sesion);
  await page.goto(`/p/${codigo}/carrera`);

  await expect(contador(page)).toHaveText("Tienes 1.000 fichas");
  // Sentarse despierta la mesa: ya hay una ventana de apuestas abierta y los cuatro caballos esperan en la salida.
  await expect(page.getByText("Elige un caballo y apuesta")).toBeVisible();
  expect(await casillas(page)).toEqual([0, 0, 0, 0]);

  await cabecera(page, "corazones").click();
  await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
  await page.getByRole("button", { name: "Apostar 50" }).click();
  await expect(contador(page)).toHaveText("Tienes 950 fichas");
  await expect(cabecera(page, "corazones")).toContainText("Tú 50");

  // Al cerrarse la ventana de apuestas (20 s) empieza la carrera: las casillas cambian y nunca se salen de 0–8.
  await expect.poll(() => casillas(page), { timeout: 40_000 }).not.toEqual([0, 0, 0, 0]);
  const vistas = new Set<string>();
  const ganador = page.getByText(/^¡Gana el caballo de (corazones|diamantes|tréboles|picas)!$/);
  await expect
    .poll(
      async () => {
        const ahora = await casillas(page);
        expect(ahora.every((n) => n >= 0 && n <= 8)).toBe(true);
        vistas.add(ahora.join());
        return ganador.isVisible();
      },
      { timeout: 90_000, intervals: [150] },
    )
    .toBe(true);
  expect(vistas.size).toBeGreaterThan(5);

  const texto = (await ganador.textContent()) ?? "";
  const gano = texto.includes("corazones");
  // El caballo ganador ha llegado a la meta (casilla 8) y el contador es lo apostado más lo cobrado (×4 con la apuesta incluida).
  const palo = texto.includes("corazones") ? "H" : texto.includes("diamantes") ? "D" : texto.includes("tréboles") ? "C" : "S";
  await expect(caballo(page, palo)).toHaveAttribute("data-casilla", "8");
  if (gano) await expect(page.getByText("¡Ganas +150!")).toBeVisible();
  await expect(contador(page)).toHaveText(`Tienes ${gano ? "1.150" : "950"} fichas`);
});

// ---------------------------------------------------------------------------------------------------------------------
// Con la mesa simulada: el socket de la mesa no llega al servidor y la prueba decide qué manda la mesa.
// ---------------------------------------------------------------------------------------------------------------------

type Casillas = Record<Palo, number>;
const pos = (H: number, D: number, C: number, S: number): Casillas => ({ H, D, C, S });
const tramos = (...cartas: string[]): VistaCarrera["tramos"] => Array.from({ length: 7 }, (_, i) => (cartas[i] ? c(cartas[i]) : null));
const estado = mensajeEstado<VistaCarrera>;
const entrar = (page: Page, request: Parameters<typeof registrar>[0]) => entrarSimulada<VistaCarrera>(page, request, "mesa-carrera");

/** Una mesa de prueba: el jugador que mira (`sesion`) sentado, con lo que se cambie. */
function vista(sesion: RespuestaSesion, resto: Partial<VistaCarrera> = {}): VistaCarrera {
  return {
    ronda: 1,
    fase: "apuestas",
    finFase: Date.now() + 20_000,
    posiciones: pos(0, 0, 0, 0),
    tramos: tramos(),
    ultimaCarta: null,
    misApuestas: [],
    totalesPorCaballo: pos(0, 0, 0, 0),
    sentados: [sesion.jugador.apodo],
    ganador: null,
    ...resto,
  };
}

const alertas = (pagina: Page): Locator => pagina.getByRole("alert");
const ganadorDe = (pagina: Page, nombre: string): Locator => pagina.getByText(`¡Gana el caballo de ${nombre}!`);
const premio = (pagina: Page): Locator => pagina.getByText(/^¡Ganas \+\d+!$/);
const tramosDeLaPista = (pagina: Page): Locator => pagina.getByRole("group", { name: "Tramos de la pista" }).getByRole("img");
const ficha = (pagina: Page, valor: number): Locator => pagina.getByRole("button", { name: `Añadir ${valor}`, exact: true });

/** Las fichas que devuelve `/api/yo`, fijadas al pedir (una petición en vuelo no ve el cambio siguiente). */
async function fichasDe(pagina: Page, inicial: number): Promise<{ poner(n: number): void }> {
  let fichas = inicial;
  await pagina.route("**/api/yo", async (ruta) => {
    const valor = fichas;
    const respuesta = await ruta.fetch();
    await ruta.fulfill({ response: respuesta, json: { ...(await respuesta.json()), fichas: valor } });
  });
  return { poner: (n) => (fichas = n) };
}

/** Lo que ha recorrido un caballo desde su salida, en píxeles (el desplazamiento de su `transform` ahora mismo). */
const recorrido = (pagina: Page, palo: Palo): Promise<number> =>
  caballo(pagina, palo).evaluate((el) => {
    const m = new DOMMatrix(getComputedStyle(el).transform);
    return Math.hypot(m.m41, m.m42);
  });

/** Espera a que la pista esté quieta: con las tipografías cargadas y sin recolocar los caballos por un cambio de medidas. */
async function pistaQuieta(pagina: Page): Promise<void> {
  await pagina.evaluate(() => document.fonts.ready);
  await expect(pagina.locator(".carrera-mesa")).not.toHaveClass(/ajustando/);
}

/** Lo que mide cada casilla en la pista de esta pantalla (`--paso`), en píxeles. */
const paso = (pagina: Page): Promise<number> => pagina.locator(".carrera-mesa").evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue("--paso")));

interface Muestra {
  /** Milisegundos desde que empezó a mirar. */
  t: number;
  /** Lo recorrido por cada caballo. */
  d: Record<string, number>;
  /** La etiqueta del primer tramo. */
  tramo: string | null;
}

/** Mira la pista fotograma a fotograma durante `ms` y deja las muestras en `window.__muestras`. */
async function mirar(pagina: Page, ms: number): Promise<void> {
  await pagina.evaluate((duracion) => {
    const w = window as unknown as { __muestras: unknown[] };
    w.__muestras = [];
    const inicio = performance.now();
    const caballos = [...document.querySelectorAll<HTMLElement>("[data-caballo]")];
    const primero = document.querySelector(".carrera-tramo [role=img]");
    const paso = () => {
      const d: Record<string, number> = {};
      for (const el of caballos) {
        const m = new DOMMatrix(getComputedStyle(el).transform);
        d[el.dataset.caballo ?? "?"] = Math.hypot(m.m41, m.m42);
      }
      w.__muestras.push({ t: performance.now() - inicio, d, tramo: primero?.getAttribute("aria-label") ?? null });
      if (performance.now() - inicio < duracion) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }, ms);
}

const muestras = (pagina: Page): Promise<Muestra[]> => pagina.evaluate(() => (window as unknown as { __muestras: Muestra[] }).__muestras);

test.describe("mesa simulada", () => {
  test("la mesa dormida invita a apostar: se elige caballo, las fichas se activan y «Apostar» manda caballo y cantidad", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    mesa.alConectar(estado(vista(sesion, { fase: "esperando", finFase: null })));
    await page.goto(`/p/${codigo}/carrera`);

    await expect(page.getByText("Apuesta para empezar la carrera")).toBeVisible();
    // Sin caballo elegido no hay a qué apostar.
    for (const valor of [10, 25, 50, 100, 500]) await expect(ficha(page, valor)).toBeDisabled();
    await expect(page.getByRole("button", { name: "Elige un caballo" })).toBeDisabled();

    // El caballo se elige tocando su as en la pista o su cabecera.
    await page.getByRole("img", { name: "As de tréboles" }).click();
    await expect(cabecera(page, "tréboles")).toHaveAttribute("aria-pressed", "true");
    await cabecera(page, "picas").click();
    await expect(cabecera(page, "picas")).toHaveAttribute("aria-pressed", "true");
    await expect(cabecera(page, "tréboles")).toHaveAttribute("aria-pressed", "false");
    for (const valor of [10, 25, 50, 100, 500]) await expect(ficha(page, valor)).toBeEnabled();
    await ficha(page, 25).click();
    await ficha(page, 50).click();
    await page.getByRole("button", { name: "Apostar 75 a picas" }).click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "apostar", caballo: "S", cantidad: 75 });
  });

  test("varias apuestas al mismo caballo se suman en lo tuyo; la mesa muestra lo de todos; el máximo por caballo apaga las fichas que lo pasarían", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    mesa.alConectar(estado(vista(sesion, { misApuestas: [{ caballo: "H", cantidad: 450 }], totalesPorCaballo: pos(900, 100, 0, 0) })));
    await page.goto(`/p/${codigo}/carrera`);

    await expect(cabecera(page, "corazones")).toContainText("Tú 450");
    await expect(cabecera(page, "corazones")).toContainText("Mesa 900");
    await expect(cabecera(page, "diamantes")).toContainText("Mesa 100");
    await expect(cabecera(page, "tréboles")).not.toContainText("Tú");

    // Corazones: 450 + 100 pasaría de 500; 50 justo llega.
    await cabecera(page, "corazones").click();
    for (const valor of [10, 25, 50]) await expect(ficha(page, valor)).toBeEnabled();
    for (const valor of [100, 500]) await expect(ficha(page, valor)).toBeDisabled();
    await ficha(page, 25).click();
    // Con 25 preparados ya solo caben 25 más: el 50 se apaga, el 25 y el 10 no.
    await expect(ficha(page, 50)).toBeDisabled();
    await expect(ficha(page, 25)).toBeEnabled();
    await ficha(page, 25).click();
    await expect(page.getByRole("button", { name: "Apostar 50 a corazones" })).toBeEnabled();
    for (const valor of [10, 25, 50, 100, 500]) await expect(ficha(page, valor)).toBeDisabled();

    // Lo preparado se pasa al caballo que se elige; el tope es por caballo: en diamantes (sin apuesta tuya) cabe hasta 500.
    await cabecera(page, "diamantes").click();
    await expect(page.getByRole("button", { name: "Apostar 50 a diamantes" })).toBeEnabled();
    await page.getByRole("button", { name: "Borrar apuesta" }).click();
    await expect(page.getByRole("button", { name: "Elige tu apuesta" })).toBeDisabled();
    for (const valor of [10, 25, 50, 100, 500]) await expect(ficha(page, valor)).toBeEnabled();
    await ficha(page, 500).click();
    await expect(page.getByRole("button", { name: "Apostar 500 a diamantes" })).toBeEnabled();
    await expect(ficha(page, 10)).toBeDisabled();

    // Llegar a 500 en un caballo lo deja cerrado.
    mesa.enviar(estado(vista(sesion, { misApuestas: [{ caballo: "H", cantidad: 500 }, { caballo: "D", cantidad: 500 }], totalesPorCaballo: pos(950, 600, 0, 0) })));
    await expect(cabecera(page, "diamantes")).toContainText("Tú 500");
    await expect(page.getByRole("button", { name: "Máximo en diamantes" })).toBeDisabled();
    for (const valor of [10, 25, 50, 100, 500]) await expect(ficha(page, valor)).toBeDisabled();
    await cabecera(page, "tréboles").click();
    await expect(ficha(page, 500)).toBeEnabled();
  });

  test("las fichas que superan tus fichas no se pueden pulsar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    await fichasDe(page, 60);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(contador(page)).toHaveText("Tienes 60 fichas");
    await cabecera(page, "tréboles").click();
    await expect(ficha(page, 50)).toBeEnabled();
    await expect(ficha(page, 100)).toBeDisabled();
    await expect(ficha(page, 500)).toBeDisabled();
    await ficha(page, 50).click();
    await expect(ficha(page, 25)).toBeDisabled();
    await expect(ficha(page, 10)).toBeEnabled();
  });

  test("un doble toque en «Apostar» manda una sola apuesta, y una novedad de otro jugador no reactiva el botón", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/carrera`);
    await cabecera(page, "corazones").click();
    await ficha(page, 50).click();
    const apostadas = () => mesa.recibidas.filter((m) => (m as { t: string }).t === "apostar").length;
    const boton = page.getByRole("button", { name: "Apostar 50 a corazones" });
    await boton.click();
    await expect.poll(apostadas).toBe(1);

    // Otro jugador apuesta antes de que conteste la mesa a la tuya.
    mesa.enviar(estado(vista(sesion, { totalesPorCaballo: pos(0, 100, 0, 0), sentados: [sesion.jugador.apodo, "Otro"] })));
    await expect(cabecera(page, "diamantes")).toContainText("Mesa 100");
    await expect(boton).toBeDisabled();
    await boton.click({ force: true });
    await page.waitForTimeout(300);
    expect(apostadas()).toBe(1);

    // Llega tu apuesta: lo preparado se da por hecho y se puede seguir.
    mesa.enviar(estado(vista(sesion, { misApuestas: [{ caballo: "H", cantidad: 50 }], totalesPorCaballo: pos(50, 100, 0, 0), sentados: [sesion.jugador.apodo, "Otro"] })));
    await expect(cabecera(page, "corazones")).toContainText("Tú 50");
    await expect(page.getByRole("button", { name: "Elige tu apuesta" })).toBeDisabled();
    await ficha(page, 25).click();
    await expect(page.getByRole("button", { name: "Apostar 25 a corazones" })).toBeEnabled();
  });

  test("errores de la mesa: textos para el jugador, y el exceso de mensajes no se enseña", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(page.getByText("Elige un caballo y apuesta")).toBeVisible();

    // Solo, el exceso de mensajes no enseña nada: detrás va un cambio visible por el mismo socket y, cuando se ve, se cuenta
    // sin reintentos (esperar a que baje a 0 daría por buena también una alerta que se va sola).
    mesa.enviar({ t: "error", codigo: "demasiados_mensajes" });
    mesa.enviar(estado(vista(sesion, { fase: "esperando", finFase: null })));
    await expect(page.getByText("Apuesta para empezar la carrera")).toBeVisible();
    expect(await alertas(page).count()).toBe(0);

    mesa.enviar({ t: "error", codigo: "sin_fichas" });
    await expect(page.getByText("No tienes fichas suficientes")).toBeVisible();
    await expect(alertas(page)).toHaveCount(1);
    mesa.enviar({ t: "error", codigo: "no_disponible" });
    await expect(page.getByText("No se pudo hacer la apuesta. Inténtalo de nuevo")).toBeVisible();
    mesa.enviar({ t: "error", codigo: "fase_incorrecta" });
    await expect(page.getByText("No puedes hacer eso ahora")).toBeVisible();
  });

  test("con la mesa llena lo dice y no reintenta", async ({ page, request }) => {
    const { codigo, mesa } = await entrar(page, request);
    await page.goto(`/p/${codigo}/carrera`);
    await expect.poll(() => mesa.conexiones()).toBeGreaterThan(0);
    // En desarrollo, el modo estricto de React abre y cierra una primera conexión: se espera a que se asiente.
    await page.waitForTimeout(500);
    const abiertas = mesa.conexiones();
    mesa.enviar({ t: "error", codigo: "mesa_llena" });
    await mesa.cerrar(4003);
    await expect(page.getByText("La mesa está llena")).toBeVisible();
    await expect(page.getByText("Ya hay 12 jugadores en la carrera")).toBeVisible();
    // partysocket reintenta en 1–5 s: pasado ese rato no debe haber ninguna conexión nueva.
    await page.waitForTimeout(6_000);
    expect(mesa.conexiones()).toBe(abiertas);
    await page.getByRole("link", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
  });

  test("si la mesa no llega a contestar, lo dice y deja volver a la sala", async ({ page, request }) => {
    const { codigo, mesa } = await entrar(page, request);
    mesa.alConectar(null);
    await page.goto(`/p/${codigo}/carrera`);
    await expect(page.getByText("No conseguimos sentarte en la mesa")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
  });

  test("si la mesa cierra la primera conexión sin reintento posible (4401), lo dice y deja volver a la sala", async ({ page, request }) => {
    const { codigo, mesa } = await entrar(page, request);
    mesa.cerrarAlConectar(4401);
    await page.goto(`/p/${codigo}/carrera`);
    await expect(page.getByText("No conseguimos sentarte en la mesa")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Volver a la sala" })).toBeVisible();
  });

  test("«← Sala» con apuestas en juego pide confirmación y manda salir; sin apuestas sale sin preguntar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    mesa.alConectar(estado(vista(sesion, { misApuestas: [{ caballo: "H", cantidad: 50 }], totalesPorCaballo: pos(50, 0, 0, 0) })));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(cabecera(page, "corazones")).toContainText("Tú 50");

    await page.getByRole("button", { name: "Volver a la sala" }).click();
    const dialogo = page.getByRole("dialog", { name: "¿Salir de la mesa?" });
    await expect(dialogo.getByText("Si sales ahora pierdes tu apuesta")).toBeVisible();
    await dialogo.getByRole("button", { name: "Seguir jugando" }).click();
    await expect(dialogo).toBeHidden();
    await expect(page).toHaveURL(`/p/${codigo}/carrera`);
    expect(mesa.recibidas).not.toContainEqual({ t: "salir" });

    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await dialogo.getByRole("button", { name: "Salir" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    const salidas = () => mesa.recibidas.filter((m) => (m as { t: string }).t === "salir").length;
    await expect.poll(salidas).toBe(1);

    // Sin apuestas: directo a la sala, y también deja el asiento.
    mesa.alConectar(estado(vista(sesion)));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(page.getByText("Elige un caballo y apuesta")).toBeVisible();
    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    await expect.poll(salidas).toBe(2);
  });

  test("con la carrera ya liquidada, salir no pregunta: no hay nada que perder", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    mesa.alConectar(
      estado(vista(sesion, { fase: "resultado", finFase: Date.now() + 4_000, posiciones: pos(8, 3, 2, 4), ganador: "H", misApuestas: [{ caballo: "D", cantidad: 50 }], tramos: tramos("5H", "6D", "7C", "8S", "9H", "4D", "3C") })),
    );
    await page.goto(`/p/${codigo}/carrera`);
    await expect(ganadorDe(page, "corazones")).toBeVisible();
    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    await expect.poll(() => mesa.recibidas.filter((m) => (m as { t: string }).t === "salir").length).toBe(1);
  });
});

test.describe("movimiento de la pista (mesa simulada)", () => {
  test("cada paso se desliza con una transición, y un paso que llega a mitad del anterior sigue desde donde va sin dar saltos atrás", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    const carrera = (posiciones: Casillas, resto: Partial<VistaCarrera> = {}) => vista(sesion, { fase: "carrera", finFase: Date.now() + 800, posiciones, misApuestas: [{ caballo: "H", cantidad: 50 }], ...resto });
    mesa.alConectar(estado(carrera(pos(0, 0, 0, 0))));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(caballo(page, "H")).toHaveAttribute("data-casilla", "0");
    const casilla = await paso(page);
    expect(casilla).toBeGreaterThan(20);
    expect(await recorrido(page, "H")).toBe(0);
    await pistaQuieta(page);

    await mirar(page, 1700);
    mesa.enviar(estado(carrera(pos(1, 0, 0, 0), { ultimaCarta: c("4H") }), [{ tipo: "caballo_avanza", palo: "H", carta: c("4H") }]));
    // El segundo paso llega cuando el primero va por la mitad (la transición dura ~400 ms).
    await page.waitForTimeout(200);
    mesa.enviar(estado(carrera(pos(2, 0, 0, 0), { ultimaCarta: c("7H") }), [{ tipo: "caballo_avanza", palo: "H", carta: c("7H") }]));
    await page.waitForTimeout(1600);
    const frames = (await muestras(page)).map((m) => m.d.H);

    // Acaba en la casilla 2, el recorrido nunca baja (no vuelve a empezar al llegar el segundo paso)…
    expect(frames.at(-1)).toBeCloseTo(2 * casilla, 0);
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1] - 0.5);
    // …y pasa por posiciones intermedias de verdad (una animación, no un salto): al menos 12 fotogramas entre medias.
    const entreMedias = frames.filter((d) => d > 0.05 * casilla && d < 1.95 * casilla);
    expect(entreMedias.length).toBeGreaterThanOrEqual(12);
    // Ningún fotograma avanza más de lo que un caballo recorre en uno: sin saltos.
    for (let i = 1; i < frames.length; i++) expect(frames[i] - frames[i - 1]).toBeLessThan(0.6 * casilla);
  });

  test("tras avanzar, el tramo se gira y, ya visto, el caballo retrocede: se ven el avance, el giro y la vuelta", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    const antes = vista(sesion, { fase: "carrera", posiciones: pos(0, 1, 1, 1), misApuestas: [{ caballo: "H", cantidad: 50 }], finFase: Date.now() + 800 });
    mesa.alConectar(estado(antes));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(caballo(page, "H")).toHaveAttribute("data-casilla", "0");
    await pistaQuieta(page);
    await expect(tramosDeLaPista(page)).toHaveCount(7);
    await expect(page.getByRole("group", { name: "Tramos de la pista" }).getByRole("img", { name: "Carta boca abajo" })).toHaveCount(7);
    const casilla = await paso(page);

    await mirar(page, 1500);
    // Sale un corazón: todos están ya en la casilla 1 o más, se gira el tramo 0 (un 5 de corazones) y el caballo de corazones vuelve a la 0.
    mesa.enviar(estado({ ...antes, posiciones: pos(0, 1, 1, 1), tramos: tramos("5H"), ultimaCarta: c("4H") }, [{ tipo: "caballo_avanza", palo: "H", carta: c("4H") }, { tipo: "tramo_girado", indice: 0, palo: "H" }]));
    await expect(page.getByRole("img", { name: "5 de corazones" })).toBeVisible();
    await page.waitForTimeout(1300);
    const frames = await muestras(page);

    const maximo = Math.max(...frames.map((m) => m.d.H));
    // El caballo llega de verdad a la casilla 1 antes de volver…
    expect(maximo).toBeGreaterThan(0.9 * casilla);
    const iMax = frames.findIndex((m) => m.d.H >= maximo - 0.5);
    // …el tramo se ve girado (cambia su etiqueta) después de que el caballo haya empezado a avanzar y antes de que empiece a volver…
    const iGiro = frames.findIndex((m) => m.tramo === "5 de corazones");
    const iVuelta = frames.findIndex((m, i) => i > iMax && m.d.H < maximo - 2);
    expect(iGiro).toBeGreaterThan(0);
    expect(frames[iGiro].d.H).toBeGreaterThan(0.2 * casilla);
    expect(iVuelta).toBeGreaterThan(iGiro);
    // …y vuelve a su casilla inicial, a la vista (varios fotogramas por el camino).
    expect(frames.at(-1)?.d.H).toBeCloseTo(0, 0);
    expect(frames.slice(iVuelta).filter((m) => m.d.H > 0.1 * casilla && m.d.H < 0.9 * casilla).length).toBeGreaterThanOrEqual(5);
    // La línea de ese tramo se enciende.
    await expect(page.locator(".carrera-linea--encendida")).toHaveCount(1);
    await expect(caballo(page, "H")).toHaveAttribute("data-casilla", "0");
  });

  test("al volver la conexión a mitad de carrera se enseñan las casillas de ahora, sin repetir la carrera", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    const carrera = (posiciones: Casillas, giradas: string[], resto: Partial<VistaCarrera> = {}) =>
      vista(sesion, { fase: "carrera", finFase: Date.now() + 800, posiciones, tramos: tramos(...giradas), misApuestas: [{ caballo: "H", cantidad: 50 }], ...resto });
    mesa.alConectar(estado(carrera(pos(1, 1, 1, 0), ["5H"], { ultimaCarta: c("2D") })));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(caballo(page, "H")).toHaveAttribute("data-casilla", "1");
    await expect.poll(() => mesa.conexiones()).toBeGreaterThan(0);
    await page.waitForTimeout(500);

    // Quien mira en cada instante en que cambia la pista: si algo se desliza o se gira en ese momento, es que se repite.
    await page.evaluate(() => {
      const w = window as unknown as { __repeticiones: { casilla: string; animaciones: number }[] };
      w.__repeticiones = [];
      const mirar = () => {
        for (const el of document.querySelectorAll<HTMLElement>("[data-caballo], .carrera-tramo .naipe__giro")) {
          w.__repeticiones.push({ casilla: el.dataset.casilla ?? "tramo", animaciones: el.getAnimations().length });
        }
      };
      new MutationObserver(mirar).observe(document.querySelector(".carrera-mesa")!, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-casilla"] });
    });
    // Se cae la conexión; al volver la mesa manda la foto de ahora, con varios pasos de más y sin eventos.
    mesa.alConectar(estado(carrera(pos(5, 4, 4, 3), ["5H", "6D", "7C"], { ultimaCarta: c("KS") })));
    await mesa.cerrar(1001);
    await expect(caballo(page, "H")).toHaveAttribute("data-casilla", "5", { timeout: 15_000 });
    await expect(caballo(page, "S")).toHaveAttribute("data-casilla", "3");
    await expect(page.getByRole("img", { name: "7 de tréboles" })).toBeVisible();
    await expect(page.locator(".carrera-linea--encendida")).toHaveCount(3);
    const repeticiones = await page.evaluate(() => (window as unknown as { __repeticiones: { casilla: string; animaciones: number }[] }).__repeticiones);
    expect(repeticiones.some((r) => r.casilla === "5")).toBe(true);
    expect(repeticiones.filter((r) => r.animaciones > 0)).toEqual([]);
    // Y ya en su sitio: el caballo está justo en su casilla, no de camino.
    const casilla = await paso(page);
    expect(await recorrido(page, "H")).toBeCloseTo(5 * casilla, 0);
    expect(await recorrido(page, "S")).toBeCloseTo(3 * casilla, 0);
    // La última carta es la de la foto.
    await expect(page.getByRole("group", { name: "Última carta" }).getByRole("img", { name: "Rey de picas" })).toBeVisible();
  });

  test("el ganador no se anuncia antes de llegar a la meta; después, el aviso, el cobro y el contador cuadran", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    const yo = sesion.jugador.id;
    const fichas = await fichasDe(page, 950);
    const enMarcha = vista(sesion, {
      fase: "carrera",
      finFase: Date.now() + 800,
      posiciones: pos(7, 3, 2, 4),
      tramos: tramos("5H", "6D", "7C", "8S"),
      ultimaCarta: c("2D"),
      misApuestas: [{ caballo: "H", cantidad: 50 }],
      totalesPorCaballo: pos(50, 0, 0, 0),
    });
    mesa.alConectar(estado(enMarcha));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(contador(page)).toHaveText("Tienes 950 fichas");
    await expect(caballo(page, "H")).toHaveAttribute("data-casilla", "7");
    await page.waitForLoadState("networkidle");
    await pistaQuieta(page);
    const casilla = await paso(page);

    fichas.poner(1150);
    await mirar(page, 2500);
    mesa.enviar(
      estado({ ...enMarcha, fase: "resultado", finFase: Date.now() + 5_000, posiciones: pos(8, 3, 2, 4), ultimaCarta: c("9H"), ganador: "H" }, [
        { tipo: "caballo_avanza", palo: "H", carta: c("9H") },
        { tipo: "ganador", palo: "H" },
        { tipo: "pago", jugadorId: yo, neto: 150 },
      ]),
    );
    // Recién llegado el paso, nada del resultado se adelanta: el caballo aún va hacia la meta.
    await page.waitForTimeout(120);
    expect(await ganadorDe(page, "corazones").count()).toBe(0);
    expect(await premio(page).count()).toBe(0);
    expect(await page.getByText("Ganas 150").count()).toBe(0);
    await expect(page.getByText("¡Corren los caballos!")).toBeVisible();

    await expect(ganadorDe(page, "corazones")).toBeVisible();
    // Cuando se anuncia, el caballo ya está en la meta (casilla 8).
    expect(await recorrido(page, "H")).toBeCloseTo(8 * casilla, 0);
    await expect(caballo(page, "H")).toHaveAttribute("data-casilla", "8");
    await expect(premio(page)).toHaveText("¡Ganas +150!");
    await expect(page.getByText("Ganas 150", { exact: true })).toBeVisible();
    await expect(page.locator(".fichas-volando")).toBeAttached();
    await expect(contador(page)).toHaveText("Tienes 1.150 fichas");
    // El cartel se va solo, pero el aviso del ganador se queda hasta la carrera siguiente.
    await expect(premio(page)).toBeHidden({ timeout: 5_000 });
    await expect(ganadorDe(page, "corazones")).toBeVisible();
    // Las cuentas del paso se ven en la escena: los otros caballos se quedan donde estaban.
    expect(await recorrido(page, "D")).toBeCloseTo(3 * casilla, 0);
  });

  test("si ganas otro caballo, no hay cartel de premio: pierdes lo apostado y el contador no se mueve", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    const yo = sesion.jugador.id;
    await fichasDe(page, 950);
    const enMarcha = vista(sesion, { fase: "carrera", posiciones: pos(3, 7, 2, 4), tramos: tramos("5H"), ultimaCarta: c("2D"), misApuestas: [{ caballo: "H", cantidad: 50 }], totalesPorCaballo: pos(50, 0, 0, 0) });
    mesa.alConectar(estado(enMarcha));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(caballo(page, "D")).toHaveAttribute("data-casilla", "7");
    mesa.enviar(
      estado({ ...enMarcha, fase: "resultado", finFase: Date.now() + 5_000, posiciones: pos(3, 8, 2, 4), ultimaCarta: c("JD"), ganador: "D" }, [
        { tipo: "caballo_avanza", palo: "D", carta: c("JD") },
        { tipo: "ganador", palo: "D" },
        { tipo: "pago", jugadorId: yo, neto: -50 },
      ]),
    );
    await expect(ganadorDe(page, "diamantes")).toBeVisible();
    await expect(page.getByText("Pierdes 50", { exact: true })).toBeVisible();
    // El resultado y el cartel salen en el mismo instante: si hubiera cartel, ya estaría.
    expect(await premio(page).count()).toBe(0);
    expect(await page.locator(".fichas-volando").count()).toBe(0);
    await expect(contador(page)).toHaveText("Tienes 950 fichas");
    // Los que no ganan se oscurecen y el ganador se marca.
    await expect(page.locator('[data-caballo="H"]')).toHaveClass(/carrera-caballo--atenuado/);
    await expect(page.locator('[data-caballo="D"]')).toHaveClass(/carrera-caballo--ganador/);
  });

  test("la carrera siguiente recoge la pista: los caballos vuelven a la salida, los tramos se tapan y el aviso del ganador se va", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    const final = vista(sesion, { fase: "resultado", finFase: Date.now() + 3_000, posiciones: pos(8, 3, 2, 4), ganador: "H", ultimaCarta: c("9H"), tramos: tramos("5H", "6D", "7C", "8S", "9H", "4D", "3C") });
    mesa.alConectar(estado(final));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(ganadorDe(page, "corazones")).toBeVisible();
    await expect(page.getByRole("group", { name: "Tramos de la pista" }).getByRole("img", { name: "Carta boca abajo" })).toHaveCount(0);
    await pistaQuieta(page);
    await mirar(page, 1000);
    mesa.enviar(estado(vista(sesion, { ronda: 2 })));
    await expect(page.getByText("Elige un caballo y apuesta")).toBeVisible();
    await expect(ganadorDe(page, "corazones")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Tramos de la pista" }).getByRole("img", { name: "Carta boca abajo" })).toHaveCount(7);
    for (const palo of ["H", "D", "C", "S"]) await expect(caballo(page, palo)).toHaveAttribute("data-casilla", "0");
    await expect(page.locator(".carrera-linea--encendida")).toHaveCount(0);
    await expect(page.locator('[data-caballo="D"]')).not.toHaveClass(/carrera-caballo--atenuado/);
    // Vuelven deslizándose (una transición), no de golpe.
    await page.waitForTimeout(1000);
    const frames = (await muestras(page)).map((m) => m.d.H);
    expect(frames.filter((d) => d > 0.5 && d < frames[0] - 0.5).length).toBeGreaterThanOrEqual(10);
    expect(frames.at(-1)).toBeCloseTo(0, 0);
  });

  test("las fichas se ponen al día al reconectar con la carrera ya liquidada (sin evento de pago) y al cambiar de ronda", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrar(page, request);
    const fichas = await fichasDe(page, 950);
    const apuesta = { misApuestas: [{ caballo: "H" as const, cantidad: 50 }] };
    mesa.alConectar(estado(vista(sesion, { fase: "carrera", posiciones: pos(7, 3, 2, 4), ...apuesta })));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(contador(page)).toHaveText("Tienes 950 fichas");
    await page.waitForLoadState("networkidle");

    // La carrera se paga con la conexión caída: al volver, la mesa manda la foto ya en «resultado», sin eventos.
    fichas.poner(1150);
    mesa.alConectar(estado(vista(sesion, { fase: "resultado", finFase: Date.now() + 4_000, posiciones: pos(8, 3, 2, 4), ganador: "H", ...apuesta })));
    await mesa.cerrar(1001);
    await expect(contador(page)).toHaveText("Tienes 1.150 fichas", { timeout: 15_000 });
    await expect(ganadorDe(page, "corazones")).toBeVisible();

    // Un pago que llega tarde no trae evento: la ronda siguiente vuelve a leer las fichas.
    fichas.poner(1200);
    mesa.enviar(estado(vista(sesion, { ronda: 2 })));
    await expect(contador(page)).toHaveText("Tienes 1.200 fichas");
  });

  test("con movimiento reducido los caballos saltan a su casilla y el giro del tramo solo se funde", async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const { sesion, codigo, mesa } = await entrar(page, request);
    await fichasDe(page, 950);
    const antes = vista(sesion, { fase: "carrera", posiciones: pos(1, 1, 1, 0), misApuestas: [{ caballo: "H", cantidad: 50 }], finFase: Date.now() + 800 });
    mesa.alConectar(estado(antes));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(caballo(page, "S")).toHaveAttribute("data-casilla", "0");
    await pistaQuieta(page);
    const casilla = await paso(page);

    await mirar(page, 1200);
    // Un paso con giro: sale una pica, se gira el tramo 0 (un 8 de picas) y el caballo de picas vuelve a la 0.
    mesa.enviar(estado({ ...antes, posiciones: pos(1, 1, 1, 0), tramos: tramos("8S"), ultimaCarta: c("3S") }, [{ tipo: "caballo_avanza", palo: "S", carta: c("3S") }, { tipo: "tramo_girado", indice: 0, palo: "S" }]));
    await expect(page.getByRole("img", { name: "8 de picas" })).toBeVisible();
    await page.waitForTimeout(1100);
    const frames = await muestras(page);
    // Saltan de golpe a cada casilla (nunca un fotograma entre medias) y no hay transición corriendo en ningún caballo.
    for (const m of frames) for (const d of Object.values(m.d)) expect(Math.abs(d / casilla - Math.round(d / casilla))).toBeLessThan(0.02);
    expect(await page.locator("[data-caballo]").evaluateAll((els) => els.flatMap((el) => el.getAnimations().map((a) => a.constructor.name)))).toEqual([]);
    // El tramo se destapa sin girar: la carta nunca está rotada en 3D.
    expect(await page.locator(".carrera-tramo .naipe__giro").first().evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    // Y no vuela nada hacia el contador al ganar.
    expect(await page.locator(".fichas-volando").count()).toBe(0);
  });

  test("suena una carta al salir cada una y otra al girarse un tramo (sin ráfagas); al ganar, la victoria y una vibración corta", async ({ page, request }) => {
    // Cada sonido crea sus osciladores: se cuentan, y la vibración se anota.
    await page.addInitScript(() => {
      const w = window as unknown as { __osciladores: number; __vibraciones: number[]; __audio: AudioContext | null };
      w.__osciladores = 0;
      w.__vibraciones = [];
      w.__audio = null;
      // El audio de la página nace al primer toque, en un rato libre: se guarda para saber cuándo está en marcha.
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
    const { sesion, codigo, mesa } = await entrar(page, request);
    const yo = sesion.jugador.id;
    await fichasDe(page, 950);
    const antes = vista(sesion, { fase: "carrera", posiciones: pos(1, 2, 2, 2), tramos: tramos(), misApuestas: [{ caballo: "H", cantidad: 50 }], finFase: Date.now() + 800 });
    mesa.alConectar(estado(antes));
    await page.goto(`/p/${codigo}/carrera`);
    await expect(caballo(page, "H")).toHaveAttribute("data-casilla", "1");
    // El audio solo despierta con un toque del jugador; se espera a que esté en marcha tocando algo.
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __audio: AudioContext | null }).__audio?.state ?? "sin audio"), { timeout: 15_000 }).toBe("running");
    const osciladores = () => page.evaluate(() => (window as unknown as { __osciladores: number }).__osciladores);
    const inicio = await osciladores();

    // Un paso sin giros: una carta (un oscilador por carta).
    mesa.enviar(estado({ ...antes, posiciones: pos(2, 2, 2, 2), ultimaCarta: c("5H") }, [{ tipo: "caballo_avanza", palo: "H", carta: c("5H") }]));
    await page.waitForTimeout(700);
    expect((await osciladores()) - inicio).toBe(1);
    // Un paso con giro: la carta al salir y otra al girarse el tramo.
    mesa.enviar(
      estado({ ...antes, posiciones: pos(2, 2, 2, 2), tramos: tramos("9D"), ultimaCarta: c("3S") }, [{ tipo: "caballo_avanza", palo: "S", carta: c("3S") }, { tipo: "tramo_girado", indice: 0, palo: "D" }]),
    );
    await page.waitForTimeout(900);
    expect((await osciladores()) - inicio).toBe(3);

    // Al ganar tú: la victoria (un arpegio de varias notas) y una vibración de 80 ms.
    expect(await page.evaluate(() => (window as unknown as { __vibraciones: number[] }).__vibraciones)).toEqual([]);
    mesa.enviar(
      estado({ ...antes, fase: "resultado", finFase: Date.now() + 5_000, posiciones: pos(8, 2, 2, 2), tramos: tramos("9D"), ultimaCarta: c("KH"), ganador: "H" }, [
        { tipo: "caballo_avanza", palo: "H", carta: c("KH") },
        { tipo: "ganador", palo: "H" },
        { tipo: "pago", jugadorId: yo, neto: 150 },
      ]),
    );
    await expect(premio(page)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __vibraciones: number[] }).__vibraciones)).toEqual([80]);
    expect((await osciladores()) - inicio).toBeGreaterThan(8);
  });
});
