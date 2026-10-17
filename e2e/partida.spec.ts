import { expect, type Page, test, type WebSocketRoute } from "@playwright/test";
import { abrirPartida, apodoUnico, conSesion, registrar } from "./ayudas";

const CODIGO_EN_LA_URL = /\/p\/([A-Z2-9]{4})$/;

const codigoDe = (pagina: Page): string => new URL(pagina.url()).pathname.split("/")[2];
const jugadoresEnLaSala = (pagina: Page) => pagina.getByRole("list", { name: "Jugadores en la sala" });

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
    const { abiertas } = await espiarSala(page);
    await page.goto(`/p/${codigo}`);
    await expect(jugadoresEnLaSala(page).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("Reconectando…")).toBeHidden();

    await abiertas[abiertas.length - 1].close({ code: 1001 });

    await expect(page.getByText("Reconectando…")).toBeVisible();
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
});

test.describe("fichas", () => {
  /** Hace que `/api/yo` conteste 250 fichas más de las que tiene el jugador cuando se active. Devuelve el interruptor. */
  async function sumarFichasAlRefrescar(pagina: Page) {
    const estado = { activo: false };
    await pagina.route("**/api/yo", async (ruta) => {
      const sumar = estado.activo;
      try {
        const respuesta = await ruta.fetch();
        if (!sumar) return await ruta.fulfill({ response: respuesta });
        const perfil = await respuesta.json();
        await ruta.fulfill({ response: respuesta, json: { ...perfil, fichas: perfil.fichas + 250 } });
      } catch {
        // La sala pide el perfil dos veces seguidas en desarrollo: si el test acaba con una petición en vuelo, ya no hay a quién contestar.
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
