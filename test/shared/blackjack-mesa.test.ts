import { describe, expect, it } from "vitest";
import { crearBaraja } from "../../src/shared/cartas";
import { blackjack, BJ, type AccionBJ, type EstadoBJ, type VistaBJ } from "../../src/shared/juegos/blackjack";
import type { Paso } from "../../src/shared/juegos/tipos";
import { c, cs, rngFijo } from "../ayudas";
import { alVerseLaBanca, asiento, error, estado, exito, faseVista, mano, RELLENO, rng, T0, zapato } from "./ayudas-blackjack";

function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const v of Object.values(valor)) congelar(v);
  }
  return valor;
}

const SIN_OPCIONES = { pedir: false, plantarse: false, doblar: false, dividir: false, rendirse: false, seguro: null };

/** Un jugador con 10♠ 9♥ contra 10♣ 6♦ en decisiones; siguiente carta del zapato: 9♠. */
const enDecisiones = (parcial: Partial<EstadoBJ> = {}) =>
  estado({
    fase: "decisiones",
    finFase: T0 + BJ.DECISIONES_MS,
    asientos: [asiento(1, "ana")],
    banca: cs("10C 6D"),
    zapato: zapato("9S 2H 3D"),
    manos: [mano(1, "ana", { cartas: cs("10S 9H") })],
    ...parcial,
  });

/** Dos jugadores en decisiones: ana 10♠ 9♥, beto 8♠ 8♥. */
const dosEnDecisiones = () =>
  enDecisiones({
    asientos: [asiento(1, "ana"), asiento(2, "beto")],
    manos: [mano(1, "ana", { cartas: cs("10S 9H") }), mano(2, "beto", { casilla: 1, cartas: cs("8S 8H") })],
  });

describe("crear, sentar y apuestas", () => {
  it("identidad y límite de jugadores", () => {
    expect(blackjack.id).toBe("blackjack");
    expect(blackjack.maxJugadores).toBe(6);
  });

  it("crear deja la mesa en espera con un zapato de 6 barajas barajado con el rng dado", () => {
    const e = blackjack.crear(T0, rngFijo(0.3));
    expect(e).toMatchObject({ ronda: 1, fase: "esperando", finFase: null, banca: [], asientos: [], manos: [], ventanasVacias: 0 });
    expect(e.zapato).toHaveLength(312);
    expect(e.zapato).not.toEqual(crearBaraja(6));
    expect(blackjack.crear(T0, rngFijo(0.3)).zapato).toEqual(e.zapato);
  });

  it("sentarse en mesa vacía abre apuestas 15 s", () => {
    const e = blackjack.crear(T0, rng);
    const p = exito(blackjack.sentar(e, 1, "ana", T0));
    expect(p.estado.fase).toBe("apuestas");
    expect(p.estado.finFase).toBe(T0 + 15_000);
    expect(p.estado.asientos).toEqual([{ jugadorId: 1, apodo: "ana", conectado: true }]);
    expect(p.eventos).toEqual([]);
    expect(e.fase).toBe("esperando"); // la entrada no se muta
  });

  it("un segundo jugador no reinicia la ventana de apuestas", () => {
    const e = exito(blackjack.sentar(blackjack.crear(T0, rng), 1, "ana", T0)).estado;
    const p = exito(blackjack.sentar(e, 2, "beto", T0 + 5_000));
    expect(p.estado.finFase).toBe(T0 + 15_000);
    expect(p.estado.asientos.map((a) => a.apodo)).toEqual(["ana", "beto"]);
  });

  it("rechaza el séptimo jugador con mesa_llena", () => {
    const seis = Array.from({ length: 6 }, (_, i) => asiento(i + 1, `jugador${i + 1}`));
    const e = estado({ fase: "apuestas", finFase: T0 + 15_000, asientos: seis });
    expect(error(blackjack.sentar(e, 7, "septimo", T0))).toBe("mesa_llena");
    // quien ya está sentado en una mesa llena no es un séptimo
    expect(blackjack.sentar(e, 3, "jugador3", T0).ok).toBe(true);
  });

  it("sentar es idempotente para el mismo jugador", () => {
    const e = exito(blackjack.sentar(blackjack.crear(T0, rng), 1, "ana", T0)).estado;
    const p = exito(blackjack.sentar(e, 1, "ana", T0 + 100));
    expect(p.estado.asientos).toHaveLength(1);
    expect(p.estado).toEqual(e);
    expect(p.eventos).toEqual([]);
  });

  it("sentar de nuevo a quien estaba desconectado lo vuelve a conectar", () => {
    const e = estado({ fase: "apuestas", finFase: T0 + 15_000, asientos: [asiento(1, "ana", false)] });
    const p = exito(blackjack.sentar(e, 1, "ana", T0));
    expect(p.estado.asientos).toEqual([asiento(1, "ana", true)]);
    expect(p.estado.fase).toBe("apuestas");
  });

  it("apostar fuera de fase → fase_incorrecta; cantidad 9 → apuesta_invalida; dos veces → accion_invalida", () => {
    const decisiones = enDecisiones();
    expect(error(blackjack.aplicar(decisiones, 1, { t: "apostar", cantidad: 50 }, T0, rng))).toBe("fase_incorrecta");

    const e = exito(blackjack.sentar(blackjack.crear(T0, rng), 1, "ana", T0)).estado;
    expect(error(blackjack.aplicar(e, 1, { t: "apostar", cantidad: 9 }, T0, rng))).toBe("apuesta_invalida");
    const apostado = exito(blackjack.aplicar(e, 1, { t: "apostar", cantidad: 50 }, T0, rng)).estado;
    expect(error(blackjack.aplicar(apostado, 1, { t: "apostar", cantidad: 50 }, T0, rng))).toBe("accion_invalida");
  });

  it("las cantidades raras son apuesta_invalida y no crean mano", () => {
    const e = exito(blackjack.sentar(blackjack.crear(T0, rng), 1, "ana", T0)).estado;
    for (const cantidad of [0, -10, 9, 50.5, NaN, Infinity, "50", null, undefined]) {
      const accion = { t: "apostar", cantidad } as unknown as AccionBJ;
      expect(error(blackjack.aplicar(e, 1, accion, T0, rng))).toBe("apuesta_invalida");
    }
    expect(e.manos).toEqual([]);
  });

  it("apostar crea una mano vacía con el mínimo y el máximo permitidos", () => {
    const e = exito(blackjack.sentar(blackjack.crear(T0, rng), 1, "ana", T0)).estado;
    const p = exito(blackjack.aplicar(e, 1, { t: "apostar", cantidad: 10 }, T0, rng));
    expect(p.estado.manos).toEqual([mano(1, "ana", { apuesta: 10 })]);
    expect(p.eventos).toEqual([]);
    expect(p.estado.fase).toBe("apuestas");
    const e2 = exito(blackjack.sentar(e, 2, "beto", T0)).estado;
    expect(exito(blackjack.aplicar(e2, 2, { t: "apostar", cantidad: 500 }, T0, rng)).estado.manos[0].apuesta).toBe(500);
  });

  it("actuar sin estar sentado → no_sentado", () => {
    const e = enDecisiones();
    const acciones: AccionBJ[] = [
      { t: "apostar", cantidad: 50 },
      { t: "pedir" },
      { t: "plantarse" },
      { t: "doblar" },
      { t: "salir" },
    ];
    for (const accion of acciones) expect(error(blackjack.aplicar(e, 99, accion, T0, rng))).toBe("no_sentado");
  });

  it("una acción desconocida es mensaje_invalido", () => {
    const e = enDecisiones();
    expect(error(blackjack.aplicar(e, 1, { t: "baile" } as unknown as AccionBJ, T0, rng))).toBe("mensaje_invalido");
  });
});

describe("reparto", () => {
  const apuestas = (parcial: Partial<EstadoBJ> = {}) =>
    estado({
      fase: "apuestas",
      finFase: T0 + BJ.APUESTAS_MS,
      asientos: [asiento(1, "ana")],
      manos: [mano(1, "ana")],
      // la banca enseña un 8: ni mira su carta ni abre el seguro (eso lo prueban los tests del seguro)
      zapato: zapato("10S 8C 9H 6D 9S"),
      ...parcial,
    });

  it("tick antes de finFase no cambia nada", () => {
    const e = apuestas();
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS - 1, rng));
    expect(p.eventos).toEqual([]);
    expect(p.estado).toEqual(e);
    expect(p.liquidacion).toBeUndefined();
  });

  it("tick en una mesa en espera no hace nada", () => {
    const e = estado();
    const p = exito(blackjack.tick(e, T0 + 10 ** 9, rng));
    expect(p.estado).toEqual(e);
    expect(p.eventos).toEqual([]);
  });

  it("reparte 2+2 y pasa a decisiones", () => {
    const e = apuestas();
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(p.eventos).toEqual([
      { tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("10S") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("8C") },
      { tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("9H") },
      { tipo: "carta_repartida", a: "banca", oculta: true },
    ]);
    expect(p.eventos[3]).not.toHaveProperty("carta");
    expect(p.estado.fase).toBe("decisiones");
    expect(p.estado.finFase).toBe(T0 + BJ.APUESTAS_MS + BJ.DECISIONES_MS);
    expect(p.estado.manos[0].cartas).toEqual(cs("10S 9H"));
    expect(p.estado.manos[0].estado).toBe("jugando");
    expect(p.estado.banca).toEqual(cs("8C 6D"));
    expect(p.estado.zapato).toEqual(zapato("9S"));
  });

  it("con varios jugadores reparte una carta a cada uno, luego a la banca, y repite", () => {
    const e = apuestas({
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      manos: [mano(1, "ana"), mano(2, "beto")],
      zapato: zapato("2S 3S 4S 5S 6S 7S"),
    });
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(p.eventos.map((ev) => [ev.a, ev.oculta])).toEqual([
      [1, false],
      [2, false],
      ["banca", false],
      [1, false],
      [2, false],
      ["banca", true],
    ]);
    expect(p.estado.manos.map((m) => m.cartas)).toEqual([cs("2S 5S"), cs("3S 6S")]);
    expect(p.estado.banca).toEqual(cs("4S 7S"));
  });

  it("los eventos nunca contienen el zapato ni la carta tapada", () => {
    const p = exito(blackjack.tick(apuestas(), T0 + BJ.APUESTAS_MS, rng));
    expect(JSON.stringify(p.eventos)).not.toContain("zapato");
    expect(JSON.stringify(p.eventos)).not.toContain(JSON.stringify(c("6D")));
  });

  it("blackjack natural queda resuelto sin decidir", () => {
    const e = apuestas({ zapato: zapato("AS 10C KH 6D") });
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(p.estado.manos[0].estado).toBe("blackjack");
    // nadie tiene que decidir: juega la banca, que se ve durante BANCA_MS
    expect(faseVista(p.estado, T0 + BJ.APUESTAS_MS)).toEqual({ fase: "banca", finFase: T0 + BJ.APUESTAS_MS + BJ.BANCA_MS });
    expect(p.liquidacion?.visibleEn).toBe(T0 + BJ.APUESTAS_MS + BJ.BANCA_MS);
    const pedir = blackjack.aplicar(p.estado, 1, { t: "pedir" }, T0, rng);
    expect(error(pedir)).toBe("fase_incorrecta");
  });

  it("un blackjack no frena al resto: la ronda sigue en decisiones y la mano resuelta no puede actuar", () => {
    const e = apuestas({
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      manos: [mano(1, "ana"), mano(2, "beto")],
      zapato: zapato("AS 8S 10C KH 8H 6D"),
    });
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(p.estado.fase).toBe("decisiones");
    expect(p.estado.manos.map((m) => m.estado)).toEqual(["blackjack", "jugando"]);
    expect(error(blackjack.aplicar(p.estado, 1, { t: "pedir" }, T0, rng))).toBe("accion_invalida");
  });

  it("el blackjack natural paga 3:2 y el empate de blackjacks devuelve la apuesta", () => {
    // Nadie decide: la banca juega en el mismo reparto, que trae la liquidación.
    const e = apuestas({ zapato: zapato("AS 9C KH 7D") });
    const reparto = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(reparto.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 50, pago: 125 }], visibleEn: T0 + BJ.APUESTAS_MS + BJ.BANCA_MS });

    // Con el as de la banca hay seguro; al vencer, la banca mira, tiene blackjack y la ronda acaba ya.
    const empate = apuestas({ zapato: zapato("AS AC KH KD") });
    const r2 = exito(blackjack.tick(empate, T0 + BJ.APUESTAS_MS, rng)).estado;
    expect(exito(blackjack.tick(r2, r2.finFase!, rng)).liquidacion?.filas[0].pago).toBe(50);
  });

  it("los jugadores desconectados antes del reparto se plantan solos", () => {
    const e = apuestas({ asientos: [asiento(1, "ana", false)] });
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(p.estado.manos[0].estado).toBe("plantado");
    expect(p.estado.manos[0].cartas).toEqual(cs("10S 9H"));
    expect(faseVista(p.estado, T0 + BJ.APUESTAS_MS).fase).toBe("banca");
  });

  it("una mano abandonada antes del reparto no recibe cartas y paga 0", () => {
    const e = apuestas({
      asientos: [asiento(2, "beto")],
      manos: [mano(1, "ana", { abandonada: true, estado: "plantado" }), mano(2, "beto")],
      zapato: zapato("10S 10C 9H 6D 9S"),
    });
    const reparto = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(reparto.estado.manos[0].cartas).toEqual([]);
    expect(reparto.estado.manos[1].cartas).toEqual(cs("10S 9H"));
    expect(reparto.eventos.filter((ev) => ev.a === 1)).toEqual([]);

    const final = exito(blackjack.aplicar(reparto.estado, 2, { t: "plantarse" }, T0, rng));
    expect(final.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 50, pago: 0 },
      { jugadorId: 2, apuesta: 50, pago: 100 },
    ]);
  });

  it("si solo hay manos abandonadas no se reparte nada y se liquida en la banca", () => {
    const e = apuestas({
      asientos: [asiento(2, "beto")],
      manos: [mano(1, "ana", { abandonada: true, estado: "plantado" })],
    });
    const reparto = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(reparto.eventos).toEqual([]);
    expect(reparto.estado.banca).toEqual([]);
    expect(reparto.estado.zapato).toEqual(e.zapato);
    expect(faseVista(reparto.estado, T0 + BJ.APUESTAS_MS).fase).toBe("banca");
    expect(alVerseLaBanca(reparto)).toEqual([{ tipo: "pago", jugadorId: 1, neto: -50 }]);
    expect(reparto.liquidacion?.filas).toEqual([{ jugadorId: 1, apuesta: 50, pago: 0 }]);
  });

  it("sin apuestas abre otra ventana de apuestas sin avanzar la ronda", () => {
    const e = apuestas({ manos: [] });
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS + 7, rng));
    expect(p.estado.fase).toBe("apuestas");
    expect(p.estado.finFase).toBe(T0 + BJ.APUESTAS_MS + 7 + BJ.APUESTAS_MS);
    expect(p.estado.ronda).toBe(1);
    expect(p.estado.ventanasVacias).toBe(1);
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toBeUndefined();
  });

  it("sin apuestas y con todos desconectados la mesa vuelve a esperar, sin alarma", () => {
    const e = apuestas({ manos: [], asientos: [asiento(1, "ana", false)] });
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(p.estado.asientos).toEqual([]);
    expect(p.estado.fase).toBe("esperando");
    expect(p.estado.finFase).toBeNull();
    expect(blackjack.proximaAlarma(p.estado)).toBeNull();
  });

  it("sin apuestas se retiran los desconectados pero la mesa sigue si queda alguien conectado", () => {
    const e = apuestas({ manos: [], asientos: [asiento(1, "ana", false), asiento(2, "beto")] });
    const p = exito(blackjack.tick(e, T0 + BJ.APUESTAS_MS, rng));
    expect(p.estado.asientos).toEqual([asiento(2, "beto")]);
    expect(p.estado.fase).toBe("apuestas");
  });
});

describe("mesa ociosa", () => {
  const ociosa = () => exito(blackjack.sentar(blackjack.crear(T0, rng), 1, "ana", T0)).estado;

  it("tres ventanas de apuestas vacías seguidas duermen la mesa: esperando, sin alarma, con los asientos", () => {
    let e = ociosa();
    let ahora = T0;
    for (const esperadas of [1, 2]) {
      ahora = e.finFase!;
      e = exito(blackjack.tick(e, ahora, rng)).estado;
      expect(e.fase).toBe("apuestas");
      expect(e.ventanasVacias).toBe(esperadas);
      expect(e.finFase).toBe(ahora + BJ.APUESTAS_MS);
    }
    const p = exito(blackjack.tick(e, e.finFase!, rng));
    expect(p.estado.fase).toBe("esperando");
    expect(p.estado.finFase).toBeNull();
    expect(blackjack.proximaAlarma(p.estado)).toBeNull();
    expect(p.estado.asientos).toEqual([asiento(1, "ana")]);
    expect(p.estado.ronda).toBe(1);
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toBeUndefined();
    // y por mucho que pase el tiempo no vuelve a hacer nada
    expect(exito(blackjack.tick(p.estado, T0 + 10 ** 9, rng)).estado).toEqual(p.estado);
  });

  it("apostar un jugador sentado en una mesa dormida reabre las apuestas con esa apuesta", () => {
    const dormida = estado({ asientos: [asiento(1, "ana")], ventanasVacias: 3 });
    const accion: AccionBJ = { t: "apostar", cantidad: 75 };
    expect(blackjack.costo(dormida, 1, accion)).toBe(75);
    const p = exito(blackjack.aplicar(dormida, 1, accion, T0 + 5_000, rng));
    expect(p.estado.fase).toBe("apuestas");
    expect(p.estado.finFase).toBe(T0 + 5_000 + BJ.APUESTAS_MS);
    expect(p.estado.ventanasVacias).toBe(0);
    expect(p.estado.manos).toEqual([mano(1, "ana", { apuesta: 75 })]);
    expect(p.estado.ronda).toBe(1);
    expect(p.eventos).toEqual([]);
    expect(blackjack.proximaAlarma(p.estado)).toBe(T0 + 5_000 + BJ.APUESTAS_MS);
  });

  it("en una mesa dormida solo apostar es válido, y con las mismas reglas de siempre", () => {
    const dormida = estado({ asientos: [asiento(1, "ana")], ventanasVacias: 3 });
    for (const accion of [{ t: "pedir" }, { t: "plantarse" }, { t: "doblar" }] as AccionBJ[]) {
      expect(error(blackjack.aplicar(dormida, 1, accion, T0, rng))).toBe("fase_incorrecta");
    }
    expect(error(blackjack.aplicar(dormida, 1, { t: "apostar", cantidad: 9 }, T0, rng))).toBe("apuesta_invalida");
    expect(error(blackjack.aplicar(dormida, 2, { t: "apostar", cantidad: 50 }, T0, rng))).toBe("no_sentado");
  });

  it("sentarse en una mesa dormida (también quien ya estaba sentado) abre una ventana nueva y reinicia el contador", () => {
    const dormida = estado({ asientos: [asiento(1, "ana")], ventanasVacias: 3 });
    const nuevo = exito(blackjack.sentar(dormida, 2, "beto", T0 + 1_000)).estado;
    expect(nuevo).toMatchObject({ fase: "apuestas", finFase: T0 + 1_000 + BJ.APUESTAS_MS, ventanasVacias: 0 });
    expect(nuevo.asientos.map((a) => a.jugadorId)).toEqual([1, 2]);

    const mismo = exito(blackjack.sentar(dormida, 1, "ana", T0 + 2_000)).estado;
    expect(mismo).toMatchObject({ fase: "apuestas", finFase: T0 + 2_000 + BJ.APUESTAS_MS, ventanasVacias: 0 });
    expect(mismo.asientos).toEqual([asiento(1, "ana")]);
  });

  it("una apuesta en una ventana reinicia el contador: hacen falta otras tres ventanas vacías para dormir", () => {
    let e = ociosa();
    e = exito(blackjack.tick(e, e.finFase!, rng)).estado; // vacía 1
    e = exito(blackjack.tick(e, e.finFase!, rng)).estado; // vacía 2
    expect(e.ventanasVacias).toBe(2);
    e = exito(blackjack.aplicar(e, 1, { t: "apostar", cantidad: 50 }, e.finFase! - 1_000, rng)).estado;
    e = exito(blackjack.tick(e, e.finFase!, rng)).estado; // reparte
    expect(e.fase).toBe("decisiones");
    expect(e.ventanasVacias).toBe(0);
    e = exito(blackjack.aplicar(e, 1, { t: "plantarse" }, e.finFase! - 1_000, rng)).estado; // juega la banca
    e = exito(blackjack.tick(e, e.finFase!, rng)).estado; // resultado → ronda 2
    expect(e).toMatchObject({ ronda: 2, fase: "apuestas", ventanasVacias: 0 });
    for (const esperadas of [1, 2]) {
      e = exito(blackjack.tick(e, e.finFase!, rng)).estado;
      expect(e).toMatchObject({ fase: "apuestas", ventanasVacias: esperadas });
    }
    e = exito(blackjack.tick(e, e.finFase!, rng)).estado;
    expect(e).toMatchObject({ fase: "esperando", finFase: null });
  });

  it("una ventana vacía con la mesa ya sin nadie conectado no cuenta: esperando con el contador a 0", () => {
    const e = estado({ fase: "apuestas", finFase: T0, asientos: [asiento(1, "ana", false)], ventanasVacias: 2 });
    const p = exito(blackjack.tick(e, T0, rng));
    expect(p.estado).toMatchObject({ fase: "esperando", finFase: null, asientos: [], ventanasVacias: 0 });
  });

  it("desconectarse de una mesa dormida libera el asiento; salir también", () => {
    const dormida = estado({ asientos: [asiento(1, "ana"), asiento(2, "beto")], ventanasVacias: 3 });
    const sin1 = exito(blackjack.desconectar(dormida, 1, T0, rng));
    expect(sin1.estado.asientos).toEqual([asiento(2, "beto")]);
    expect(sin1.estado).toMatchObject({ fase: "esperando", finFase: null });
    const sin2 = exito(blackjack.aplicar(sin1.estado, 2, { t: "salir" }, T0, rng));
    expect(sin2.estado).toMatchObject({ fase: "esperando", finFase: null, asientos: [], manos: [] });
    expect(sin2.liquidacion).toBeUndefined();
  });
});

describe("decisiones", () => {
  it("pedir da una carta visible; pasarse de 21 deja la mano en pasado", () => {
    const e = enDecisiones({ zapato: zapato("2C KD") });
    const p1 = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rng));
    expect(p1.estado.manos[0].cartas).toEqual(cs("10S 9H 2C"));
    expect(p1.estado.manos[0].estado).toBe("jugando"); // 21 todavía se puede seguir pidiendo
    expect(p1.eventos).toEqual([{ tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("2C") }]);
    expect(p1.estado.fase).toBe("decisiones");

    const p2 = exito(blackjack.aplicar(p1.estado, 1, { t: "pedir" }, T0 + 10, rng));
    expect(p2.estado.manos[0].estado).toBe("pasado");
    expect(faseVista(p2.estado, T0 + 10)).toEqual({ fase: "banca", finFase: T0 + 10 + BJ.BANCA_MS }); // nadie más decide
  });

  it("plantarse deja la mano en plantado", () => {
    const p = exito(blackjack.aplicar(dosEnDecisiones(), 1, { t: "plantarse" }, T0, rng));
    expect(p.estado.manos[0].estado).toBe("plantado");
    expect(p.estado.manos[1].estado).toBe("jugando");
    expect(p.estado.fase).toBe("decisiones");
    expect(p.eventos).toEqual([]);
  });

  it("cuando todos se plantan pasa a banca sin esperar el tiempo", () => {
    const e = dosEnDecisiones();
    const p1 = exito(blackjack.aplicar(e, 1, { t: "plantarse" }, T0 + 2_000, rng));
    expect(p1.estado.fase).toBe("decisiones");
    expect(p1.estado.finFase).toBe(e.finFase); // el reloj no se toca
    const p2 = exito(blackjack.aplicar(p1.estado, 2, { t: "plantarse" }, T0 + 3_000, rng));
    expect(faseVista(p2.estado, T0 + 3_000)).toEqual({ fase: "banca", finFase: T0 + 3_000 + BJ.BANCA_MS });
  });

  it("tiempo agotado planta las manos que quedan", () => {
    const e = dosEnDecisiones();
    const p1 = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rng)).estado;
    const antes = blackjack.tick(p1, e.finFase! - 1, rng);
    expect(exito(antes).estado.fase).toBe("decisiones");
    const p = exito(blackjack.tick(p1, e.finFase!, rng));
    // ana ya se había pasado con el 9♠ que pidió; beto no decidió y se planta solo
    expect(p.estado.manos.map((m) => m.estado)).toEqual(["pasado", "plantado"]);
    expect(faseVista(p.estado, e.finFase!)).toEqual({ fase: "banca", finFase: e.finFase! + BJ.BANCA_MS });
  });

  it("pedir, plantarse y doblar fuera de decisiones → fase_incorrecta", () => {
    const e = enDecisiones({ fase: "apuestas" });
    for (const accion of [{ t: "pedir" }, { t: "plantarse" }, { t: "doblar" }] as AccionBJ[]) {
      expect(error(blackjack.aplicar(e, 1, accion, T0, rng))).toBe("fase_incorrecta");
    }
  });

  it("sin mano en esta ronda o con la mano ya resuelta → accion_invalida", () => {
    const e = enDecisiones({
      asientos: [asiento(1, "ana"), asiento(2, "beto"), asiento(3, "carla")],
      manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" }), mano(3, "carla", { cartas: cs("AS KH"), estado: "blackjack" })],
    });
    for (const accion of [{ t: "pedir" }, { t: "plantarse" }, { t: "doblar" }] as AccionBJ[]) {
      expect(error(blackjack.aplicar(e, 2, accion, T0, rng))).toBe("accion_invalida"); // sentado sin mano
      expect(error(blackjack.aplicar(e, 1, accion, T0, rng))).toBe("accion_invalida"); // plantado
      expect(error(blackjack.aplicar(e, 3, accion, T0, rng))).toBe("accion_invalida"); // blackjack
    }
  });

  it("pasarse y volver a pedir → accion_invalida", () => {
    const e = enDecisiones({ asientos: [asiento(1, "ana"), asiento(2, "beto")], manos: [mano(1, "ana", { cartas: cs("10S 9H") }), mano(2, "beto", { cartas: cs("8S 8H") })], zapato: zapato("KD 2C") });
    const pasado = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rng)).estado;
    expect(pasado.manos[0].estado).toBe("pasado");
    expect(error(blackjack.aplicar(pasado, 1, { t: "pedir" }, T0, rng))).toBe("accion_invalida");
  });

  it("doblar cuesta la apuesta, da una carta y planta", () => {
    const e = enDecisiones({ manos: [mano(1, "ana", { cartas: cs("5S 6H"), apuesta: 50 })], zapato: zapato("9S 2H") });
    expect(blackjack.costo(e, 1, { t: "doblar" })).toBe(50);
    const p = exito(blackjack.aplicar(e, 1, { t: "doblar" }, T0, rng));
    const m = p.estado.manos[0];
    expect(m.apuesta).toBe(100);
    expect(m.doblada).toBe(true);
    expect(m.cartas).toEqual(cs("5S 6H 9S"));
    expect(m.estado).toBe("plantado");
    expect(p.eventos).toEqual([{ tipo: "carta_repartida", a: 1, mano: 0, oculta: false, carta: c("9S") }]);
    expect(faseVista(p.estado, T0).fase).toBe("banca");
  });

  it("doblar y pasarse deja la mano en pasado", () => {
    const e = enDecisiones({ zapato: zapato("KD") });
    const m = exito(blackjack.aplicar(e, 1, { t: "doblar" }, T0, rng)).estado.manos[0];
    expect(m.estado).toBe("pasado");
    expect(m.apuesta).toBe(100);
  });

  it("doblar con 3 cartas → accion_invalida", () => {
    const e = enDecisiones({ zapato: zapato("2C 3D") });
    const tres = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rng)).estado;
    expect(error(blackjack.aplicar(tres, 1, { t: "doblar" }, T0, rng))).toBe("accion_invalida");
  });

  it("la mano doblada liquida con la apuesta total: gana 200 sobre 100", () => {
    const e = enDecisiones({ manos: [mano(1, "ana", { cartas: cs("5S 6H") })], zapato: zapato("9S 9C") });
    const p = exito(blackjack.aplicar(e, 1, { t: "doblar" }, T0, rng)); // 20 contra 10C 6D + 9C
    expect(p.liquidacion?.filas).toEqual([{ jugadorId: 1, apuesta: 100, pago: 200 }]);
    expect(alVerseLaBanca(p).at(-1)).toEqual({ tipo: "pago", jugadorId: 1, neto: 100 });
  });
});

describe("banca y liquidación", () => {
  const partidaFija = () => {
    const apuestas = estado({
      fase: "apuestas",
      finFase: T0 + BJ.APUESTAS_MS,
      asientos: [asiento(1, "ana")],
      manos: [mano(1, "ana", { apuesta: 50 })],
      zapato: zapato("10S 10C 9H 6D 9S"),
    });
    const reparto = exito(blackjack.tick(apuestas, T0 + BJ.APUESTAS_MS, rng)).estado;
    // El último que decide cierra la ronda: la banca juega en ese mismo cambio.
    return exito(blackjack.aplicar(reparto, 1, { t: "plantarse" }, T0 + 20_000, rng));
  };
  const REVELA = T0 + 20_000 + BJ.BANCA_MS;

  it("la banca pide hasta 17 y liquida al cerrarse las decisiones, aunque lo que juega se vea después", () => {
    const p = partidaFija();
    expect(p.estado.banca).toEqual(cs("10C 6D 9S")); // 25
    expect(p.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 50, pago: 100 }], visibleEn: REVELA });
    // El cierre no enseña nada de la banca: eso lo anuncia el reloj al verse.
    expect(p.eventos).toEqual([]);
    expect(alVerseLaBanca(p)).toEqual([
      { tipo: "carta_girada", carta: c("6D") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("9S") },
      { tipo: "pago", jugadorId: 1, neto: 50 },
    ]);
    expect(p.estado.fase).toBe("resultado");
    expect(p.estado.finFase).toBe(REVELA + BJ.RESULTADO_MS);
  });

  it("hasta que se ve la jugada de la banca, el tick no cambia nada y la vista enseña solo su carta visible", () => {
    const { estado: e } = partidaFija();
    const p = exito(blackjack.tick(e, REVELA - 1, rng));
    expect(p.estado).toBe(e);
    expect(p.liquidacion).toBeUndefined();
    const v = blackjack.vista(e, 1, REVELA - 1) as VistaBJ;
    expect(v).toMatchObject({ fase: "banca", finFase: REVELA, banca: [c("10C"), null], totalBanca: 10 });
    // Ni la tapada ni la que ha pedido salen del servidor (tampoco cuántas son).
    for (const carta of cs("6D 9S")) expect(JSON.stringify(v)).not.toContain(JSON.stringify(carta));
    expect(blackjack.vista(e, 1, REVELA)).toMatchObject({ fase: "resultado", finFase: REVELA + BJ.RESULTADO_MS, banca: cs("10C 6D 9S"), totalBanca: 25 });
  });

  it("la banca se planta en cualquier 17, también en blando, y no pide de más", () => {
    for (const cartas of ["10C 7D", "AC 6D", "10C KD"]) {
      const e = enDecisiones({ banca: cs(cartas), manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })], fase: "banca", finFase: T0 });
      const p = exito(blackjack.tick(e, T0, rng));
      expect(p.estado.banca).toEqual(cs(cartas));
      expect(p.estado.zapato).toEqual(e.zapato);
    }
  });

  it("la banca sigue pidiendo mientras tenga menos de 17", () => {
    const e = enDecisiones({
      fase: "banca",
      finFase: T0,
      banca: cs("2C 3D"),
      zapato: zapato("5S 4S 6S 9H"),
      manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })],
    });
    const p = exito(blackjack.tick(e, T0, rng));
    expect(p.estado.banca).toEqual(cs("2C 3D 5S 4S 6S")); // 5 → 10 → 14 → 20; se planta
    expect(p.eventos.filter((ev) => ev.tipo === "carta_repartida")).toHaveLength(3);
  });

  it("si todas las manos se pasaron la banca no pide", () => {
    const e = enDecisiones({
      fase: "banca",
      finFase: T0,
      banca: cs("10C 2D"),
      manos: [mano(1, "ana", { cartas: cs("10S 9H KD"), estado: "pasado" })],
    });
    const p = exito(blackjack.tick(e, T0, rng));
    expect(p.estado.banca).toEqual(cs("10C 2D"));
    expect(p.estado.zapato).toEqual(e.zapato);
    expect(p.liquidacion?.filas).toEqual([{ jugadorId: 1, apuesta: 50, pago: 0 }]);
    expect(p.eventos).toEqual([{ tipo: "carta_girada", carta: c("2D") }, { tipo: "pago", jugadorId: 1, neto: -50 }]);
  });

  it("una mano abandonada no obliga a la banca a pedir", () => {
    const e = enDecisiones({
      fase: "banca",
      finFase: T0,
      banca: cs("10C 2D"),
      asientos: [asiento(2, "beto")],
      manos: [
        mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado", abandonada: true }),
        mano(2, "beto", { cartas: cs("10S 9H KD"), estado: "pasado" }),
      ],
    });
    expect(exito(blackjack.tick(e, T0, rng)).estado.banca).toEqual(cs("10C 2D"));
  });

  it("empate devuelve la apuesta y perder no devuelve nada; hay un evento pago por mano", () => {
    const e = enDecisiones({
      fase: "banca",
      finFase: T0,
      banca: cs("10C 9D"),
      asientos: [asiento(1, "ana"), asiento(2, "beto"), asiento(3, "carla")],
      manos: [
        mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado", apuesta: 40 }),
        mano(2, "beto", { cartas: cs("10S 8H"), estado: "plantado", apuesta: 60 }),
        mano(3, "carla", { cartas: cs("10S QH"), estado: "plantado", apuesta: 100 }),
      ],
    });
    const p = exito(blackjack.tick(e, T0, rng));
    expect(p.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 40, pago: 40 },
      { jugadorId: 2, apuesta: 60, pago: 0 },
      { jugadorId: 3, apuesta: 100, pago: 200 },
    ]);
    expect(p.eventos.filter((ev) => ev.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: 1, neto: 0 },
      { tipo: "pago", jugadorId: 2, neto: -60 },
      { tipo: "pago", jugadorId: 3, neto: 100 },
    ]);
  });

  it("la liquidación lleva el número de la ronda en curso", () => {
    const e = enDecisiones({ ronda: 7, fase: "banca", finFase: T0, manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })] });
    expect(exito(blackjack.tick(e, T0, rng)).liquidacion?.ronda).toBe(7);
  });
});

describe("la banca y la ronda siguiente las trae el reloj", () => {
  // ana y beto (desconectado) se plantan con 19 y 16 contra 10♣ 6♦: la banca pide 9♠ y se pasa. Cierra beto en CIERRE.
  const CIERRE = T0 + 3_000;
  const REVELA = CIERRE + BJ.BANCA_MS;
  const NUEVA = REVELA + BJ.RESULTADO_MS;
  const cerrada = (parcial: Partial<EstadoBJ> = {}) => {
    const e = enDecisiones({
      asientos: [asiento(1, "ana"), asiento(2, "beto"), asiento(3, "carla", false)],
      manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" }), mano(2, "beto", { casilla: 1, cartas: cs("10H 6H") })],
      ...parcial,
    });
    return exito(blackjack.aplicar(e, 2, { t: "plantarse" }, CIERRE, rng));
  };

  it("el cierre guarda la ronda jugada y liquidada, sin eventos de la banca; la liquidación se ve en REVELA", () => {
    const p = cerrada();
    expect(p.estado).toMatchObject({ fase: "resultado", finFase: NUEVA, banca: cs("10C 6D 9S") });
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toEqual({
      ronda: 1,
      filas: [
        { jugadorId: 1, apuesta: 50, pago: 100 },
        { jugadorId: 2, apuesta: 50, pago: 100 },
      ],
      visibleEn: REVELA,
    });
  });

  it("proximoAviso: primero la jugada de la banca, luego la ronda siguiente, y nada más", () => {
    const { estado: e } = cerrada();
    expect(blackjack.proximoAviso!(e, CIERRE)).toBe(REVELA);
    expect(blackjack.proximoAviso!(e, REVELA)).toBe(NUEVA);
    expect(blackjack.proximoAviso!(e, NUEVA)).toBeNull();
    // fuera de `resultado`, nada que anunciar
    expect(blackjack.proximoAviso!(enDecisiones(), T0)).toBeNull();
  });

  it("eventosEntre: en REVELA la carta girada, las que pide la banca y los pagos; en NUEVA, nada si no hay que rebarajar", () => {
    const { estado: e } = cerrada();
    const banca = [
      { tipo: "carta_girada", carta: c("6D") },
      { tipo: "carta_repartida", a: "banca", oculta: false, carta: c("9S") },
      { tipo: "pago", jugadorId: 1, neto: 50 },
      { tipo: "pago", jugadorId: 2, neto: 50 },
    ];
    expect(blackjack.eventosEntre!(e, CIERRE, REVELA)).toEqual(banca);
    expect(blackjack.eventosEntre!(e, CIERRE, REVELA - 1)).toEqual([]);
    expect(blackjack.eventosEntre!(e, REVELA, NUEVA)).toEqual([]);
    expect(blackjack.eventosEntre!(e, CIERRE, NUEVA)).toEqual(banca);
    // con el zapato corto, la ronda nueva rebaraja: se anuncia a su hora
    const corto = { ...e, zapato: RELLENO.slice(0, BJ.MIN_ZAPATO - 1) };
    expect(blackjack.eventosEntre!(corto, REVELA, NUEVA)).toEqual([{ tipo: "barajado" }]);
  });

  it("la vista cambia con la hora: la banca con la carta tapada, el resultado y la ronda siguiente", () => {
    const { estado: e } = cerrada();
    const banca = blackjack.vista(e, 1, REVELA - 1) as VistaBJ;
    expect(banca).toMatchObject({ ronda: 1, fase: "banca", finFase: REVELA, banca: [c("10C"), null], totalBanca: 10, opciones: SIN_OPCIONES });
    for (const carta of cs("6D 9S")) expect(JSON.stringify(banca)).not.toContain(JSON.stringify(carta));

    const resultado = blackjack.vista(e, 1, REVELA) as VistaBJ;
    expect(resultado).toMatchObject({ ronda: 1, fase: "resultado", finFase: NUEVA, banca: cs("10C 6D 9S"), totalBanca: 25 });
    expect(resultado.manos).toHaveLength(2);

    // la ronda siguiente, sin la desconectada y con la mesa limpia; igual que la que deja el tick
    const nueva = blackjack.vista(e, 1, NUEVA) as VistaBJ;
    expect(nueva).toMatchObject({ ronda: 2, fase: "apuestas", finFase: NUEVA + BJ.APUESTAS_MS, banca: [], manos: [], sentados: ["ana", "beto"], totalBanca: null, miSeguro: null });
    const tick = exito(blackjack.tick(e, NUEVA, rng));
    expect(blackjack.vista(tick.estado, 1, NUEVA)).toEqual(nueva);
    expect(blackjack.vista(e, 1, NUEVA + 5_000)).toEqual(blackjack.vista(tick.estado, 1, NUEVA + 5_000));
  });

  it("el tick no cambia nada hasta NUEVA; entonces abre la ronda siguiente ya anunciada, sin nada que pagar", () => {
    const { estado: e } = cerrada();
    for (const ahora of [CIERRE, REVELA, NUEVA - 1]) expect(exito(blackjack.tick(e, ahora, rng)).estado).toBe(e);
    const p = exito(blackjack.tick(e, NUEVA + 2_000, rng));
    expect(p.anunciado).toBe(true);
    expect(p.liquidacion).toBeUndefined();
    expect(p.estado).toMatchObject({ ronda: 2, fase: "apuestas", finFase: NUEVA + BJ.APUESTAS_MS, manos: [], seguros: [], banca: [], bancaMirada: false });
    expect(p.estado.asientos).toEqual([asiento(1, "ana"), asiento(2, "beto")]);
  });

  it("si también ha vencido la ventana siguiente (nadie apostó), el tick la cierra y eso sí es un cambio que guardar", () => {
    const { estado: e } = cerrada();
    const p = exito(blackjack.tick(e, NUEVA + BJ.APUESTAS_MS + 500, rng));
    expect(p.anunciado).toBeUndefined();
    expect(p.estado).toMatchObject({ ronda: 2, fase: "apuestas", ventanasVacias: 1, finFase: NUEVA + BJ.APUESTAS_MS + 500 + BJ.APUESTAS_MS });
    // sin nadie conectado la ronda siguiente ya es la mesa dormida: el tick la aplica igual, sin más
    const sola = cerrada({ asientos: [asiento(1, "ana", false), asiento(2, "beto")] });
    const sinNadie = exito(blackjack.desconectar(sola.estado, 2, CIERRE + 100, rng)).estado;
    const dormida = exito(blackjack.tick(sinNadie, NUEVA + 10 ** 6, rng));
    expect(dormida.anunciado).toBe(true);
    expect(dormida.estado).toMatchObject({ ronda: 2, fase: "esperando", finFase: null, asientos: [] });
  });

  it("el tick que rebaraja al abrir la ronda siguiente también es anunciado: el zapato no se ve", () => {
    const { estado: e } = cerrada();
    const p = exito(blackjack.tick({ ...e, zapato: RELLENO.slice(0, 10) }, NUEVA, rngFijo(0.2)));
    expect(p.anunciado).toBe(true);
    expect(p.eventos).toEqual([{ tipo: "barajado" }]);
    expect(p.estado.zapato).toHaveLength(312);
  });

  it("la alarma de respaldo es el fin de la ventana siguiente; el resumen sigue a la vista", () => {
    const { estado: e } = cerrada();
    expect(blackjack.proximaAlarma(e)).toBe(NUEVA + BJ.APUESTAS_MS);
    expect(blackjack.resumen(e, REVELA - 1)).toEqual({ jugadores: ["ana", "beto", "carla"], fase: "banca", finFase: null });
    expect(blackjack.resumen(e, REVELA)).toEqual({ jugadores: ["ana", "beto", "carla"], fase: "resultado", finFase: NUEVA });
    expect(blackjack.resumen(e, NUEVA)).toEqual({ jugadores: ["ana", "beto"], fase: "apuestas", finFase: NUEVA + BJ.APUESTAS_MS });
  });

  it("con blackjack de la banca al mirar, todo se ve al momento: los eventos van en el paso y no hay nada que anunciar", () => {
    // ana 10♠ 9♥ contra K♣ y A♦ tapada: la banca mira al repartir y la ronda acaba ya
    const e = estado({ fase: "apuestas", finFase: T0, asientos: [asiento(1, "ana")], manos: [mano(1, "ana")], zapato: zapato("10S KC 9H AD") });
    const p = exito(blackjack.tick(e, T0, rng));
    expect(p.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 50, pago: 0 }] });
    expect(p.eventos.slice(-3)).toEqual([{ tipo: "banca_mira", blackjack: true }, { tipo: "carta_girada", carta: c("AD") }, { tipo: "pago", jugadorId: 1, neto: -50 }]);
    expect(p.estado).toMatchObject({ fase: "resultado", finFase: T0 + BJ.RESULTADO_MS });
    expect(blackjack.vista(p.estado, 1, T0)).toMatchObject({ fase: "resultado", banca: cs("KC AD") });
    // lo que ya trajo el paso no se repite: desde su instante solo queda la ronda siguiente
    expect(blackjack.proximoAviso!(p.estado, T0)).toBe(T0 + BJ.RESULTADO_MS);
  });
});

describe("salir y desconectar", () => {
  it("salir a mitad de ronda pierde: pago 0", () => {
    const e = dosEnDecisiones();
    const sale = exito(blackjack.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(sale.estado.asientos.map((a) => a.jugadorId)).toEqual([2]);
    expect(sale.estado.manos[0]).toMatchObject({ jugadorId: 1, abandonada: true, estado: "plantado" });
    expect(sale.estado.fase).toBe("decisiones");
    expect(sale.liquidacion).toBeUndefined();

    // beto se planta con 16; la banca (10C 6D + 9S) se pasa: beto gana, ana (que se fue con 19) no cobra
    const final = exito(blackjack.aplicar(sale.estado, 2, { t: "plantarse" }, T0, rng));
    expect(final.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 50, pago: 0 },
      { jugadorId: 2, apuesta: 50, pago: 100 },
    ]);
  });

  it("salir con la última mano en juego cierra las decisiones", () => {
    const e = dosEnDecisiones();
    const parcial = exito(blackjack.aplicar(e, 1, { t: "plantarse" }, T0, rng)).estado;
    const p = exito(blackjack.aplicar(parcial, 2, { t: "salir" }, T0 + 4_000, rng));
    expect(faseVista(p.estado, T0 + 4_000)).toEqual({ fase: "banca", finFase: T0 + 4_000 + BJ.BANCA_MS });
    expect(p.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 50, pago: 100 },
      { jugadorId: 2, apuesta: 50, pago: 0 },
    ]);
  });

  it("salir sin mano solo libera el asiento", () => {
    const e = enDecisiones({ asientos: [asiento(1, "ana"), asiento(2, "beto")] });
    const p = exito(blackjack.aplicar(e, 2, { t: "salir" }, T0, rng));
    expect(p.estado.asientos.map((a) => a.jugadorId)).toEqual([1]);
    expect(p.estado.manos).toEqual(e.manos);
    expect(p.estado.fase).toBe("decisiones");
  });

  it("salir tras apostar, antes del reparto, deja la apuesta perdida", () => {
    const e = estado({
      fase: "apuestas",
      finFase: T0 + BJ.APUESTAS_MS,
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      manos: [mano(1, "ana")],
    });
    const p = exito(blackjack.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.estado.manos[0]).toMatchObject({ abandonada: true, estado: "plantado", cartas: [] });
    expect(p.estado.fase).toBe("apuestas");
  });

  it("salir tras resolverse la ronda no marca la mano como abandonada (ya está liquidada)", () => {
    const e = estado({
      fase: "resultado",
      finFase: T0,
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      banca: cs("10C 9D"),
      manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })],
    });
    const p = exito(blackjack.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.estado.manos[0].abandonada).toBe(false);
    expect(p.estado.asientos.map((a) => a.jugadorId)).toEqual([2]);
    expect(p.liquidacion).toBeUndefined();
  });

  it("quien sale y vuelve a sentarse no puede apostar otra vez en la misma ronda", () => {
    const e = estado({
      fase: "apuestas",
      finFase: T0 + BJ.APUESTAS_MS,
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      manos: [mano(1, "ana")],
    });
    const fuera = exito(blackjack.aplicar(e, 1, { t: "salir" }, T0, rng)).estado;
    const dentro = exito(blackjack.sentar(fuera, 1, "ana", T0 + 100)).estado;
    expect(error(blackjack.aplicar(dentro, 1, { t: "apostar", cantidad: 50 }, T0 + 100, rng))).toBe("accion_invalida");
    expect(error(blackjack.aplicar(dentro, 1, { t: "pedir" }, T0 + 100, rng))).toBe("fase_incorrecta");
  });

  it("si se va el último jugador a mitad de ronda se liquida de inmediato y la mesa queda sin alarma", () => {
    const e = enDecisiones();
    const p = exito(blackjack.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 50, pago: 0 }] });
    expect(p.eventos).toEqual([{ tipo: "pago", jugadorId: 1, neto: -50 }]);
    expect(p.estado).toMatchObject({ ronda: 2, fase: "esperando", finFase: null, asientos: [], manos: [], banca: [] });
    expect(blackjack.proximaAlarma(p.estado)).toBeNull();
  });

  it("si se va el último jugador en apuestas con una apuesta hecha también se liquida", () => {
    const e = estado({ fase: "apuestas", finFase: T0 + BJ.APUESTAS_MS, asientos: [asiento(1, "ana")], manos: [mano(1, "ana", { apuesta: 80 })] });
    const p = exito(blackjack.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 80, pago: 0 }] });
    expect(p.estado.fase).toBe("esperando");
    expect(blackjack.proximaAlarma(p.estado)).toBeNull();
  });

  it("si se va el último jugador sin apuesta no hay liquidación", () => {
    const e = estado({ fase: "apuestas", finFase: T0 + BJ.APUESTAS_MS, asientos: [asiento(1, "ana")] });
    const p = exito(blackjack.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toBeUndefined();
    expect(p.estado.fase).toBe("esperando");
    expect(p.estado.finFase).toBeNull();
  });

  it("si se va el último jugador durante el resultado la mesa pasa a esperar sin liquidar otra vez", () => {
    const e = estado({
      fase: "resultado",
      finFase: T0,
      asientos: [asiento(1, "ana")],
      banca: cs("10C 9D"),
      manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })],
      zapato: zapato("2S"),
    });
    const p = exito(blackjack.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toBeUndefined();
    expect(p.estado).toMatchObject({ ronda: 2, fase: "esperando", finFase: null, manos: [], banca: [] });
  });

  it("desconectar durante decisiones planta la mano", () => {
    const p = exito(blackjack.desconectar(dosEnDecisiones(), 1, T0, rng));
    expect(p.estado.asientos[0]).toEqual({ jugadorId: 1, apodo: "ana", conectado: false });
    expect(p.estado.manos[0]).toMatchObject({ estado: "plantado", abandonada: false });
    expect(p.estado.fase).toBe("decisiones"); // beto sigue decidiendo
    expect(p.eventos).toEqual([]);
  });

  it("desconectar al último jugador que decide pasa a banca y su mano se resuelve con normalidad", () => {
    const e = enDecisiones();
    const p = exito(blackjack.desconectar(e, 1, T0 + 3_000, rng));
    expect(faseVista(p.estado, T0 + 3_000)).toEqual({ fase: "banca", finFase: T0 + 3_000 + BJ.BANCA_MS });
    expect(p.liquidacion?.filas).toEqual([{ jugadorId: 1, apuesta: 50, pago: 100 }]);
  });

  it("desconectar fuera de decisiones solo marca el asiento", () => {
    const e = estado({ fase: "apuestas", finFase: T0 + BJ.APUESTAS_MS, asientos: [asiento(1, "ana")], manos: [mano(1, "ana")] });
    const p = exito(blackjack.desconectar(e, 1, T0, rng));
    expect(p.estado.asientos[0].conectado).toBe(false);
    expect(p.estado.manos[0].estado).toBe("jugando");
    expect(p.estado.fase).toBe("apuestas");
  });

  it("desconectar a alguien que no está sentado no hace nada", () => {
    const e = enDecisiones();
    const p = exito(blackjack.desconectar(e, 99, T0, rng));
    expect(p.estado).toEqual(e);
    expect(p.eventos).toEqual([]);
  });

  it("volver a sentarse tras desconectar conserva la mano", () => {
    const e = dosEnDecisiones();
    const fuera = exito(blackjack.desconectar(e, 1, T0, rng)).estado;
    const dentro = exito(blackjack.sentar(fuera, 1, "ana", T0 + 1_000)).estado;
    expect(dentro.asientos[0].conectado).toBe(true);
    expect(dentro.manos[0]).toEqual(fuera.manos[0]);
    expect(dentro.asientos).toHaveLength(2);
  });
});

describe("resultado y nueva ronda", () => {
  const resultado = (parcial: Partial<EstadoBJ> = {}) =>
    estado({
      ronda: 3,
      fase: "resultado",
      finFase: T0,
      asientos: [asiento(1, "ana"), asiento(2, "beto", false)],
      banca: cs("10C 9D"),
      manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })],
      zapato: zapato("2S"),
      ...parcial,
    });

  it("el tick de resultado abre la siguiente ronda: limpia, quita desconectados y abre apuestas", () => {
    const p = exito(blackjack.tick(resultado(), T0 + 10, rng));
    expect(p.estado.ronda).toBe(4);
    expect(p.estado.fase).toBe("apuestas");
    // Empieza a su hora (al acabar el resultado), no a la del tick: es la misma que ya enseñaba la vista.
    expect(p.estado.finFase).toBe(T0 + BJ.APUESTAS_MS);
    expect(p.estado.manos).toEqual([]);
    expect(p.estado.banca).toEqual([]);
    expect(p.estado.asientos).toEqual([asiento(1, "ana")]);
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toBeUndefined();
  });

  it("sin asientos conectados la mesa pasa a esperar y no deja alarma", () => {
    const e = resultado({ asientos: [asiento(1, "ana", false)] });
    const p = exito(blackjack.tick(e, T0, rng));
    expect(p.estado.asientos).toEqual([]);
    expect(p.estado.fase).toBe("esperando");
    expect(p.estado.finFase).toBeNull();
    expect(blackjack.proximaAlarma(p.estado)).toBeNull();
    // y volver a sentarse reabre las apuestas
    const de_nuevo = exito(blackjack.sentar(p.estado, 1, "ana", T0 + 5_000));
    expect(de_nuevo.estado.fase).toBe("apuestas");
    expect(de_nuevo.estado.ronda).toBe(4);
    expect(de_nuevo.estado.finFase).toBe(T0 + 5_000 + BJ.APUESTAS_MS);
  });

  it("rebaraja cuando quedan menos de 78 cartas", () => {
    const e = resultado({ zapato: RELLENO.slice(0, 77) });
    const p = exito(blackjack.tick(e, T0, rngFijo(0.2)));
    expect(p.eventos).toEqual([{ tipo: "barajado" }]);
    expect(p.estado.zapato).toHaveLength(312);
    expect(p.estado.zapato).not.toEqual(crearBaraja(6));
  });

  it("con exactamente 78 cartas no rebaraja", () => {
    const e = resultado({ zapato: RELLENO.slice(0, 78) });
    const p = exito(blackjack.tick(e, T0, rng));
    expect(p.eventos).toEqual([]);
    expect(p.estado.zapato).toEqual(e.zapato);
  });

  it("el zapato nunca se rebaraja a mitad de ronda aunque baje de 78", () => {
    const e = enDecisiones({ zapato: zapato("2C").slice(0, 70) });
    const p = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rng));
    expect(p.estado.zapato).toHaveLength(69);
    expect(p.eventos.map((ev) => ev.tipo)).toEqual(["carta_repartida"]);
  });

  it("si el zapato se vacía en plena ronda se baraja uno nuevo en lugar de fallar", () => {
    const e = enDecisiones({ zapato: [] });
    const p = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rngFijo(0.4)));
    expect(p.estado.manos[0].cartas).toHaveLength(3);
    expect(p.estado.zapato).toHaveLength(311);
    expect(p.eventos.map((ev) => ev.tipo)).toEqual(["barajado", "carta_repartida"]);
  });

  it("entrar con la ronda empezada: sentado sin mano, apuesta en la siguiente", () => {
    const e = enDecisiones();
    const dentro = exito(blackjack.sentar(e, 2, "beto", T0 + 1_000)).estado;
    expect(dentro.fase).toBe("decisiones");
    expect(dentro.asientos.map((a) => a.jugadorId)).toEqual([1, 2]);
    expect(dentro.manos.map((m) => m.jugadorId)).toEqual([1]);
    // no puede actuar ni apostar esta ronda
    expect(error(blackjack.aplicar(dentro, 2, { t: "pedir" }, T0, rng))).toBe("accion_invalida");
    expect(error(blackjack.aplicar(dentro, 2, { t: "apostar", cantidad: 50 }, T0, rng))).toBe("fase_incorrecta");
    // la vista propia no tiene mano
    const vista = blackjack.vista(dentro, 2, T0) as VistaBJ;
    expect(vista.yo).toBe(2);
    expect(vista.manos.some((m) => m.jugadorId === 2)).toBe(false);
    expect(vista.sentados).toEqual(["ana", "beto"]);

    // termina la ronda…
    const plantado = exito(blackjack.aplicar(dentro, 1, { t: "plantarse" }, T0 + 2_000, rng)).estado;
    const enResultado = exito(blackjack.tick(plantado, plantado.finFase!, rng)).estado;
    const siguiente = exito(blackjack.tick(enResultado, enResultado.finFase!, rng)).estado;
    // …y en la siguiente ya puede apostar
    expect(siguiente.fase).toBe("apuestas");
    const apostado = exito(blackjack.aplicar(siguiente, 2, { t: "apostar", cantidad: 25 }, T0 + 9_000, rng)).estado;
    expect(apostado.manos).toEqual([mano(2, "beto", { apuesta: 25 })]);
  });

  it("una ronda completa vuelve a abrir apuestas con la ronda siguiente", () => {
    let e = blackjack.crear(T0, rngFijo(0.7));
    e = { ...e, zapato: zapato("10S 10C 9H 6D 9S") };
    e = exito(blackjack.sentar(e, 1, "ana", T0)).estado;
    e = exito(blackjack.aplicar(e, 1, { t: "apostar", cantidad: 50 }, T0 + 1_000, rng)).estado;
    e = exito(blackjack.tick(e, e.finFase!, rng)).estado;
    expect(e.fase).toBe("decisiones");
    const cierre = exito(blackjack.aplicar(e, 1, { t: "plantarse" }, e.finFase! - 5_000, rng));
    expect(faseVista(cierre.estado, e.finFase! - 5_000).fase).toBe("banca");
    expect(cierre.liquidacion?.filas).toEqual([{ jugadorId: 1, apuesta: 50, pago: 100 }]);
    e = exito(blackjack.tick(cierre.estado, cierre.estado.finFase!, rng)).estado;
    expect(e).toMatchObject({ ronda: 2, fase: "apuestas", banca: [], manos: [] });
    expect(e.asientos).toEqual([asiento(1, "ana")]);
  });
});

describe("costo, alarma y resumen", () => {
  it("costo: apostar → cantidad; doblar → apuesta de su mano; el resto 0", () => {
    const e = enDecisiones({ manos: [mano(1, "ana", { cartas: cs("5S 6H"), apuesta: 70 })] });
    expect(blackjack.costo(e, 1, { t: "apostar", cantidad: 250 })).toBe(250);
    expect(blackjack.costo(e, 1, { t: "doblar" })).toBe(70);
    expect(blackjack.costo(e, 1, { t: "pedir" })).toBe(0);
    expect(blackjack.costo(e, 1, { t: "plantarse" })).toBe(0);
    expect(blackjack.costo(e, 1, { t: "salir" })).toBe(0);
  });

  it("costo nunca devuelve una cantidad inválida ni cobra por doblar sin mano", () => {
    const e = enDecisiones();
    for (const cantidad of [-10, 0, 9, 50.5, NaN, Infinity, "50"]) {
      expect(blackjack.costo(e, 1, { t: "apostar", cantidad } as unknown as AccionBJ)).toBe(0);
    }
    expect(blackjack.costo(e, 2, { t: "doblar" })).toBe(0);
  });

  it("costo se calcula sobre el estado anterior: tras doblar la mano ya vale el doble", () => {
    const e = enDecisiones({ manos: [mano(1, "ana", { cartas: cs("5S 6H"), apuesta: 50 })] });
    const antes = blackjack.costo(e, 1, { t: "doblar" });
    const despues = exito(blackjack.aplicar(e, 1, { t: "doblar" }, T0, rng)).estado;
    expect(antes).toBe(50);
    expect(despues.manos[0].apuesta).toBe(2 * antes);
  });

  it("proximaAlarma es finFase y null en esperando; en resultado, el fin de la ventana de apuestas siguiente", () => {
    expect(blackjack.proximaAlarma(estado())).toBeNull();
    expect(blackjack.proximaAlarma(enDecisiones())).toBe(T0 + BJ.DECISIONES_MS);
    // La jugada de la banca y la ronda nueva las enseña el reloj sin cambiar el estado: la alarma es solo por si nadie apuesta.
    expect(blackjack.proximaAlarma(estado({ fase: "resultado", finFase: 42 }))).toBe(42 + BJ.APUESTAS_MS);
  });

  it("resumen lista los apodos sentados, la fase y el fin de fase", () => {
    const e = enDecisiones({ asientos: [asiento(1, "ana"), asiento(2, "beto")] });
    expect(blackjack.resumen(e, T0)).toEqual({ jugadores: ["ana", "beto"], fase: "decisiones", finFase: T0 + BJ.DECISIONES_MS });
    expect(blackjack.resumen(estado(), T0)).toEqual({ jugadores: [], fase: "esperando", finFase: null });
  });

  it("en la banca el resumen no lleva cuenta atrás: dura un instante y la sala no la enseña", () => {
    const e = enDecisiones({ fase: "banca", finFase: T0 + BJ.BANCA_MS });
    expect(blackjack.resumen(e, T0)).toEqual({ jugadores: ["ana"], fase: "banca", finFase: null });
  });
});

describe("vista", () => {
  it("la vista oculta la carta tapada y el zapato", () => {
    const v = blackjack.vista(enDecisiones(), 1, T0) as VistaBJ;
    expect(v.banca[1]).toBeNull();
    expect(JSON.stringify(v)).not.toContain("zapato");
  });

  it("mientras la carta está tapada el total de la banca cuenta solo la visible", () => {
    const e = enDecisiones({ banca: cs("KD 6D") });
    const v = blackjack.vista(e, 1, T0) as VistaBJ;
    expect(v.banca).toEqual([c("KD"), null]);
    expect(v.totalBanca).toBe(10);
    // la carta tapada no se cuela por ningún otro campo
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(c("6D")));
  });

  it("en apuestas, con la banca todavía sin cartas, no hay total", () => {
    const e = estado({ fase: "apuestas", finFase: T0, asientos: [asiento(1, "ana")] });
    const v = blackjack.vista(e, 1, T0) as VistaBJ;
    expect(v.banca).toEqual([]);
    expect(v.totalBanca).toBeNull();
  });

  it("en banca (antes del tick que gira la carta) la carta tapada sigue oculta", () => {
    const v = blackjack.vista(enDecisiones({ fase: "banca", finFase: T0, banca: cs("KD 6D") }), 1, T0) as VistaBJ;
    expect(v.banca).toEqual([c("KD"), null]);
    expect(v.totalBanca).toBe(10);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(c("6D")));
  });

  it("desde resultado las cartas de la banca se ven enteras", () => {
    const v = blackjack.vista(enDecisiones({ fase: "resultado", finFase: T0 + BJ.RESULTADO_MS, banca: cs("KD 6D 5S") }), 1, T0) as VistaBJ;
    expect(v.banca).toEqual(cs("KD 6D 5S"));
    expect(v.totalBanca).toBe(21);
  });

  it("la carta tapada se ve exactamente cuando el tick de banca la gira", () => {
    const antes = enDecisiones({ fase: "banca", finFase: T0, banca: cs("KD 6D"), manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })] });
    expect((blackjack.vista(antes, 1, T0) as VistaBJ).banca[1]).toBeNull();
    const p = exito(blackjack.tick(antes, T0, rng));
    expect(p.eventos[0]).toEqual({ tipo: "carta_girada", carta: c("6D") });
    expect((blackjack.vista(p.estado, 1, T0) as VistaBJ).banca.slice(0, 2)).toEqual(cs("KD 6D"));
  });

  it("incluye las manos de todos con su total y sin el campo abandonada", () => {
    const e = dosEnDecisiones();
    const v = blackjack.vista(e, 2, T0) as VistaBJ;
    expect(v.yo).toBe(2);
    expect(v.ronda).toBe(1);
    expect(v.fase).toBe("decisiones");
    expect(v.finFase).toBe(T0 + BJ.DECISIONES_MS);
    expect(v.sentados).toEqual(["ana", "beto"]);
    expect(v.manos).toEqual([
      { jugadorId: 1, apodo: "ana", casilla: 0, indice: 0, apuesta: 50, cartas: cs("10S 9H"), estado: "jugando", doblada: false, dividida: false, total: 19 },
      { jugadorId: 2, apodo: "beto", casilla: 1, indice: 0, apuesta: 50, cartas: cs("8S 8H"), estado: "jugando", doblada: false, dividida: false, total: 16 },
    ]);
    for (const m of v.manos) expect(m).not.toHaveProperty("abandonada");
  });

  it("la vista de un espectador (null) tiene yo: null y las mismas manos", () => {
    const e = dosEnDecisiones();
    const espectador = blackjack.vista(e, null, T0) as VistaBJ;
    expect(espectador.yo).toBeNull();
    expect(espectador.manos).toEqual((blackjack.vista(e, 1, T0) as VistaBJ).manos);
    expect(espectador.banca[1]).toBeNull();
  });

  it("es JSON serializable y no comparte referencias con el estado", () => {
    const e = dosEnDecisiones();
    const v = blackjack.vista(e, 1, T0) as VistaBJ;
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    v.manos[0].cartas.push(c("2S"));
    v.sentados.push("intruso");
    expect(e.manos[0].cartas).toHaveLength(2);
    expect(e.asientos).toHaveLength(2);
  });
});

describe("estado puro y serializable", () => {
  it("ninguna transición muta el estado de entrada", () => {
    const apuestas = estado({
      fase: "apuestas",
      finFase: T0 + BJ.APUESTAS_MS,
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      manos: [mano(1, "ana")],
      zapato: zapato("10S 10C 9H 6D 9S"),
    });
    const banca = enDecisiones({ fase: "banca", finFase: T0, manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })] });
    const resultado = estado({ fase: "resultado", finFase: T0, ronda: 3, asientos: [asiento(1, "ana"), asiento(2, "beto", false)], banca: cs("10C 9D"), manos: [mano(1, "ana", { cartas: cs("10S 9H"), estado: "plantado" })], zapato: zapato("2S").slice(0, 10) });
    const llamadas: Array<[string, () => Paso<EstadoBJ>]> = [
      ["sentar nuevo", () => blackjack.sentar(congelar(structuredClone(apuestas)), 3, "carla", T0)],
      ["sentar en mesa vacía", () => blackjack.sentar(congelar(estado()), 3, "carla", T0)],
      ["apostar", () => blackjack.aplicar(congelar(structuredClone(apuestas)), 2, { t: "apostar", cantidad: 50 }, T0, rng)],
      ["tick reparto", () => blackjack.tick(congelar(structuredClone(apuestas)), T0 + BJ.APUESTAS_MS, rng)],
      ["pedir", () => blackjack.aplicar(congelar(dosEnDecisiones()), 1, { t: "pedir" }, T0, rng)],
      ["plantarse", () => blackjack.aplicar(congelar(dosEnDecisiones()), 1, { t: "plantarse" }, T0, rng)],
      ["doblar", () => blackjack.aplicar(congelar(dosEnDecisiones()), 1, { t: "doblar" }, T0, rng)],
      ["salir", () => blackjack.aplicar(congelar(dosEnDecisiones()), 1, { t: "salir" }, T0, rng)],
      ["salir el último", () => blackjack.aplicar(congelar(enDecisiones()), 1, { t: "salir" }, T0, rng)],
      ["desconectar", () => blackjack.desconectar(congelar(dosEnDecisiones()), 1, T0, rng)],
      ["tick decisiones", () => blackjack.tick(congelar(dosEnDecisiones()), T0 + BJ.DECISIONES_MS, rng)],
      ["tick banca", () => blackjack.tick(congelar(banca), T0, rng)],
      ["tick resultado", () => blackjack.tick(congelar(resultado), T0, rng)],
    ];
    for (const [nombre, llamar] of llamadas) {
      expect(() => llamar(), nombre).not.toThrow();
    }
    expect(() => blackjack.vista(congelar(dosEnDecisiones()), 1, T0)).not.toThrow();
    expect(() => blackjack.resumen(congelar(dosEnDecisiones()), T0)).not.toThrow();
    expect(() => blackjack.costo(congelar(dosEnDecisiones()), 1, { t: "doblar" })).not.toThrow();
  });

  it("cada transición devuelve un estado nuevo", () => {
    const e = dosEnDecisiones();
    const p = exito(blackjack.aplicar(e, 1, { t: "pedir" }, T0, rng));
    expect(p.estado).not.toBe(e);
    expect(p.estado.manos[0]).not.toBe(e.manos[0]);
    expect(e.manos[0].cartas).toHaveLength(2);
    expect(e.zapato.length).toBe(RELLENO.length + 3);
  });

  it("el estado de una ronda completa sobrevive a JSON sin perder nada", () => {
    let e = blackjack.crear(T0, rngFijo(0.9));
    e = exito(blackjack.sentar(e, 1, "ana", T0)).estado;
    e = exito(blackjack.aplicar(e, 1, { t: "apostar", cantidad: 50 }, T0, rng)).estado;
    e = exito(blackjack.tick(e, e.finFase!, rng)).estado;
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    // y la máquina sigue funcionando desde el estado reconstruido
    const reconstruido: EstadoBJ = JSON.parse(JSON.stringify(e));
    expect(exito(blackjack.aplicar(reconstruido, 1, { t: "plantarse" }, T0, rng)).estado.manos[0].estado).toBe("plantado");
  });
});
