import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TOKEN_SECRET: "secreto-de-pruebas" } },
    }),
  ],
  // Mayor que `ESPERA_MS` de `test/ayudas.ts`: una espera de mensaje colgada falla con su propio error, no con el tiempo agotado.
  test: { include: ["test/**/*.test.ts"], testTimeout: 20_000 },
});
