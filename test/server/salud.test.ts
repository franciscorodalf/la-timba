import { exports } from "cloudflare:workers";
import { expect, it } from "vitest";

it("GET /api/salud responde ok", async () => {
  const r = await exports.default.fetch("http://x/api/salud");
  expect(r.status).toBe(200);
  expect(await r.text()).toBe("ok");
});
