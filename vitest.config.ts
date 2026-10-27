import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TOKEN_SECRET: "secreto-de-pruebas" } },
    }),
  ],
  test: { include: ["test/**/*.test.ts"] },
});
