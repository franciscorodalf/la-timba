import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import type { MensajeSala } from "../src/shared/api";
import { abrirPartida, apodoUnico, conSesion, registrar } from "./ayudas";

const CODIGO_EN_LA_URL = /\/p\/([A-Z2-9]{4})$/;

const codigoDe = (pagina: Page): string => new URL(pagina.url()).pathname.split("/")[2];
const jugadoresEnLaSala = (pagina: Page) => pagina.getByRole("list", { name: "Jugadores en la sala" });

const MESA_LIBRE = { jugadores: [], fase: "esperando", finFase: null };

/** Un mensaje de sala como el que manda el servidor, con las dos mesas libres salvo lo que se cambie. */
const mensajeSala = (codigo: string, resto: Partial<MensajeSala> = {}): MensajeSala => ({
  t: "sala",
  codigo,
  ahora: Date.now(),
  conectados: [],
  mesas: { blackjack: MESA_LIBRE, carrera: MESA_LIBRE },
  rankingNoche: [],
  ...resto,
});

/** Sustituye la sala del servidor por una simulada, sin llegar a conectar con él. */
async function simularSala(pagina: Page) {
  let socket: WebSocketRoute | null = null;
  let inicial: MensajeSala | null = null;
  await pagina.routeWebSocket(/\/parties\/partida\//, (ws) => {
    socket = ws;
    if (inicial !== null) ws.send(JSON.stringify(inicial));
  });
  return {
    /** El mensaje con el que contesta la sala al conectar. Se fija antes de abrir la página. */
    alConectar: (mensaje: MensajeSala) => {
      inicial = mensaje;
    },
    /** Un mensaje más, ya conectado. */
    enviar: (mensaje: MensajeSala) => (socket as WebSocketRoute | null)?.send(JSON.stringify(mensaje)),
  };
}

test("A crea la partida, B entra con el código en minúsculas y ambos se ven en la sala", async ({ page, browser, request }) => {
  const apodoA = apodoUnico();
  const apodoB = apodoUnico();
  await conSesion(page, await registrar(request, apodoA, "1234"));
  const contextoB = await browser.newContext();
  const paginaB = await contextoB.newPage();
  await conSesion(paginaB, await registrar(request, apodoB, "1234"));

  try {
    await page.goto("/");
    await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();
    await page.getByRole("button", { name: "Crear partida" }).click();

    await expect(page).toHaveURL(CODIGO_EN_LA_URL);
    const codigo = codigoDe(page);
    await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
    await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();
    await expect(jugadoresEnLaSala(page).getByText(apodoA)).toBeVisible();

    await paginaB.goto("/");
    await paginaB.getByLabel("Código").fill(codigo.toLowerCase());
    await expect(paginaB.getByLabel("Código")).toHaveValue(codigo);
    await paginaB.getByRole("button", { name: "Unirse" }).click();
    await expect(paginaB).toHaveURL(`/p/${codigo}`);

    for (const pagina of [page, paginaB]) {
      await expect(jugadoresEnLaSala(pagina).getByText(apodoA)).toBeVisible();
      await expect(jugadoresEnLaSala(pagina).getByText(apodoB)).toBeVisible();
    }

    // Las dos mesas están libres, el póker aún no existe y nadie ha jugado esta noche.
    await expect(page.getByRole("link", { name: "Entrar en Blackjack" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Entrar en Carrera" })).toBeVisible();
    await expect(page.getByText("Mesa libre")).toHaveCount(2);
    await expect(page.getByText("Próximamente")).toBeVisible();
    await expect(page.getByRole("link", { name: /Póker/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Esta noche" })).toBeVisible();
    await expect(page.getByText("Aún no ha jugado nadie")).toBeVisible();

    // La barra inferior lleva a la sala, al ranking y al perfil.
    const barra = page.getByRole("navigation", { name: "Principal" });
    await expect(barra.getByRole("link", { name: "Sala" })).toHaveAttribute("href", `/p/${codigo}`);
    await expect(barra.getByRole("link", { name: "Sala" })).toHaveAttribute("aria-current", "page");
    await expect(barra.getByRole("link", { name: "Ranking" })).toHaveAttribute("href", "/ranking");
    await expect(barra.getByRole("link", { name: "Perfil" })).toHaveAttribute("href", "/perfil");

    // Sin desplazamiento horizontal en ningún tamaño de pantalla.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // Cuando B se va, A deja de verlo.
    await contextoB.close();
    await expect(jugadoresEnLaSala(page).getByText(apodoB)).toHaveCount(0);
    await expect(jugadoresEnLaSala(page).getByText(apodoA)).toBeVisible();
  } finally {
    await contextoB.close();
  }
});

test("una partida que no existe lo dice y lleva de vuelta al inicio, sin abrir ninguna conexión", async ({ page, request }) => {
  await conSesion(page, await registrar(request, apodoUnico(), "1234"));
  let conexiones = 0;
  page.on("websocket", (socket) => {
    if (socket.url().includes("/parties/")) conexiones++; // el servidor de desarrollo abre otro socket para recargar en caliente
  });

  await page.goto("/p/ZZZZ");
  await expect(page.getByText("Esa partida no existe")).toBeVisible();
  expect(conexiones).toBe(0);

  await page.getByRole("link", { name: "Volver al inicio" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "Crear partida" })).toBeVisible();
});

test("un enlace con el código en minúsculas abre la misma sala", async ({ page, request }) => {
  const sesion = await registrar(request, apodoUnico(), "1234");
  const codigo = await abrirPartida(request, sesion);
  await conSesion(page, sesion);

  await page.goto(`/p/${codigo.toLowerCase()}`);
  await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
});

test.describe("Inicio", () => {
  test("unirse a un código que no existe avisa y se queda en el inicio", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await page.goto("/");

    await page.getByLabel("Código").fill("zzzz");
    await page.getByRole("button", { name: "Unirse" }).click();

    await expect(page.getByText("Esa partida no existe")).toBeVisible();
    await expect(page).toHaveURL("/");
  });

  test("unirse con el código pregunta una sola vez si la partida existe; crearla, ninguna", async ({ page, request }) => {
    const anfitrion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, anfitrion);
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    const consultas: string[] = [];
    page.on("request", (peticion) => {
      const ruta = new URL(peticion.url()).pathname;
      if (peticion.method() === "GET" && ruta.startsWith("/api/partidas/")) consultas.push(ruta);
    });
    await page.goto("/");

    await page.getByLabel("Código").fill(codigo);
    await page.getByRole("button", { name: "Unirse" }).click();
    await expect(page.getByRole("button", { name: new RegExp(`Invitar.*${codigo}`) })).toBeVisible();
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);
    expect(consultas).toEqual([`/api/partidas/${codigo}`]);

    // Una partida recién creada existe: tampoco se pregunta.
    await page.goto("/");
    consultas.length = 0;
    await page.getByRole("button", { name: "Crear partida" }).click();
    await expect(page.getByRole("button", { name: /Invitar/ })).toBeVisible();
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);
    expect(consultas).toEqual([]);
  });

  test("un código incompleto se corrige sin preguntar al servidor", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    let consultas = 0;
    await page.route("**/api/partidas/*", (ruta) => {
      consultas++;
      return ruta.continue();
    });
    await page.goto("/");

    await page.getByLabel("Código").fill("ab");
    await page.getByRole("button", { name: "Unirse" }).click();

    await expect(page.getByLabel("Código")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("El código tiene 4 caracteres")).toBeVisible();
    expect(consultas).toBe(0);
  });

  test("el campo del código escribe en mayúsculas, sin símbolos y con 4 como máximo", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await page.goto("/");

    await page.getByLabel("Código").fill("a-b c9xyz");
    await expect(page.getByLabel("Código")).toHaveValue("ABC9");
  });

  test("si el servidor falla al crear la partida, lo dice", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    await page.route("**/api/partidas", (ruta) => ruta.fulfill({ status: 503, json: { error: "descansando" } }));
    await page.goto("/");

    await page.getByRole("button", { name: "Crear partida" }).click();

    await expect(page.getByText("La Timba está descansando, vuelve mañana")).toBeVisible();
    await expect(page).toHaveURL("/");
  });
});

test.describe("Invitar", () => {
  test("enseña el código y el QR del enlace, copia el enlace y se cierra con Esc", async ({ page, context, request }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    await page.goto(`/p/${codigo}`);
    const enlace = `${new URL(page.url()).origin}/p/${codigo}`;

    const abrir = page.getByRole("button", { name: /Invitar/ });
    await abrir.click();
    const dialogo = page.getByRole("dialog", { name: "Invita a tus amigos" });
    await expect(dialogo).toBeVisible();
    await expect(dialogo.getByText(codigo, { exact: true })).toBeVisible();
    await expect(dialogo.getByRole("img", { name: new RegExp(codigo) })).toBeVisible();
    await expect(dialogo.getByText(enlace)).toBeVisible();

    await dialogo.getByRole("button", { name: "Copiar enlace" }).click();
    await expect(dialogo.getByText("Enlace copiado")).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(enlace);

    await page.keyboard.press("Escape");
    await expect(dialogo).toBeHidden();
    await expect(abrir).toBeFocused();
  });

  test("se cierra también con su botón y pulsando fuera", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    await page.goto(`/p/${codigo}`);

    const dialogo = page.getByRole("dialog", { name: "Invita a tus amigos" });
    await page.getByRole("button", { name: /Invitar/ }).click();
    await dialogo.getByRole("button", { name: "Cerrar" }).click();
    await expect(dialogo).toBeHidden();

    await page.getByRole("button", { name: /Invitar/ }).click();
    await expect(dialogo).toBeVisible();
    await page.mouse.click(4, 4);
    await expect(dialogo).toBeHidden();
  });
});

test.describe("mesas", () => {
  test("«Entrar» lleva a la mesa y la conexión de la sala sigue abierta al ir y volver", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    let conexiones = 0;
    page.on("websocket", (socket) => {
      if (socket.url().includes("/parties/partida/")) conexiones++;
    });
    await page.goto(`/p/${codigo}`);
    await expect(page.getByRole("link", { name: "Entrar en Blackjack" })).toBeVisible();
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);
    const antes = conexiones;
    expect(antes).toBeGreaterThan(0);

    await page.getByRole("link", { name: "Entrar en Blackjack" }).click();
    await expect(page).toHaveURL(`/p/${codigo}/blackjack`);
    await page.goBack();
    await page.getByRole("link", { name: "Entrar en Carrera" }).click();
    await expect(page).toHaveURL(`/p/${codigo}/carrera`);
    await page.goBack();

    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);
    expect(conexiones).toBe(antes);
  });

  test("enseña quién está sentado, la fase y la cuenta atrás de cada mesa", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);

    // La sala la manda el servidor: aquí se sustituye por una con las dos mesas en marcha y alguien arriba en el ranking.
    const finApuestas = Date.now() + 30_000;
    await page.routeWebSocket(/\/parties\/partida\//, (ws) => {
      ws.send(
        JSON.stringify({
          t: "sala",
          codigo,
          ahora: Date.now(),
          conectados: ["Leo", "Ana"],
          mesas: {
            blackjack: { jugadores: ["Ana", "Leo", "Mía"], fase: "decisiones", finFase: Date.now() + 9_000 },
            carrera: { jugadores: ["Sol"], fase: "apuestas", finFase: finApuestas },
          },
          rankingNoche: [
            { apodo: "Leo", neto: 420 },
            { apodo: "Ana", neto: 0 },
            { apodo: "Mía", neto: -120 },
            { apodo: "Sol", neto: -300 },
          ],
        }),
      );
    });
    await page.goto(`/p/${codigo}`);

    const blackjack = page.getByRole("link", { name: "Entrar en Blackjack" });
    const carrera = page.getByRole("link", { name: "Entrar en Carrera" });
    await expect(blackjack).toBeVisible();
    await expect(page.getByText("Jugando")).toBeVisible();
    await expect(page.getByRole("list", { name: "Sentados en Blackjack" }).getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("list", { name: "Sentados en Carrera" }).getByText("Sol")).toBeAttached();

    // La cuenta atrás avanza sola.
    const cuenta = page.getByText(/^Sale en 0:\d\d$/);
    await expect(cuenta).toBeVisible();
    const primera = await cuenta.textContent();
    await expect(async () => expect(await cuenta.textContent()).not.toBe(primera)).toPass({ timeout: 4_000 });

    // «Esta noche»: solo los tres primeros, con su signo.
    const ranking = page.getByRole("list", { name: "Ranking de esta noche" });
    await expect(ranking.getByRole("listitem")).toHaveCount(3);
    await expect(ranking.getByRole("listitem").nth(0)).toContainText("Leo");
    await expect(ranking.getByRole("listitem").nth(0)).toContainText("+420");
    await expect(ranking.getByRole("listitem").nth(1)).toHaveText(/Ana\s*0$/);
    await expect(ranking.getByRole("listitem").nth(2)).toContainText("−120");
    await expect(ranking).not.toContainText("Sol");
    await expect(carrera).toBeVisible();
  });
});

test.describe("cuentas atrás", () => {
  /** Anota cada cuenta atrás de la carrera que aparece en pantalla, en orden, y cuántos temporizadores de 250 ms hay vivos. */
  async function vigilarCuentas(pagina: Page) {
    await pagina.addInitScript(() => {
      const w = window as unknown as { cuentas: string[]; latidos: () => number };
      w.cuentas = [];
      let previa: string | null = null;
      new MutationObserver(() => {
        const actual = /Sale en (\d+:\d\d)/.exec(document.body.textContent ?? "")?.[1] ?? null;
        if (actual === previa) return;
        previa = actual;
        if (actual !== null) w.cuentas.push(actual);
      }).observe(document, { subtree: true, childList: true, characterData: true });

      const vivos = new Map<number, number | undefined>();
      const poner = window.setInterval.bind(window);
      const quitar = window.clearInterval.bind(window);
      window.setInterval = ((funcion: TimerHandler, ms?: number, ...resto: unknown[]) => {
        const id = poner(funcion, ms, ...resto);
        vivos.set(id, ms);
        return id;
      }) as typeof window.setInterval;
      window.clearInterval = ((id?: number) => {
        if (id !== undefined) vivos.delete(id);
        quitar(id);
      }) as typeof window.clearInterval;
      w.latidos = () => [...vivos.values()].filter((ms) => ms === 250).length;
    });
    return {
      cuentas: () => pagina.evaluate(() => (window as unknown as { cuentas: string[] }).cuentas),
      latidos: () => pagina.evaluate(() => (window as unknown as { latidos: () => number }).latidos()),
    };
  }

  test("se calculan con el reloj del servidor aunque el del dispositivo vaya un minuto atrasado", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    const sala = await simularSala(page);
    // El servidor va 60 s por delante del reloj del navegador, y dice que las apuestas cierran dentro de 12 s (de su reloj).
    const servidor = Date.now() + 60_000;
    sala.alConectar(mensajeSala(codigo, { ahora: servidor, mesas: { blackjack: MESA_LIBRE, carrera: { jugadores: ["Sol"], fase: "apuestas", finFase: servidor + 12_000 } } }));

    await page.goto(`/p/${codigo}`);

    // Con el reloj del navegador saldría «1:12».
    await expect(page.getByText(/^Sale en 0:1[0-2]$/)).toBeVisible();
    await expect(page.getByText("Sale en 1:1")).toHaveCount(0);
  });

  test("al pasar de «Mesa libre» a las apuestas, ninguna cuenta atrás se ve con la hora de antes", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    const vigilancia = await vigilarCuentas(page);
    const sala = await simularSala(page);
    sala.alConectar(mensajeSala(codigo));
    await page.goto(`/p/${codigo}`);
    await expect(page.getByText("Mesa libre")).toHaveCount(2);

    // Ocho veces: la mesa se queda libre y vuelve a abrir apuestas, y cada vez el reloj del servidor se aparta un minuto
    // más o menos del anterior. Si la tarjeta pintara con la hora de su último latido, saldría una cuenta de más de 15 s.
    for (let vuelta = 0; vuelta < 8; vuelta++) {
      const ahora = Date.now() + (vuelta % 2) * 60_000;
      sala.enviar(mensajeSala(codigo, { ahora }));
      await expect(page.getByText("Mesa libre")).toHaveCount(2);
      sala.enviar(mensajeSala(codigo, { ahora, mesas: { blackjack: MESA_LIBRE, carrera: { jugadores: ["Sol"], fase: "apuestas", finFase: ahora + 15_000 } } }));
      await expect(page.getByText(/^Sale en 0:\d\d$/)).toBeVisible();
    }

    const cuentas = await vigilancia.cuentas();
    expect(cuentas.length).toBeGreaterThanOrEqual(8);
    for (const cuenta of cuentas) expect(cuenta).toMatch(/^0:(0\d|1[0-5])$/);
  });

  test("el temporizador solo corre mientras la fase enseña una cuenta atrás", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    const vigilancia = await vigilarCuentas(page);
    const sala = await simularSala(page);
    // La banca juega y los caballos corren: su `finFase` es el siguiente paso (menos de un segundo), no una cuenta atrás.
    const ahora = Date.now();
    sala.alConectar(
      mensajeSala(codigo, {
        ahora,
        mesas: {
          blackjack: { jugadores: ["Ana"], fase: "banca", finFase: ahora + 1_000 },
          carrera: { jugadores: ["Sol"], fase: "carrera", finFase: ahora + 800 },
        },
      }),
    );
    await page.goto(`/p/${codigo}`);
    await expect(page.getByText("Juega la banca")).toBeVisible();
    await expect(page.getByText("¡Corren los caballos!")).toBeVisible();
    expect(await vigilancia.latidos()).toBe(0);

    sala.enviar(mensajeSala(codigo, { mesas: { blackjack: MESA_LIBRE, carrera: { jugadores: ["Sol"], fase: "apuestas", finFase: Date.now() + 20_000 } } }));
    await expect(page.getByText(/^Sale en 0:\d\d$/)).toBeVisible();
    expect(await vigilancia.latidos()).toBe(1);

    sala.enviar(mensajeSala(codigo, { mesas: { blackjack: MESA_LIBRE, carrera: { jugadores: ["Sol"], fase: "carrera", finFase: Date.now() + 800 } } }));
    await expect(page.getByText("¡Corren los caballos!")).toBeVisible();
    expect(await vigilancia.latidos()).toBe(0);
  });
});

test.describe("conexión de la sala", () => {
  /** Deja pasar las conexiones de la sala, anotándolas para poder cortarlas. */
  async function espiarSala(pagina: Page) {
    const abiertas: WebSocketRoute[] = [];
    const estado = { bloqueada: false };
    await pagina.routeWebSocket(/\/parties\/partida\//, (ws) => {
      if (estado.bloqueada) {
        void ws.close({ code: 1011 });
        return;
      }
      ws.connectToServer();
      abiertas.push(ws);
    });
    return { abiertas, estado };
  }

  test("al perder la conexión avisa de que reconecta y lo quita cuando vuelve", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    const { abiertas, estado } = await espiarSala(page);
    await page.goto(`/p/${codigo}`);
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("Reconectando…")).toHaveCount(0);

    // La sala no deja volver a conectar: el aviso sale pasado un segundo sin conexión y se queda mientras dure.
    estado.bloqueada = true;
    await abiertas[abiertas.length - 1].close({ code: 1001 });
    await expect(page.getByText("Reconectando…")).toBeVisible();

    estado.bloqueada = false;
    await expect(page.getByText("Reconectando…")).toBeHidden({ timeout: 20_000 });
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);
  });

  test("si la partida se cierra mientras no hay conexión, deja de reintentar y lo dice", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    const { abiertas, estado } = await espiarSala(page);
    await page.goto(`/p/${codigo}`);
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);

    estado.bloqueada = true;
    await page.route(`**/api/partidas/${codigo}`, (ruta) => ruta.fulfill({ json: { existe: false } }));
    await abiertas[abiertas.length - 1].close({ code: 1001 });

    await expect(page.getByText("Esa partida no existe")).toBeVisible();
  });

  test("en una carga normal «Reconectando…» ni se pinta, y si la conexión tarda aparece pasado un rato", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    await page.addInitScript(() => {
      const w = window as unknown as { reconectando: boolean };
      w.reconectando = false;
      new MutationObserver(() => {
        if (document.body.textContent?.includes("Reconectando")) w.reconectando = true;
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    const sala = await simularSala(page);
    sala.alConectar(mensajeSala(codigo, { conectados: ["Ana"] }));

    await page.goto(`/p/${codigo}`);
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);
    expect(await page.evaluate(() => (window as unknown as { reconectando: boolean }).reconectando)).toBe(false);
  });

  test("si el token ya no vale, al caerse la conexión se cierra la sesión en vez de reintentar para siempre", async ({ page, request }) => {
    const sesion = await registrar(request, apodoUnico(), "1234");
    const codigo = await abrirPartida(request, sesion);
    await conSesion(page, sesion);
    const { abiertas } = await espiarSala(page);
    await page.goto(`/p/${codigo}`);
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);

    // La consulta de si existe la partida no lleva token y seguiría diciendo que sí: lo que lo delata es leer las fichas.
    await page.route(/\/api\/(yo|fichas)$/, (ruta) => ruta.fulfill({ status: 401, json: { error: "no_autenticado" } }));
    await abiertas[abiertas.length - 1].close({ code: 1001 });

    await expect(page.getByLabel("Apodo")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("timba.token"))).toBeNull();
  });
});

test.describe("fichas", () => {
  /** Hace que `/api/fichas` (y `/api/yo`) contesten 250 fichas más de las que tiene el jugador cuando se active. Devuelve el interruptor. */
  async function sumarFichasAlRefrescar(pagina: Page) {
    const estado = { activo: false };
    await pagina.route(/\/api\/(yo|fichas)$/, async (ruta) => {
      const sumar = estado.activo;
      try {
        const respuesta = await ruta.fetch();
        if (!sumar) return await ruta.fulfill({ response: respuesta });
        const cuerpo = await respuesta.json();
        await ruta.fulfill({ response: respuesta, json: { ...cuerpo, fichas: cuerpo.fichas + 250 } });
      } catch {
        // La sala pide las fichas dos veces seguidas en desarrollo: si el test acaba con una petición en vuelo, ya no hay a quién contestar.
      }
    });
    // Anota cada valor que enseña el contador, en orden.
    await pagina.addInitScript(() => {
      const vistos: string[] = [];
      (window as unknown as { contador: string[] }).contador = vistos;
      new MutationObserver(() => {
        const texto = document.querySelector(".contador")?.textContent;
        if (texto != null && vistos.at(-1) !== texto) vistos.push(texto);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    return estado;
  }
  const valoresVistos = (pagina: Page) => pagina.evaluate(() => (window as unknown as { contador: string[] }).contador.map((v) => Number(v.replaceAll(".", ""))));

  test("la sala vuelve a leer las fichas y el contador sube contando", async ({ page, request }) => {
    await conSesion(page, await registrar(request, apodoUnico(), "1234"));
    const fichas = await sumarFichasAlRefrescar(page);
    await page.goto("/");
    await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();

    fichas.activo = true;
    await page.getByRole("button", { name: "Crear partida" }).click();
    await expect(page.getByText("Hola, tienes 1.250 fichas")).toBeVisible();

    const valores = await valoresVistos(page);
    expect(valores.at(-1)).toBe(1250);
    expect(valores.some((v) => v > 1000 && v < 1250)).toBe(true);
  });

  test.describe("con movimiento reducido", () => {
    test.use({ reducedMotion: "reduce" });

    test("el contador salta directo al valor nuevo", async ({ page, request }) => {
      await conSesion(page, await registrar(request, apodoUnico(), "1234"));
      const fichas = await sumarFichasAlRefrescar(page);
      await page.goto("/");
      await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();

      fichas.activo = true;
      await page.getByRole("button", { name: "Crear partida" }).click();
      await expect(page.getByText("Hola, tienes 1.250 fichas")).toBeVisible();

      expect((await valoresVistos(page)).filter((v) => v !== 1000 && v !== 1250)).toEqual([]);
    });
  });
});
