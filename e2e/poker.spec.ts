import { expect, type Page, test } from "@playwright/test";
import type { RespuestaSesion } from "../src/shared/api";
import type { AsientoVista, VistaPoker } from "../src/shared/juegos/poker";
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

const SIN_OPCIONES = { retirarse: false, pasar: false, igualar: null, subir: null, ensenar: false };

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
