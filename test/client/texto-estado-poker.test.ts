import { describe, expect, it } from "vitest";
import { textoEstado } from "../../src/client/pantallas/poker/controles";
import type { AsientoVista, VistaPoker } from "../../src/shared/juegos/poker";

const asiento = (n: number, resto: Partial<AsientoVista> = {}): AsientoVista => ({
  asiento: n,
  jugadorId: n + 1,
  apodo: `J${n + 1}`,
  fichas: 1000,
  apostado: 0,
  estado: "juega",
  conectado: true,
  boton: false,
  tieneCartas: true,
  cartas: null,
  ...resto,
});

/** Una mesa en la que eres el jugador 1 (asiento 0) y hay otro rival. */
const vista = (resto: Partial<VistaPoker> = {}, yo: Partial<AsientoVista> = {}): VistaPoker => ({
  ronda: 1,
  fase: "mano",
  calle: "flop",
  finFase: null,
  mesa: [],
  botes: [],
  turno: 2,
  asientos: [asiento(0, yo), asiento(1)],
  asientosLibres: 6,
  yo: 1,
  misCartas: null,
  opciones: null,
  porEntrar: 0,
  ...resto,
});

describe("textoEstado del póker", () => {
  it("sin vista, entra en la mesa", () => {
    expect(textoEstado(null)).toBe("Entrando en la mesa…");
  });

  it("quien mira lo lee, con o sin asientos libres", () => {
    expect(textoEstado(vista({ yo: null, asientos: [asiento(1)] }))).toBe("Estás mirando. Siéntate para jugar");
    expect(textoEstado(vista({ yo: null, asientos: [asiento(1)], asientosLibres: 0 }))).toBe("La mesa está completa. Estás mirando");
  });

  it("sentado, sigue la fase: esperando rivales, resultado y mano siguiente", () => {
    expect(textoEstado(vista({ fase: "esperando", turno: null }))).toBe("Esperando rivales");
    expect(textoEstado(vista({ fase: "resultado", turno: null }))).toBe("Nueva mano en");
    expect(textoEstado(vista({}, { estado: "fuera", tieneCartas: false }))).toBe("Juegas en la mano siguiente");
  });

  it("en la mano, dice a quién le toca; si te toca a ti, «Tu turno»", () => {
    expect(textoEstado(vista({ turno: 1 }))).toBe("Tu turno");
    expect(textoEstado(vista({ turno: 2 }))).toBe("Habla J2");
    expect(textoEstado(vista({ turno: null }))).toBe("Se reparte la mano");
  });

  it("retirado, lo dice mientras los demás siguen", () => {
    expect(textoEstado(vista({ turno: 2 }, { estado: "retirado", tieneCartas: false }))).toBe("Te has retirado de esta mano");
  });
});
