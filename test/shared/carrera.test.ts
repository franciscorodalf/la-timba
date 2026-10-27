import { describe, expect, it } from "vitest";
import { barajar, crearBaraja, type Carta, type Palo } from "../../src/shared/cartas";
import { carrera, CARRERA, type AccionCarrera, type EstadoCarrera, type VistaCarrera } from "../../src/shared/juegos/carrera";
import type { Paso } from "../../src/shared/juegos/tipos";
import { c, cs, rngFijo } from "../ayudas";

const T0 = 1_000_000;
const rng = rngFijo(0.5);
const clave = (carta: Carta) => carta.valor + carta.palo;
/** Baraja de 48 cartas (sin ases) en orden fijo: relleno que va detrás de las cartas de cada fixture. */
const SIN_ASES = crearBaraja(1).filter((carta) => carta.valor !== "A");
const POS0 = (): Record<Palo, number> => ({ H: 0, D: 0, C: 0, S: 0 });

function estado(parcial: Partial<EstadoCarrera> = {}): EstadoCarrera {
  return {
    ronda: 1,
    fase: "esperando",
    finFase: null,
    mazo: [],
    descartes: [],
    tramos: cs("2H 2D 2C 2S 3H 3D 3C"),
    tramosGirados: 0,
    posiciones: POS0(),
    plan: [],
    apuestas: [],
    asientos: [],
    abandonos: [],
    ganador: null,
    ventanasVacias: 0,
    ...parcial,
  };
}
const asiento = (jugadorId: number, apodo: string, conectado = true) => ({ jugadorId, apodo, conectado });
const ap = (jugadorId: number, caballo: Palo, cantidad: number) => ({ jugadorId, caballo, cantidad });
/** Mazo conocido: las primeras cartas salen en el orden escrito; detrás, relleno. */
const mazo = (texto: string): Carta[] => [...cs(texto), ...SIN_ASES];

function exito(p: Paso<EstadoCarrera>) {
  if (!p.ok) throw new Error(`se esperaba ok y llegó el error ${p.error}`);
  return p;
}
const error = (p: Paso<EstadoCarrera>) => (p.ok ? "ok" : p.error);

function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === "object" && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const v of Object.values(valor)) congelar(v);
  }
  return valor;
}

/**
 * Ana apuesta 50 a H y beto 50 a S, y las apuestas se cierran en T0: la carrera queda sorteada desde la pista de `parcial`
 * (posiciones, tramos girados, mazo). El primer paso, en T0 + PASO_MS, saca el 5♥.
 */
const enCarrera = (parcial: Partial<EstadoCarrera> = {}, rngSorteo = rng) =>
  exito(
    carrera.tick(
      estado({
        fase: "apuestas",
        finFase: T0,
        asientos: [asiento(1, "ana"), asiento(2, "beto")],
        apuestas: [ap(1, "H", 50), ap(2, "S", 50)],
        tramos: cs("7D 9H 2C 4S 6D 8C KH"),
        mazo: mazo("5H 3S 9D"),
        ...parcial,
      }),
      T0,
      rngSorteo,
    ),
  ).estado;
/** Las 41 cartas que no son tramos de `enCarrera`, barajadas con `semilla`: un mazo como el de una carrera de verdad. */
const mazoAlAzar = (semilla: number) =>
  barajar(
    SIN_ASES.filter((carta) => !cs("7D 9H 2C 4S 6D 8C KH").some((tramo) => clave(tramo) === clave(carta))),
    rngFijo(semilla, 0.37, 0.73),
  );
/** El instante del paso `n` (desde 1) de una carrera que sale en T0. */
const paso = (n: number) => T0 + n * CARRERA.PASO_MS;

/** Apuestas abiertas con apuestas hechas de ana (H) y beto (S). */
const enApuestas = (parcial: Partial<EstadoCarrera> = {}) =>
  estado({
    fase: "apuestas",
    finFase: T0 + CARRERA.APUESTAS_MS,
    asientos: [asiento(1, "ana"), asiento(2, "beto")],
    apuestas: [ap(1, "H", 50), ap(2, "S", 50)],
    mazo: mazo("5H 3S"),
    ...parcial,
  });

/** Apuesta nueva de `cantidad` al caballo `caballo`. */
const apostar = (caballo: Palo, cantidad: number): AccionCarrera => ({ t: "apostar", caballo, cantidad });

describe("crear, sentar y apuestas", () => {
  it("identidad, límites y constantes", () => {
    expect(carrera.id).toBe("carrera");
    expect(carrera.maxJugadores).toBe(12);
    expect(CARRERA).toEqual({
      TRAMOS: 7,
      META: 8,
      PASO_MS: 800,
      APUESTAS_MS: 20_000,
      RESULTADO_MS: 5_000,
      MIN: 10,
      PAGO: 4,
      MAX_JUGADORES: 12,
    });
  });

  it("crear deja la mesa en espera con una pista nueva: 7 tramos y el resto de una baraja sin ases en el mazo", () => {
    const e = carrera.crear(T0, rngFijo(0.3));
    expect(e).toMatchObject({
      ronda: 1,
      fase: "esperando",
      finFase: null,
      descartes: [],
      tramosGirados: 0,
      posiciones: { H: 0, D: 0, C: 0, S: 0 },
      apuestas: [],
      asientos: [],
      abandonos: [],
      ganador: null,
      ventanasVacias: 0,
    });
    expect(e.tramos).toHaveLength(7);
    expect(e.mazo).toHaveLength(41);
    const todas = [...e.tramos, ...e.mazo];
    expect(todas.some((carta) => carta.valor === "A")).toBe(false);
    expect(new Set(todas.map(clave)).size).toBe(48);
    expect(todas).not.toEqual(SIN_ASES); // barajada
    // determinista con el mismo rng, y los tramos son las 7 primeras cartas
    const igual = carrera.crear(T0, rngFijo(0.3));
    expect(igual).toEqual(e);
    expect(todas).toEqual(barajar(SIN_ASES, rngFijo(0.3)));
  });

  it("sentarse en mesa vacía abre apuestas 20 s", () => {
    const e = carrera.crear(T0, rng);
    const p = exito(carrera.sentar(e, 1, "ana", T0));
    expect(p.estado.fase).toBe("apuestas");
    expect(p.estado.finFase).toBe(T0 + 20_000);
    expect(p.estado.asientos).toEqual([{ jugadorId: 1, apodo: "ana", conectado: true }]);
    expect(p.eventos).toEqual([]);
    expect(e.fase).toBe("esperando"); // la entrada no se muta
  });

  it("un segundo jugador no reinicia la ventana de apuestas", () => {
    const e = exito(carrera.sentar(carrera.crear(T0, rng), 1, "ana", T0)).estado;
    const p = exito(carrera.sentar(e, 2, "beto", T0 + 5_000));
    expect(p.estado.finFase).toBe(T0 + 20_000);
    expect(p.estado.asientos.map((a) => a.apodo)).toEqual(["ana", "beto"]);
  });

  it("rechaza el decimotercer jugador con mesa_llena", () => {
    const doce = Array.from({ length: 12 }, (_, i) => asiento(i + 1, `jugador${i + 1}`));
    const e = estado({ fase: "apuestas", finFase: T0 + CARRERA.APUESTAS_MS, asientos: doce });
    expect(error(carrera.sentar(e, 13, "decimotercero", T0))).toBe("mesa_llena");
    // quien ya está sentado en una mesa llena no es un decimotercero
    expect(carrera.sentar(e, 3, "jugador3", T0).ok).toBe(true);
  });

  it("sentar es idempotente para el mismo jugador", () => {
    const e = exito(carrera.sentar(carrera.crear(T0, rng), 1, "ana", T0)).estado;
    const p = exito(carrera.sentar(e, 1, "ana", T0 + 100));
    expect(p.estado.asientos).toHaveLength(1);
    expect(p.estado).toEqual(e);
    expect(p.eventos).toEqual([]);
  });

  it("sentar de nuevo a quien estaba desconectado lo vuelve a conectar", () => {
    const e = estado({ fase: "apuestas", finFase: T0 + CARRERA.APUESTAS_MS, asientos: [asiento(1, "ana", false)] });
    const p = exito(carrera.sentar(e, 1, "ana", T0));
    expect(p.estado.asientos).toEqual([asiento(1, "ana", true)]);
    expect(p.estado.fase).toBe("apuestas");
    expect(p.estado.finFase).toBe(e.finFase);
  });

  it("apostar fuera de fase → fase_incorrecta", () => {
    expect(error(carrera.aplicar(enCarrera(), 1, apostar("H", 50), T0, rng))).toBe("fase_incorrecta");
    const resultado = estado({ fase: "resultado", finFase: T0, asientos: [asiento(1, "ana")] });
    expect(error(carrera.aplicar(resultado, 1, apostar("H", 50), T0, rng))).toBe("fase_incorrecta");
  });

  it("las cantidades raras son apuesta_invalida y no crean apuesta", () => {
    const e = exito(carrera.sentar(carrera.crear(T0, rng), 1, "ana", T0)).estado;
    for (const cantidad of [0, -10, 9, 50.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "50", null, undefined]) {
      const accion = { t: "apostar", caballo: "H", cantidad } as unknown as AccionCarrera;
      expect(error(carrera.aplicar(e, 1, accion, T0, rng))).toBe("apuesta_invalida");
    }
    expect(e.apuestas).toEqual([]);
  });

  it("un caballo que no existe es apuesta_invalida", () => {
    const e = exito(carrera.sentar(carrera.crear(T0, rng), 1, "ana", T0)).estado;
    for (const caballo of ["X", "h", "", null, undefined, 1]) {
      const accion = { t: "apostar", caballo, cantidad: 50 } as unknown as AccionCarrera;
      expect(error(carrera.aplicar(e, 1, accion, T0, rng))).toBe("apuesta_invalida");
    }
    expect(e.apuestas).toEqual([]);
  });

  it("apostar crea una apuesta con el mínimo, y no hay tope: se puede apostar todo", () => {
    const e = exito(carrera.sentar(carrera.crear(T0, rng), 1, "ana", T0)).estado;
    const p = exito(carrera.aplicar(e, 1, apostar("D", 10), T0, rng));
    expect(p.estado.apuestas).toEqual([ap(1, "D", 10)]);
    expect(p.estado.fase).toBe("apuestas");
    expect(p.eventos).toEqual([]);
    expect(exito(carrera.aplicar(e, 1, apostar("S", 500), T0, rng)).estado.apuestas).toEqual([ap(1, "S", 500)]);
    expect(exito(carrera.aplicar(e, 1, apostar("S", 12_345), T0, rng)).estado.apuestas).toEqual([ap(1, "S", 12_345)]);
  });

  it("apostar a varios caballos y acumular en uno sin tope", () => {
    let e = exito(carrera.sentar(carrera.crear(T0, rng), 1, "ana", T0)).estado;
    e = exito(carrera.aplicar(e, 1, apostar("H", 300), T0, rng)).estado;
    e = exito(carrera.aplicar(e, 1, apostar("H", 200), T0, rng)).estado;
    e = exito(carrera.aplicar(e, 1, apostar("H", 1_000), T0, rng)).estado; // pasar de 500 ya no es un problema
    expect(e.apuestas).toEqual([ap(1, "H", 1_500)]);
    e = exito(carrera.aplicar(e, 1, apostar("D", 500), T0, rng)).estado;
    e = exito(carrera.aplicar(e, 1, apostar("S", 10), T0, rng)).estado;
    expect(e.apuestas).toEqual([ap(1, "H", 1_500), ap(1, "D", 500), ap(1, "S", 10)]);
  });

  it("lo acumulado en un caballo no puede pasar de un entero seguro", () => {
    const e = enApuestas({ apuestas: [ap(1, "H", Number.MAX_SAFE_INTEGER - 5)] });
    expect(error(carrera.aplicar(e, 1, apostar("H", 10), T0, rng))).toBe("apuesta_invalida");
    expect(exito(carrera.aplicar(e, 1, apostar("D", 10), T0, rng)).estado.apuestas).toEqual([ap(1, "H", Number.MAX_SAFE_INTEGER - 5), ap(1, "D", 10)]);
  });

  it("actuar sin estar sentado → no_sentado", () => {
    const e = enApuestas();
    for (const accion of [apostar("H", 50), { t: "salir" }] as AccionCarrera[]) {
      expect(error(carrera.aplicar(e, 99, accion, T0, rng))).toBe("no_sentado");
    }
  });

  it("una acción desconocida es mensaje_invalido", () => {
    const e = enApuestas();
    expect(error(carrera.aplicar(e, 1, { t: "rendirse" } as unknown as AccionCarrera, T0, rng))).toBe("mensaje_invalido");
    // sin estar sentado manda no_sentado, como en el blackjack
    expect(error(carrera.aplicar(e, 99, { t: "rendirse" } as unknown as AccionCarrera, T0, rng))).toBe("no_sentado");
  });
});

describe("inicio de la carrera", () => {
  it("tick antes de finFase no cambia nada", () => {
    const e = enApuestas();
    const p = exito(carrera.tick(e, T0 + CARRERA.APUESTAS_MS - 1, rng));
    expect(p.estado).toBe(e);
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toBeUndefined();
  });

  it("tick en una mesa en espera no hace nada", () => {
    const e = estado();
    const p = exito(carrera.tick(e, T0 + 10 ** 9, rng));
    expect(p.estado).toEqual(e);
    expect(p.eventos).toEqual([]);
  });

  it("al acabar las apuestas con apuestas arranca la carrera ya sorteada: sin carta todavía, un paso cada 800 ms hasta la meta", () => {
    const e = enApuestas({ ventanasVacias: 2 });
    const ahora = T0 + CARRERA.APUESTAS_MS + 7;
    const p = exito(carrera.tick(e, ahora, rng));
    expect(p.estado.fase).toBe("carrera");
    expect(p.estado.ventanasVacias).toBe(0);
    expect(p.estado.apuestas).toEqual(e.apuestas);
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toBeUndefined();
    // La pista no se mueve hasta la meta: lo que se ve sale del plan y de la hora.
    expect(p.estado.posiciones).toEqual(POS0());
    expect(p.estado.ganador).toBeNull();
    const { plan } = p.estado;
    expect(plan.map((paso) => paso.momento)).toEqual(plan.map((_, i) => ahora + (i + 1) * CARRERA.PASO_MS));
    expect(plan[0].carta).toEqual(c("5H"));
    expect(plan[1].carta).toEqual(c("3S"));
    // Las cartas del plan son las del mazo, en orden, y ya están sacadas.
    expect(p.estado.descartes).toEqual(plan.map((paso) => paso.carta));
    expect(p.estado.mazo).toEqual(e.mazo.slice(plan.length));
    // La fase vence en la meta: es la única alarma de la carrera.
    expect(p.estado.finFase).toBe(plan[plan.length - 1].momento);
    expect(carrera.proximaAlarma(p.estado)).toBe(p.estado.finFase);
    expect(Math.max(...Object.values(plan[plan.length - 1].posiciones))).toBe(CARRERA.META);
    for (const paso of plan.slice(0, -1)) expect(Math.max(...Object.values(paso.posiciones))).toBeLessThan(CARRERA.META);
  });

  it("sin apuestas al acabar el tiempo abre otra ventana sin avanzar la ronda", () => {
    const e = enApuestas({ apuestas: [] });
    const ahora = T0 + CARRERA.APUESTAS_MS + 7;
    const p = exito(carrera.tick(e, ahora, rng));
    expect(p.estado.fase).toBe("apuestas");
    expect(p.estado.finFase).toBe(ahora + CARRERA.APUESTAS_MS);
    expect(p.estado.ronda).toBe(1);
    expect(p.estado.ventanasVacias).toBe(1);
    expect(p.estado.mazo).toEqual(e.mazo);
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toBeUndefined();
  });

  it("sin apuestas y con todos desconectados la mesa vuelve a esperar, sin alarma", () => {
    const e = enApuestas({ apuestas: [], asientos: [asiento(1, "ana", false)] });
    const p = exito(carrera.tick(e, T0 + CARRERA.APUESTAS_MS, rng));
    expect(p.estado.asientos).toEqual([]);
    expect(p.estado.fase).toBe("esperando");
    expect(p.estado.finFase).toBeNull();
    expect(carrera.proximaAlarma(p.estado)).toBeNull();
  });

  it("sin apuestas se retiran los desconectados pero la mesa sigue si queda alguien conectado", () => {
    const e = enApuestas({ apuestas: [], asientos: [asiento(1, "ana", false), asiento(2, "beto")] });
    const p = exito(carrera.tick(e, T0 + CARRERA.APUESTAS_MS, rng));
    expect(p.estado.asientos).toEqual([asiento(2, "beto")]);
    expect(p.estado.fase).toBe("apuestas");
  });

  it("con apuestas, los desconectados sin apuesta siguen sentados hasta el resultado", () => {
    const e = enApuestas({ asientos: [asiento(1, "ana"), asiento(2, "beto"), asiento(3, "carla", false)] });
    const p = exito(carrera.tick(e, T0 + CARRERA.APUESTAS_MS, rng));
    expect(p.estado.asientos).toHaveLength(3);
  });
});

describe("mesa ociosa", () => {
  const ociosa = () => exito(carrera.sentar(carrera.crear(T0, rng), 1, "ana", T0)).estado;

  it("tres ventanas de apuestas vacías seguidas duermen la mesa: esperando, sin alarma, con los asientos", () => {
    let e = ociosa();
    let ahora = T0;
    for (const esperadas of [1, 2]) {
      ahora = e.finFase!;
      e = exito(carrera.tick(e, ahora, rng)).estado;
      expect(e.fase).toBe("apuestas");
      expect(e.ventanasVacias).toBe(esperadas);
      expect(e.finFase).toBe(ahora + CARRERA.APUESTAS_MS);
    }
    const p = exito(carrera.tick(e, e.finFase!, rng));
    expect(p.estado.fase).toBe("esperando");
    expect(p.estado.finFase).toBeNull();
    expect(carrera.proximaAlarma(p.estado)).toBeNull();
    expect(p.estado.asientos).toEqual([asiento(1, "ana")]);
    expect(p.estado.ronda).toBe(1);
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toBeUndefined();
    // y por mucho que pase el tiempo no vuelve a hacer nada
    expect(exito(carrera.tick(p.estado, T0 + 10 ** 9, rng)).estado).toEqual(p.estado);
  });

  it("apostar un jugador sentado en una mesa dormida reabre las apuestas con esa apuesta", () => {
    const dormida = estado({ asientos: [asiento(1, "ana")], ventanasVacias: 3 });
    const accion = apostar("C", 75);
    expect(carrera.costo(dormida, 1, accion)).toBe(75);
    const p = exito(carrera.aplicar(dormida, 1, accion, T0 + 5_000, rng));
    expect(p.estado.fase).toBe("apuestas");
    expect(p.estado.finFase).toBe(T0 + 5_000 + CARRERA.APUESTAS_MS);
    expect(p.estado.ventanasVacias).toBe(0);
    expect(p.estado.apuestas).toEqual([ap(1, "C", 75)]);
    expect(p.estado.ronda).toBe(1);
    expect(p.eventos).toEqual([]);
    expect(carrera.proximaAlarma(p.estado)).toBe(T0 + 5_000 + CARRERA.APUESTAS_MS);
  });

  it("en una mesa dormida apostar sigue con las mismas reglas de siempre", () => {
    const dormida = estado({ asientos: [asiento(1, "ana")], ventanasVacias: 3 });
    expect(error(carrera.aplicar(dormida, 1, apostar("H", 9), T0, rng))).toBe("apuesta_invalida");
    expect(error(carrera.aplicar(dormida, 2, apostar("H", 50), T0, rng))).toBe("no_sentado");
    // una apuesta inválida no despierta la mesa
    expect(dormida.fase).toBe("esperando");
  });

  it("sentarse en una mesa dormida (también quien ya estaba sentado) abre una ventana nueva y reinicia el contador", () => {
    const dormida = estado({ asientos: [asiento(1, "ana")], ventanasVacias: 3 });
    const nuevo = exito(carrera.sentar(dormida, 2, "beto", T0 + 1_000)).estado;
    expect(nuevo).toMatchObject({ fase: "apuestas", finFase: T0 + 1_000 + CARRERA.APUESTAS_MS, ventanasVacias: 0 });
    expect(nuevo.asientos.map((a) => a.jugadorId)).toEqual([1, 2]);

    const mismo = exito(carrera.sentar(dormida, 1, "ana", T0 + 2_000)).estado;
    expect(mismo).toMatchObject({ fase: "apuestas", finFase: T0 + 2_000 + CARRERA.APUESTAS_MS, ventanasVacias: 0 });
    expect(mismo.asientos).toEqual([asiento(1, "ana")]);
  });

  it("una apuesta en una ventana reinicia el contador: hacen falta otras tres ventanas vacías para dormir", () => {
    let e = ociosa();
    e = exito(carrera.tick(e, e.finFase!, rng)).estado; // vacía 1
    e = exito(carrera.tick(e, e.finFase!, rng)).estado; // vacía 2
    expect(e.ventanasVacias).toBe(2);
    e = exito(carrera.aplicar(e, 1, apostar("H", 50), e.finFase! - 1_000, rng)).estado;
    e = exito(carrera.tick(e, e.finFase!, rng)).estado; // arranca la carrera
    expect(e.fase).toBe("carrera");
    expect(e.ventanasVacias).toBe(0);
    // se acaba la carrera (el tick de la meta) y se abre la ronda 2
    e = exito(carrera.tick(e, e.finFase!, rng)).estado;
    expect(e.fase).toBe("resultado");
    e = exito(carrera.tick(e, e.finFase!, rng)).estado;
    expect(e).toMatchObject({ ronda: 2, fase: "apuestas", ventanasVacias: 0 });
    for (const esperadas of [1, 2]) {
      e = exito(carrera.tick(e, e.finFase!, rng)).estado;
      expect(e).toMatchObject({ fase: "apuestas", ventanasVacias: esperadas });
    }
    e = exito(carrera.tick(e, e.finFase!, rng)).estado;
    expect(e).toMatchObject({ fase: "esperando", finFase: null });
  });

  it("una ventana vacía con la mesa ya sin nadie conectado no cuenta: esperando con el contador a 0", () => {
    const e = estado({ fase: "apuestas", finFase: T0, asientos: [asiento(1, "ana", false)], ventanasVacias: 2 });
    const p = exito(carrera.tick(e, T0, rng));
    expect(p.estado).toMatchObject({ fase: "esperando", finFase: null, asientos: [], ventanasVacias: 0 });
  });

  it("desconectarse de una mesa dormida libera el asiento; salir también", () => {
    const dormida = estado({ asientos: [asiento(1, "ana"), asiento(2, "beto")], ventanasVacias: 3 });
    const sin1 = exito(carrera.desconectar(dormida, 1, T0, rng));
    expect(sin1.estado.asientos).toEqual([asiento(2, "beto")]);
    expect(sin1.estado).toMatchObject({ fase: "esperando", finFase: null });
    const sin2 = exito(carrera.aplicar(sin1.estado, 2, { t: "salir" }, T0, rng));
    expect(sin2.estado).toMatchObject({ fase: "esperando", finFase: null, asientos: [], apuestas: [] });
    expect(sin2.liquidacion).toBeUndefined();
  });
});

describe("la carrera", () => {
  it("antes de la meta el tick no hace nada, tampoco en los pasos intermedios: el estado no cambia en toda la carrera", () => {
    const e = enCarrera();
    for (const ahora of [T0 + 1, paso(1), paso(2) + 5, e.finFase! - 1]) {
      const p = exito(carrera.tick(e, ahora, rng));
      expect(p.estado).toBe(e);
      expect(p.eventos).toEqual([]);
    }
  });

  it("avanza el caballo del palo de la carta", () => {
    const [primero] = enCarrera().plan;
    expect(primero).toEqual({
      momento: paso(1),
      carta: c("5H"),
      posiciones: { H: 1, D: 0, C: 0, S: 0 },
      tramosGirados: 0,
      eventos: [{ tipo: "caballo_avanza", palo: "H", carta: c("5H") }],
    });
  });

  it("cada paso saca exactamente una carta, en el orden del mazo", () => {
    const [, segundo, tercero] = enCarrera().plan;
    expect(segundo.eventos).toEqual([{ tipo: "caballo_avanza", palo: "S", carta: c("3S") }]);
    expect(segundo.posiciones).toEqual({ H: 1, D: 0, C: 0, S: 1 });
    expect(tercero.eventos).toEqual([{ tipo: "caballo_avanza", palo: "D", carta: c("9D") }]);
    expect(tercero.momento).toBe(paso(3));
  });

  it("no gira ningún tramo mientras algún caballo siga sin pasar el tramo 1", () => {
    const [primero] = enCarrera({ posiciones: { H: 0, D: 1, C: 0, S: 1 }, mazo: mazo("2S") }).plan;
    expect(primero.posiciones).toEqual({ H: 0, D: 1, C: 0, S: 2 });
    expect(primero.tramosGirados).toBe(0);
    expect(primero.eventos.map((ev) => ev.tipo)).toEqual(["caballo_avanza"]);
  });

  it("cuando todos pasan el tramo 1 se gira y retrocede su palo", () => {
    const e = enCarrera({ posiciones: { H: 1, D: 1, C: 1, S: 0 }, mazo: mazo("2S 3H") });
    const [primero] = e.plan;
    expect(primero.eventos).toEqual([
      { tipo: "caballo_avanza", palo: "S", carta: c("2S") },
      { tipo: "tramo_girado", indice: 0, palo: "D" }, // tramos[0] = 7♦
    ]);
    expect(primero.tramosGirados).toBe(1);
    expect(primero.posiciones).toEqual({ H: 1, D: 0, C: 1, S: 1 });
    expect(e.tramos).toEqual(cs("7D 9H 2C 4S 6D 8C KH")); // los tramos no se tocan, solo se giran
    expect(e.tramosGirados).toBe(0); // y la pista del estado sigue como al salir
  });

  it("tras girar un tramo, el siguiente no gira hasta que todos lo pasen", () => {
    const [, segundo] = enCarrera({ posiciones: { H: 1, D: 1, C: 1, S: 0 }, mazo: mazo("2S 3D") }).plan; // D vuelve a 0 y luego a 1
    expect(segundo.posiciones).toEqual({ H: 1, D: 1, C: 1, S: 1 });
    expect(segundo.tramosGirados).toBe(1);
    expect(segundo.eventos.map((ev) => ev.tipo)).toEqual(["caballo_avanza"]);
  });

  it("varios tramos pueden girarse en un mismo paso", () => {
    const [primero] = enCarrera({ posiciones: { H: 3, D: 3, C: 3, S: 2 }, mazo: mazo("2S") }).plan;
    expect(primero.eventos).toEqual([
      { tipo: "caballo_avanza", palo: "S", carta: c("2S") },
      { tipo: "tramo_girado", indice: 0, palo: "D" }, // tramos[0] = 7♦
      { tipo: "tramo_girado", indice: 1, palo: "H" }, // tramos[1] = 9♥
    ]);
    expect(primero.tramosGirados).toBe(2);
    expect(primero.posiciones).toEqual({ H: 2, D: 2, C: 3, S: 3 });
  });

  it("nunca se giran más de 7 tramos", () => {
    const [primero] = enCarrera({ tramosGirados: 7, posiciones: { H: 7, D: 7, C: 7, S: 6 }, mazo: mazo("2S") }).plan;
    expect(primero.posiciones).toEqual({ H: 7, D: 7, C: 7, S: 7 });
    expect(primero.tramosGirados).toBe(7);
    expect(primero.eventos.map((ev) => ev.tipo)).toEqual(["caballo_avanza"]);
  });

  it("el primero en llegar a 8 gana: el tick de la meta da ganador, resultado y finFase de 5 s", () => {
    const e = enCarrera({ posiciones: { H: 7, D: 3, C: 2, S: 5 } });
    expect(e.plan).toHaveLength(1);
    expect(e.finFase).toBe(paso(1));
    const ahora = paso(1) + 3;
    const p = exito(carrera.tick(e, ahora, rng));
    expect(p.estado.posiciones).toEqual({ H: 8, D: 3, C: 2, S: 5 });
    expect(p.estado.ganador).toBe("H");
    expect(p.estado.fase).toBe("resultado");
    expect(p.estado.finFase).toBe(ahora + CARRERA.RESULTADO_MS);
    expect(p.estado.plan).toEqual([]);
    expect(p.eventos.slice(0, 2)).toEqual([
      { tipo: "caballo_avanza", palo: "H", carta: c("5H") },
      { tipo: "ganador", palo: "H" },
    ]);
  });

  it("el tick de la meta trae solo los eventos del último paso (los anteriores se anuncian aparte)", () => {
    const e = enCarrera({ posiciones: { H: 6, D: 0, C: 0, S: 0 }, mazo: mazo("5H 6H") });
    expect(e.plan).toHaveLength(2);
    const p = exito(carrera.tick(e, e.finFase!, rng));
    expect(p.eventos.filter((ev) => ev.tipo === "caballo_avanza")).toEqual([{ tipo: "caballo_avanza", palo: "H", carta: c("6H") }]);
    expect(p.estado.descartes).toEqual(cs("5H 6H"));
  });

  it("llegar a la meta tiene prioridad: no se gira ningún tramo en el paso ganador", () => {
    const e = enCarrera({ posiciones: { H: 7, D: 1, C: 1, S: 1 } });
    expect(e.plan[0].eventos.map((ev) => ev.tipo)).not.toContain("tramo_girado");
    const p = exito(carrera.tick(e, e.finFase!, rng));
    expect(p.eventos.map((ev) => ev.tipo)).not.toContain("tramo_girado");
    expect(p.estado.tramosGirados).toBe(0);
    expect(p.estado.posiciones).toEqual({ H: 8, D: 1, C: 1, S: 1 });
  });

  it("gana el primero en llegar a 8 y paga ×4", () => {
    const e = enCarrera({ posiciones: { H: 7, D: 3, C: 2, S: 5 } });
    const p = exito(carrera.tick(e, e.finFase!, rng));
    expect(p.liquidacion).toEqual({
      ronda: 1,
      filas: [
        { jugadorId: 1, apuesta: 50, pago: 200 },
        { jugadorId: 2, apuesta: 50, pago: 0 },
      ],
    });
    expect(p.eventos.slice(2)).toEqual([
      { tipo: "pago", jugadorId: 1, neto: 150 },
      { tipo: "pago", jugadorId: 2, neto: -50 },
    ]);
  });

  it("una fila de liquidación por jugador sumando sus apuestas", () => {
    const e = enCarrera({
      asientos: [asiento(1, "ana"), asiento(2, "beto"), asiento(3, "carla")],
      posiciones: { H: 7, D: 0, C: 0, S: 0 },
      apuestas: [ap(1, "H", 50), ap(2, "S", 200), ap(1, "S", 50), ap(2, "H", 100), ap(1, "D", 20)],
    });
    const p = exito(carrera.tick(e, e.finFase!, rng));
    expect(p.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 120, pago: 200 }, // 50 al ganador ×4
      { jugadorId: 2, apuesta: 300, pago: 400 }, // 100 al ganador ×4
    ]);
    expect(p.eventos.filter((ev) => ev.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: 1, neto: 80 },
      { tipo: "pago", jugadorId: 2, neto: 100 },
    ]);
    // carla no apostó: no hay fila ni evento para ella
    expect(JSON.stringify(p.liquidacion)).not.toContain('"jugadorId":3');
  });

  it("apostar 50 a H y 50 a S el mismo jugador: una fila con apuesta 100 y pago 200 si gana H", () => {
    const e = enCarrera({ posiciones: { H: 7, D: 0, C: 0, S: 0 }, apuestas: [ap(1, "H", 50), ap(1, "S", 50)] });
    const p = exito(carrera.tick(e, e.finFase!, rng));
    expect(p.liquidacion?.filas).toEqual([{ jugadorId: 1, apuesta: 100, pago: 200 }]);
  });

  it("quien no acierta cobra 0 y, si nadie acierta, todas las filas pagan 0", () => {
    const e = enCarrera({ posiciones: { H: 0, D: 0, C: 0, S: 7 }, mazo: mazo("4S") });
    const p = exito(carrera.tick(e, e.finFase!, rng));
    // gana S: beto (S) cobra, ana (H) no
    expect(p.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 50, pago: 0 },
      { jugadorId: 2, apuesta: 50, pago: 200 },
    ]);
    const sinAciertos = enCarrera({
      posiciones: { H: 0, D: 0, C: 0, S: 7 },
      mazo: mazo("4S"),
      apuestas: [ap(1, "H", 50), ap(2, "D", 75)],
    });
    const q = exito(carrera.tick(sinAciertos, sinAciertos.finFase!, rng));
    expect(q.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 50, pago: 0 },
      { jugadorId: 2, apuesta: 75, pago: 0 },
    ]);
  });

  it("la liquidación lleva el número de la ronda en curso", () => {
    const e = enCarrera({ ronda: 7, posiciones: { H: 7, D: 0, C: 0, S: 0 } });
    expect(exito(carrera.tick(e, e.finFase!, rng)).liquidacion?.ronda).toBe(7);
  });

  it("la liquidación sale una sola vez: el tick de resultado no vuelve a liquidar", () => {
    const e = enCarrera({ posiciones: { H: 7, D: 0, C: 0, S: 0 } });
    const fin = exito(carrera.tick(e, e.finFase!, rng)).estado;
    const sig = exito(carrera.tick(fin, fin.finFase!, rng));
    expect(sig.liquidacion).toBeUndefined();
    expect(sig.eventos.filter((ev) => ev.tipo === "pago")).toEqual([]);
  });

  it("si el mazo se agota se rebaraja el descarte (con el rng del sorteo)", () => {
    const descartes = cs("2H 3H 4S");
    const e = enCarrera({ mazo: [], descartes, posiciones: { H: 1, D: 0, C: 0, S: 0 } }, rngFijo(0.3));
    const esperado = barajar(descartes, rngFijo(0.3));
    expect(esperado[0]).not.toEqual(descartes[0]); // el fixture sí cambia el orden
    expect(e.plan[0].eventos).toEqual([
      { tipo: "barajado" },
      { tipo: "caballo_avanza", palo: esperado[0].palo, carta: esperado[0] },
    ]);
    expect(e.plan[0].posiciones.H).toBe(esperado[0].palo === "H" ? 2 : 1);
    // El descarte se baraja cada vez que el mazo se agota, hasta que alguien llega a la meta.
    expect(e.plan.filter((p) => p.eventos.some((ev) => ev.tipo === "barajado")).length).toBeGreaterThan(1);
  });

  it("con el mazo con cartas no hay barajado", () => {
    for (const p of enCarrera().plan) expect(p.eventos.map((ev) => ev.tipo)).not.toContain("barajado");
  });

  it("la carrera siempre acaba: con barajas al azar nadie pasa de la meta y hay como mucho 36 pasos", () => {
    for (let semilla = 1; semilla <= 50; semilla++) {
      const e = enCarrera({ mazo: mazoAlAzar(semilla / 51) });
      expect(e.plan.length).toBeLessThanOrEqual(36);
      for (const p of e.plan) {
        for (const pos of Object.values(p.posiciones)) {
          expect(pos).toBeGreaterThanOrEqual(0);
          expect(pos).toBeLessThanOrEqual(CARRERA.META);
        }
        expect(p.tramosGirados).toBeLessThanOrEqual(CARRERA.TRAMOS);
      }
    }
  });
});

describe("la carrera se ve con el reloj", () => {
  it("la vista enseña los pasos vencidos: posiciones, carta, tramos girados y el siguiente paso como finFase", () => {
    const e = enCarrera({ posiciones: { H: 1, D: 1, C: 1, S: 0 }, mazo: mazo("2S 3D 4C") });
    const salida = carrera.vista(e, 1, T0) as VistaCarrera;
    expect(salida).toMatchObject({ fase: "carrera", posiciones: { H: 1, D: 1, C: 1, S: 0 }, ultimaCarta: null, finFase: paso(1), ganador: null });
    expect(salida.tramos).toEqual(Array(7).fill(null));

    for (const ahora of [paso(1), paso(1) + 500]) {
      const v = carrera.vista(e, 1, ahora) as VistaCarrera;
      expect(v).toMatchObject({ posiciones: { H: 1, D: 0, C: 1, S: 1 }, ultimaCarta: c("2S"), finFase: paso(2) });
      expect(v.tramos).toEqual([c("7D"), null, null, null, null, null, null]);
    }
    expect(carrera.vista(e, 1, paso(2))).toMatchObject({ posiciones: { H: 1, D: 1, C: 1, S: 1 }, ultimaCarta: c("3D"), finFase: paso(3) });
  });

  it("no se ve ni una carta del futuro: ni las que faltan por salir, ni el ganador, ni los tramos sin girar", () => {
    const e = enCarrera({ mazo: mazoAlAzar(0.61) });
    expect(e.plan.length).toBeGreaterThan(10);
    const { plan } = e;
    for (let k = 0; k < plan.length; k++) {
      const ahora = k === 0 ? T0 : plan[k - 1].momento;
      const v = carrera.vista(e, 1, ahora) as VistaCarrera;
      expect(v.ganador).toBeNull();
      expect(v.fase).toBe("carrera");
      const texto = JSON.stringify(v);
      for (const futuro of plan.slice(k)) expect(texto, `paso ${k}`).not.toContain(JSON.stringify(futuro.carta));
      const girados = k === 0 ? 0 : plan[k - 1].tramosGirados;
      for (const tapado of e.tramos.slice(girados)) expect(texto).not.toContain(JSON.stringify(tapado));
    }
  });

  it("con la meta ya vencida pero sin su tick, la vista se queda en el penúltimo paso", () => {
    const e = enCarrera({ posiciones: { H: 6, D: 0, C: 0, S: 0 }, mazo: mazo("5H 6H") });
    const v = carrera.vista(e, 1, e.finFase! + 10_000) as VistaCarrera;
    expect(v).toMatchObject({ fase: "carrera", posiciones: { H: 7, D: 0, C: 0, S: 0 }, ultimaCarta: c("5H"), finFase: e.finFase, ganador: null });
  });

  it("proximoAviso da el siguiente paso intermedio; la meta no (llega con su alarma); fuera de la carrera, ninguno", () => {
    const e = enCarrera({ posiciones: { H: 5, D: 0, C: 0, S: 0 }, mazo: mazo("5H 6H 7H") });
    expect(e.plan).toHaveLength(3);
    expect(carrera.proximoAviso!(e, T0)).toBe(paso(1));
    expect(carrera.proximoAviso!(e, paso(1) - 1)).toBe(paso(1));
    expect(carrera.proximoAviso!(e, paso(1))).toBe(paso(2));
    expect(carrera.proximoAviso!(e, paso(2))).toBeNull();
    expect(carrera.proximoAviso!(enApuestas(), T0)).toBeNull();
    expect(carrera.proximoAviso!(exito(carrera.tick(e, e.finFase!, rng)).estado, T0)).toBeNull();
  });

  it("eventosEntre junta, en orden, los eventos de los pasos intermedios de (desde, hasta]", () => {
    const e = enCarrera({ posiciones: { H: 5, D: 0, C: 0, S: 0 }, mazo: mazo("5H 6H 7H") });
    const avanza = (carta: string) => ({ tipo: "caballo_avanza", palo: c(carta).palo, carta: c(carta) });
    expect(carrera.eventosEntre!(e, T0, paso(1))).toEqual([avanza("5H")]);
    expect(carrera.eventosEntre!(e, paso(1), paso(1))).toEqual([]);
    expect(carrera.eventosEntre!(e, T0, paso(2) + 100)).toEqual([avanza("5H"), avanza("6H")]);
    // la meta no: sus eventos llegan con el tick
    expect(carrera.eventosEntre!(e, paso(2), paso(9))).toEqual([]);
    expect(carrera.eventosEntre!(enApuestas(), T0, T0 + 10 ** 6)).toEqual([]);
  });
});

describe("salir y desconectar", () => {
  it("abandonar durante la carrera paga 0 aunque gane su caballo, y la apuesta se queda en la mesa", () => {
    const e = enCarrera({ posiciones: { H: 7, D: 0, C: 0, S: 0 } });
    const sale = exito(carrera.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(sale.estado.asientos.map((a) => a.jugadorId)).toEqual([2]);
    expect(sale.estado.abandonos).toEqual([1]);
    expect(sale.estado.apuestas).toEqual(e.apuestas);
    expect(sale.estado.fase).toBe("carrera");
    expect(sale.estado.finFase).toBe(e.finFase);
    expect(sale.liquidacion).toBeUndefined();
    expect(sale.eventos).toEqual([]);

    // gana H: ana (que se fue) no cobra
    const final = exito(carrera.tick(sale.estado, sale.estado.finFase!, rng));
    expect(final.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 50, pago: 0 },
      { jugadorId: 2, apuesta: 50, pago: 0 },
    ]);
    expect(final.eventos.filter((ev) => ev.tipo === "pago")).toEqual([
      { tipo: "pago", jugadorId: 1, neto: -50 },
      { tipo: "pago", jugadorId: 2, neto: -50 },
    ]);
  });

  it("salir sin apuestas solo libera el asiento", () => {
    const e = enCarrera({ asientos: [asiento(1, "ana"), asiento(2, "beto"), asiento(3, "carla")] });
    const p = exito(carrera.aplicar(e, 3, { t: "salir" }, T0, rng));
    expect(p.estado.asientos.map((a) => a.jugadorId)).toEqual([1, 2]);
    expect(p.estado.abandonos).toEqual([]);
    expect(p.estado.apuestas).toEqual(e.apuestas);
    expect(p.estado.fase).toBe("carrera");
  });

  it("salir tras apostar, antes de la carrera, deja la apuesta perdida", () => {
    const e = enApuestas();
    const p = exito(carrera.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.estado.abandonos).toEqual([1]);
    expect(p.estado.apuestas).toEqual(e.apuestas);
    expect(p.estado.fase).toBe("apuestas");
    expect(p.estado.finFase).toBe(e.finFase);
    // la carrera sigue adelante por beto y la fila de ana paga 0
    const carreraEnMarcha = exito(carrera.tick(p.estado, p.estado.finFase!, rng)).estado;
    expect(carreraEnMarcha.fase).toBe("carrera");
  });

  it("salir tras resolverse la carrera no cuenta como abandono (ya está liquidada)", () => {
    const e = estado({
      fase: "resultado",
      finFase: T0,
      ganador: "H",
      posiciones: { H: 8, D: 1, C: 1, S: 1 },
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      apuestas: [ap(1, "H", 50)],
    });
    const p = exito(carrera.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.estado.abandonos).toEqual([]);
    expect(p.estado.asientos.map((a) => a.jugadorId)).toEqual([2]);
    expect(p.liquidacion).toBeUndefined();
  });

  it("quien sale y vuelve a sentarse no puede apostar otra vez en la misma ronda", () => {
    const e = enApuestas();
    const fuera = exito(carrera.aplicar(e, 1, { t: "salir" }, T0, rng)).estado;
    const dentro = exito(carrera.sentar(fuera, 1, "ana", T0 + 100)).estado;
    expect(error(carrera.aplicar(dentro, 1, apostar("D", 50), T0 + 100, rng))).toBe("accion_invalida");
    expect(dentro.abandonos).toEqual([1]);
  });

  it("quien sale sin haber apostado puede volver y apostar", () => {
    const e = enApuestas({ asientos: [asiento(1, "ana"), asiento(2, "beto"), asiento(3, "carla")] });
    const fuera = exito(carrera.aplicar(e, 3, { t: "salir" }, T0, rng)).estado;
    const dentro = exito(carrera.sentar(fuera, 3, "carla", T0 + 100)).estado;
    expect(exito(carrera.aplicar(dentro, 3, apostar("D", 50), T0 + 100, rng)).estado.apuestas).toHaveLength(3);
  });

  it("si se va el último jugador a mitad de carrera se liquida de inmediato (pago 0) y la mesa queda sin alarma", () => {
    const e = enCarrera({
      asientos: [asiento(1, "ana")],
      apuestas: [ap(1, "H", 50), ap(1, "S", 30)],
      posiciones: { H: 5, D: 2, C: 3, S: 4 },
      tramosGirados: 2,
      descartes: cs("5H 3S"),
    });
    const p = exito(carrera.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 80, pago: 0 }] });
    expect(p.eventos).toEqual([{ tipo: "pago", jugadorId: 1, neto: -80 }]);
    expect(p.estado).toMatchObject({
      ronda: 2,
      fase: "esperando",
      finFase: null,
      asientos: [],
      apuestas: [],
      abandonos: [],
      posiciones: { H: 0, D: 0, C: 0, S: 0 },
      tramosGirados: 0,
      descartes: [],
      ganador: null,
      ventanasVacias: 0,
    });
    expect(p.estado.tramos).toHaveLength(7);
    expect(p.estado.mazo).toHaveLength(41);
    expect(carrera.proximaAlarma(p.estado)).toBeNull();
  });

  it("si se va el último jugador en apuestas con una apuesta hecha también se liquida", () => {
    const e = enApuestas({ asientos: [asiento(1, "ana")], apuestas: [ap(1, "D", 80)] });
    const p = exito(carrera.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toEqual({ ronda: 1, filas: [{ jugadorId: 1, apuesta: 80, pago: 0 }] });
    expect(p.estado.fase).toBe("esperando");
    expect(carrera.proximaAlarma(p.estado)).toBeNull();
  });

  it("si se va el último jugador sin apuesta no hay liquidación", () => {
    const e = enApuestas({ asientos: [asiento(1, "ana")], apuestas: [] });
    const p = exito(carrera.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toBeUndefined();
    expect(p.estado.fase).toBe("esperando");
    expect(p.estado.finFase).toBeNull();
  });

  it("si se va el último jugador durante el resultado la mesa pasa a esperar sin liquidar otra vez", () => {
    const e = estado({
      fase: "resultado",
      finFase: T0,
      ganador: "H",
      posiciones: { H: 8, D: 1, C: 1, S: 1 },
      asientos: [asiento(1, "ana")],
      apuestas: [ap(1, "H", 50)],
    });
    const p = exito(carrera.aplicar(e, 1, { t: "salir" }, T0, rng));
    expect(p.liquidacion).toBeUndefined();
    expect(p.eventos).toEqual([]);
    expect(p.estado).toMatchObject({ ronda: 2, fase: "esperando", finFase: null, apuestas: [], ganador: null });
  });

  it("desconectar marca el asiento y las apuestas siguen en juego y se liquidan con normalidad", () => {
    const e = enCarrera({ posiciones: { H: 7, D: 0, C: 0, S: 0 } });
    const p = exito(carrera.desconectar(e, 1, T0, rng));
    expect(p.estado.asientos[0]).toEqual({ jugadorId: 1, apodo: "ana", conectado: false });
    expect(p.estado.apuestas).toEqual(e.apuestas);
    expect(p.estado.abandonos).toEqual([]);
    expect(p.estado.fase).toBe("carrera");
    expect(p.estado.finFase).toBe(e.finFase);
    expect(p.eventos).toEqual([]);

    const final = exito(carrera.tick(p.estado, p.estado.finFase!, rng));
    expect(final.liquidacion?.filas).toEqual([
      { jugadorId: 1, apuesta: 50, pago: 200 },
      { jugadorId: 2, apuesta: 50, pago: 0 },
    ]);
    // y en el tick de resultado se retira el asiento desconectado
    const sig = exito(carrera.tick(final.estado, final.estado.finFase!, rng)).estado;
    expect(sig.asientos.map((a) => a.jugadorId)).toEqual([2]);
  });

  it("desconectar antes de la carrera conserva las apuestas y la carrera arranca", () => {
    const p = exito(carrera.desconectar(enApuestas(), 1, T0, rng));
    expect(p.estado.asientos[0].conectado).toBe(false);
    expect(p.estado.apuestas).toHaveLength(2);
    expect(exito(carrera.tick(p.estado, p.estado.finFase!, rng)).estado.fase).toBe("carrera");
  });

  it("desconectar a alguien que no está sentado no hace nada", () => {
    const e = enCarrera();
    const p = exito(carrera.desconectar(e, 99, T0, rng));
    expect(p.estado).toEqual(e);
    expect(p.eventos).toEqual([]);
  });

  it("volver a sentarse tras desconectar conserva las apuestas y puede seguir apostando", () => {
    const e = enApuestas();
    const fuera = exito(carrera.desconectar(e, 1, T0, rng)).estado;
    const dentro = exito(carrera.sentar(fuera, 1, "ana", T0 + 1_000)).estado;
    expect(dentro.asientos[0].conectado).toBe(true);
    expect(dentro.apuestas).toEqual(fuera.apuestas);
    expect(dentro.asientos).toHaveLength(2);
    expect(exito(carrera.aplicar(dentro, 1, apostar("H", 25), T0 + 1_000, rng)).estado.apuestas[0]).toEqual(ap(1, "H", 75));
  });
});

describe("resultado y nueva ronda", () => {
  const resultado = (parcial: Partial<EstadoCarrera> = {}) =>
    estado({
      ronda: 3,
      fase: "resultado",
      finFase: T0,
      ganador: "H",
      posiciones: { H: 8, D: 4, C: 2, S: 5 },
      tramosGirados: 3,
      mazo: mazo("2S"),
      descartes: cs("5H 3S 9D"),
      asientos: [asiento(1, "ana"), asiento(2, "beto", false)],
      apuestas: [ap(1, "H", 50), ap(2, "S", 50)],
      abandonos: [2],
      ventanasVacias: 0,
      ...parcial,
    });

  it("el tick de resultado abre la ronda siguiente: pista nueva, limpia, quita desconectados y abre apuestas", () => {
    const p = exito(carrera.tick(resultado(), T0 + 10, rngFijo(0.3)));
    const nueva = carrera.crear(T0, rngFijo(0.3)); // misma baraja con el mismo rng
    expect(p.estado).toMatchObject({
      ronda: 4,
      fase: "apuestas",
      finFase: T0 + 10 + CARRERA.APUESTAS_MS,
      descartes: [],
      tramosGirados: 0,
      posiciones: { H: 0, D: 0, C: 0, S: 0 },
      apuestas: [],
      abandonos: [],
      ganador: null,
      ventanasVacias: 0,
    });
    expect(p.estado.asientos).toEqual([asiento(1, "ana")]);
    expect(p.estado.tramos).toEqual(nueva.tramos);
    expect(p.estado.mazo).toEqual(nueva.mazo);
    expect(p.estado.mazo).toHaveLength(41);
    expect(p.eventos).toEqual([]);
    expect(p.liquidacion).toBeUndefined();
  });

  it("la pista nueva se reparte de una baraja sin ases completa, no del mazo viejo", () => {
    const p = exito(carrera.tick(resultado(), T0, rng));
    const todas = [...p.estado.tramos, ...p.estado.mazo];
    expect(new Set(todas.map(clave)).size).toBe(48);
    expect(todas.some((carta) => carta.valor === "A")).toBe(false);
  });

  it("tick de resultado antes de tiempo no hace nada", () => {
    const e = resultado({ finFase: T0 + CARRERA.RESULTADO_MS });
    const p = exito(carrera.tick(e, T0 + CARRERA.RESULTADO_MS - 1, rng));
    expect(p.estado).toBe(e);
    expect(p.eventos).toEqual([]);
  });

  it("sin asientos conectados la mesa pasa a esperar y no deja alarma", () => {
    const p = exito(carrera.tick(resultado({ asientos: [asiento(1, "ana", false)] }), T0, rng));
    expect(p.estado.asientos).toEqual([]);
    expect(p.estado).toMatchObject({ ronda: 4, fase: "esperando", finFase: null });
    expect(carrera.proximaAlarma(p.estado)).toBeNull();
  });

  it("entrar con la carrera empezada: sentado sin apuestas, apuesta en la siguiente ventana", () => {
    const e = enCarrera({ asientos: [asiento(1, "ana"), asiento(2, "beto")], posiciones: { H: 7, D: 0, C: 0, S: 0 } });
    const dentro = exito(carrera.sentar(e, 3, "carla", T0)).estado;
    expect(dentro.fase).toBe("carrera");
    expect(dentro.finFase).toBe(e.finFase);
    expect(dentro.plan).toEqual(e.plan);
    expect(error(carrera.aplicar(dentro, 3, apostar("D", 50), T0, rng))).toBe("fase_incorrecta");
    let sig = exito(carrera.tick(dentro, dentro.finFase!, rng)).estado; // gana H
    sig = exito(carrera.tick(sig, sig.finFase!, rng)).estado; // ronda siguiente
    expect(sig.fase).toBe("apuestas");
    expect(exito(carrera.aplicar(sig, 3, apostar("D", 50), sig.finFase! - 1_000, rng)).estado.apuestas).toEqual([ap(3, "D", 50)]);
  });

  it("una ronda completa: apuestas, carrera hasta la meta, resultado y ronda siguiente", () => {
    let e = carrera.crear(T0, rngFijo(0.9));
    e = exito(carrera.sentar(e, 1, "ana", T0)).estado;
    e = exito(carrera.aplicar(e, 1, apostar("H", 50), T0, rng)).estado;
    e = exito(carrera.tick(e, e.finFase!, rng)).estado;
    expect(e.fase).toBe("carrera");
    const meta = e.plan[e.plan.length - 1];
    // Ningún paso intermedio cambia el estado; el de la meta liquida una sola vez.
    for (const p of e.plan.slice(0, -1)) expect(exito(carrera.tick(e, p.momento, rng)).estado).toBe(e);
    const p = exito(carrera.tick(e, e.finFase!, rng));
    expect(p.liquidacion).toBeDefined();
    e = p.estado;
    expect(e.posiciones).toEqual(meta.posiciones);
    expect(e.fase).toBe("resultado");
    expect(e.ganador).not.toBeNull();
    expect(e.posiciones[e.ganador!]).toBe(CARRERA.META);
    expect(e.tramosGirados).toBeLessThanOrEqual(CARRERA.TRAMOS);
    e = exito(carrera.tick(e, e.finFase!, rng)).estado;
    expect(e).toMatchObject({ ronda: 2, fase: "apuestas", ganador: null, apuestas: [] });
  });
});

describe("costo, alarma y resumen", () => {
  it("costo: apostar → cantidad; salir → 0", () => {
    const e = enApuestas();
    expect(carrera.costo(e, 1, apostar("H", 10))).toBe(10);
    expect(carrera.costo(e, 1, apostar("D", 500))).toBe(500);
    expect(carrera.costo(e, 1, { t: "salir" })).toBe(0);
  });

  it("costo nunca devuelve una cantidad inválida", () => {
    const e = enApuestas();
    for (const cantidad of [0, -10, 9, 50.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "50", null, undefined]) {
      expect(carrera.costo(e, 1, { t: "apostar", caballo: "H", cantidad } as unknown as AccionCarrera)).toBe(0);
    }
    expect(carrera.costo(e, 1, { t: "apostar", caballo: "X", cantidad: 50 } as unknown as AccionCarrera)).toBe(0);
  });

  it("costo se calcula sobre el estado anterior: la cantidad pedida, no el acumulado del caballo", () => {
    const e = enApuestas({ apuestas: [ap(1, "H", 300)] });
    const accion = apostar("H", 100);
    expect(carrera.costo(e, 1, accion)).toBe(100);
    const despues = exito(carrera.aplicar(e, 1, accion, T0, rng)).estado;
    expect(despues.apuestas[0].cantidad).toBe(400);
    expect(carrera.costo(despues, 1, accion)).toBe(100);
  });

  it("proximaAlarma es finFase (en plena carrera, la meta: ninguna por paso) y null en esperando", () => {
    expect(carrera.proximaAlarma(enApuestas())).toBe(T0 + CARRERA.APUESTAS_MS);
    const e = enCarrera();
    expect(carrera.proximaAlarma(e)).toBe(e.plan[e.plan.length - 1].momento);
    expect(carrera.proximaAlarma(estado())).toBeNull();
  });

  it("resumen lista los apodos sentados, la fase y el fin de fase", () => {
    expect(carrera.resumen(enApuestas())).toEqual({ jugadores: ["ana", "beto"], fase: "apuestas", finFase: T0 + CARRERA.APUESTAS_MS });
    // en plena carrera, sin cuenta atrás: el resumen no cambia hasta la meta
    expect(carrera.resumen(enCarrera())).toEqual({ jugadores: ["ana", "beto"], fase: "carrera", finFase: null });
    expect(carrera.resumen(estado())).toEqual({ jugadores: [], fase: "esperando", finFase: null });
  });
});

describe("vista", () => {
  /** Una carrera acabada con dos tramos girados; la última carta fue el 3♠. */
  const conGirados = () =>
    estado({
      fase: "resultado",
      finFase: T0 + CARRERA.RESULTADO_MS,
      ganador: "S",
      asientos: [asiento(1, "ana"), asiento(2, "beto")],
      tramos: cs("7D 9H 2C 4S 6D 8C KH"),
      mazo: mazo(""),
      tramosGirados: 2,
      posiciones: { H: 3, D: 3, C: 3, S: 8 },
      descartes: cs("5H 3S"),
      apuestas: [ap(1, "H", 50), ap(1, "S", 20), ap(2, "H", 100), ap(2, "D", 30)],
    });

  it("la vista no revela tramos no girados ni el mazo", () => {
    const e = conGirados();
    const v = carrera.vista(e, 1, T0) as VistaCarrera;
    expect(v.tramos).toEqual([c("7D"), c("9H"), null, null, null, null, null]);
    expect(Object.keys(v).sort()).toEqual(
      ["ronda", "fase", "finFase", "posiciones", "tramos", "ultimaCarta", "misApuestas", "totalesPorCaballo", "sentados", "ganador"].sort(),
    );
    const texto = JSON.stringify(v);
    expect(texto).not.toContain("mazo");
    expect(texto).not.toContain("descartes");
    for (const oculto of e.tramos.slice(2)) expect(texto).not.toContain(JSON.stringify(oculto));
  });

  it("sin tramos girados todos van tapados", () => {
    const v = carrera.vista(enCarrera(), 1, T0) as VistaCarrera;
    expect(v.tramos).toEqual(Array(7).fill(null));
  });

  it("incluye fase, posiciones, sentados y ganador", () => {
    const v = carrera.vista(conGirados(), 1, T0) as VistaCarrera;
    expect(v).toMatchObject({
      ronda: 1,
      fase: "resultado",
      finFase: T0 + CARRERA.RESULTADO_MS,
      posiciones: { H: 3, D: 3, C: 3, S: 8 },
      sentados: ["ana", "beto"],
      ganador: "S",
    });
    expect(carrera.vista(enApuestas(), 1, T0)).toMatchObject({ fase: "apuestas", finFase: T0 + CARRERA.APUESTAS_MS, ganador: null });
  });

  it("ultimaCarta es la última carta sacada, y null si todavía no salió ninguna", () => {
    expect((carrera.vista(conGirados(), 1, T0) as VistaCarrera).ultimaCarta).toEqual(c("3S"));
    expect((carrera.vista(enApuestas(), 1, T0) as VistaCarrera).ultimaCarta).toBeNull();
    expect((carrera.vista(enCarrera(), 1, T0) as VistaCarrera).ultimaCarta).toBeNull();
  });

  it("ultimaCarta sigue siendo la última tras rebarajar el descarte", () => {
    const e = enCarrera({ mazo: [], descartes: cs("2H 3H 4S") }, rngFijo(0.3));
    const v = carrera.vista(e, 1, paso(1)) as VistaCarrera;
    expect(v.ultimaCarta).toEqual(e.plan[0].eventos[1].carta);
    const p = exito(carrera.tick(e, e.finFase!, rng));
    expect((carrera.vista(p.estado, 1, e.finFase!) as VistaCarrera).ultimaCarta).toEqual(e.plan[e.plan.length - 1].carta);
  });

  it("misApuestas son solo las del jugador; totalesPorCaballo suma las de toda la mesa", () => {
    const e = conGirados();
    const ana = carrera.vista(e, 1, T0) as VistaCarrera;
    expect(ana.misApuestas).toEqual([
      { caballo: "H", cantidad: 50 },
      { caballo: "S", cantidad: 20 },
    ]);
    const beto = carrera.vista(e, 2, T0) as VistaCarrera;
    expect(beto.misApuestas).toEqual([
      { caballo: "H", cantidad: 100 },
      { caballo: "D", cantidad: 30 },
    ]);
    for (const v of [ana, beto]) expect(v.totalesPorCaballo).toEqual({ H: 150, D: 30, C: 0, S: 20 });
  });

  it("la vista de un espectador (null) no tiene apuestas propias pero ve los totales", () => {
    const v = carrera.vista(conGirados(), null, T0) as VistaCarrera;
    expect(v.misApuestas).toEqual([]);
    expect(v.totalesPorCaballo).toEqual({ H: 150, D: 30, C: 0, S: 20 });
    expect(carrera.vista(conGirados(), 99, T0)).toMatchObject({ misApuestas: [] });
  });

  it("es JSON serializable y no comparte referencias con el estado", () => {
    const e = conGirados();
    const v = carrera.vista(e, 1, T0) as VistaCarrera;
    expect(JSON.parse(JSON.stringify(v))).toEqual(v);
    (v.tramos[0] as Carta).valor = "K";
    v.sentados.push("intruso");
    v.misApuestas.push({ caballo: "C", cantidad: 1 });
    v.posiciones.H = 99;
    v.ultimaCarta!.valor = "K";
    expect(e.tramos[0]).toEqual(c("7D"));
    expect(e.asientos).toHaveLength(2);
    expect(e.apuestas).toHaveLength(4);
    expect(e.posiciones.H).toBe(3);
    expect(e.descartes[1]).toEqual(c("3S"));
    // en plena carrera tampoco: la vista no comparte nada con el plan
    const enMarcha = enCarrera();
    const w = carrera.vista(enMarcha, 1, paso(1)) as VistaCarrera;
    w.posiciones.H = 99;
    w.ultimaCarta!.valor = "K";
    expect(enMarcha.plan[0].posiciones.H).toBe(1);
    expect(enMarcha.plan[0].carta).toEqual(c("5H"));
    const eventos = carrera.eventosEntre!(enMarcha, T0, paso(1));
    (eventos[0].carta as Carta).valor = "K";
    expect(enMarcha.plan[0].eventos[0]).toEqual({ tipo: "caballo_avanza", palo: "H", carta: c("5H") });
  });
});

describe("estado puro y serializable", () => {
  it("ninguna transición muta el estado de entrada", () => {
    const resultado = estado({
      fase: "resultado",
      finFase: T0,
      ronda: 3,
      ganador: "H",
      posiciones: { H: 8, D: 1, C: 1, S: 1 },
      asientos: [asiento(1, "ana"), asiento(2, "beto", false)],
      apuestas: [ap(1, "H", 50)],
    });
    const ganando = () => enCarrera({ posiciones: { H: 7, D: 3, C: 2, S: 5 } });
    const girando = () => enApuestas({ posiciones: { H: 1, D: 1, C: 1, S: 0 }, mazo: mazo("2S") });
    const llamadas: Array<[string, () => Paso<EstadoCarrera>]> = [
      ["sentar nuevo", () => carrera.sentar(congelar(enApuestas()), 3, "carla", T0)],
      ["sentar en mesa vacía", () => carrera.sentar(congelar(estado()), 3, "carla", T0)],
      ["apostar", () => carrera.aplicar(congelar(enApuestas()), 2, apostar("H", 50), T0, rng)],
      ["apostar acumulando", () => carrera.aplicar(congelar(enApuestas()), 1, apostar("H", 50), T0, rng)],
      ["tick arranque", () => carrera.tick(congelar(enApuestas()), T0 + CARRERA.APUESTAS_MS, rng)],
      ["tick ventana vacía", () => carrera.tick(congelar(enApuestas({ apuestas: [] })), T0 + CARRERA.APUESTAS_MS, rng)],
      ["tick carrera", () => carrera.tick(congelar(enCarrera()), T0 + CARRERA.PASO_MS, rng)],
      ["tick arranque con giro de tramo", () => carrera.tick(congelar(girando()), T0 + CARRERA.APUESTAS_MS, rng)],
      ["tick meta", () => carrera.tick(congelar(ganando()), T0 + CARRERA.PASO_MS, rng)],
      ["tick arranque con rebarajado", () => carrera.tick(congelar(enApuestas({ mazo: [], descartes: cs("2H 3H 4S") })), T0 + CARRERA.APUESTAS_MS, rng)],
      ["tick resultado", () => carrera.tick(congelar(resultado), T0, rng)],
      ["salir", () => carrera.aplicar(congelar(enCarrera()), 1, { t: "salir" }, T0, rng)],
      ["salir el último", () => carrera.aplicar(congelar(enCarrera({ asientos: [asiento(1, "ana")] })), 1, { t: "salir" }, T0, rng)],
      ["desconectar", () => carrera.desconectar(congelar(enCarrera()), 1, T0, rng)],
      ["desconectar en mesa dormida", () => carrera.desconectar(congelar(estado({ asientos: [asiento(1, "ana")] })), 1, T0, rng)],
    ];
    for (const [nombre, llamar] of llamadas) {
      expect(() => llamar(), nombre).not.toThrow();
    }
    expect(() => carrera.vista(congelar(enCarrera()), 1, T0 + CARRERA.PASO_MS)).not.toThrow();
    expect(() => carrera.proximoAviso!(congelar(enCarrera()), T0)).not.toThrow();
    expect(() => carrera.eventosEntre!(congelar(enCarrera()), T0, T0 + 10 ** 6)).not.toThrow();
    expect(() => carrera.resumen(congelar(enCarrera()))).not.toThrow();
    expect(() => carrera.costo(congelar(enCarrera()), 1, apostar("H", 50))).not.toThrow();
  });

  it("cada transición devuelve un estado nuevo", () => {
    const e = enApuestas({ mazo: mazo("5H 3S") });
    const p = exito(carrera.tick(e, T0 + CARRERA.APUESTAS_MS, rng));
    expect(p.estado).not.toBe(e);
    expect(p.estado.mazo).not.toBe(e.mazo);
    expect(e.plan).toEqual([]);
    expect(e.descartes).toEqual([]);
    expect(e.mazo).toHaveLength(SIN_ASES.length + 2);
    const meta = exito(carrera.tick(p.estado, p.estado.finFase!, rng));
    expect(meta.estado.posiciones).not.toBe(p.estado.posiciones);
    expect(p.estado.posiciones).toEqual(POS0());
    expect(p.estado.plan).not.toEqual([]);
  });

  it("el estado de una ronda en marcha sobrevive a JSON sin perder nada", () => {
    let e = carrera.crear(T0, rngFijo(0.9));
    e = exito(carrera.sentar(e, 1, "ana", T0)).estado;
    e = exito(carrera.aplicar(e, 1, apostar("H", 50), T0, rng)).estado;
    e = exito(carrera.tick(e, e.finFase!, rng)).estado;
    expect(e.fase).toBe("carrera");
    expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    // y la máquina sigue funcionando desde el estado reconstruido: misma vista y misma meta
    const reconstruido: EstadoCarrera = JSON.parse(JSON.stringify(e));
    expect(carrera.vista(reconstruido, 1, e.plan[0].momento)).toEqual(carrera.vista(e, 1, e.plan[0].momento));
    const sig = exito(carrera.tick(reconstruido, reconstruido.finFase!, rng));
    expect(sig.estado.fase).toBe("resultado");
    expect(sig.estado.posiciones).toEqual(e.plan[e.plan.length - 1].posiciones);
  });
});
