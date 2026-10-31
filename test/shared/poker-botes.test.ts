import { describe, expect, it } from "vitest";
import { calcularBotes, repartirBote, type Aporte } from "../../src/shared/juegos/poker-botes";

const A = 1;
const B = 2;
const C = 3;
const D = 4;
const E = 5;

const vivo = (jugadorId: number, aportado: number): Aporte => ({ jugadorId, aportado, vivo: true });
const muerto = (jugadorId: number, aportado: number): Aporte => ({ jugadorId, aportado, vivo: false });

/** Generador determinista (mulberry32), como el de presupuesto.test.ts. */
function rngSemilla(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("botes de póker", () => {
  it("un bote cuando todos aportan igual, y el retirado no puede ganarlo", () => {
    const { botes, devuelto } = calcularBotes([vivo(A, 100), vivo(B, 100), muerto(C, 100)]);
    expect(botes).toEqual([{ cantidad: 300, jugadores: [A, B] }]);
    expect(devuelto).toBeNull();
  });

  it("tres niveles de all-in", () => {
    const { botes, devuelto } = calcularBotes([vivo(A, 50), vivo(B, 200), vivo(C, 500), vivo(D, 500)]);
    expect(botes).toEqual([
      { cantidad: 200, jugadores: [A, B, C, D] },
      { cantidad: 450, jugadores: [B, C, D] },
      { cantidad: 600, jugadores: [C, D] },
    ]);
    expect(devuelto).toBeNull();
  });

  it("cuatro niveles de all-in", () => {
    const { botes } = calcularBotes([vivo(A, 50), vivo(B, 100), vivo(C, 200), vivo(D, 300), vivo(E, 300)]);
    expect(botes).toEqual([
      { cantidad: 250, jugadores: [A, B, C, D, E] },
      { cantidad: 200, jugadores: [B, C, D, E] },
      { cantidad: 300, jugadores: [C, D, E] },
      { cantidad: 200, jugadores: [D, E] },
    ]);
  });

  it("lo que nadie iguala vuelve", () => {
    const { botes, devuelto } = calcularBotes([vivo(A, 100), vivo(B, 300)]);
    expect(devuelto).toEqual({ jugadorId: B, cantidad: 200 });
    expect(botes).toEqual([{ cantidad: 200, jugadores: [A, B] }]);
  });

  it("lo que nadie iguala vuelve aunque el segundo que más aportó se haya retirado", () => {
    const { botes, devuelto } = calcularBotes([vivo(A, 400), muerto(B, 150), vivo(C, 100)]);
    expect(devuelto).toEqual({ jugadorId: A, cantidad: 250 });
    expect(botes).toEqual([
      { cantidad: 300, jugadores: [A, C] },
      { cantidad: 100, jugadores: [A] },
    ]);
  });

  it("un retirado que aportó más que un all-in reparte su aportación por niveles", () => {
    const { botes, devuelto } = calcularBotes([vivo(A, 50), muerto(B, 100), vivo(C, 200), vivo(D, 200)]);
    expect(botes).toEqual([
      { cantidad: 200, jugadores: [A, C, D] },
      { cantidad: 350, jugadores: [C, D] },
    ]);
    expect(devuelto).toBeNull();
  });

  it("quien se levanta con la mayor aportación deja sus fichas en el bote", () => {
    const { botes, devuelto } = calcularBotes([muerto(A, 100), vivo(B, 60), vivo(C, 60)]);
    expect(botes).toEqual([{ cantidad: 220, jugadores: [B, C] }]);
    expect(devuelto).toBeNull();
  });

  it("si la mayor aportación está empatada no se devuelve nada", () => {
    const { botes, devuelto } = calcularBotes([vivo(A, 200), vivo(B, 200), vivo(C, 30)]);
    expect(devuelto).toBeNull();
    expect(botes).toEqual([
      { cantidad: 90, jugadores: [A, B, C] },
      { cantidad: 340, jugadores: [A, B] },
    ]);
  });

  it("un solo vivo se lleva todo lo que hay por encima de lo que le igualaron y el resto se devuelve", () => {
    const { botes, devuelto } = calcularBotes([vivo(A, 80), muerto(B, 20), muerto(C, 50)]);
    expect(devuelto).toEqual({ jugadorId: A, cantidad: 30 });
    expect(botes).toEqual([{ cantidad: 120, jugadores: [A] }]);
  });

  it("reparte a partes iguales y la ficha impar va al primero", () => {
    expect(repartirBote(101, [A, B])).toEqual([
      { jugadorId: A, cantidad: 51 },
      { jugadorId: B, cantidad: 50 },
    ]);
    expect(repartirBote(100, [A, B, C])).toEqual([
      { jugadorId: A, cantidad: 34 },
      { jugadorId: B, cantidad: 33 },
      { jugadorId: C, cantidad: 33 },
    ]);
    expect(repartirBote(90, [A])).toEqual([{ jugadorId: A, cantidad: 90 }]);
  });

  it("lo repartido y lo devuelto suman siempre lo aportado", () => {
    const azar = rngSemilla(20261031);
    for (let i = 0; i < 3000; i++) {
      const n = 2 + Math.floor(azar() * 7);
      const aportes: Aporte[] = [];
      for (let j = 0; j < n; j++) {
        // Montos pequeños para que haya empates y niveles repetidos.
        const vivo = azar() < 0.65;
        // Quien sigue vivo ha puesto al menos una ciega, así que su aportación nunca es cero.
        aportes.push({ jugadorId: j + 1, aportado: (vivo ? 1 : 0) * 10 + Math.floor(azar() * 12) * 10, vivo });
      }
      if (!aportes.some((x) => x.vivo)) aportes[0] = { ...aportes[0], aportado: Math.max(aportes[0].aportado, 10), vivo: true };
      const total = aportes.reduce((s, x) => s + x.aportado, 0);

      const { botes, devuelto } = calcularBotes(aportes);
      const enBotes = botes.reduce((s, b) => s + b.cantidad, 0);
      expect(enBotes + (devuelto?.cantidad ?? 0)).toBe(total);

      const vivos = new Set(aportes.filter((x) => x.vivo).map((x) => x.jugadorId));
      for (const bote of botes) {
        expect(bote.cantidad).toBeGreaterThan(0);
        expect(bote.jugadores.length).toBeGreaterThan(0);
        for (const id of bote.jugadores) expect(vivos.has(id)).toBe(true);
        const repartido = repartirBote(bote.cantidad, bote.jugadores);
        expect(repartido.reduce((s, x) => s + x.cantidad, 0)).toBe(bote.cantidad);
      }
    }
  });
});
