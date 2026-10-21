import { describe, expect, it } from "vitest";
import { geometria } from "../../src/client/pantallas/carrera/geometria";
import { CARRERA } from "../../src/shared/juegos/carrera";

describe("geometria de la pista", () => {
  const casos = [
    { nombre: "móvil pequeño (360×640)", largo: 330, ancho: 244, horizontal: false },
    { nombre: "móvil grande (412×915)", largo: 600, ancho: 270, horizontal: false },
    { nombre: "ordenador 1280×720", largo: 880, ancho: 300, horizontal: true },
    { nombre: "ordenador grande", largo: 1000, ancho: 420, horizontal: true },
  ];

  it.each(casos)("$nombre: el caballo cabe en su carril y la carrera entera cabe en la pista", ({ largo, ancho, horizontal }) => {
    const g = geometria(largo, ancho, horizontal);
    const carril = ancho / 4;
    expect(horizontal ? g.caballoAlto : g.caballoAncho).toBeLessThanOrEqual(horizontal ? carril : carril);
    // La punta del caballo en la meta (casilla 8) queda donde empieza la franja de meta, y no pasa del final.
    const punta = g.salida + g.caballoLargo + CARRERA.META * g.paso;
    expect(punta).toBeCloseTo(largo - g.meta, 5);
    expect(g.paso).toBeGreaterThan(18);
  });

  it("los caballos tienen proporción de carta y son legibles (≥ 28 px de ancho)", () => {
    for (const { largo, ancho, horizontal } of casos) {
      const g = geometria(largo, ancho, horizontal);
      expect(g.caballoAncho).toBeGreaterThanOrEqual(28);
      expect(g.caballoAlto / g.caballoAncho).toBeCloseTo(1.4, 1);
    }
  });

  it("en ordenador el tramo cabe en la franja; en móvil cabe a lo ancho de la columna", () => {
    const o = geometria(880, 300, true);
    expect(o.tramoAlto).toBeLessThanOrEqual(o.franja);
    const m = geometria(330, 244, false);
    expect(m.tramoAncho).toBeLessThanOrEqual(m.franja);
    // Si el paso es corto, los tramos se solapan (su alto pasa del paso) pero nunca más de la mitad.
    expect(m.tramoAlto - m.paso).toBeLessThan(m.tramoAlto / 2);
  });
});
