import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  // Cuatro navegadores a la vez (cada prueba de la sala abre dos) saturan el servidor de desarrollo y a veces un clic tarda más
  // que su plazo (se ve con `--repeat-each`, que pone la misma prueba en todos los trabajadores a la vez). Con el 40 % de los
  // núcleos (3 en una máquina de 8) esas pruebas pasan de forma estable.
  workers: "40%",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    locale: "es-ES",
    actionTimeout: 15_000,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "movil", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
