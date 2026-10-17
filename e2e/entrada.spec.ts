import { expect, test } from "@playwright/test";
import { apodoUnico } from "./ayudas";

test("crea un perfil nuevo con confirmación y la sesión sobrevive a recargar", async ({ page }) => {
  const apodo = apodoUnico();
  await page.goto("/");

  await page.getByLabel("Apodo").fill(apodo);
  await page.getByLabel("PIN").fill("1234");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByText(`¿Crear el perfil "${apodo}"?`)).toBeVisible();
  await page.getByRole("button", { name: "Sí" }).click();
  await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("timba.token"))).not.toBeNull();
});

test("«No» en la confirmación vuelve al formulario sin crear el perfil", async ({ page, request }) => {
  const apodo = apodoUnico();
  await page.goto("/");
  await page.getByLabel("Apodo").fill(apodo);
  await page.getByLabel("PIN").fill("1234");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText(`¿Crear el perfil "${apodo}"?`)).toBeVisible();

  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.getByLabel("Apodo")).toHaveValue(apodo);
  await expect(page.getByText("Hola, tienes")).toHaveCount(0);

  const respuesta = await request.post("/api/entrar", { data: { apodo, pin: "1234" } });
  expect(respuesta.status()).toBe(404);
});

test("un PIN incorrecto dice cuántos intentos quedan", async ({ page, request }) => {
  const apodo = apodoUnico();
  const registro = await request.post("/api/registro", { data: { apodo, pin: "1234" } });
  expect(registro.status()).toBe(201);

  await page.goto("/");
  await page.getByLabel("Apodo").fill(apodo);
  await page.getByLabel("PIN").fill("0000");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByText("PIN incorrecto, te quedan 4 intentos")).toBeVisible();
  await expect(page.getByLabel("PIN")).toHaveValue("");
  await expect(page.getByLabel("PIN")).toBeFocused();
});

test("entra con un perfil existente y puede salir", async ({ page, request }) => {
  const apodo = apodoUnico();
  await request.post("/api/registro", { data: { apodo, pin: "4321" } });

  await page.goto("/");
  await page.getByLabel("Apodo").fill(apodo.toUpperCase());
  await page.getByLabel("PIN").fill("4321");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();

  await page.getByRole("button", { name: "Salir" }).click();
  await expect(page.getByLabel("Apodo")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Apodo")).toBeVisible();
});

test("valida apodo y PIN en el cliente antes de llamar al servidor", async ({ page }) => {
  let llamadas = 0;
  await page.route("**/api/entrar", (ruta) => {
    llamadas++;
    return ruta.continue();
  });
  await page.goto("/");

  await page.getByLabel("Apodo").fill("a!");
  await page.getByLabel("PIN").fill("12a3");
  await expect(page.getByLabel("PIN")).toHaveValue("123");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByLabel("Apodo")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("PIN")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("De 3 a 16 caracteres: letras, números y _")).toBeVisible();
  await expect(page.getByText("4 dígitos")).toBeVisible();
  expect(llamadas).toBe(0);
});

test("un enlace de partida sin sesión lleva a la entrada y vuelve después", async ({ page, request }) => {
  const apodo = apodoUnico();
  await request.post("/api/registro", { data: { apodo, pin: "1234" } });

  await page.goto("/p/ABCD");
  await expect(page.getByLabel("Apodo")).toBeVisible();
  await page.getByLabel("Apodo").fill(apodo);
  await page.getByLabel("PIN").fill("1234");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByLabel("Apodo")).toHaveCount(0);
  await expect(page).toHaveURL(/\/p\/ABCD$/);
});

test("un token que el servidor rechaza se descarta y muestra la entrada", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("timba.token", "token-invalido"));
  await page.goto("/");

  await expect(page.getByLabel("Apodo")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("timba.token"))).toBeNull();
});

test.describe("avisos del servidor", () => {
  test.use({ timezoneId: "Europe/Madrid" });

  test("bloqueo por intentos: indica la hora local en que se puede volver a probar", async ({ page }) => {
    await page.route("**/api/entrar", (ruta) =>
      ruta.fulfill({ status: 429, json: { error: "bloqueado", hasta: Date.UTC(2026, 0, 15, 10, 5) } }),
    );
    await page.goto("/");
    await page.getByLabel("Apodo").fill("jugador");
    await page.getByLabel("PIN").fill("1234");
    await page.getByRole("button", { name: "Entrar" }).click();

    await expect(page.getByText("Demasiados intentos. Prueba de nuevo a las 11:05")).toBeVisible();
  });
});

test("si el servidor falla dice que La Timba está descansando", async ({ page }) => {
  await page.route("**/api/entrar", (ruta) => ruta.fulfill({ status: 503, json: { error: "descansando" } }));
  await page.goto("/");
  await page.getByLabel("Apodo").fill("jugador");
  await page.getByLabel("PIN").fill("1234");
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByText("La Timba está descansando, vuelve mañana")).toBeVisible();
});

test.describe("sesión compartida entre pestañas", () => {
  test("cerrar e iniciar sesión en una pestaña se refleja en las demás", async ({ page, context, request }) => {
    const apodo = apodoUnico();
    await request.post("/api/registro", { data: { apodo, pin: "1234" } });

    await page.goto("/");
    await page.getByLabel("Apodo").fill(apodo);
    await page.getByLabel("PIN").fill("1234");
    await page.getByRole("button", { name: "Entrar" }).click();
    await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();

    const otra = await context.newPage();
    await otra.goto("/");
    await expect(otra.getByText("Hola, tienes 1.000 fichas")).toBeVisible();

    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page.getByLabel("Apodo")).toBeVisible();
    await expect(otra.getByLabel("Apodo")).toBeVisible();

    await otra.getByLabel("Apodo").fill(apodo);
    await otra.getByLabel("PIN").fill("1234");
    await otra.getByRole("button", { name: "Entrar" }).click();
    await expect(otra.getByText("Hola, tienes 1.000 fichas")).toBeVisible();
    await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();
  });

  test("un token que otra pestaña deja y el servidor rechaza cierra la sesión", async ({ page, context }) => {
    const apodo = apodoUnico();
    await page.goto("/");
    await page.getByLabel("Apodo").fill(apodo);
    await page.getByLabel("PIN").fill("1234");
    await page.getByRole("button", { name: "Entrar" }).click();
    await page.getByRole("button", { name: "Sí" }).click();
    await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();

    const otra = await context.newPage();
    await otra.goto("/");
    await otra.evaluate(() => localStorage.setItem("timba.token", "token-invalido"));

    await expect(page.getByLabel("Apodo")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("timba.token"))).toBeNull();
  });
});

test.describe("sesión guardada con el servidor inaccesible", () => {
  test("avisa de que La Timba descansa, conserva el token y deja reintentar", async ({ page, request }) => {
    const apodo = apodoUnico();
    const registro = await request.post("/api/registro", { data: { apodo, pin: "1234" } });
    const { token } = await registro.json();
    await page.addInitScript((t) => localStorage.setItem("timba.token", t), token);
    let caido = true;
    await page.route("**/api/yo", (ruta) => (caido ? ruta.fulfill({ status: 503, json: { error: "descansando" } }) : ruta.continue()));

    await page.goto("/");
    await expect(page.getByText("La Timba está descansando, vuelve mañana")).toBeVisible();
    await expect(page.getByLabel("Apodo")).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("timba.token"))).toBe(token);

    caido = false;
    await page.getByRole("button", { name: "Reintentar" }).click();
    await expect(page.getByText("Hola, tienes 1.000 fichas")).toBeVisible();
  });

  test("sin red avisa de la falta de conexión y deja reintentar", async ({ page, request }) => {
    const apodo = apodoUnico();
    const registro = await request.post("/api/registro", { data: { apodo, pin: "1234" } });
    const { token } = await registro.json();
    await page.addInitScript((t) => localStorage.setItem("timba.token", t), token);
    await page.route("**/api/yo", (ruta) => ruta.abort());

    await page.goto("/");
    await expect(page.getByText("No hay conexión con La Timba")).toBeVisible();
    await expect(page.getByRole("button", { name: "Reintentar" })).toBeVisible();
  });
});
