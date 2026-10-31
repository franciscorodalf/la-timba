import { expect, type Page, test } from "@playwright/test";
import type { RespuestaSesion } from "../src/shared/api";
import type { AsientoVista, OpcionesPoker, VistaPoker } from "../src/shared/juegos/poker";
import { carta, entrarSimulada as baseEntrarSimulada, fichasDeApi, mensajeEstado, sinDesplazamientoHorizontal } from "./ayudas";

// La mesa simulada: el socket de la mesa no llega al servidor y la prueba decide qué vista manda.
const estado = mensajeEstado<VistaPoker>;

const entrarSimulada = (pagina: Page, request: Parameters<typeof baseEntrarSimulada>[1]) => baseEntrarSimulada<VistaPoker>(pagina, request, "mesa-poker");

const NOMBRES = ["Ana", "Luis", "Marta", "Pablo", "Sol", "Leo", "Nuria", "Hugo"];

/** El asiento `n` de una mesa de prueba: el jugador `n + 1` (los ids de las pruebas empiezan en 9001, lejos del tuyo). */
function asientoDe(n: number, resto: Partial<AsientoVista> = {}): AsientoVista {
  return { asiento: n, jugadorId: 9001 + n, apodo: NOMBRES[n], fichas: 1000, apostado: 0, estado: "juega", conectado: true, boton: false, tieneCartas: true, cartas: null, ...resto };
}

/** Tu asiento, el `n`, con tu apodo y tu id. */
const miAsiento = (sesion: RespuestaSesion, n: number, resto: Partial<AsientoVista> = {}): AsientoVista => ({
  ...asientoDe(n, resto),
  jugadorId: sesion.jugador.id,
  apodo: sesion.jugador.apodo,
});

/** `n` rivales en los asientos 0, 1, 2… (o desde `desde`). */
const rivales = (n: number, desde = 0): AsientoVista[] => Array.from({ length: n }, (_, i) => asientoDe(desde + i));

/** Una mesa de prueba vista por quien mira (`yo` no está en `asientos`), con lo que se cambie. */
function vista(sesion: RespuestaSesion, resto: Partial<VistaPoker> = {}): VistaPoker {
  const asientos = resto.asientos ?? [];
  return {
    ronda: 1,
    fase: "mano",
    calle: "flop",
    finFase: Date.now() + 20_000,
    mesa: [carta("10H"), carta("JD"), carta("2C")],
    botes: [{ cantidad: 120, jugadores: asientos.map((a) => a.jugadorId) }],
    turno: null,
    asientos,
    asientosLibres: 8 - asientos.length,
    yo: sesion.jugador.id,
    misCartas: null,
    opciones: null,
    porEntrar: 0,
    ...resto,
  };
}

const SIN_OPCIONES: OpcionesPoker = { retirarse: false, pasar: false, igualar: null, subir: null, ensenar: false };

const contador = (pagina: Page) => pagina.getByText(/^Tienes [\d.]+ fichas$/);
const sentarme = (pagina: Page) => pagina.getByRole("button", { name: /^Sentarme/ });
const asientosDeLaMesa = (pagina: Page) => pagina.getByRole("list", { name: "Asientos" }).getByRole("listitem");

test.describe("mesa simulada", () => {
  test("quien mira ve la mesa y Sentarme, y manda sentarse con lo elegido", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion, { asientos: rivales(2), turno: 9001 })));
    await page.goto(`/p/${codigo}/poker`);

    await expect(page.getByRole("heading", { name: "Póker" })).toBeVisible();
    await expect(contador(page)).toHaveText("Tienes 1.000 fichas");
    await expect(page.getByText("Estás mirando. Siéntate para jugar")).toBeVisible();
    // La mesa completa se ve: los dos sentados, las cartas de la mesa y el bote.
    await expect(asientosDeLaMesa(page)).toHaveCount(2);
    await expect(page.getByRole("group", { name: "Cartas de la mesa" }).getByRole("img")).toHaveCount(3);
    await expect(page.getByText("Bote 120")).toBeVisible();

    // Sin elegir nada, «Sentarme» está apagado; con las fichas, dice con cuántas.
    await expect(sentarme(page)).toBeDisabled();
    await page.getByRole("button", { name: "Añadir 100", exact: true }).click();
    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    await page.getByRole("button", { name: "Sentarme con 150" }).click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "sentarse", fichas: 150 });

    // La mesa te sienta: Sentarme desaparece y tu asiento aparece abajo.
    mesa.enviar(estado(vista(sesion, { asientos: [...rivales(2), miAsiento(sesion, 2, { fichas: 150 })] })));
    await expect(sentarme(page)).toHaveCount(0);
    await expect(asientosDeLaMesa(page)).toHaveCount(3);
    await expect(page.locator(".pk-asiento--yo")).toContainText("Tú");
  });

  test("no deja sentarse con más fichas de las que tienes", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 60);
    mesa.alConectar(estado(vista(sesion, { asientos: rivales(1) })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(contador(page)).toHaveText("Tienes 60 fichas");

    await page.getByRole("button", { name: "Añadir 50", exact: true }).click();
    // Con 50 preparadas caben 10 más, pero no 25 ni más: la mesa rechazaría la compra sin preguntar.
    await expect(page.getByRole("button", { name: "Añadir 10", exact: true })).toBeEnabled();
    for (const valor of [25, 50, 100, 500]) await expect(page.getByRole("button", { name: `Añadir ${valor}`, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Todo", exact: true }).click();
    await page.getByRole("button", { name: "Sentarme con 60" }).click();
    await expect.poll(() => mesa.recibidas).toContainEqual({ t: "sentarse", fichas: 60 });
    expect(mesa.recibidas.filter((m) => (m as { t: string }).t === "sentarse")).toHaveLength(1);
  });

  test("con menos fichas que la compra mínima no se puede sentar nadie", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 5);
    mesa.alConectar(estado(vista(sesion, { asientos: rivales(1) })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(contador(page)).toHaveText("Tienes 5 fichas");
    for (const valor of [10, 25, 50, 100, 500]) await expect(page.getByRole("button", { name: `Añadir ${valor}`, exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Todo", exact: true })).toBeDisabled();
    await expect(sentarme(page)).toBeDisabled();
  });

  test("con los ocho asientos ocupados, quien mira lo lee y no se le ofrece sentarse", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion, { asientos: rivales(8) })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(asientosDeLaMesa(page)).toHaveCount(8);
    await expect(page.getByText("La mesa está completa. Estás mirando")).toBeVisible();
    await expect(page.getByText("Podrás sentarte en cuanto se libere un asiento.")).toBeVisible();
    await expect(sentarme(page)).toHaveCount(0);
  });

  for (const tamano of [
    { ancho: 360, alto: 640 },
    { ancho: 1280, alto: 720 },
  ]) {
    test(`ocho jugadores caben en ${tamano.ancho}×${tamano.alto} sin desplazamiento horizontal y con botones de 44 px o más`, async ({ page, request }) => {
      await page.setViewportSize({ width: tamano.ancho, height: tamano.alto });
      const { sesion, codigo, mesa } = await entrarSimulada(page, request);
      // Ocho sentados (tú el cuarto), con apuestas, el botón y alguien que habla: todo lo que puede llenar el tapete.
      const sentados = Array.from({ length: 8 }, (_, n) =>
        n === 3
          ? miAsiento(sesion, n, { fichas: 12_345, apostado: 100, boton: true })
          : asientoDe(n, { fichas: 1000 + n * 1111, apostado: n % 2 === 0 ? 50 * (n + 1) : 0, estado: n === 5 ? "retirado" : "juega", tieneCartas: n !== 5 }),
      );
      mesa.alConectar(estado(vista(sesion, { asientos: sentados, turno: 9001, mesa: [carta("10H"), carta("JD"), carta("2C"), carta("KS"), carta("3D")], calle: "river" })));
      await page.goto(`/p/${codigo}/poker`);
      await expect(asientosDeLaMesa(page)).toHaveCount(8);

      const medidas = await page.evaluate(() => {
        const caja = (el: Element) => {
          const r = el.getBoundingClientRect();
          return { izq: r.left, der: r.right, arr: r.top, aba: r.bottom };
        };
        const tapete = caja(document.querySelector(".pk-tapete")!);
        return {
          tapete,
          asientos: [...document.querySelectorAll(".pk-asiento")].map((el) => ({ nombre: el.querySelector(".pk-placa")!.textContent, ...caja(el) })),
          apuestas: [...document.querySelectorAll(".pk-apuesta")].map((el) => ({ nombre: el.textContent, ...caja(el) })),
          centro: caja(document.querySelector(".pk-centro")!),
        };
      });
      type Caja = { izq: number; der: number; arr: number; aba: number };
      const se = (a: Caja, b: Caja) => a.izq < b.der - 0.5 && b.izq < a.der - 0.5 && a.arr < b.aba - 0.5 && b.arr < a.aba - 0.5;
      const dentro = (c: Caja, t: Caja) => c.izq >= t.izq - 0.5 && c.der <= t.der + 0.5 && c.arr >= t.arr - 0.5 && c.aba <= t.aba + 0.5;
      for (const [i, a] of medidas.asientos.entries()) {
        expect(dentro(a, medidas.tapete), `el asiento de ${a.nombre} se sale del tapete`).toBe(true);
        for (const b of medidas.asientos.slice(i + 1)) expect(se(a, b), `${a.nombre} y ${b.nombre} se pisan`).toBe(false);
        expect(se(a, medidas.centro), `${a.nombre} pisa las cartas de la mesa`).toBe(false);
        for (const ap of medidas.apuestas) expect(se(a, ap), `${a.nombre} pisa ${ap.nombre}`).toBe(false);
      }
      for (const ap of medidas.apuestas) expect(se(ap, medidas.centro), `${ap.nombre} pisa las cartas de la mesa`).toBe(false);
      expect(await sinDesplazamientoHorizontal(page)).toBe(true);

      // Los botones de la barra (volver, sonido) llegan a 44 px.
      const pequenos = await page.evaluate(() =>
        [...document.querySelectorAll("button, a.boton")]
          .map((el) => ({ nombre: el.getAttribute("aria-label") ?? el.textContent, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.width < 43.5 || r.height < 43.5))
          .map(({ nombre, r }) => `${nombre} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`),
      );
      expect(pequenos).toEqual([]);
    });

    test(`quien mira con siete sentados ve las fichas y «Sentarme» en ${tamano.ancho}×${tamano.alto} sin desplazamiento horizontal y con botones de 44 px o más`, async ({ page, request }) => {
      await page.setViewportSize({ width: tamano.ancho, height: tamano.alto });
      const { sesion, codigo, mesa } = await entrarSimulada(page, request);
      mesa.alConectar(estado(vista(sesion, { asientos: rivales(7), turno: 9003 })));
      await page.goto(`/p/${codigo}/poker`);
      await expect(asientosDeLaMesa(page)).toHaveCount(7);
      await expect(page.getByRole("button", { name: "Añadir 500", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Añadir 500", exact: true }).click();
      await expect(page.getByRole("button", { name: "Sentarme con 500" })).toBeVisible();

      expect(await sinDesplazamientoHorizontal(page)).toBe(true);
      const pequenos = await page.evaluate(() =>
        [...document.querySelectorAll("button, a.boton")]
          .map((el) => ({ nombre: el.getAttribute("aria-label") ?? el.textContent, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && (r.width < 43.5 || r.height < 43.5))
          .map(({ nombre, r }) => `${nombre} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`),
      );
      expect(pequenos).toEqual([]);
    });
  }

  test("la cantidad de cada jugador no está en su placa", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const sentados = [asientoDe(0, { fichas: 1250, apostado: 40 }), asientoDe(1, { fichas: 80 }), miAsiento(sesion, 2, { fichas: 3000 }), asientoDe(3, { fichas: 0, estado: "allin" })];
    mesa.alConectar(estado(vista(sesion, { asientos: sentados, turno: 9002 })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(asientosDeLaMesa(page)).toHaveCount(4);

    const placas = await page.locator(".pk-placa").allTextContents();
    // Solo el nombre (o «Tú»): ni un número en la placa.
    expect(placas.map((t) => t.replace(/\s*\(.*\)$/, "").trim()).sort()).toEqual(["Ana", "Luis", "Pablo", "Tú"]);
    for (const texto of placas) expect(texto).not.toMatch(/\d/);

    // La cantidad va en la pila, debajo, y lo apostado aparte, hacia el centro.
    const asiento = (nombre: string) => asientosDeLaMesa(page).filter({ has: page.locator(".pk-placa", { hasText: nombre }) });
    await expect(asiento("Ana").locator(".pk-pila")).toContainText("1.250");
    await expect(asiento("Luis").locator(".pk-pila")).toContainText("80");
    await expect(page.locator(".pk-asiento--yo .pk-pila")).toContainText("3.000");
    await expect(asiento("Pablo").locator(".pk-pila")).toContainText("All-in");
    await expect(asiento("Ana").locator(".pk-apuesta")).toHaveCount(0);
    await expect(page.locator(".pk-apuestas .pk-apuesta")).toHaveCount(1);
    await expect(page.locator(".pk-apuestas .pk-apuesta")).toContainText("40");

    // Quien habla lleva la placa en dorado.
    await expect(page.locator(".pk-asiento--turno")).toHaveCount(1);
    await expect(page.locator(".pk-asiento--turno")).toContainText("Luis");
  });

  test("las cartas pequeñas solo las tiene quien sigue en la mano, y el botón es una D", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const sentados = [asientoDe(0, { boton: true }), asientoDe(1, { estado: "retirado", tieneCartas: false }), asientoDe(2, { cartas: [carta("AS"), carta("KS")] }), miAsiento(sesion, 3)];
    mesa.alConectar(estado(vista(sesion, { asientos: sentados, misCartas: [carta("2C"), carta("7D")], turno: sesion.jugador.id, opciones: { ...SIN_OPCIONES, retirarse: true, pasar: true } })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(asientosDeLaMesa(page)).toHaveCount(4);

    const asiento = (nombre: string) => asientosDeLaMesa(page).filter({ has: page.locator(".pk-placa", { hasText: nombre }) });
    await expect(asiento("Ana").getByRole("img", { name: "Carta boca abajo" })).toHaveCount(2);
    await expect(asiento("Luis").getByRole("img", { name: /^Carta/ })).toHaveCount(0);
    await expect(asiento("Marta").getByRole("img", { name: "As de picas" })).toHaveCount(1);
    await expect(asiento("Marta").getByRole("img", { name: "Rey de picas" })).toHaveCount(1);
    // Tus cartas grandes no van en tu asiento del tapete.
    await expect(page.locator(".pk-asiento--yo").getByRole("img", { name: /^Carta|de/ })).toHaveCount(0);
    await expect(asiento("Ana").getByRole("img", { name: "Botón del repartidor" })).toHaveText("D");
    await expect(page.getByRole("img", { name: "Botón del repartidor" })).toHaveCount(1);
    await expect(page.getByText("Tu turno")).toBeVisible();
  });

  test("quien se sienta a mitad de mano la mira sin cartas ni botones", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const sentados = [asientoDe(0, { boton: true }), asientoDe(1), miAsiento(sesion, 2, { estado: "fuera", tieneCartas: false, fichas: 200 })];
    mesa.alConectar(estado(vista(sesion, { asientos: sentados, turno: 9001, misCartas: null, opciones: SIN_OPCIONES })));
    await page.goto(`/p/${codigo}/poker`);

    await expect(page.getByText("Juegas en la mano siguiente")).toBeVisible();
    await expect(asientosDeLaMesa(page)).toHaveCount(3);
    // Los rivales en la mano tienen sus cartas pequeñas; tú no tienes ninguna, ni pequeña ni grande.
    await expect(page.locator(".pk-asiento--yo").getByRole("img")).toHaveCount(0);
    await expect(page.getByRole("img", { name: "Carta boca abajo" })).toHaveCount(4);
    await expect(page.getByRole("group", { name: "Tus cartas" })).toHaveCount(0);
    // Sin botones de jugar ni de sentarse.
    await expect(page.getByRole("button", { name: /^(Retirarse|Pasar|Igualar|Apostar|Subir|All-in|Sentarme|Enseñar)/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Añadir 10", exact: true })).toHaveCount(0);
  });

  test("«← Sala» manda salir y vuelve a la sala; en plena mano pregunta antes", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const salidas = () => mesa.recibidas.filter((m) => (m as { t: string }).t === "salir");

    // Mirando no se pierde nada: sale a la sala sin preguntar.
    mesa.alConectar(estado(vista(sesion, { asientos: rivales(2) })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(asientosDeLaMesa(page)).toHaveCount(2);
    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    expect(salidas()).toHaveLength(1);

    // Sentado y con una mano en juego, pregunta: seguir jugando no manda nada.
    mesa.alConectar(estado(vista(sesion, { asientos: [...rivales(2), miAsiento(sesion, 2)], misCartas: [carta("2C"), carta("7D")] })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(asientosDeLaMesa(page)).toHaveCount(3);
    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await expect(page.getByText("Si sales ahora pierdes lo que llevas puesto en esta mano")).toBeVisible();
    await page.getByRole("button", { name: "Seguir jugando" }).click();
    expect(salidas()).toHaveLength(1);
    await page.getByRole("button", { name: "Volver a la sala" }).click();
    await page.getByRole("button", { name: "Salir", exact: true }).click();
    await expect(page).toHaveURL(`/p/${codigo}`);
    await expect.poll(salidas).toHaveLength(2);
  });

  test("entre manos se lee «Esperando rivales» y, en el resultado, la cuenta atrás de la mano siguiente", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion, { fase: "esperando", calle: null, finFase: null, mesa: [], botes: [], asientos: [miAsiento(sesion, 0, { tieneCartas: false, estado: "fuera" })] })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(page.getByText("Esperando rivales")).toBeVisible();
    // Sin cartas en la mesa: los cinco huecos vacíos y el bote sin enseñar.
    await expect(page.getByRole("group", { name: "Cartas de la mesa" }).getByRole("img")).toHaveCount(0);
    await expect(page.locator(".pk-hueco")).toHaveCount(5);

    mesa.enviar(
      estado(
        vista(sesion, {
          fase: "resultado",
          calle: "river",
          finFase: Date.now() + 6_000,
          mesa: [carta("10H"), carta("JD"), carta("2C"), carta("KS"), carta("3D")],
          asientos: [miAsiento(sesion, 0), asientoDe(1)],
        }),
      ),
    );
    await expect(page.getByText("Nueva mano en")).toBeVisible();
    await expect(page.getByText(/^0:0[4-6]$/)).toBeVisible();
    await expect(page.getByRole("group", { name: "Cartas de la mesa" }).getByRole("img")).toHaveCount(5);
    await expect(page.locator(".pk-hueco")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Decidir, subir, tapar, enseñar, añadir y levantarse
// ---------------------------------------------------------------------------------------------------------------------

const MESA_FLOP = [carta("10H"), carta("JD"), carta("2C")];

/** Una mano en la que eres el asiento 2 y hablas tú, con las opciones que se pidan (las reglas dejan retirarse siempre). */
function tuTurno(sesion: RespuestaSesion, opciones: Partial<OpcionesPoker>, resto: Partial<VistaPoker> = {}, yo: Partial<AsientoVista> = {}): VistaPoker {
  return vista(sesion, {
    asientos: [...rivales(2), miAsiento(sesion, 2, { fichas: 980, apostado: 20, ...yo })],
    misCartas: [carta("KS"), carta("KD")],
    turno: sesion.jugador.id,
    opciones: { ...SIN_OPCIONES, retirarse: true, ...opciones },
    ...resto,
  });
}

const acciones = (mesa: { recibidas: unknown[] }) => mesa.recibidas.map((m) => m as { t: string });
const boton = (pagina: Page, nombre: string | RegExp, exacto = true) => pagina.getByRole("button", { name: nombre, exact: exacto });
const panelSubir = (pagina: Page) => pagina.getByRole("group", { name: "Subir la apuesta" });

test.describe("decidir y subir", () => {
  test("Pasar cuando no hay nada que igualar e Igualar N cuando lo hay, y Apostar o Subir según toque", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true, subir: { min: 20, max: 1000 } })));
    await page.goto(`/p/${codigo}/poker`);

    // Sin nada que igualar: Retirarse · Pasar · Apostar (y ni Igualar ni Subir).
    await expect(boton(page, "Retirarse")).toBeVisible();
    await expect(boton(page, "Pasar")).toBeVisible();
    await expect(boton(page, "Apostar")).toBeVisible();
    await expect(boton(page, /^Igualar/, false)).toHaveCount(0);
    await expect(boton(page, "Subir")).toHaveCount(0);
    await boton(page, "Pasar").click();
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "pasar" });

    // Con algo que igualar: Retirarse · Igualar 30 · Subir (y ni Pasar ni Apostar).
    mesa.enviar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 60, max: 1000 } }, { calle: "turn", ronda: 2 })));
    await expect(boton(page, "Igualar 30")).toBeVisible();
    await expect(boton(page, "Subir")).toBeVisible();
    await expect(boton(page, "Pasar")).toHaveCount(0);
    await expect(boton(page, "Apostar")).toHaveCount(0);
    await boton(page, "Igualar 30").click();
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "igualar" });

    // Retirarse manda retirarse.
    mesa.enviar(estado(tuTurno(sesion, { igualar: 40, subir: { min: 80, max: 1000 } }, { calle: "river", ronda: 3 })));
    await expect(boton(page, "Igualar 40")).toBeVisible();
    await boton(page, "Retirarse").click();
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "retirarse" });
  });

  test("fuera de tu turno no hay botones de jugar, aunque lleguen opciones", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    // Habla otro: aunque la vista trajera opciones, los botones dependen de que el turno sea tuyo.
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true, subir: { min: 20, max: 1000 } }, { turno: 9001 })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(page.getByText("Habla Ana")).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Retirarse|Pasar|Igualar|Apostar|Subir|All-in)/ })).toHaveCount(0);
    // Tus cartas, en cambio, siguen a la vista.
    await expect(page.getByRole("group", { name: "Tus cartas" }).getByRole("img")).toHaveCount(2);
  });

  test("subir con el deslizador manda { t: \"subir\", hasta }", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 60, max: 1000 } })));
    await page.goto(`/p/${codigo}/poker`);

    await boton(page, "Subir").click();
    await expect(panelSubir(page)).toBeVisible();
    // Empieza en la subida mínima, con el mismo número en el campo y en el deslizador.
    const campo = page.getByRole("textbox", { name: "Cantidad a subir" });
    const deslizador = page.getByRole("slider", { name: "Deslizador de la subida" });
    await expect(campo).toHaveValue("60");
    await expect(deslizador).toHaveAttribute("min", "60");
    await expect(deslizador).toHaveAttribute("max", "1000");
    await expect(boton(page, "Subir a 60")).toBeVisible();

    await deslizador.fill("340");
    await expect(campo).toHaveValue("340");
    await boton(page, "Subir a 340").click();
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "subir", hasta: 340 });
    expect(acciones(mesa).filter((m) => m.t === "subir")).toHaveLength(1);
  });

  test("− y + afinan de diez en diez sin salirse de los límites", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true, subir: { min: 20, max: 45 } })));
    await page.goto(`/p/${codigo}/poker`);
    await boton(page, "Apostar").click();
    const campo = page.getByRole("textbox", { name: "Cantidad a subir" });
    await expect(campo).toHaveValue("20");
    // Por debajo del mínimo no baja.
    await expect(boton(page, "Quitar 10")).toBeDisabled();
    await boton(page, "Poner 10 más").click();
    await expect(campo).toHaveValue("30");
    await boton(page, "Poner 10 más").click();
    await expect(campo).toHaveValue("40");
    // Quedan 5 hasta el máximo: el último paso llega justo al tope y ya no se puede seguir.
    await boton(page, "Poner 10 más").click();
    await expect(campo).toHaveValue("45");
    await expect(boton(page, "Poner 10 más")).toBeDisabled();
    await boton(page, "Quitar 10").click();
    await expect(campo).toHaveValue("35");
    await expect(page.getByRole("slider", { name: "Deslizador de la subida" })).toHaveValue("35");
  });

  test("subir escribiendo la cantidad; con letras o fuera de límites no se puede mandar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 60, max: 1000 } })));
    await page.goto(`/p/${codigo}/poker`);
    await boton(page, "Subir").click();
    const campo = page.getByRole("textbox", { name: "Cantidad a subir" });
    await expect(campo).toHaveAttribute("inputmode", "numeric");
    const confirmar = page.getByRole("button", { name: /^Subir a/ });

    for (const mal of ["abc", "1e3", "", "59", "1001", "99999", "12,5", "-70"]) {
      await campo.fill(mal);
      await expect(confirmar, `«${mal}» no debería poder mandarse`).toBeDisabled();
      await expect(campo).toHaveAttribute("aria-invalid", "true");
    }
    // Un clic en el botón apagado no manda nada.
    await confirmar.click({ force: true });
    expect(acciones(mesa).filter((m) => m.t === "subir")).toHaveLength(0);

    await campo.fill("250");
    await expect(campo).toHaveAttribute("aria-invalid", "false");
    await expect(confirmar).toBeEnabled();
    await expect(confirmar).toHaveText("Subir a 250");
    // El deslizador sigue al campo.
    await expect(page.getByRole("slider", { name: "Deslizador de la subida" })).toHaveValue("250");
    await confirmar.click();
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "subir", hasta: 250 });
  });

  test("All-in manda hasta con todas tus fichas", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    // 980 en la pila y 20 ya puestos: el tope de la ronda es 1.000.
    mesa.alConectar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 60, max: 1000 } })));
    await page.goto(`/p/${codigo}/poker`);
    await boton(page, "Subir").click();
    await boton(page, "All-in 1.000").click();
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "subir", hasta: 1000 });
  });

  test("con menos de la subida mínima solo se ofrece All-in", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 50, max: 50 } }, {}, { fichas: 30, apostado: 20 })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(boton(page, "Igualar 30")).toBeVisible();
    await expect(boton(page, "Subir")).toHaveCount(0);
    await expect(boton(page, "Apostar")).toHaveCount(0);
    await boton(page, "All-in 50").click();
    await expect(panelSubir(page)).toHaveCount(0);
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "subir", hasta: 50 });
  });

  test("si el turno pasa con el panel abierto, se cierra; y también si cambia el rango de subir", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 60, max: 1000 } })));
    await page.goto(`/p/${codigo}/poker`);

    // El turno pasa a otro (por ejemplo, se acabó el tiempo).
    await boton(page, "Subir").click();
    await expect(panelSubir(page)).toBeVisible();
    mesa.enviar(estado(tuTurno(sesion, SIN_OPCIONES, { turno: 9001 })));
    await expect(panelSubir(page)).toHaveCount(0);
    await expect(boton(page, /^Subir/, false)).toHaveCount(0);

    // Vuelve a ser tu turno con el mismo rango: el panel no reaparece solo.
    mesa.enviar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 60, max: 1000 } })));
    await expect(boton(page, "Subir")).toBeVisible();
    await expect(panelSubir(page)).toHaveCount(0);

    // Con el panel abierto, otro sube y cambia el rango: el panel se cierra, no manda una cantidad vieja.
    await boton(page, "Subir").click();
    await expect(panelSubir(page)).toBeVisible();
    mesa.enviar(estado(tuTurno(sesion, { igualar: 80, subir: { min: 160, max: 1000 } })));
    await expect(panelSubir(page)).toHaveCount(0);
    await expect(boton(page, "Igualar 80")).toBeVisible();
  });

  test("Cancelar cierra el panel sin mandar nada", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true, subir: { min: 20, max: 1000 } })));
    await page.goto(`/p/${codigo}/poker`);
    await boton(page, "Apostar").click();
    await expect(panelSubir(page)).toBeVisible();
    await boton(page, "Cancelar").click();
    await expect(panelSubir(page)).toHaveCount(0);
    await expect(boton(page, "Apostar")).toBeVisible();
    expect(mesa.recibidas.filter((m) => (m as { t: string }).t !== "salir")).toEqual([]);
  });

  test("dos toques en Igualar mandan una sola acción", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 60, max: 1000 } })));
    await page.goto(`/p/${codigo}/poker`);
    const igualar = boton(page, "Igualar 30");
    await igualar.dblclick();
    await igualar.click({ force: true });
    await expect.poll(() => acciones(mesa).filter((m) => m.t === "igualar").length).toBe(1);
    await page.waitForTimeout(300);
    expect(acciones(mesa).filter((m) => m.t === "igualar")).toHaveLength(1);

    // Cuando la mesa contesta (el turno pasa a otro y vuelve al tuyo en otra calle), los botones vuelven a funcionar.
    mesa.enviar(estado(tuTurno(sesion, SIN_OPCIONES, { turno: 9001, calle: "turn" }, { apostado: 50, fichas: 950 })));
    await expect(boton(page, "Igualar 30")).toHaveCount(0);
    mesa.enviar(estado(tuTurno(sesion, { igualar: 30, subir: { min: 60, max: 1000 } }, { calle: "river", ronda: 2 })));
    await expect(boton(page, "Igualar 30")).toBeEnabled();
  });
});

for (const tamano of [
  { ancho: 360, alto: 640 },
  { ancho: 412, alto: 915 },
  { ancho: 1280, alto: 720 },
]) {
  test(`en ${tamano.ancho}×${tamano.alto} tus cartas y los botones de decidir se ven sin desplazar, y el panel de subir cabe entero`, async ({ page, request }) => {
    await page.setViewportSize({ width: tamano.ancho, height: tamano.alto });
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const sentados = Array.from({ length: 8 }, (_, n) => (n === 3 ? miAsiento(sesion, n, { fichas: 980, apostado: 20, boton: true }) : asientoDe(n, { apostado: n % 2 === 0 ? 40 : 0 })));
    mesa.alConectar(estado(vista(sesion, { asientos: sentados, turno: sesion.jugador.id, misCartas: [carta("KS"), carta("KD")], opciones: { ...SIN_OPCIONES, retirarse: true, igualar: 20, subir: { min: 60, max: 1000 } } })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(boton(page, "Subir")).toBeVisible();

    const dentroDeLaPantalla = (localizador: ReturnType<Page["locator"]>) =>
      localizador.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
      });
    await page.waitForTimeout(300);
    expect(await dentroDeLaPantalla(page.getByRole("group", { name: "Tus cartas" })), "tus cartas").toBe(true);
    for (const nombre of ["Retirarse", "Igualar 20", "Subir"]) expect(await dentroDeLaPantalla(boton(page, nombre)), nombre).toBe(true);
    expect(await sinDesplazamientoHorizontal(page)).toBe(true);

    // Con el panel abierto, todo él a la vista, sus botones de 44 px o más, y quitarlo devuelve la fila de decidir.
    await boton(page, "Subir").click();
    await expect(panelSubir(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(await dentroDeLaPantalla(panelSubir(page)), "el panel de subir").toBe(true);
    const pequenos = await page.evaluate(() =>
      [...document.querySelectorAll(".pk-subir button, .pk-subir input")]
        .map((el) => ({ nombre: el.getAttribute("aria-label") ?? el.textContent, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.height < 43.5 || (r.width < 43.5))
        .map(({ nombre, r }) => `${nombre} ${r.width.toFixed(1)}×${r.height.toFixed(1)}`),
    );
    expect(pequenos).toEqual([]);
    expect(await sinDesplazamientoHorizontal(page)).toBe(true);
  });
}

test("en 360×640, con el panel de subir abierto, la cuenta atrás de tu turno se ve y no está tapada", async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const { sesion, codigo, mesa } = await entrarSimulada(page, request);
  const sentados = Array.from({ length: 8 }, (_, n) => (n === 3 ? miAsiento(sesion, n, { fichas: 980, apostado: 20, boton: true }) : asientoDe(n)));
  mesa.alConectar(estado(vista(sesion, { asientos: sentados, turno: sesion.jugador.id, finFase: Date.now() + 14_000, misCartas: [carta("KS"), carta("KD")], opciones: { ...SIN_OPCIONES, retirarse: true, igualar: 20, subir: { min: 60, max: 1000 } } })));
  await page.goto(`/p/${codigo}/poker`);
  await boton(page, "Subir").click();
  await expect(panelSubir(page)).toBeVisible();
  await page.waitForTimeout(300);

  const cuenta = panelSubir(page).locator(".pk-cuenta b");
  await expect(cuenta).toHaveText(/^0:1[2-4]$/);
  const visible = await cuenta.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const arriba = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { dentro: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth, libre: arriba !== null && el.contains(arriba) };
  });
  expect(visible).toEqual({ dentro: true, libre: true });
  // Y sigue siendo la misma cuenta que baja: pasados dos segundos, marca menos.
  const antes = (await cuenta.textContent())!;
  await expect.poll(async () => (await cuenta.textContent())!, { timeout: 5_000 }).not.toBe(antes);

  // La hoja de añadir fichas, en tu turno, también la lleva.
  await boton(page, "Cancelar").click();
  await boton(page, "Añadir fichas").scrollIntoViewIfNeeded();
  await boton(page, "Añadir fichas").click();
  await expect(page.locator(".pk-anadir .pk-cuenta b")).toHaveText(/^0:\d\d$/);
});

test.describe("tus cartas", () => {
  test("Tapar oculta las cartas y el texto de tu jugada, y se recuerda al recargar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true }, { mesa: MESA_FLOP, misCartas: [carta("KS"), carta("KD")] })));
    await page.goto(`/p/${codigo}/poker`);

    const cartas = page.getByRole("group", { name: "Tus cartas" });
    await expect(cartas.getByRole("img", { name: "Rey de picas" })).toBeVisible();
    await expect(cartas.getByRole("img", { name: "Rey de diamantes" })).toBeVisible();
    await expect(page.getByText("Pareja de reyes")).toBeVisible();
    await expect(page.getByText("Tu pila")).toBeVisible();

    await boton(page, "Tapar").click();
    await expect(boton(page, "Destapar")).toBeVisible();
    await expect(cartas.getByRole("img", { name: "Carta boca abajo" })).toHaveCount(2);
    await expect(cartas.getByRole("img", { name: "Rey de picas" })).toHaveCount(0);
    await expect(page.getByText("Pareja de reyes")).toHaveCount(0);
    // Lo ven solo en tu pantalla: no se manda nada a la mesa.
    expect(acciones(mesa).filter((m) => m.t !== "salir")).toEqual([]);

    // Recordado al recargar (en el navegador, como el silencio).
    await page.reload();
    await expect(boton(page, "Destapar")).toBeVisible();
    await expect(page.getByRole("group", { name: "Tus cartas" }).getByRole("img", { name: "Carta boca abajo" })).toHaveCount(2);
    await expect(page.getByText("Pareja de reyes")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("timba.poker.tapar"))).toBe("1");

    await boton(page, "Destapar").click();
    await expect(page.getByText("Pareja de reyes")).toBeVisible();
    await expect(page.getByRole("group", { name: "Tus cartas" }).getByRole("img", { name: "Rey de picas" })).toBeVisible();
  });

  test("la jugada se calcula con las cartas de la mesa, y antes del flop es la que tienes en la mano", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true }, { mesa: [], calle: "preflop", misCartas: [carta("AS"), carta("7D")] })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(page.getByText("Carta alta: as")).toBeVisible();
    mesa.enviar(estado(tuTurno(sesion, { pasar: true }, { mesa: [carta("7H"), carta("7C"), carta("2S")], calle: "flop", misCartas: [carta("AS"), carta("7D")] })));
    await expect(page.getByText("Trío de sietes")).toBeVisible();
  });

  test("sin cartas (esperando rivales) no hay jugada, ni Tapar, pero sí tu pila", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion, { fase: "esperando", calle: null, finFase: null, mesa: [], botes: [], asientos: [miAsiento(sesion, 0, { tieneCartas: false, estado: "fuera", fichas: 700 })] })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(page.getByText("Esperando rivales")).toBeVisible();
    await expect(page.getByText("Tu pila")).toBeVisible();
    await expect(page.getByText("700", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("group", { name: "Tus cartas" })).toHaveCount(0);
    await expect(boton(page, /^(Tapar|Destapar)/, false)).toHaveCount(0);
  });

  test("Enseñar mis cartas aparece en resultado y manda ensenar", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const resultado = (ensenar: boolean) =>
      tuTurno(sesion, { retirarse: false, ensenar }, { fase: "resultado", turno: null, mesa: [...MESA_FLOP, carta("KS"), carta("3D")].slice(0, 5), calle: "river", finFase: Date.now() + 6_000 }, { estado: "juega", apostado: 0 });

    // En plena mano no se ofrece.
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(boton(page, "Pasar")).toBeVisible();
    await expect(boton(page, /^Enseñar/, false)).toHaveCount(0);

    mesa.enviar(estado(resultado(true)));
    await expect(page.getByText("Nueva mano en")).toBeVisible();
    await expect(boton(page, "Pasar")).toHaveCount(0);
    await boton(page, "Enseñar mis cartas").click();
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "ensenar" });

    // Ya enseñadas, el servidor deja de ofrecerlo.
    mesa.enviar(estado(resultado(false)));
    await expect(boton(page, /^Enseñar/, false)).toHaveCount(0);
    expect(acciones(mesa).filter((m) => m.t === "ensenar")).toHaveLength(1);
  });
});

test.describe("levantarse y añadir fichas", () => {
  test("levantarse en una mano pide confirmación; fuera de ella, no", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    const levantadas = () => acciones(mesa).filter((m) => m.t === "levantarse");

    // En plena mano: pregunta, y seguir jugando no manda nada.
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true })));
    await page.goto(`/p/${codigo}/poker`);
    await boton(page, "Levantarme").click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo.getByText("Si te levantas ahora pierdes lo que llevas puesto en esta mano")).toBeVisible();
    await dialogo.getByRole("button", { name: "Seguir jugando" }).click();
    await expect(dialogo).toHaveCount(0);
    expect(levantadas()).toHaveLength(0);
    await boton(page, "Levantarme").click();
    await dialogo.getByRole("button", { name: "Levantarme", exact: true }).click();
    await expect.poll(levantadas).toHaveLength(1);

    // Entre manos (resultado) no pregunta: manda levantarse al momento. (La mesa te levanta y te vuelves a sentar para la segunda vez.)
    mesa.enviar(estado(vista(sesion, { asientos: rivales(2) })));
    await expect(sentarme(page)).toBeVisible();
    mesa.enviar(estado(tuTurno(sesion, SIN_OPCIONES, { fase: "resultado", turno: null, finFase: Date.now() + 6_000 })));
    await expect(page.getByText("Nueva mano en")).toBeVisible();
    await boton(page, "Levantarme").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(levantadas).toHaveLength(2);
  });

  test("quien se ha retirado no pierde nada más: levantarse tampoco pregunta", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, SIN_OPCIONES, { turno: 9001 }, { estado: "retirado", tieneCartas: false })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(page.getByText("Te has retirado de esta mano")).toBeVisible();
    await boton(page, "Levantarme").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => acciones(mesa).filter((m) => m.t === "levantarse").length).toBe(1);
  });

  test("Levantarme te deja mirando, con Sentarme a la vista", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(vista(sesion, { fase: "esperando", calle: null, finFase: null, mesa: [], botes: [], asientos: [asientoDe(0), miAsiento(sesion, 1, { estado: "fuera", tieneCartas: false })] })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(sentarme(page)).toHaveCount(0);
    await boton(page, "Levantarme").click();
    await expect.poll(() => acciones(mesa).filter((m) => m.t === "levantarse").length).toBe(1);

    // La mesa te levanta: te quedas en la pantalla, mirando.
    mesa.enviar(estado(vista(sesion, { fase: "esperando", calle: null, finFase: null, mesa: [], botes: [], asientos: [asientoDe(0)] })));
    await expect(page.getByText("Estás mirando. Siéntate para jugar")).toBeVisible();
    await expect(sentarme(page)).toBeVisible();
    await expect(boton(page, "Levantarme")).toHaveCount(0);
    await expect(boton(page, "Añadir fichas")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Tus cartas" })).toHaveCount(0);
    await expect(page).toHaveURL(`/p/${codigo}/poker`);
  });

  test("añadir fichas manda anadir y en una mano enseña +N en la próxima mano", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(page.getByText(/en la próxima mano/)).toHaveCount(0);

    await boton(page, "Añadir fichas").click();
    // Con tu saldo de 1.000 fichas: de 10 hasta todas.
    await expect(boton(page, "Poner 150 en la mesa", false)).toHaveCount(0);
    await expect(boton(page, "Añadir 10")).toBeVisible();
    await boton(page, "Añadir 100").click();
    await boton(page, "Añadir 50").click();
    await boton(page, "Poner 150 en la mesa").click();
    await expect.poll(() => acciones(mesa)).toContainEqual({ t: "anadir", fichas: 150 });
    // Mandado, el panel se cierra.
    await expect(boton(page, "Añadir 10")).toHaveCount(0);

    // La mesa lo apunta para la mano siguiente.
    mesa.enviar(estado(tuTurno(sesion, { pasar: true }, { porEntrar: 150 })));
    await expect(page.getByText("+150 en la próxima mano")).toBeVisible();
  });

  test("añadir fichas no deja pasar de tu saldo ni bajar de la compra mínima", async ({ page, request }) => {
    const { sesion, codigo, mesa } = await entrarSimulada(page, request);
    await fichasDeApi(page, 60);
    mesa.alConectar(estado(tuTurno(sesion, { pasar: true })));
    await page.goto(`/p/${codigo}/poker`);
    await expect(contador(page)).toHaveText("Tienes 60 fichas");
    await boton(page, "Añadir fichas").click();
    await expect(boton(page, "Poner 10 en la mesa", false)).toHaveCount(0);
    await expect(boton(page, "Añadir 100")).toBeDisabled();
    await boton(page, "Todo").click();
    await expect(boton(page, "Poner 60 en la mesa")).toBeEnabled();
    // Cancelar lo cierra sin mandar nada.
    await boton(page, "Cancelar").click();
    await expect(boton(page, "Añadir 10")).toHaveCount(0);
    expect(acciones(mesa).filter((m) => m.t === "anadir")).toHaveLength(0);
  });
});
