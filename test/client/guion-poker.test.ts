import { describe, expect, it } from "vitest";
import {
  encolarGuion,
  ENTRE_CARTAS_MESA_MS,
  finDeLasCartas,
  fotoAntesDeLaMano,
  fotoDeLaVista,
  fotoEn,
  GUION_VACIO,
  guionDelLote,
  hitosDelGuion,
  VUELO_BOTE_MS,
  VUELO_FICHAS_MS,
  vistaEn,
} from "../../src/client/pantallas/poker/guion";
import type { Carta } from "../../src/shared/cartas";
import { BJ } from "../../src/shared/juegos/blackjack";
import { type AsientoVista, POKER, type VistaPoker } from "../../src/shared/juegos/poker";
import type { Evento } from "../../src/shared/juegos/tipos";

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Carta["palo"], valor: texto.slice(0, -1) as Carta["valor"] });

const FLOP = [c("2C"), c("7D"), c("KS")];
const TURN = [c("9H")];
const RIVER = [c("QD")];

const reparte = (a: number): Evento => ({ tipo: "carta_repartida", a });
const ciega = (jugadorId: number, cantidad: number): Evento => ({ tipo: "ciega", jugadorId, cantidad });
const accion = (jugadorId: number, nombre: string, cantidad: number): Evento => ({ tipo: "accion", jugadorId, accion: nombre, cantidad });
const calle = (nombre: string, cartas: Carta[]): Evento => ({ tipo: "calle_abierta", calle: nombre, cartas });
const ensenadas = (jugadorId: number): Evento => ({ tipo: "cartas_ensenadas", jugadorId, cartas: [c("AS"), c("AD")] });
const devuelto = (jugadorId: number, cantidad: number): Evento => ({ tipo: "bote_devuelto", jugadorId, cantidad });
const ganado = (jugadorId: number, cantidad: number, indiceBote = 0): Evento => ({ tipo: "bote_ganado", jugadorId, cantidad, indiceBote });

/** Una mesa con los jugadores 1, 2 y 3: lo que no se diga, con 1.000 fichas y nada apostado. */
function vista(resto: Partial<VistaPoker> = {}, porJugador: Record<number, Partial<AsientoVista>> = {}): VistaPoker {
  const asientos = [1, 2, 3].map((jugadorId, asiento) => ({
    asiento,
    jugadorId,
    apodo: `j${jugadorId}`,
    fichas: 1000,
    apostado: 0,
    estado: "juega" as const,
    conectado: true,
    boton: false,
    tieneCartas: true,
    cartas: null,
    ...porJugador[jugadorId],
  }));
  return { ronda: 3, fase: "mano", calle: "preflop", finFase: 0, mesa: [], botes: [], turno: 1, asientos, asientosLibres: 5, yo: 1, misCartas: [c("AS"), c("AD")], opciones: null, porEntrar: 0, ...resto };
}

const asiento = (v: VistaPoker, jugadorId: number) => v.asientos.find((a) => a.jugadorId === jugadorId)!;
const bote = (v: VistaPoker) => v.botes.reduce((suma, b) => suma + b.cantidad, 0);

describe("guionDelLote", () => {
  it("las cartas salen una a una", () => {
    const guion = guionDelLote([reparte(1), reparte(2), reparte(1), reparte(2)]);
    expect(guion.reparto.get(1)).toEqual([0, 2 * BJ.ESCALONADO_MS]);
    expect(guion.reparto.get(2)).toEqual([BJ.ESCALONADO_MS, 3 * BJ.ESCALONADO_MS]);
    expect(guion.fin).toBe(3 * BJ.ESCALONADO_MS + BJ.VUELO_MS);
  });

  it("las ciegas vuelan una tras otra y las cartas salen después que ellas", () => {
    const guion = guionDelLote([{ tipo: "mano_empezada", ronda: 3, boton: 0 }, ciega(2, 5), ciega(3, 10), reparte(2), reparte(3)]);
    expect(guion.fichas.map((f) => f.jugadorId)).toEqual([2, 3]);
    expect(guion.fichas.map((f) => f.cantidad)).toEqual([5, 10]);
    expect(guion.fichas[0].en).toBeLessThan(guion.fichas[1].en);
    expect(guion.reparto.get(2)![0]).toBeGreaterThan(guion.fichas[1].en);
  });

  it("una acción sin fichas no vuela", () => {
    expect(guionDelLote([accion(1, "pasar", 0), accion(2, "retirarse", 0)]).fichas).toEqual([]);
    expect(guionDelLote([accion(1, "pasar", 0)]).fin).toBe(0);
  });

  it("la calle se abre cuando las apuestas ya han llegado al bote", () => {
    const guion = guionDelLote([accion(2, "igualar", 20), calle("flop", FLOP)]);
    expect(guion.barridos).toEqual([VUELO_FICHAS_MS]);
    expect(guion.calles[0].en).toBe(guion.barridos[0] + VUELO_FICHAS_MS);
    expect(guion.calles[0].cartas).toEqual(FLOP);
  });

  it("en un all-in cada grupo de la mesa sale CALLE_MS después", () => {
    const guion = guionDelLote([accion(2, "allin", 500), ensenadas(1), ensenadas(2), calle("flop", FLOP), calle("turn", TURN), calle("river", RIVER), ganado(1, 1000)]);
    const [flop, turn, river] = guion.calles;
    expect(turn.en - flop.en).toBe(POKER.CALLE_MS);
    expect(river.en - turn.en).toBe(POKER.CALLE_MS);
    expect(guion.barridos).toHaveLength(1);
  });

  it("las manos se enseñan una a una, antes de sacar las cartas de la mesa", () => {
    const guion = guionDelLote([ensenadas(1), ensenadas(2), calle("flop", FLOP)]);
    expect(guion.ensenadas.map((e) => e.jugadorId)).toEqual([1, 2]);
    expect(guion.ensenadas[1].en).toBeGreaterThan(guion.ensenadas[0].en);
    expect(guion.calles[0].en).toBeGreaterThan(guion.ensenadas[1].en);
  });

  it("el premio llega tras la última carta", () => {
    const guion = guionDelLote([calle("flop", FLOP), calle("turn", TURN), calle("river", RIVER), ganado(2, 300)]);
    expect(guion.premios).toHaveLength(1);
    expect(guion.premios[0]).toMatchObject({ jugadorId: 2, cantidad: 300 });
    expect(guion.premios[0].en).toBeGreaterThanOrEqual(guion.calles[2].en + POKER.CALLE_MS);
    expect(guion.fin).toBe(guion.premios[0].en + VUELO_BOTE_MS);
  });

  it("lo que nadie iguala vuelve antes de comparar manos", () => {
    const guion = guionDelLote([accion(1, "allin", 500), devuelto(1, 300), ensenadas(1), ensenadas(2), ganado(2, 400)]);
    expect(guion.devueltos).toEqual([{ jugadorId: 1, cantidad: 300, en: VUELO_FICHAS_MS }]);
    expect(guion.ensenadas[0].en).toBeGreaterThanOrEqual(VUELO_FICHAS_MS * 2);
  });

  it("los ganadores de un mismo bote cobran a la vez y cada bote va después del anterior", () => {
    const guion = guionDelLote([ganado(1, 50, 0), ganado(2, 50, 0), ganado(3, 200, 1)]);
    expect(guion.premios[0].en).toBe(guion.premios[1].en);
    expect(guion.premios[2].en).toBe(guion.premios[0].en + VUELO_BOTE_MS);
  });

  it("si en el lote empieza otra mano, lo de la anterior no se anima", () => {
    const guion = guionDelLote([calle("river", RIVER), ganado(2, 300), { tipo: "mano_empezada", ronda: 4, boton: 1 }, ciega(1, 5), reparte(1)]);
    expect(guion.calles).toEqual([]);
    expect(guion.premios).toEqual([]);
    expect(guion.fichas).toHaveLength(1);
    expect(guion.reparto.get(1)).toHaveLength(1);
  });
});

describe("encolarGuion", () => {
  it("lo nuevo sale cuando acaba lo que está en marcha y lo de antes conserva su momento", () => {
    const reparto = guionDelLote([reparte(1), reparte(2)]);
    const cola = encolarGuion(reparto, 100, guionDelLote([accion(1, "igualar", 20), calle("flop", FLOP)]));
    expect(cola.reparto.get(2)).toEqual([BJ.ESCALONADO_MS]);
    expect(cola.fichas[0].en).toBe(reparto.fin);
    expect(cola.calles[0].en).toBe(reparto.fin + 2 * VUELO_FICHAS_MS);
    expect(cola.fin).toBe(cola.calles[0].en + POKER.CALLE_MS);
  });

  it("detrás de un guion terminado, lo nuevo sale ya", () => {
    const cola = encolarGuion(guionDelLote([reparte(1)]), 5000, guionDelLote([accion(1, "igualar", 20)]));
    expect(cola.fichas[0].en).toBe(5000);
  });
});

describe("lo que se ve en cada momento", () => {
  /** Quien iguala cierra la ronda: la vista ya trae el flop, las apuestas a cero y el bote con todo. */
  const antes = vista({}, { 1: { fichas: 960, apostado: 40 }, 2: { fichas: 980, apostado: 20 }, 3: { estado: "retirado", tieneCartas: false } });
  const despues = vista({ calle: "flop", mesa: FLOP, botes: [{ cantidad: 80, jugadores: [1, 2] }], turno: 2 }, { 1: { fichas: 960 }, 2: { fichas: 960 }, 3: { estado: "retirado", tieneCartas: false } });
  const guion = guionDelLote([accion(2, "igualar", 20), calle("flop", FLOP)]);
  const base = fotoDeLaVista(antes);
  const en = (hito: number) => vistaEn(despues, base, guion, hito);

  it("la mesa, lo apostado y las pilas se retienen hasta que su guion llega", () => {
    const inicio = en(0);
    expect(inicio.mesa).toEqual([]);
    expect(asiento(inicio, 2).fichas).toBe(980);
    expect(asiento(inicio, 2).apostado).toBe(20);
    expect(asiento(inicio, 1).apostado).toBe(40);
    expect(bote(inicio)).toBe(0);
  });

  it("la ficha cuenta al llegar y el barrido deja las apuestas en el bote", () => {
    const igualado = en(VUELO_FICHAS_MS);
    expect(asiento(igualado, 2).fichas).toBe(960);
    expect(asiento(igualado, 2).apostado).toBe(40);
    const barrido = en(2 * VUELO_FICHAS_MS);
    expect(asiento(barrido, 1).apostado).toBe(0);
    expect(asiento(barrido, 2).apostado).toBe(0);
    expect(bote(barrido)).toBe(80);
  });

  it("las cartas de la mesa salen de una en una y en orden", () => {
    const { en: salida } = guion.calles[0];
    expect(en(salida - 1).mesa).toEqual([]);
    expect(en(salida).mesa).toEqual(FLOP.slice(0, 1));
    expect(en(salida + ENTRE_CARTAS_MESA_MS).mesa).toEqual(FLOP.slice(0, 2));
    expect(en(salida + 2 * ENTRE_CARTAS_MESA_MS).mesa).toEqual(FLOP);
  });

  it("nadie tiene la palabra hasta que se han visto las cartas", () => {
    expect(en(guion.calles[0].en).turno).toBeNull();
    expect(en(finDeLasCartas(guion)).turno).toBe(2);
  });

  it("al terminar el guion se ve la vista tal cual", () => {
    expect(en(guion.fin)).toBe(despues);
    expect(vistaEn(despues, null, GUION_VACIO, Infinity)).toBe(despues);
  });

  it("la pila del ganador no sube hasta que llegan las fichas, y lo devuelto vuelve antes", () => {
    const antesDelFinal = vista({ calle: "river", mesa: [...FLOP, ...TURN, ...RIVER], botes: [{ cantidad: 200, jugadores: [1, 2] }] }, { 1: { fichas: 500, apostado: 300 }, 2: { fichas: 0, apostado: 100, estado: "allin" } });
    const final = vista({ fase: "resultado", calle: "river", mesa: antesDelFinal.mesa, botes: [{ cantidad: 400, jugadores: [1, 2] }], turno: null }, { 1: { fichas: 700 }, 2: { fichas: 400, estado: "allin" } });
    const fin = guionDelLote([devuelto(1, 200), ganado(2, 400)]);
    const foto = fotoDeLaVista(antesDelFinal);
    const momento = (hito: number) => vistaEn(final, foto, fin, hito);
    expect(asiento(momento(0), 1).fichas).toBe(500);
    expect(asiento(momento(VUELO_FICHAS_MS), 1).fichas).toBe(700);
    expect(asiento(momento(VUELO_FICHAS_MS), 1).apostado).toBe(100);
    expect(asiento(momento(fin.premios[0].en), 2).fichas).toBe(0);
    expect(bote(momento(fin.barridos[0] + VUELO_FICHAS_MS))).toBe(400);
    expect(asiento(momento(fin.premios[0].en + VUELO_BOTE_MS - 1), 2).fichas).toBe(0);
    expect(asiento(momento(fin.premios[0].en + VUELO_BOTE_MS), 2).fichas).toBe(400);
  });

  it("las cartas enseñadas siguen boca abajo hasta su momento", () => {
    const mano = vista({ fase: "resultado" }, { 2: { cartas: [c("AS"), c("AD")] } });
    const conEnsenar = guionDelLote([accion(1, "igualar", 20), ensenadas(2)]);
    const foto = fotoDeLaVista(vista());
    expect(asiento(vistaEn(mano, foto, conEnsenar, conEnsenar.ensenadas[0].en - 1), 2).cartas).toBeNull();
    expect(asiento(vistaEn(mano, foto, conEnsenar, conEnsenar.ensenadas[0].en), 2).cartas).toHaveLength(2);
  });

  it("una mano nueva arranca con las pilas de antes de las ciegas y sin bote", () => {
    const nueva = vista({ ronda: 4, botes: [] }, { 1: { fichas: 995, apostado: 5 }, 2: { fichas: 990, apostado: 10 } });
    const inicio = guionDelLote([{ tipo: "mano_empezada", ronda: 4, boton: 0 }, ciega(1, 5), ciega(2, 10), reparte(1), reparte(2), reparte(3)]);
    const foto = fotoAntesDeLaMano(nueva, inicio);
    expect(foto.pilas.get(1)).toBe(1000);
    expect(foto.pilas.get(2)).toBe(1000);
    expect(foto.pilas.get(3)).toBe(1000);
    expect(foto.bote).toBe(0);
    const mostrada = fotoEn(foto, inicio, 0);
    expect(mostrada.apuestas.get(1) ?? 0).toBe(0);
  });
});

describe("hitosDelGuion", () => {
  it("incluye cada momento en que cambia lo que se ve", () => {
    const guion = guionDelLote([reparte(1), accion(1, "igualar", 20), calle("flop", FLOP), ganado(1, 40)]);
    const hitos = hitosDelGuion(guion);
    expect(hitos.has(guion.reparto.get(1)![0] + BJ.VUELO_MS)).toBe(true);
    expect(hitos.has(guion.fichas[0].en)).toBe(true);
    expect(hitos.has(guion.fichas[0].en + VUELO_FICHAS_MS)).toBe(true);
    expect(hitos.has(guion.calles[0].en + 2 * ENTRE_CARTAS_MESA_MS)).toBe(true);
    expect(hitos.has(finDeLasCartas(guion))).toBe(true);
    expect(hitos.has(guion.premios[0].en + VUELO_BOTE_MS)).toBe(true);
    expect(hitos.has(guion.fin)).toBe(true);
  });
});
