import { type Browser, type BrowserContext, expect, type Locator, type Page, test, type WebSocketRoute } from "@playwright/test";
import type { MensajeMesa, RespuestaSesion } from "../src/shared/api";
import type { Carta } from "../src/shared/cartas";
import type { VistaBJ } from "../src/shared/juegos/blackjack";
import type { Evento } from "../src/shared/juegos/tipos";
import { abrirPartida, apodoUnico, conSesion, registrar } from "./ayudas";

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

test("dos jugadores apuestan 50, se plantan y cobran lo que enseña la mesa; recargar a mitad de ronda devuelve la mano", async ({ page, browser, request }) => {
  const sesionA = await registrar(request, apodoUnico(), "1234");
  const sesionB = await registrar(request, apodoUnico(), "1234");
  const codigo = await abrirPartida(request, sesionA);
  await conSesion(page, sesionA);
  const contextoB = await otroContexto(browser);
  try {
    const paginaB = await contextoB.newPage();
    await conSesion(paginaB, sesionB);
    const paginas = [page, paginaB];

    await Promise.all(paginas.map((p) => p.goto(`/p/${codigo}/blackjack`)));
    for (const p of paginas) await expect(contador(p)).toHaveText("Tienes 1.000 fichas");

    await Promise.all(paginas.map((p) => apostar(p, 50)));
    for (const p of paginas) await expect(contador(p)).toHaveText("Tienes 950 fichas");

    // El reparto llega al cerrarse la ventana de apuestas (15 s): dos cartas para cada uno y la banca con una tapada.
    for (const p of paginas) {
      await expect(tuMano(p)).toHaveCount(2, { timeout: 30_000 });
      await expect(banca(p)).toHaveCount(2);
      await expect(p.getByRole("group", { name: "Banca" }).getByRole("img", { name: "Carta boca abajo" })).toHaveCount(1);
    }

    // Se recarga a quien no sostiene la ronda: si el otro aún decide, la ronda sigue mientras tanto.
    const plantarse = (p: Page) => p.getByRole("button", { name: "Plantarse" });
    // Si la ronda ya ha pasado de las decisiones, el botón ya no está: no se espera a que vuelva.
    const decide = async (p: Page) => (await plantarse(p).isVisible()) && (await plantarse(p).isEnabled({ timeout: 1_000 }).catch(() => false));
    for (const p of paginas) await expect(plantarse(p).or(resultado(p))).toBeVisible();
    const [aDecide, bDecide] = [await decide(page), await decide(paginaB)];
    const recargada = aDecide ? paginaB : bDecide ? page : null;
    if (recargada === null) {
      test.info().annotations.push({ type: "nota", description: "Los dos tienen blackjack: no hay decisiones durante las que recargar." });
    } else {
      const antes = await tuMano(recargada).evaluateAll((cartas) => cartas.map((c) => c.getAttribute("aria-label")));
      await recargada.reload();
      await expect(tuMano(recargada)).toHaveCount(2);
      expect(await tuMano(recargada).evaluateAll((cartas) => cartas.map((c) => c.getAttribute("aria-label")))).toEqual(antes);
      await expect(contador(recargada)).toHaveText("Tienes 950 fichas");
    }

    // Se mira quién decide antes de que nadie actúe: en cuanto se planta el último que decidía, la ronda sigue sin esperar.
    const deciden = [await decide(page), await decide(paginaB)];
    for (const [i, p] of paginas.entries()) if (deciden[i]) await plantarse(p).click();

    for (const p of paginas) {
      await resultado(p).waitFor({ timeout: 30_000 });
      const neto = await netoMostrado(p);
      await expect(contador(p)).toHaveText(`Tienes ${miles(1000 + neto)} fichas`);
    }
  } finally {
    await contextoB.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Con la mesa simulada: el socket de la mesa no llega al servidor y la prueba decide qué manda la mesa.
// ---------------------------------------------------------------------------------------------------------------------

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Carta["palo"], valor: texto.slice(0, -1) as Carta["valor"] });

interface Mesa {
  /** El mensaje con el que contesta la mesa al conectar (o `null`: no contesta). Se fija antes de abrir la página. */
  alConectar(mensaje: MensajeMesa<VistaBJ> | null): void;
  /** Al conectar, en vez de contestar, cierra con este código. */
  cerrarAlConectar(codigo: number): void;
  enviar(mensaje: MensajeMesa<VistaBJ>): void;
  cerrar(codigo: number): Promise<void>;
  /** Las acciones que ha mandado el cliente, en orden. */
  recibidas: unknown[];
  /** Cuántas conexiones ha abierto el cliente con la mesa. */
  conexiones(): number;
}

async function simularMesa(pagina: Page): Promise<Mesa> {
  let socket: WebSocketRoute | null = null;
  let inicial: MensajeMesa<VistaBJ> | null = null;
  let cierre: number | null = null;
  const recibidas: unknown[] = [];
  let conexiones = 0;
  await pagina.routeWebSocket(/\/parties\/mesa-blackjack\//, (ws) => {
    conexiones++;
    socket = ws;
    ws.onMessage((m) => recibidas.push(JSON.parse(String(m))));
    if (cierre !== null) void ws.close({ code: cierre });
    else if (inicial !== null) ws.send(JSON.stringify(inicial));
  });
  return {
    alConectar: (mensaje) => {
      inicial = mensaje;
    },
    cerrarAlConectar: (codigo) => {
      cierre = codigo;
    },
    enviar: (mensaje) => (socket as WebSocketRoute | null)?.send(JSON.stringify(mensaje)),
    cerrar: async (codigo) => (socket as WebSocketRoute | null)?.close({ code: codigo }),
    recibidas,
    conexiones: () => conexiones,
  };
}

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
    ...resto,
  };
}

let version = 0;
const estado = (v: VistaBJ, eventos: Evento[] = []): MensajeMesa<VistaBJ> => ({ t: "estado", version: ++version, ahora: Date.now(), vista: v, eventos });

async function entrarSimulada(pagina: Page, request: Parameters<typeof registrar>[0]) {
  const sesion = await registrar(request, apodoUnico(), "1234");
  const codigo = await abrirPartida(request, sesion);
  await conSesion(pagina, sesion);
  const mesa = await simularMesa(pagina);
  return { sesion, codigo, mesa };
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

  test("las fichas que no puedes pagar no se pueden pulsar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await page.route("**/api/yo", async (ruta) => {
      const respuesta = await ruta.fetch();
      await ruta.fulfill({ response: respuesta, json: { ...(await respuesta.json()), fichas: 60 } });
    });
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
    // ya se ha atendido.
    mesa.enviar({ t: "error", codigo: "demasiados_mensajes" });
    mesa.enviar(estado(vista(sesion, { fase: "esperando", finFase: null })));
    await expect(page.getByText("Apuesta para empezar la ronda")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);

    mesa.enviar({ t: "error", codigo: "sin_fichas" });
    await expect(page.getByText("No tienes fichas suficientes")).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(1);

    mesa.enviar({ t: "error", codigo: "no_disponible" });
    await expect(page.getByText("No se pudo hacer la apuesta. Inténtalo de nuevo")).toBeVisible();

    mesa.enviar({ t: "error", codigo: "fase_incorrecta" });
    await expect(page.getByText("No puedes hacer eso ahora")).toBeVisible();
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
    let fichas = 950;
    await page.route("**/api/yo", async (ruta) => {
      // Las fichas de cuando se pide, no de cuando contesta el servidor: una petición en vuelo no ve el cambio siguiente.
      const valor = fichas;
      const respuesta = await ruta.fetch();
      await ruta.fulfill({ response: respuesta, json: { ...(await respuesta.json()), fichas: valor } });
    });
    const mano = (cartas: Carta[], total: number, estadoMano: VistaBJ["manos"][number]["estado"] = "jugando") => ({
      jugadorId: yo,
      apodo: sesion.jugador.apodo,
      apuesta: 50,
      cartas,
      estado: estadoMano,
      doblada: false,
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
    fichas = 1050;
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
  });

  test("«← Sala» con apuesta en juego pide confirmación y manda salir; sin apuesta sale sin preguntar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const conApuesta = vista(sesion, {
      fase: "decisiones",
      banca: [c("6S"), null],
      totalBanca: 6,
      manos: [{ jugadorId: sesion.jugador.id, apodo: sesion.jugador.apodo, apuesta: 50, cartas: [c("10H"), c("9C")], estado: "jugando", doblada: false, total: 19 }],
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

  test("el contador se pone al día al reconectar con la ronda ya liquidada (sin evento de pago) y al cambiar de ronda", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    let fichas = 950;
    await page.route("**/api/yo", async (ruta) => {
      // Las fichas de cuando se pide, no de cuando contesta el servidor: una petición en vuelo no ve el cambio siguiente.
      const valor = fichas;
      const respuesta = await ruta.fetch();
      await ruta.fulfill({ response: respuesta, json: { ...(await respuesta.json()), fichas: valor } });
    });
    const mano = { jugadorId: sesion.jugador.id, apodo: sesion.jugador.apodo, apuesta: 50, cartas: [c("10H"), c("9C")], estado: "plantado" as const, doblada: false, total: 19 };
    mesa.alConectar(estado(vista(sesion, { fase: "banca", finFase: Date.now() + 1_000, banca: [c("6S"), null], totalBanca: 6, manos: [mano] })));
    await page.goto(`/p/${codigo}/blackjack`);
    await expect(contador(page)).toHaveText("Tienes 950 fichas");
    await page.waitForLoadState("networkidle");

    // La ronda se paga con la conexión caída: al volver, la mesa manda la foto ya en «resultado», sin eventos.
    fichas = 1050;
    mesa.alConectar(
      estado(vista(sesion, { fase: "resultado", finFase: Date.now() + 4_000, banca: [c("6S"), c("KD"), c("9C")], totalBanca: 25, manos: [mano] })),
    );
    await mesa.cerrar(1001);
    await expect(contador(page)).toHaveText("Tienes 1.050 fichas", { timeout: 15_000 });

    // Un pago que llega tarde (reintento de la liquidación) no trae evento: la ronda siguiente vuelve a leer las fichas.
    fichas = 1100;
    mesa.enviar(estado(vista(sesion, { ronda: 2 })));
    await expect(contador(page)).toHaveText("Tienes 1.100 fichas");
  });

  test("mientras «Pedir» espera respuesta, una novedad de otro jugador no lo reactiva: un doble toque pide una sola carta", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const yo = sesion.jugador.id;
    const mia = (cartas: Carta[]) => ({ jugadorId: yo, apodo: sesion.jugador.apodo, apuesta: 50, cartas, estado: "jugando" as const, doblada: false, total: 0 });
    const otra = (cartas: Carta[]) => ({ jugadorId: 900, apodo: "Otro", apuesta: 50, cartas, estado: "jugando" as const, doblada: false, total: 0 });
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
