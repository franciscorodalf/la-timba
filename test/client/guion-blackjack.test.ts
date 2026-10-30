import { describe, expect, it } from "vitest";
import {
  claveCarta,
  claveTrasDividir,
  DESLIZE_MS,
  encolarGuion,
  ESCALONADO_MS,
  GIRO_MS,
  guionDelLote,
  partesDeClave,
  sumarGeneraciones,
  totalVisible,
  VUELO_MS,
} from "../../src/client/pantallas/blackjack/guion";
import type { Carta } from "../../src/shared/cartas";
import type { VistaBJ } from "../../src/shared/juegos/blackjack";
import type { Evento } from "../../src/shared/juegos/tipos";

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Carta["palo"], valor: texto.slice(0, -1) as Carta["valor"] });

/** Una mano de la vista: `indice` es su orden dentro del jugador (las que salen de dividir comparten casilla). */
function mano(jugadorId: number, cartas: Carta[], indice = 0, casilla = indice): VistaBJ["manos"][number] {
  return { jugadorId, apodo: `j${jugadorId}`, casilla, indice, apuesta: 50, cartas, estado: "jugando", doblada: false, dividida: false, total: 0 };
}

/** El evento de una carta visible repartida a una mano de un jugador. */
const reparte = (a: number, mano: number, carta: Carta): Evento => ({ tipo: "carta_repartida", a, mano, oculta: false, carta });

function vista(resto: Partial<VistaBJ>): VistaBJ {
  return { ronda: 3, fase: "decisiones", finFase: 0, banca: [], totalBanca: null, manos: [], sentados: [], yo: 1, opciones: null, miSeguro: null, casillasLibres: 7 - (resto.manos?.length ?? 0), ...resto };
}

describe("guionDelLote", () => {
  it("en el reparto, cada carta sale 260 ms después de la anterior en el orden de los eventos", () => {
    const v = vista({ banca: [c("6S"), null], manos: [mano(1, [c("10H"), c("9C")]), mano(2, [c("2D"), c("AS")])] });
    const guion = guionDelLote(
      [
        { tipo: "carta_repartida", a: 1, oculta: false, carta: c("10H") },
        { tipo: "carta_repartida", a: 2, oculta: false, carta: c("2D") },
        { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("6S") },
        { tipo: "carta_repartida", a: 1, oculta: false, carta: c("9C") },
        { tipo: "carta_repartida", a: 2, oculta: false, carta: c("AS") },
        { tipo: "carta_repartida", a: "banca", oculta: true },
      ],
      v,
    );
    expect(ESCALONADO_MS).toBe(260);
    expect([...guion.cartas]).toEqual([
      [claveCarta(3, 1, 0, 0), 0],
      [claveCarta(3, 2, 0, 0), 260],
      [claveCarta(3, "banca", 0, 0), 520],
      [claveCarta(3, 1, 0, 1), 780],
      [claveCarta(3, 2, 0, 1), 1040],
      [claveCarta(3, "banca", 0, 1), 1300],
    ]);
    expect(guion.giro).toBeNull();
    expect(guion.fin).toBe(1300 + VUELO_MS);
  });

  it("una carta pedida es la última de la mano; los eventos que no son cartas no cuentan como posición", () => {
    const v = vista({ manos: [mano(1, [c("10H"), c("2C"), c("5D")])] });
    const guion = guionDelLote([{ tipo: "barajado" }, { tipo: "carta_repartida", a: 1, oculta: false, carta: c("5D") }], v);
    expect([...guion.cartas]).toEqual([[claveCarta(3, 1, 0, 2), 0]]);
  });

  it("al jugar la banca, primero se gira la tapada y las cartas que pide salen cuando termina el giro", () => {
    const v = vista({ fase: "resultado", banca: [c("6S"), c("10D"), c("2C"), c("3H")] });
    const guion = guionDelLote(
      [
        { tipo: "carta_girada", carta: c("10D") },
        { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("2C") },
        { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("3H") },
        { tipo: "pago", jugadorId: 1, neto: 50 },
      ],
      v,
    );
    expect(guion.giro).toBe(0);
    const primera = guion.cartas.get(claveCarta(3, "banca", 0, 2))!;
    expect(primera).toBeGreaterThanOrEqual(GIRO_MS);
    expect(guion.cartas.get(claveCarta(3, "banca", 0, 3))).toBe(primera + ESCALONADO_MS);
    expect(guion.fin).toBe(primera + ESCALONADO_MS + VUELO_MS);
  });

  it("sin cartas en el lote no hay nada que animar; un evento de una mano que ya no está se ignora", () => {
    expect(guionDelLote([{ tipo: "pago", jugadorId: 1, neto: -50 }], vista({})).cartas.size).toBe(0);
    const guion = guionDelLote([{ tipo: "carta_repartida", a: 9, oculta: false, carta: c("5D") }], vista({ manos: [mano(1, [c("5D")])] }));
    expect(guion.cartas.size).toBe(0);
    expect(guion.fin).toBe(0);
  });

  it("las cartas de manos distintas del mismo jugador tienen claves distintas", () => {
    expect(claveCarta(3, 1, 0, 0)).not.toBe(claveCarta(3, 1, 1, 0));
    expect(claveCarta(3, 1, 0, 1)).not.toBe(claveCarta(3, 1, 1, 1));
    // La banca siempre es la mano 0.
    expect(claveCarta(3, "banca", 0, 0)).not.toBe(claveCarta(3, 1, 0, 0));

    // Dos casillas: el reparto es una carta a cada mano, primero la primera de cada una y luego la segunda.
    const v = vista({ manos: [mano(1, [c("10H"), c("9C")], 0), mano(1, [c("8D"), c("3S")], 1)] });
    const guion = guionDelLote([reparte(1, 0, c("10H")), reparte(1, 1, c("8D")), reparte(1, 0, c("9C")), reparte(1, 1, c("3S"))], v);
    expect([...guion.cartas]).toEqual([
      [claveCarta(3, 1, 0, 0), 0],
      [claveCarta(3, 1, 1, 0), 260],
      [claveCarta(3, 1, 0, 1), 520],
      [claveCarta(3, 1, 1, 1), 780],
    ]);
  });

  it("una carta pedida va a la mano que dice el evento, no a la primera del jugador", () => {
    const v = vista({ manos: [mano(1, [c("10H"), c("9C")], 0), mano(1, [c("8D"), c("3S"), c("2C")], 1)] });
    const guion = guionDelLote([reparte(1, 1, c("2C"))], v);
    expect([...guion.cartas]).toEqual([[claveCarta(3, 1, 1, 2), 0]]);
  });

  it("tras mano_dividida, las cartas nuevas van a las manos 0 y 1", () => {
    // Dos ochos divididos: cada mano se queda con uno y recibe al momento su segunda carta (primero la original).
    const v = vista({ manos: [mano(1, [c("8H"), c("2D")], 0, 0), mano(1, [c("8C"), c("5S")], 1, 0)] });
    const guion = guionDelLote(
      [{ tipo: "mano_dividida", jugadorId: 1, casilla: 0, indice: 0 }, reparte(1, 0, c("2D")), reparte(1, 1, c("5S"))],
      v,
    );
    expect([...guion.cartas.keys()]).toEqual([claveCarta(3, 1, 0, 1), claveCarta(3, 1, 1, 1)]);
    // La segunda carta de la mano original (la que se desliza) no es una carta repartida: no vuela desde el mazo.
    expect(guion.cartas.has(claveCarta(3, 1, 1, 0))).toBe(false);
    // Primero se desliza la carta y las nuevas salen sin esperar a que acabe del todo, una detrás de otra.
    const [primera, segunda] = [...guion.cartas.values()];
    expect(primera).toBeGreaterThan(0);
    expect(primera).toBeLessThan(DESLIZE_MS);
    expect(segunda).toBe(primera + ESCALONADO_MS);
    expect(guion.fin).toBe(segunda + VUELO_MS);
  });

  it("al dividir con otra mano delante o detrás, las cartas nuevas siguen a las manos que se dividen y las demás no se tocan", () => {
    // Dos casillas, la primera se divide: las manos del jugador pasan a ser 0, 1 (las dos nuevas) y 2 (la de la otra casilla).
    const v = vista({ manos: [mano(1, [c("8H"), c("2D")], 0, 0), mano(1, [c("8C"), c("5S")], 1, 0), mano(1, [c("KD"), c("QS")], 2, 1)] });
    const guion = guionDelLote(
      [{ tipo: "mano_dividida", jugadorId: 1, casilla: 0, indice: 0 }, reparte(1, 0, c("2D")), reparte(1, 1, c("5S"))],
      v,
    );
    expect([...guion.cartas.keys()]).toEqual([claveCarta(3, 1, 0, 1), claveCarta(3, 1, 1, 1)]);
  });

  it("si dos mensajes llegan juntos (dividir y pedir en la nueva), cada carta cae en su sitio", () => {
    const v = vista({ manos: [mano(1, [c("8H"), c("2D")], 0, 0), mano(1, [c("8C"), c("5S"), c("4H")], 1, 0)] });
    const guion = guionDelLote(
      [{ tipo: "mano_dividida", jugadorId: 1, casilla: 0, indice: 0 }, reparte(1, 0, c("2D")), reparte(1, 1, c("5S")), reparte(1, 1, c("4H"))],
      v,
    );
    expect([...guion.cartas.keys()]).toEqual([claveCarta(3, 1, 0, 1), claveCarta(3, 1, 1, 1), claveCarta(3, 1, 1, 2)]);
  });

  it("dividir dos veces seguidas en un mismo lote: las manos se renumeran en cada división", () => {
    // 8-8 se divide en A=[8,x] y B=[8,y]; A (con otro 8) vuelve a dividirse en A1=[8,z] y A2=[8,w]; B queda al final.
    const v = vista({ manos: [mano(1, [c("8H"), c("2D")], 0, 0), mano(1, [c("8S"), c("3D")], 1, 0), mano(1, [c("8C"), c("5S")], 2, 0)] });
    const guion = guionDelLote(
      [
        { tipo: "mano_dividida", jugadorId: 1, casilla: 0, indice: 0 },
        reparte(1, 0, c("8S")),
        reparte(1, 1, c("5S")),
        { tipo: "mano_dividida", jugadorId: 1, casilla: 0, indice: 0 },
        reparte(1, 0, c("2D")),
        reparte(1, 1, c("3D")),
      ],
      v,
    );
    // Las dos primeras cartas fueron a las manos 0 y 1 de entonces, pero la segunda división movió la primera de ellas (el 8 que
    // acababa de llegar a la mano 0 es ahora la primera de la 1) y corrió la mano 1 a la 2: cada carta lleva la clave con la que acaba.
    expect([...guion.cartas.keys()]).toEqual([claveCarta(3, 1, 1, 0), claveCarta(3, 1, 2, 1), claveCarta(3, 1, 0, 1), claveCarta(3, 1, 1, 1)]);
  });
});

describe("claves de carta al dividir", () => {
  it("partesDeClave devuelve lo que puso claveCarta, también para la banca", () => {
    expect(partesDeClave(claveCarta(7, 12, 2, 3))).toEqual({ ronda: 7, de: 12, mano: 2, indice: 3 });
    expect(partesDeClave(claveCarta(7, "banca", 0, 1))).toEqual({ ronda: 7, de: "banca", mano: 0, indice: 1 });
    expect(partesDeClave("basura")).toBeNull();
  });

  it("claveTrasDividir: la segunda carta de la mano que se divide pasa a ser la primera de la nueva, y las manos de detrás se corren una", () => {
    const division = { jugadorId: 1, indice: 1 };
    // Manos de delante y la primera carta de la que se divide: no cambian.
    expect(claveTrasDividir(claveCarta(3, 1, 0, 1), division)).toBe(claveCarta(3, 1, 0, 1));
    expect(claveTrasDividir(claveCarta(3, 1, 1, 0), division)).toBe(claveCarta(3, 1, 1, 0));
    // La segunda carta pasa a la mano nueva.
    expect(claveTrasDividir(claveCarta(3, 1, 1, 1), division)).toBe(claveCarta(3, 1, 2, 0));
    // Las de detrás se corren.
    expect(claveTrasDividir(claveCarta(3, 1, 2, 0), division)).toBe(claveCarta(3, 1, 3, 0));
    expect(claveTrasDividir(claveCarta(3, 1, 2, 1), division)).toBe(claveCarta(3, 1, 3, 1));
    // Otro jugador y la banca no cambian.
    expect(claveTrasDividir(claveCarta(3, 2, 1, 1), division)).toBe(claveCarta(3, 2, 1, 1));
    expect(claveTrasDividir(claveCarta(3, "banca", 0, 1), division)).toBe(claveCarta(3, "banca", 0, 1));
  });
});

describe("encolarGuion", () => {
  // Reparto de tres cartas (0, 260 y 520 ms; termina a los 1.000) y, por separado, una carta pedida.
  const reparto = guionDelLote(
    [
      { tipo: "carta_repartida", a: 1, oculta: false, carta: c("10H") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("6S") },
      { tipo: "carta_repartida", a: 1, oculta: false, carta: c("9C") },
    ],
    vista({ banca: [c("6S")], manos: [mano(1, [c("10H"), c("9C")])] }),
  );
  const pedida = guionDelLote([{ tipo: "carta_repartida", a: 2, oculta: false, carta: c("5D") }], vista({ manos: [mano(2, [c("KD"), c("2S"), c("5D")])] }));

  it("un lote que llega con el reparto en marcha sale detrás de la última carta, sin adelantarla", () => {
    expect(reparto.fin).toBe(520 + VUELO_MS);
    const guion = encolarGuion(reparto, 300, pedida);
    expect([...guion.cartas]).toEqual([
      [claveCarta(3, 1, 0, 0), 0],
      [claveCarta(3, "banca", 0, 0), 260],
      [claveCarta(3, 1, 0, 1), 520],
      [claveCarta(3, 2, 0, 2), reparto.fin],
    ]);
    expect(guion.fin).toBe(reparto.fin + VUELO_MS);
  });

  it("las cartas que ya han aterrizado se olvidan (cuentan como en su sitio); sin reparto en marcha, la nueva sale ya", () => {
    const aMedias = encolarGuion(reparto, 900, pedida);
    expect([...aMedias.cartas]).toEqual([
      [claveCarta(3, 1, 0, 1), 520],
      [claveCarta(3, 2, 0, 2), reparto.fin],
    ]);
    const acabado = encolarGuion(reparto, 1500, pedida);
    expect([...acabado.cartas]).toEqual([[claveCarta(3, 2, 0, 2), 1500]]);
    expect(acabado.fin).toBe(1500 + VUELO_MS);
  });

  it("el giro de la tapada se conserva mientras dura y se desplaza con su lote", () => {
    const banca = guionDelLote([{ tipo: "carta_girada", carta: c("10D") }], vista({ fase: "resultado", banca: [c("6S"), c("10D")] }));
    expect(encolarGuion(banca, 200, pedida).giro).toBe(0);
    expect(encolarGuion(banca, GIRO_MS + 50, pedida).giro).toBeNull();
    expect(encolarGuion(reparto, 300, banca).giro).toBe(reparto.fin);
  });
});

describe("sumarGeneraciones", () => {
  const guionCon = (...claves: string[]) => ({ cartas: new Map(claves.map((clave, i) => [clave, i * ESCALONADO_MS])), giro: null, fin: 0 });

  it("cada reparto suma una generación a la clave: la carta que vuelve a repartirse con una clave ya usada es una carta nueva", () => {
    // El reparto: la segunda carta de la mano 0 sale por primera vez.
    const reparto = sumarGeneraciones(new Map(), guionCon(claveCarta(3, 1, 0, 0), claveCarta(3, 1, 0, 1)));
    expect(reparto.get(claveCarta(3, 1, 0, 1))).toBe(1);
    // Al dividir, la nueva segunda carta de esa mano vuelve a llevar esa clave: otra generación; la primera, que no se reparte, sigue como estaba.
    const dividida = sumarGeneraciones(reparto, guionCon(claveCarta(3, 1, 0, 1), claveCarta(3, 1, 1, 1)));
    expect(dividida.get(claveCarta(3, 1, 0, 1))).toBe(2);
    expect(dividida.get(claveCarta(3, 1, 0, 0))).toBe(1);
    expect(dividida.get(claveCarta(3, 1, 1, 1))).toBe(1);
  });

  it("un guion sin cartas (solo el giro) no cambia nada, y las claves de rondas anteriores se olvidan", () => {
    const previas = sumarGeneraciones(new Map(), guionCon(claveCarta(3, 1, 0, 0)));
    expect(sumarGeneraciones(previas, { cartas: new Map(), giro: 0, fin: GIRO_MS })).toBe(previas);
    const siguiente = sumarGeneraciones(previas, guionCon(claveCarta(4, 1, 0, 0)));
    expect([...siguiente.keys()]).toEqual([claveCarta(4, 1, 0, 0)]);
  });
});

describe("totalVisible", () => {
  it("suma solo las cartas que ya se ven, con el as como 11 si cabe", () => {
    expect(totalVisible([c("AS"), c("6D"), c("9C")], () => true)).toBe(16);
    expect(totalVisible([c("AS"), c("6D"), c("9C")], (i) => i < 2)).toBe(17);
  });

  it("la carta tapada no cuenta y, si no se ve ninguna, no hay total", () => {
    expect(totalVisible([c("KH"), null], () => true)).toBe(10);
    expect(totalVisible([c("KH"), c("7S")], () => false)).toBeNull();
    expect(totalVisible([], () => true)).toBeNull();
  });
});
