import { describe, expect, it } from "vitest";
import { activaDe, agruparOtros, disponerManos, type ManoVista } from "../../src/client/pantallas/blackjack/manos";
import type { Carta } from "../../src/shared/cartas";
import type { VistaBJ } from "../../src/shared/juegos/blackjack";

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Carta["palo"], valor: texto.slice(0, -1) as Carta["valor"] });

function mano(jugadorId: number, apodo: string, indice: number, estado: ManoVista["estado"] = "jugando"): ManoVista {
  return { jugadorId, apodo, casilla: indice, indice, apuesta: 50, cartas: [c("10H"), c("9C")], estado, doblada: false, dividida: false, total: 19 };
}

/** Lo que ocupan en horizontal las manos con esa disposición: cada columna y el hueco entre ellas. */
const ocupan = (d: { columnas: number[] }, hueco: number): number => d.columnas.reduce((suma, c) => suma + c, 0) + hueco * (d.columnas.length - 1);
/** Lo que ocupan solo las cartas de cada mano (la primera entera y lo que asoma de las demás). */
const ocupanLasCartas = (cartas: number[], { ancho, solape }: { ancho: number; solape: number }, hueco: number): number =>
  cartas.reduce((suma, n) => suma + ancho * (1 + (n - 1) * (1 + solape)), 0) + hueco * (cartas.length - 1);

describe("disponerManos", () => {
  it("una mano conserva el tamaño y el solape de siempre; con más de cinco cartas se solapan más", () => {
    expect(disponerManos([2], 90, 328, 8)).toMatchObject({ ancho: 90, solape: -0.42 });
    expect(disponerManos([6], 90, 328, 8)).toMatchObject({ ancho: 90, solape: -0.62 });
  });

  it("el ancho de la carta baja con las manos: 100 % con una, ~75 % con dos y ~58 % con tres o cuatro", () => {
    expect(disponerManos([2, 2], 100, 600, 8).ancho).toBe(75);
    expect(disponerManos([2, 2, 2], 100, 600, 8).ancho).toBe(58);
    expect(disponerManos([2, 2, 2, 2], 100, 600, 8).ancho).toBe(58);
  });

  it("con más manos hay más solape", () => {
    const una = disponerManos([2], 100, 600, 8).solape;
    const dos = disponerManos([2, 2], 100, 600, 8).solape;
    const cuatro = disponerManos([2, 2, 2, 2], 100, 600, 8).solape;
    expect(dos).toBeLessThan(una);
    expect(cuatro).toBeLessThan(dos);
  });

  it("cuatro manos con dos cartas caben en 360×640 (328 px útiles) y sin quitar el tamaño del 58 %", () => {
    const d = disponerManos([2, 2, 2, 2], 90, 328, 8);
    expect(d.ancho).toBe(52);
    expect(ocupan(d, 8)).toBeLessThanOrEqual(328);
  });

  it("si no caben, primero se solapan más y solo después se encogen las cartas", () => {
    const normal = disponerManos([2, 2, 2, 2], 90, 328, 8);
    const solapadas = disponerManos([3, 2, 2, 2], 90, 328, 8);
    expect(solapadas.ancho).toBe(52);
    expect(solapadas.solape).toBeLessThan(normal.solape);
    expect(ocupan(solapadas, 8)).toBeLessThanOrEqual(328);
    // Con tantas cartas que ni al máximo solape caben, se encogen, pero nunca por debajo de un mínimo legible.
    const muchas = disponerManos([7, 7, 7, 7], 90, 328, 8);
    expect(ocupan(muchas, 8)).toBeLessThanOrEqual(328);
    expect(muchas.ancho).toBeLessThan(52);
    expect(muchas.ancho).toBeGreaterThanOrEqual(24);
    expect(disponerManos([12, 12, 12, 12], 90, 100, 8).ancho).toBe(24);
  });

  it("cada columna mide lo que sus cartas o, si es más, lo que necesita lo de debajo (el total y la apuesta), y la fila entera cabe", () => {
    // Dos manos en el ordenador con un jugador a cada lado: poco hueco (190 px) y cartas de 63 px (la primera mano con tres cartas).
    const dos = disponerManos([3, 2], 84, 190, 8);
    expect(dos.ancho).toBe(63);
    expect(ocupan(dos, 8)).toBeLessThanOrEqual(190);
    for (const columna of dos.columnas) expect(columna).toBeGreaterThanOrEqual(64);
    // Las cartas, que ocupan menos que sus columnas, también caben.
    expect(ocupanLasCartas([3, 2], dos, 8)).toBeLessThanOrEqual(ocupan(dos, 8));

    // Con muchas cartas de poco ancho, la columna no baja de lo que pide el pie aunque las cartas sean más estrechas.
    const cuatro = disponerManos([2, 2, 2, 2], 84, 220, 8);
    expect(ocupan(cuatro, 8)).toBeLessThanOrEqual(220);
    for (const columna of cuatro.columnas) expect(columna).toBeGreaterThanOrEqual(48);
    // Con una sola mano no hay pie debajo: la columna es la mano.
    expect(disponerManos([2], 90, 328, 8).columnas).toEqual([Math.ceil(90 * 1.58)]);
  });
});

describe("activaDe", () => {
  it("la mano activa es la primera que sigue en juego, en el orden de la vista", () => {
    const manos = [mano(1, "Ana", 0, "plantado"), mano(1, "Ana", 1), mano(1, "Ana", 2)];
    expect(activaDe(manos)).toBe(1);
    expect(activaDe([mano(1, "Ana", 0, "plantado"), mano(1, "Ana", 1, "rendido")])).toBe(-1);
    expect(activaDe([])).toBe(-1);
  });
});

describe("agruparOtros", () => {
  const vista = (resto: Partial<VistaBJ>): Pick<VistaBJ, "sentados" | "manos" | "yo"> => ({ sentados: [], manos: [], yo: 1, ...resto });

  it("los sentados por orden de llegada, sin ti, cada uno con todas sus manos", () => {
    const manos = [mano(1, "Yo", 0), mano(2, "Ana", 0), mano(2, "Ana", 1), mano(3, "Bea", 0)];
    const otros = agruparOtros(vista({ sentados: ["Yo", "Bea", "Ana", "Cris"], manos }), "yo");
    expect(otros.map((o) => [o.apodo, o.manos.map((m) => m.indice)])).toEqual([
      ["Bea", [0]],
      ["Ana", [0, 1]],
      ["Cris", []],
    ]);
  });

  it("quien se fue con manos en juego sigue en la mesa hasta que acaba la ronda, con todas sus manos juntas", () => {
    const manos = [mano(2, "Ana", 0), mano(4, "Dani", 0), mano(4, "Dani", 1)];
    const otros = agruparOtros(vista({ sentados: ["Ana"], manos, yo: 1 }), "yo");
    expect(otros.map((o) => [o.apodo, o.manos.length])).toEqual([
      ["Ana", 1],
      ["Dani", 2],
    ]);
  });
});
