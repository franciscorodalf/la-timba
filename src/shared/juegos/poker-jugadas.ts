import type { Carta, Valor } from "../cartas";

export type CategoriaJugada = "carta_alta" | "pareja" | "doble_pareja" | "trio" | "escalera" | "color" | "full" | "poquer" | "escalera_color" | "escalera_real";

/** Las diez jugadas de mayor a menor, con los nombres y descripciones de la tabla del spec §2.5. */
export const CATEGORIAS: readonly { categoria: CategoriaJugada; nombre: string; descripcion: string }[] = [
  { categoria: "escalera_real", nombre: "Escalera real", descripcion: "10, J, Q, K y A del mismo palo" },
  { categoria: "escalera_color", nombre: "Escalera de color", descripcion: "Cinco seguidas del mismo palo" },
  { categoria: "poquer", nombre: "Póquer", descripcion: "Cuatro cartas iguales" },
  { categoria: "full", nombre: "Full", descripcion: "Un trío y una pareja" },
  { categoria: "color", nombre: "Color", descripcion: "Cinco del mismo palo" },
  { categoria: "escalera", nombre: "Escalera", descripcion: "Cinco seguidas" },
  { categoria: "trio", nombre: "Trío", descripcion: "Tres cartas iguales" },
  { categoria: "doble_pareja", nombre: "Doble pareja", descripcion: "Dos parejas" },
  { categoria: "pareja", nombre: "Pareja", descripcion: "Dos cartas iguales" },
  { categoria: "carta_alta", nombre: "Carta alta", descripcion: "Ninguna de las anteriores" },
];

/** `valores` sirve para desempatar, del 2 al 14 (el as es 14), de lo que más pesa a lo que menos; las cartas que acompañan van al final. */
export interface Jugada {
  categoria: CategoriaJugada;
  valores: number[];
  cartas: Carta[];
}

const NUMERO: Record<Valor, number> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14 };

/** Fuerza de cada categoría: la primera de `CATEGORIAS` es la mayor. */
const FUERZA = new Map<CategoriaJugada, number>(CATEGORIAS.map((x, i) => [x.categoria, CATEGORIAS.length - i]));

const PLURAL: Record<number, string> = { 2: "doses", 3: "treses", 4: "cuatros", 5: "cincos", 6: "seises", 7: "sietes", 8: "ochos", 9: "nueves", 10: "dieces", 11: "jotas", 12: "reinas", 13: "reyes", 14: "ases" };
const SINGULAR: Record<number, string> = { 11: "jota", 12: "reina", 13: "rey", 14: "as" };
/** «al 9», «al rey», «al as», pero «a la jota» y «a la reina». */
const HASTA: Record<number, string> = { 11: "a la jota", 12: "a la reina", 13: "al rey", 14: "al as" };

const numero = (carta: Carta): number => NUMERO[carta.valor];
const masAlta = (a: Carta, b: Carta): number => numero(b) - numero(a);

/** La escalera más alta que forman las cartas, con el as también como 1. Devuelve sus cinco cartas de mayor a menor, o null. */
function mejorEscalera(cartas: Carta[]): Carta[] | null {
  const porValor = new Map<number, Carta>();
  for (const carta of cartas) if (!porValor.has(numero(carta))) porValor.set(numero(carta), carta);
  const as = porValor.get(14);
  if (as) porValor.set(1, as);
  for (let alta = 14; alta >= 5; alta--) {
    const tramo: Carta[] = [];
    for (let v = alta; v > alta - 5; v--) {
      const carta = porValor.get(v);
      if (!carta) break;
      tramo.push(carta);
    }
    if (tramo.length === 5) return tramo;
  }
  return null;
}

/** Valor de la carta más alta de una escalera: en A-2-3-4-5 es el 5, no el as. */
const altaDeEscalera = (escalera: Carta[]): number => (numero(escalera[0]) === 14 && numero(escalera[1]) === 5 ? 5 : numero(escalera[0]));

/** La mejor jugada de 2 a 7 cartas, calculada de los recuentos por valor y por palo. `null` si no hay cartas. */
export function mejorJugada(cartas: Carta[]): Jugada | null {
  if (cartas.length === 0) return null;
  const ordenadas = [...cartas].sort(masAlta);

  const porPalo = new Map<string, Carta[]>();
  for (const carta of ordenadas) porPalo.set(carta.palo, [...(porPalo.get(carta.palo) ?? []), carta]);
  const delColor = [...porPalo.values()].find((grupo) => grupo.length >= 5);

  if (delColor) {
    const escaleraColor = mejorEscalera(delColor);
    if (escaleraColor) {
      const alta = altaDeEscalera(escaleraColor);
      return { categoria: alta === 14 ? "escalera_real" : "escalera_color", valores: [alta], cartas: escaleraColor };
    }
  }

  const porValor = new Map<number, Carta[]>();
  for (const carta of ordenadas) porValor.set(numero(carta), [...(porValor.get(numero(carta)) ?? []), carta]);
  // Primero los grupos más grandes y, a igual tamaño, los de más valor: el primero de cada tamaño es el que mejor juega.
  const [primero, segundo] = [...porValor.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  /** Las `n` cartas más altas que no pertenecen a los valores dados. */
  const acompanantes = (n: number, ...usados: number[]): Carta[] => ordenadas.filter((carta) => !usados.includes(numero(carta))).slice(0, n);
  const conAcompanantes = (categoria: CategoriaJugada, usados: number[], principales: Carta[], resto: Carta[]): Jugada => ({
    categoria,
    valores: [...usados, ...resto.map(numero)],
    cartas: [...principales, ...resto],
  });

  if (primero[1].length === 4) return conAcompanantes("poquer", [primero[0]], primero[1], acompanantes(1, primero[0]));
  if (primero[1].length === 3 && segundo && segundo[1].length >= 2) {
    // Con dos tríos, el menor aporta su pareja.
    return { categoria: "full", valores: [primero[0], segundo[0]], cartas: [...primero[1], ...segundo[1].slice(0, 2)] };
  }
  if (delColor) {
    const cinco = delColor.slice(0, 5);
    return { categoria: "color", valores: cinco.map(numero), cartas: cinco };
  }
  const escalera = mejorEscalera(ordenadas);
  if (escalera) return { categoria: "escalera", valores: [altaDeEscalera(escalera)], cartas: escalera };
  if (primero[1].length === 3) return conAcompanantes("trio", [primero[0]], primero[1], acompanantes(2, primero[0]));
  if (primero[1].length === 2 && segundo && segundo[1].length === 2) {
    // Con tres parejas, la tercera solo puede aportar su carta más alta como acompañante.
    const usados = [primero[0], segundo[0]];
    return conAcompanantes("doble_pareja", usados, [...primero[1], ...segundo[1]], acompanantes(1, ...usados));
  }
  if (primero[1].length === 2) return conAcompanantes("pareja", [primero[0]], primero[1], acompanantes(3, primero[0]));
  const cinco = ordenadas.slice(0, 5);
  return { categoria: "carta_alta", valores: cinco.map(numero), cartas: cinco };
}

/** Positivo si gana `a`, negativo si gana `b` y 0 si empatan. Primero la categoría, después los valores en orden; los palos nunca desempatan. */
export function compararJugadas(a: Jugada, b: Jugada): number {
  const porCategoria = (FUERZA.get(a.categoria) ?? 0) - (FUERZA.get(b.categoria) ?? 0);
  if (porCategoria !== 0) return porCategoria;
  const largo = Math.max(a.valores.length, b.valores.length);
  for (let i = 0; i < largo; i++) {
    const diferencia = (a.valores[i] ?? 0) - (b.valores[i] ?? 0);
    if (diferencia !== 0) return diferencia;
  }
  return 0;
}

/** El nombre de la jugada para enseñarlo: «Pareja de reyes», «Escalera al 9», «Carta alta: as». */
export function nombreJugada(jugada: Jugada): string {
  const [v, w] = jugada.valores;
  const nombre = CATEGORIAS.find((x) => x.categoria === jugada.categoria)?.nombre ?? "";
  switch (jugada.categoria) {
    case "escalera_real":
      return nombre;
    case "escalera_color":
    case "escalera":
    case "color":
      return `${nombre} ${HASTA[v] ?? `al ${v}`}`;
    case "poquer":
    case "trio":
    case "pareja":
      return `${nombre} de ${PLURAL[v]}`;
    case "doble_pareja":
    case "full":
      return `${nombre} de ${PLURAL[v]} y ${PLURAL[w]}`;
    case "carta_alta":
      return `${nombre}: ${SINGULAR[v] ?? v}`;
  }
}
