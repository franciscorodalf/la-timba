import { describe, expect, it } from "vitest";
import { CATEGORIAS, compararJugadas, mejorJugada, nombreJugada, type CategoriaJugada, type Jugada } from "../../src/shared/juegos/poker-jugadas";
import { cs } from "../ayudas";

const jugada = (texto: string): Jugada => {
  const j = mejorJugada(cs(texto));
  if (!j) throw new Error(`Sin jugada para "${texto}"`);
  return j;
};

describe("jugadas de póker", () => {
  it("lista las diez jugadas de mayor a menor", () => {
    expect(CATEGORIAS.map((x) => x.categoria)).toEqual([
      "escalera_real",
      "escalera_color",
      "poquer",
      "full",
      "color",
      "escalera",
      "trio",
      "doble_pareja",
      "pareja",
      "carta_alta",
    ]);
    expect(CATEGORIAS.every((x) => x.nombre !== "" && x.descripcion !== "")).toBe(true);
  });

  it("reconoce cada una de las diez jugadas con siete cartas", () => {
    const manos: [CategoriaJugada, string][] = [
      ["escalera_real", "AS KS QS JS 10S 2D 3C"],
      ["escalera_color", "9H 8H 7H 6H 5H KD 2C"],
      ["poquer", "AS AD AC AH 9S 4D 2C"],
      ["full", "KS KD KC 4H 4D 9S 2C"],
      ["color", "AH 9H 7H 5H 2H KD KC"],
      ["escalera", "9S 8D 7C 6H 5S KD 2C"],
      ["trio", "7S 7D 7C KH 9S 4D 2C"],
      ["doble_pareja", "AS AD 8C 8H KS 4D 2C"],
      ["pareja", "KS KD 9C 7H 5S 4D 2C"],
      ["carta_alta", "AS KD 9C 7H 5S 4D 2C"],
    ];
    for (const [categoria, texto] of manos) expect(jugada(texto).categoria, texto).toBe(categoria);
  });

  it("no hay jugada sin cartas", () => {
    expect(mejorJugada([])).toBeNull();
  });

  it("con menos de cinco cartas no hay escalera ni color", () => {
    expect(jugada("AS KD").categoria).toBe("carta_alta");
    expect(jugada("9H 9D").categoria).toBe("pareja");
    expect(jugada("2S 5S 9S 10S").categoria).toBe("carta_alta");
    expect(jugada("2S 3D 4C 5H").categoria).toBe("carta_alta");
  });

  it("A-2-3-4-5 es escalera al 5 y Q-K-A-2-3 no es escalera", () => {
    const rueda = jugada("AS 2D 3C 4H 5S 9D KC");
    expect(rueda.categoria).toBe("escalera");
    expect(rueda.valores).toEqual([5]);
    expect(jugada("QS KD AC 2H 3S 8D 9C").categoria).toBe("carta_alta");
  });

  it("la escalera más alta gana a la rueda y a otra más baja", () => {
    expect(compararJugadas(jugada("6S 5D 4C 3H 2S KD KC"), jugada("AS 2D 3C 4H 5S 9D KC"))).toBeGreaterThan(0);
    expect(compararJugadas(jugada("10S JD QC KH AS 2D 3C"), jugada("9S 10D JC QH KS 2D 3C"))).toBeGreaterThan(0);
  });

  it("la escalera de color gana aunque haya un color más alto en las siete", () => {
    const j = jugada("9S 8S 7S 6S 5S AS 2S");
    expect(j.categoria).toBe("escalera_color");
    expect(j.valores).toEqual([9]);
    expect(nombreJugada(j)).toBe("Escalera de color al 9");
  });

  it("de dos fulles en siete cartas se queda el mejor", () => {
    const j = jugada("KD KS KC 9D 9S 9C 2H");
    expect(j.categoria).toBe("full");
    expect(j.valores).toEqual([13, 9]);
    expect(nombreJugada(j)).toBe("Full de reyes y nueves");
  });

  it("un trío doble y una pareja forman el full con la mejor pareja", () => {
    expect(jugada("7D 7S 7C 4D 4S 2C 2H").valores).toEqual([7, 4]);
  });

  it("el póquer se queda con la mejor carta acompañante", () => {
    const j = jugada("8D 8S 8C 8H 3D KS 2H");
    expect(j.categoria).toBe("poquer");
    expect(j.valores).toEqual([8, 13]);
    expect(j.cartas).toHaveLength(5);
  });

  it("el color se juega con las cinco más altas del palo", () => {
    const j = jugada("AH KH 9H 7H 5H 3H 2D");
    expect(j.categoria).toBe("color");
    expect(j.valores).toEqual([14, 13, 9, 7, 5]);
    expect(j.cartas).toHaveLength(5);
  });

  it("desempata por pareja y después por cartas acompañantes", () => {
    expect(compararJugadas(jugada("KS KD 9C 7H 5S 4D 2C"), jugada("QS QD AC KH JS 4D 2C"))).toBeGreaterThan(0);
    expect(compararJugadas(jugada("9S 9D AC 7H 5S 4D 2C"), jugada("9H 9C KC 7D 5H 4S 2D"))).toBeGreaterThan(0);
    expect(compararJugadas(jugada("9H 9C KC 7D 5H 4S 2D"), jugada("9S 9D AC 7H 5S 4D 2C"))).toBeLessThan(0);
    expect(compararJugadas(jugada("9S 9D AC 7H 5S 4D 2C"), jugada("9H 9C AD 7S 6H 4S 3D"))).toBeLessThan(0);
  });

  it("doble pareja con la mejor quinta carta", () => {
    const tres = jugada("KS KD 9C 9H 5S 5D 2C");
    expect(tres.categoria).toBe("doble_pareja");
    expect(tres.valores).toEqual([13, 9, 5]);
    expect(compararJugadas(jugada("KS KD 9C 9H AS 5D 2C"), jugada("KH KC 9D 9S QS 5D 2C"))).toBeGreaterThan(0);
  });

  it("una categoría mayor gana a cualquier valor de una menor", () => {
    expect(compararJugadas(jugada("2S 2D 2C 3H 4S 9D KC"), jugada("AS AD KC KH QS 5D 2C"))).toBeGreaterThan(0);
  });

  it("los palos no desempatan", () => {
    const a = jugada("AH KH 9H 7H 5H 3D 2C");
    const b = jugada("AS KS 9S 7S 5S 3D 2C");
    expect(a.categoria).toBe("color");
    expect(compararJugadas(a, b)).toBe(0);
    expect(compararJugadas(jugada("AH KD 9C 7S 5H 3D 2C"), jugada("AS KC 9D 7H 5S 3H 2D"))).toBe(0);
  });

  it("compara jugadas con distinta cantidad de cartas sin fallar", () => {
    expect(compararJugadas(jugada("9H 9D"), jugada("9S 9C 2D"))).toBeLessThan(0);
    expect(compararJugadas(jugada("9H 9D"), jugada("9S 9C"))).toBe(0);
    expect(compararJugadas(jugada("AS KD"), jugada("AH QD"))).toBeGreaterThan(0);
  });

  it("nombra las jugadas", () => {
    const nombres: [string, string][] = [
      ["KS KD 9C 7H 5S 4D 2C", "Pareja de reyes"],
      ["AS AD 8C 8H KS 4D 2C", "Doble pareja de ases y ochos"],
      ["7S 7D 7C KH 9S 4D 2C", "Trío de sietes"],
      ["9S 8D 7C 6H 5S KD 2C", "Escalera al 9"],
      ["AH 9H 7H 5H 2H KD KC", "Color al as"],
      ["KS KD KC 2H 2D 9S 4C", "Full de reyes y doses"],
      ["AS AD AC AH 9S 4D 2C", "Póquer de ases"],
      ["9H 8H 7H 6H 5H KD 2C", "Escalera de color al 9"],
      ["AS KS QS JS 10S 2D 3C", "Escalera real"],
      ["AS KD 9C 7H 5S 4D 2C", "Carta alta: as"],
    ];
    for (const [texto, nombre] of nombres) expect(nombreJugada(jugada(texto)), texto).toBe(nombre);
  });

  it("nombra las figuras y los números con su artículo", () => {
    expect(nombreJugada(jugada("JS 10D 9C 8H 7S 2D 2C"))).toBe("Escalera a la jota");
    expect(nombreJugada(jugada("QH 9H 7H 5H 2H KD KC"))).toBe("Color a la reina");
    expect(nombreJugada(jugada("KS QD JC 10H 9S 2D 2C"))).toBe("Escalera al rey");
    expect(nombreJugada(jugada("QS 10D 9C 7H 5S 4D 2C"))).toBe("Carta alta: reina");
    expect(nombreJugada(jugada("JS 10D 9C 7H 5S 4D 2C"))).toBe("Carta alta: jota");
    expect(nombreJugada(jugada("10S 6D 3C 2H"))).toBe("Carta alta: 10");
    expect(nombreJugada(jugada("QS QD 10C 10H"))).toBe("Doble pareja de reinas y dieces");
    expect(nombreJugada(jugada("JS JD 6C 6H"))).toBe("Doble pareja de jotas y seises");
    expect(nombreJugada(jugada("3S 3D 3C 5H 5S"))).toBe("Full de treses y cincos");
    expect(nombreJugada(jugada("4S 4D 4C 4H"))).toBe("Póquer de cuatros");
  });
});
