import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules(); // cada prueba parte de un reloj sin desfase
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("reloj del servidor", () => {
  it("mientras no llegue ningún mensaje, la hora del servidor es la del cliente", async () => {
    const { ahoraServidor } = await import("../../src/client/red/reloj");
    expect(ahoraServidor()).toBe(1_000_000);
  });

  it("con el servidor 60 s por delante, su hora va 60 s por delante y avanza con el reloj del cliente", async () => {
    const { ahoraServidor, registrarHoraServidor } = await import("../../src/client/red/reloj");
    registrarHoraServidor(1_060_000);
    expect(ahoraServidor()).toBe(1_060_000);

    vi.advanceTimersByTime(2_500);
    expect(ahoraServidor()).toBe(1_062_500);
  });

  it("con el servidor por detrás también vale, y el último mensaje es el que manda", async () => {
    const { ahoraServidor, registrarHoraServidor } = await import("../../src/client/red/reloj");
    registrarHoraServidor(940_000);
    expect(ahoraServidor()).toBe(940_000);

    vi.advanceTimersByTime(1_000);
    registrarHoraServidor(1_001_000); // otro mensaje: ahora el desfase es de 0
    expect(ahoraServidor()).toBe(1_001_000);
  });

  it("lo que falta para un instante del servidor se mide con la hora del servidor, no con la del cliente", async () => {
    const { ahoraServidor, registrarHoraServidor } = await import("../../src/client/red/reloj");
    registrarHoraServidor(1_060_000);
    const finFase = 1_060_000 + 12_000; // el servidor dice que la fase vence dentro de 12 s
    expect(finFase - ahoraServidor()).toBe(12_000);
    expect(finFase - Date.now()).toBe(72_000); // con el reloj del cliente saldría un minuto de más
  });
});
