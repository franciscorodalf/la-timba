import { describe, expect, it } from "vitest";
import { BJ, blackjack, opcionesDe, type EstadoBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import { cs } from "../ayudas";
import { asiento, estado, exito, faseVista, mano, rng, T0, zapato } from "./ayudas-blackjack";

const ANA = asiento(1, "ana");
const BETO = asiento(2, "beto");

/** Una mano como la guardaba el blackjack antes de las casillas: sin `casilla`, `indice` ni `dividida`. */
const manoVieja = (jugadorId: number, apodo: string, cartas: string, parcial: Record<string, unknown> = {}) => ({
  jugadorId,
  apodo,
  apuesta: 50,
  cartas: cs(cartas),
  estado: "jugando",
  doblada: false,
  abandonada: false,
  ...parcial,
});

/** Un estado como el que guardaban las mesas ya desplegadas: sin `seguros` ni `bancaMirada`, y con manos sin casilla. */
function estadoViejo(parcial: Record<string, unknown> = {}): EstadoBJ {
  const { seguros: _seguros, bancaMirada: _bancaMirada, ...base } = estado();
  return { ...base, ...parcial } as unknown as EstadoBJ;
}

const normalizar = (e: EstadoBJ) => blackjack.normalizar!(e);

describe("blackjack.normalizar: estados guardados antes de las casillas, el seguro y dividir", () => {
  it("las mesas ya desplegadas guardan manos sin casilla, indice ni dividida, y un estado sin seguros ni bancaMirada: todo se rellena", () => {
    const viejo = estadoViejo({
      ronda: 7,
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      zapato: zapato("KS 2C"),
      banca: cs("9C 7D"),
      asientos: [ANA, BETO],
      manos: [manoVieja(1, "ana", "10S 8H"), manoVieja(2, "beto", "10H 9H", { apuesta: 20, estado: "plantado" })],
      ventanasVacias: 1,
    });
    const antes = structuredClone(viejo);

    const nuevo = normalizar(viejo);

    expect(nuevo).toEqual({
      ronda: 7,
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      zapato: zapato("KS 2C"),
      banca: cs("9C 7D"),
      asientos: [ANA, BETO],
      manos: [
        { jugadorId: 1, apodo: "ana", casilla: 0, indice: 0, apuesta: 50, cartas: cs("10S 8H"), estado: "jugando", doblada: false, dividida: false, abandonada: false },
        { jugadorId: 2, apodo: "beto", casilla: 1, indice: 0, apuesta: 20, cartas: cs("10H 9H"), estado: "plantado", doblada: false, dividida: false, abandonada: false },
      ],
      seguros: [],
      bancaMirada: false,
      ventanasVacias: 1,
    });
    expect(viejo).toEqual(antes); // no muta el estado que le llega
  });

  it("las casillas se asignan por orden de aparición y una mano abandonada o doblada conserva todo lo suyo", () => {
    const viejo = estadoViejo({
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      banca: cs("9C 7D"),
      asientos: [ANA, BETO, asiento(3, "carla", false)],
      manos: [
        manoVieja(3, "carla", "10S 2S", { estado: "plantado", abandonada: true }),
        manoVieja(1, "ana", "5S 6H KH", { apuesta: 100, estado: "plantado", doblada: true }),
        manoVieja(2, "beto", "AS KH", { estado: "blackjack" }),
      ],
    });

    const manos = normalizar(viejo).manos;

    expect(manos.map((m) => [m.jugadorId, m.casilla, m.indice, m.dividida])).toEqual([
      [3, 0, 0, false],
      [1, 1, 0, false],
      [2, 2, 0, false],
    ]);
    expect(manos[0]).toMatchObject({ abandonada: true, estado: "plantado" });
    expect(manos[1]).toMatchObject({ apuesta: 100, doblada: true, cartas: cs("5S 6H KH") });
  });

  it("un jugador con varias manos viejas (no debería haberlas) las ordena por aparición: casillas distintas e indices 0, 1…", () => {
    const viejo = estadoViejo({
      fase: "apuestas",
      finFase: T0 + BJ.APUESTAS_MS,
      asientos: [ANA, BETO],
      manos: [manoVieja(1, "ana", "", { estado: "jugando" }), manoVieja(2, "beto", ""), manoVieja(1, "ana", "", { apuesta: 30 })],
    });

    expect(normalizar(viejo).manos.map((m) => [m.jugadorId, m.casilla, m.indice])).toEqual([
      [1, 0, 0],
      [2, 1, 0],
      [1, 2, 1],
    ]);
  });

  it("si ya hay manos con casilla, las que faltan toman la casilla libre más baja y las que la tienen la conservan", () => {
    const viejo = estadoViejo({
      fase: "apuestas",
      finFase: T0 + BJ.APUESTAS_MS,
      asientos: [ANA, BETO],
      manos: [manoVieja(1, "ana", ""), manoVieja(2, "beto", "", { casilla: 0, indice: 0, dividida: false })],
    });

    expect(normalizar(viejo).manos.map((m) => [m.jugadorId, m.casilla, m.indice])).toEqual([
      [1, 1, 0],
      [2, 0, 0],
    ]);
  });

  it("un estado actual queda igual (idempotente): conserva casillas, divisiones y seguros", () => {
    const actual = estado({
      fase: "decisiones",
      finFase: T0 + BJ.DECISIONES_MS,
      banca: cs("AD 6D"),
      asientos: [ANA],
      manos: [
        mano(1, "ana", { casilla: 0, indice: 0, cartas: cs("8S 3D"), dividida: true }),
        mano(1, "ana", { casilla: 0, indice: 1, cartas: cs("8H KC"), dividida: true }),
        mano(1, "ana", { casilla: 3, indice: 2, cartas: cs("5S 6H") }),
      ],
      seguros: [{ jugadorId: 1, cantidad: 40, respondido: true }],
      bancaMirada: true,
    });
    const antes = structuredClone(actual);

    expect(normalizar(actual)).toEqual(antes);
    expect(normalizar(normalizar(actual))).toEqual(antes);
    expect(actual).toEqual(antes);
  });

  it("una mesa dormida o en apuestas, sin manos, también se normaliza", () => {
    for (const fase of ["esperando", "apuestas"] as const) {
      const nuevo = normalizar(estadoViejo({ fase, finFase: fase === "esperando" ? null : T0 + BJ.APUESTAS_MS, asientos: [ANA] }));
      expect(nuevo.manos, fase).toEqual([]);
      expect(nuevo.seguros, fase).toEqual([]);
      expect(nuevo.bancaMirada, fase).toBe(false);
    }
  });
});

describe("blackjack.normalizar: la ronda sigue sobre el estado normalizado", () => {
  it("decisiones: vista, opciones y coste funcionan, y plantarse, la banca y la liquidación acaban como antes", () => {
    // ana 10♠ 8♥ = 18 y beto 10♥ 9♥ = 19; banca 9♣ 7♦ = 16, pide K♠ y se pasa: los dos cobran el doble.
    const e = normalizar(
      estadoViejo({
        fase: "decisiones",
        finFase: T0 + BJ.DECISIONES_MS,
        zapato: zapato("KS"),
        banca: cs("9C 7D"),
        asientos: [ANA, BETO],
        manos: [manoVieja(1, "ana", "10S 8H"), manoVieja(2, "beto", "10H 9H", { apuesta: 20 })],
      }),
    );

    const vista = blackjack.vista(e, 1, T0) as VistaBJ;
    expect(vista).toMatchObject({ fase: "decisiones", banca: [{ valor: "9", palo: "C" }, null], yo: 1, miSeguro: null, casillasLibres: BJ.CASILLAS - 2 });
    expect(vista.manos.map((m) => [m.jugadorId, m.casilla, m.indice, m.total])).toEqual([
      [1, 0, 0, 18],
      [2, 1, 0, 19],
    ]);
    expect(opcionesDe(e, 1)).toEqual({ pedir: true, plantarse: true, doblar: true, dividir: false, rendirse: true, seguro: null });
    expect(blackjack.costo(e, 2, { t: "doblar" })).toBe(20);

    const ana = exito(blackjack.aplicar(e, 1, { t: "plantarse" }, T0, rng));
    const ambos = exito(blackjack.aplicar(ana.estado, 2, { t: "plantarse" }, T0, rng));
    expect(faseVista(ambos.estado, T0).fase).toBe("banca");
    expect(faseVista(ambos.estado, T0 + BJ.BANCA_MS).fase).toBe("resultado");
    expect(ambos.liquidacion).toEqual({
      ronda: 1,
      filas: [
        { jugadorId: 1, apuesta: 50, pago: 100 },
        { jugadorId: 2, apuesta: 20, pago: 40 },
      ],
      visibleEn: T0 + BJ.BANCA_MS,
    });
  });

  it("apuestas: se apuesta (segunda casilla incluida), se reparte y se abre el seguro con un as", () => {
    const e = normalizar(
      estadoViejo({
        fase: "apuestas",
        finFase: T0 + BJ.APUESTAS_MS,
        zapato: zapato("8S 5S AD 8H 6H 6D"),
        asientos: [ANA, BETO],
        manos: [manoVieja(1, "ana", "")],
      }),
    );

    const conSegunda = exito(blackjack.aplicar(e, 1, { t: "apostar", cantidad: 30, segunda: true }, T0, rng)).estado;
    expect(conSegunda.manos.map((m) => [m.jugadorId, m.casilla, m.indice, m.apuesta])).toEqual([
      [1, 0, 0, 50],
      [1, 1, 1, 30],
    ]);
    const repartido = exito(blackjack.tick(conSegunda, T0 + BJ.APUESTAS_MS, rng)).estado;
    expect(repartido).toMatchObject({ fase: "seguro" });
    expect(opcionesDe(repartido, 1).seguro).toBe(40); // la mitad de 50 + 30
  });
});
