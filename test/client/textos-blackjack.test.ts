import { describe, expect, it } from "vitest";
import { textoEstado } from "../../src/client/pantallas/blackjack/controles";
import type { Carta } from "../../src/shared/cartas";
import type { VistaBJ } from "../../src/shared/juegos/blackjack";

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Carta["palo"], valor: texto.slice(0, -1) as Carta["valor"] });
const mano = (estado: VistaBJ["manos"][number]["estado"], cartas: Carta[]): VistaBJ["manos"][number] => ({ jugadorId: 1, apodo: "Yo", casilla: 0, indice: 0, apuesta: 50, cartas, estado, doblada: false, dividida: false, total: 0 });
const vista = (fase: VistaBJ["fase"], seguro: number | null = null): VistaBJ => ({
  ronda: 1,
  fase,
  finFase: 0,
  banca: [],
  totalBanca: null,
  manos: [],
  sentados: ["Yo"],
  yo: 1,
  opciones: seguro === null ? null : { pedir: false, plantarse: false, doblar: false, dividir: false, rendirse: false, seguro },
  miSeguro: null,
  casillasLibres: 7,
});

describe("textoEstado", () => {
  it("mientras tus cartas aún vuelan no adelanta el desenlace: ni blackjack, ni pasarse, ni tu turno", () => {
    expect(textoEstado(vista("decisiones"), mano("blackjack", [c("AS"), c("KD")]), false)).toBe("Repartiendo…");
    expect(textoEstado(vista("decisiones"), mano("pasado", [c("10S"), c("6D"), c("KC")]), false)).toBe("Repartiendo…");
    expect(textoEstado(vista("decisiones"), mano("jugando", [c("10S"), c("6D")]), false)).toBe("Repartiendo…");
  });

  it("con tus cartas ya en la mesa, cuenta cómo va tu mano", () => {
    expect(textoEstado(vista("decisiones"), mano("blackjack", [c("AS"), c("KD")]), true)).toBe("¡Blackjack! Esperando al resto");
    expect(textoEstado(vista("decisiones"), mano("pasado", [c("10S"), c("6D"), c("KC")]), true)).toBe("Te has pasado. Esperando al resto");
    expect(textoEstado(vista("decisiones"), mano("jugando", [c("10S"), c("6D")]), true)).toBe("Tu turno: ¿pides o te plantas?");
  });

  it("rendirse y varias manos: la mano rendida lo cuenta; con varias manos ya jugadas solo espera, y mientras alguna juega, es tu turno", () => {
    expect(textoEstado(vista("decisiones"), mano("rendido", [c("10S"), c("6D")]), true)).toBe("Te has rendido. Esperando al resto");
    // Con varias manos, `mano` es la que juega (o, si ya no juega ninguna, la última) y el último argumento dice cuántas son.
    expect(textoEstado(vista("decisiones"), mano("jugando", [c("8S"), c("6D")]), true, 3)).toBe("Tu turno: ¿pides o te plantas?");
    expect(textoEstado(vista("decisiones"), mano("pasado", [c("10S"), c("6D"), c("KC")]), true, 2)).toBe("Esperando al resto");
    expect(textoEstado(vista("decisiones"), mano("rendido", [c("10S"), c("6D")]), true, 2)).toBe("Esperando al resto");
    expect(textoEstado(vista("decisiones"), mano("jugando", [c("8S"), c("6D")]), false, 2)).toBe("Repartiendo…");
  });

  it("en la fase de seguro el estado pide decidir el seguro, y al contestar dice que esperas a los demás", () => {
    const jugando = mano("jugando", [c("10S"), c("6D")]);
    expect(textoEstado(vista("seguro", 50), jugando, true)).toBe("La banca enseña un as. ¿Seguro por 50?");
    expect(textoEstado(vista("seguro", 1250), jugando, true)).toBe("La banca enseña un as. ¿Seguro por 1.250?");
    // Contestado (o sin nada que ofrecer: `opciones.seguro` es `null`), solo queda esperar.
    expect(textoEstado(vista("seguro", null), jugando, true)).toBe("Esperando a los demás…");
    // Mientras las cartas aún vuelan no se pregunta nada que no se vea, y sin manos solo se mira.
    expect(textoEstado(vista("seguro", 50), jugando, false)).toBe("Repartiendo…");
    expect(textoEstado(vista("seguro", null), undefined, true)).toBe("Miras esta ronda");
  });

  it("mientras la banca mira su carta, el estado lo dice, sea cual sea la fase a la que pasa la mesa", () => {
    const jugando = mano("jugando", [c("10S"), c("6D")]);
    for (const fase of ["seguro", "decisiones", "resultado"] as const) expect(textoEstado(vista(fase), jugando, true, 1, true)).toBe("La banca mira su carta…");
    expect(textoEstado(vista("decisiones"), jugando, true, 1, false)).toBe("Tu turno: ¿pides o te plantas?");
  });

  it("el resto de fases no dependen de tus cartas", () => {
    expect(textoEstado(vista("esperando"), undefined, true)).toBe("Apuesta para empezar la ronda");
    expect(textoEstado(vista("apuestas"), undefined, true)).toBe("Haz tu apuesta");
    expect(textoEstado(vista("decisiones"), undefined, true)).toBe("Miras esta ronda");
    expect(textoEstado(vista("banca"), mano("plantado", [c("10S"), c("8D")]), false)).toBe("Juega la banca");
  });
});
