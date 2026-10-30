import { describe, expect, it } from "vitest";
import { textoEstado } from "../../src/client/pantallas/blackjack/controles";
import type { Carta } from "../../src/shared/cartas";
import type { VistaBJ } from "../../src/shared/juegos/blackjack";

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Carta["palo"], valor: texto.slice(0, -1) as Carta["valor"] });
const mano = (estado: VistaBJ["manos"][number]["estado"], cartas: Carta[]): VistaBJ["manos"][number] => ({ jugadorId: 1, apodo: "Yo", casilla: 0, indice: 0, apuesta: 50, cartas, estado, doblada: false, dividida: false, total: 0 });
const vista = (fase: VistaBJ["fase"]): VistaBJ => ({ ronda: 1, fase, finFase: 0, banca: [], totalBanca: null, manos: [], sentados: ["Yo"], yo: 1, opciones: null, miSeguro: null, casillasLibres: 7 });

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

  it("el resto de fases no dependen de tus cartas", () => {
    expect(textoEstado(vista("esperando"), undefined, true)).toBe("Apuesta para empezar la ronda");
    expect(textoEstado(vista("apuestas"), undefined, true)).toBe("Haz tu apuesta");
    expect(textoEstado(vista("decisiones"), undefined, true)).toBe("Miras esta ronda");
    expect(textoEstado(vista("banca"), mano("plantado", [c("10S"), c("8D")]), false)).toBe("Juega la banca");
  });
});
