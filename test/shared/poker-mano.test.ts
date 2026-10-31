import { describe, expect, it } from "vitest";
import { POKER, opcionesDe, poker, type EstadoPoker } from "../../src/shared/juegos/poker";
import { cs } from "../ayudas";
import { T0, aplicar, asiento, conBaraja, error, intentar, mesaCon, rng, turno, vistaDe } from "./ayudas-poker";

/** Todos los que tengan el turno pasan o igualan hasta que cambia la calle. */
function cerrarCalle(e: EstadoPoker): EstadoPoker {
  const calle = e.calle;
  let s = e;
  while (s.fase === "mano" && s.calle === calle) {
    const id = turno(s)!;
    s = aplicar(s, id, { t: opcionesDe(s, id)!.pasar ? "pasar" : "igualar" }).estado;
  }
  return s;
}

/** Empieza una mano nueva a partir de otra ya jugada, como hará el `tick` que cierra `resultado`, sentando a `id`. */
function manoSiguiente(e: EstadoPoker, id: number): EstadoPoker {
  const limpios = e.asientos.map((a) => ({ ...a, aportado: 0 }));
  return aplicar({ ...e, fase: "esperando", asientos: limpios, abandonos: [] }, id, { t: "sentarse", fichas: 100 }).estado;
}

describe("póker: una mano", () => {
  it("ciegas y orden de palabra con 3 jugadores", () => {
    const e = mesaCon([100, 100, 100]);
    expect(e.boton).toBe(0);
    expect(asiento(e, 1)).toMatchObject({ apostado: 0, aportado: 0, fichas: 100 });
    expect(asiento(e, 2)).toMatchObject({ apostado: 5, aportado: 5, fichas: 95 });
    expect(asiento(e, 3)).toMatchObject({ apostado: 10, aportado: 10, fichas: 90 });
    expect(e).toMatchObject({ apuesta: 10, subidaMinima: 10, calle: "preflop", finFase: T0 + POKER.TURNO_MS });

    const orden: (number | null)[] = [];
    let s = e;
    while (s.calle === "preflop") {
      orden.push(turno(s));
      s = cerrarUno(s);
    }
    expect(orden).toEqual([1, 2, 3]);
    // Después del flop habla el primero tras el botón, y el botón el último.
    expect(turno(s)).toBe(2);
    s = aplicar(s, 2, { t: "pasar" }).estado;
    expect(turno(s)).toBe(3);
    s = aplicar(s, 3, { t: "pasar" }).estado;
    expect(turno(s)).toBe(1);
  });

  it("las ciegas salen en los eventos, antes de repartir desde el siguiente al botón", () => {
    const uno = aplicar(poker.crear(T0, rng), 1, { t: "sentarse", fichas: 100 }).estado;
    const { eventos } = aplicar(uno, 2, { t: "sentarse", fichas: 100 });
    expect(eventos.slice(0, 3)).toEqual([
      { tipo: "mano_empezada", ronda: 1, boton: 0 },
      { tipo: "ciega", jugadorId: 1, cantidad: 5 },
      { tipo: "ciega", jugadorId: 2, cantidad: 10 },
    ]);
  });

  it("con 2 jugadores el botón pone la pequeña y habla primero antes del flop y último después", () => {
    let e = mesaCon([100, 100]);
    expect(e.boton).toBe(0);
    expect(asiento(e, 1).apostado).toBe(5);
    expect(asiento(e, 2).apostado).toBe(10);
    expect(turno(e)).toBe(1);
    e = aplicar(e, 1, { t: "igualar" }).estado;
    expect(turno(e)).toBe(2);
    e = aplicar(e, 2, { t: "pasar" }).estado;
    expect(e.calle).toBe("flop");
    expect(turno(e)).toBe(2);
    e = aplicar(e, 2, { t: "pasar" }).estado;
    expect(turno(e)).toBe(1);
  });

  it("con 8 jugadores habla el siguiente a la ciega grande", () => {
    const e = mesaCon(Array<number>(8).fill(100));
    expect(asiento(e, 2).apostado).toBe(5);
    expect(asiento(e, 3).apostado).toBe(10);
    expect(turno(e)).toBe(4);
  });

  it("el botón pasa al siguiente que juega", () => {
    const e = mesaCon([100, 100, 100]);
    expect(e.boton).toBe(0);

    const siguiente = manoSiguiente(e, 4);
    expect(siguiente).toMatchObject({ ronda: 2, boton: 1 });

    // El asiento 1 no juega esta mano (desconectado): el botón lo salta.
    const sinConectar = { ...e, asientos: e.asientos.map((a) => (a.asiento === 1 ? { ...a, conectado: false } : a)) };
    const otra = manoSiguiente(sinConectar, 4);
    expect(otra.boton).toBe(2);
    expect(asiento(otra, 2)).toMatchObject({ estado: "fuera", cartas: [] });
    // Y da la vuelta a la mesa.
    expect(manoSiguiente({ ...e, boton: 3 }, 4).boton).toBe(0);
  });

  it("la ciega grande puede subir aunque nadie haya subido", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    expect(e.calle).toBe("preflop");
    expect(turno(e)).toBe(3);
    expect(opcionesDe(e, 3)).toEqual({ retirarse: true, pasar: true, igualar: null, subir: { min: 20, max: 100 }, ensenar: false });
    e = aplicar(e, 3, { t: "subir", hasta: 20 }).estado;
    expect(e.calle).toBe("preflop");
    expect(turno(e)).toBe(1);
  });

  it("ciega corta: va all-in con lo que tenga y los demás igualan 10", () => {
    const e = mesaCon([100, 100, 7, 100]);
    expect(asiento(e, 3)).toMatchObject({ estado: "allin", apostado: 7, aportado: 7, fichas: 0 });
    expect(e.apuesta).toBe(10);
    expect(turno(e)).toBe(4);
    expect(opcionesDe(e, 4)?.igualar).toBe(10);

    const pequena = mesaCon([100, 3, 100]);
    expect(asiento(pequena, 2)).toMatchObject({ estado: "allin", apostado: 3, fichas: 0 });
    expect(asiento(pequena, 2).cartas).toHaveLength(2);
    expect(asiento(pequena, 3).apostado).toBe(10);
  });

  it("si las ciegas dejan a un solo jugador con fichas, no hay nada que apostar", () => {
    const e = mesaCon([3, 100]);
    // El botón pone 3 y va all-in; la grande ya cubre: nadie puede responderle y no tiene por qué hablar.
    expect(e.fase).toBe("resultado");
    expect(e.mesa).toHaveLength(5);
  });

  it("quien ya cubre todos los all-in no decide: con 2 jugadores, la grande va all-in con 3 y la pequeña puso 5", () => {
    const e = mesaCon([3, 100], T0, 0);
    expect(e.boton).toBe(1);
    expect(asiento(e, 1)).toMatchObject({ estado: "allin", aportado: 3 });
    expect(asiento(e, 2)).toMatchObject({ estado: "juega", aportado: 5 });
    expect(e).toMatchObject({ fase: "resultado", turno: null });
    expect(e.mesa).toHaveLength(5);
  });

  it("quien ya cubre todos los all-in no decide: tampoco si los demás se retiran hasta él", () => {
    let e = mesaCon([100, 100, 3, 100]);
    expect(turno(e)).toBe(4);
    e = aplicar(e, 4, { t: "retirarse" }).estado;
    expect(turno(e)).toBe(1);
    e = aplicar(e, 1, { t: "retirarse" }).estado;
    expect(e).toMatchObject({ fase: "resultado", turno: null });
    expect(e.mesa).toHaveLength(5);
  });

  it("sin nadie más con fichas solo se iguala lo que puso el all-in: la pequeña debe 2, no 5", () => {
    const e = mesaCon([7, 100], T0, 0);
    expect(asiento(e, 1)).toMatchObject({ estado: "allin", apostado: 7 });
    expect(turno(e)).toBe(2);
    expect(opcionesDe(e, 2)).toEqual({ retirarse: true, pasar: false, igualar: 2, subir: null, ensenar: false });
    const { estado, eventos } = aplicar(e, 2, { t: "igualar" });
    expect(eventos[0]).toEqual({ tipo: "accion", jugadorId: 2, accion: "igualar", cantidad: 2 });
    expect(asiento(estado, 2)).toMatchObject({ fichas: 93, aportado: 7 });
    expect(estado).toMatchObject({ fase: "resultado", turno: null });
    expect(estado.mesa).toHaveLength(5);
  });

  it("con otro rival que aún juega se iguala la apuesta entera, aunque la grande sea corta", () => {
    const e = aplicar(mesaCon([100, 100, 7, 100]), 4, { t: "igualar" }).estado;
    expect(turno(e)).toBe(1);
    expect(opcionesDe(e, 1)?.igualar).toBe(10);
    const pequena = aplicar(e, 1, { t: "igualar" }).estado;
    expect(opcionesDe(pequena, 2)?.igualar).toBe(5);
  });

  it("una apuesta de quien se levantó no se paga si solo queda un all-in por cubrir", () => {
    let e = mesaCon([500, 500, 7, 500]);
    e = aplicar(e, 4, { t: "subir", hasta: 40 }).estado;
    e = aplicar(e, 1, { t: "retirarse" }).estado;
    expect(turno(e)).toBe(2);
    expect(opcionesDe(e, 2)?.igualar).toBe(35);
    const { estado } = aplicar(e, 4, { t: "levantarse" }, T0 + 1);
    expect(turno(estado)).toBe(2);
    expect(opcionesDe(estado, 2)).toEqual({ retirarse: true, pasar: false, igualar: 2, subir: null, ensenar: false });
    const fin = aplicar(estado, 2, { t: "igualar" }).estado;
    expect(asiento(fin, 2).aportado).toBe(7);
    expect(fin).toMatchObject({ fase: "resultado", turno: null });
  });

  it("flop, turn y river queman una y abren 3, 1 y 1", () => {
    const baraja = cs("2C 3C 4C 5C 6C 7C 8C 9C");
    let e = conBaraja(mesaCon([100, 100, 100]), baraja);

    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    const flop = aplicar(e, 3, { t: "pasar" }, T0 + 3);
    expect(flop.eventos).toEqual([
      { tipo: "accion", jugadorId: 3, accion: "pasar", cantidad: 0 },
      { tipo: "calle_abierta", calle: "flop", cartas: cs("3C 4C 5C") },
    ]);
    expect(flop.estado).toMatchObject({ calle: "flop", mesa: cs("3C 4C 5C"), apuesta: 0, subidaMinima: 10, finFase: T0 + 3 + POKER.TURNO_MS });
    expect(flop.estado.asientos.map((a) => a.apostado)).toEqual([0, 0, 0]);
    expect(flop.estado.asientos.map((a) => a.aportado)).toEqual([10, 10, 10]);

    const turn = cerrarCalle(flop.estado);
    expect(turn).toMatchObject({ calle: "turn", mesa: cs("3C 4C 5C 7C") });
    const river = cerrarCalle(turn);
    expect(river).toMatchObject({ calle: "river", mesa: cs("3C 4C 5C 7C 9C") });
    expect(river.baraja).toEqual([]);

    const fin = cerrarCalle(river);
    expect(fin).toMatchObject({ fase: "resultado", turno: null, finFase: T0 + POKER.RESULTADO_MS });
  });

  it("pasar con algo que igualar da accion_invalida", () => {
    const e = mesaCon([100, 100, 100]);
    expect(error(intentar(e, 1, { t: "pasar" }))).toBe("accion_invalida");
    expect(opcionesDe(e, 1)).toMatchObject({ pasar: false, igualar: 10 });
  });

  it("igualar sin nada que igualar da accion_invalida", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    expect(error(intentar(e, 3, { t: "igualar" }))).toBe("accion_invalida");
  });

  it("actuar fuera de tu turno da accion_invalida", () => {
    const e = mesaCon([100, 100, 100]);
    for (const accion of [{ t: "retirarse" }, { t: "igualar" }, { t: "pasar" }, { t: "subir", hasta: 30 }] as const) {
      expect(error(intentar(e, 2, accion))).toBe("accion_invalida");
    }
    expect(opcionesDe(e, 2)).toEqual({ retirarse: false, pasar: false, igualar: null, subir: null, ensenar: false });
  });

  it("actuar fuera de una mano da fase_incorrecta, y sin sentarse, no_sentado", () => {
    const solo = aplicar(poker.crear(T0, rng), 1, { t: "sentarse", fichas: 100 }).estado;
    expect(error(intentar(solo, 1, { t: "pasar" }))).toBe("fase_incorrecta");
    expect(error(intentar(solo, 2, { t: "pasar" }))).toBe("no_sentado");
    expect(error(intentar(solo, 1, { t: "desconocida" } as never))).toBe("mensaje_invalido");
  });

  it("la subida mínima es lo que subió el anterior", () => {
    let e = mesaCon([500, 500, 500]);
    expect(opcionesDe(e, 1)?.subir).toEqual({ min: 20, max: 500 });
    e = aplicar(e, 1, { t: "subir", hasta: 30 }).estado;
    expect(e).toMatchObject({ apuesta: 30, subidaMinima: 20 });
    expect(opcionesDe(e, 2)?.subir).toEqual({ min: 50, max: 500 });
    expect(error(intentar(e, 2, { t: "subir", hasta: 45 }))).toBe("apuesta_invalida");
    expect(error(intentar(e, 2, { t: "subir", hasta: 30 }))).toBe("apuesta_invalida");
    e = aplicar(e, 2, { t: "subir", hasta: 50 }).estado;
    expect(e).toMatchObject({ apuesta: 50, subidaMinima: 20 });
  });

  it("una subida que no es un entero o supera tus fichas da apuesta_invalida", () => {
    const e = mesaCon([100, 100, 100]);
    for (const hasta of [101, 30.5, Number.NaN, "30" as unknown as number, undefined as unknown as number]) {
      expect(error(intentar(e, 1, { t: "subir", hasta }))).toBe("apuesta_invalida");
    }
  });

  it("sin nada apostado, la apuesta mínima es la ciega grande", () => {
    let e = cerrarCalle(mesaCon([100, 100, 100]));
    expect(e.calle).toBe("flop");
    expect(opcionesDe(e, 2)?.subir).toEqual({ min: 10, max: 90 });
    expect(error(intentar(e, 2, { t: "subir", hasta: 9 }))).toBe("apuesta_invalida");
    e = aplicar(e, 2, { t: "subir", hasta: 10 }).estado;
    expect(e.ultimoAgresor).toBe(1);
  });

  it("una subida completa reabre las apuestas a quien ya había actuado", () => {
    let e = mesaCon([500, 500, 500]);
    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    e = aplicar(e, 3, { t: "subir", hasta: 40 }).estado;
    expect(turno(e)).toBe(1);
    expect(asiento(e, 1)).toMatchObject({ actuo: false, puedeSubir: true });
    expect(opcionesDe(e, 1)?.subir).toEqual({ min: 70, max: 500 });
  });

  it("un all-in corto no reabre: quien ya actuó solo puede igualar o retirarse", () => {
    // Orden: 4, 1, 2, 3. El 4 sube a 40 (30 más) y el 1 va all-in con 55, que no llega a 70.
    let e = mesaCon([55, 500, 500, 500]);
    e = aplicar(e, 4, { t: "subir", hasta: 40 }).estado;
    expect(e.subidaMinima).toBe(30);
    expect(opcionesDe(e, 1)?.subir).toEqual({ min: 55, max: 55 });
    expect(error(intentar(e, 1, { t: "subir", hasta: 54 }))).toBe("apuesta_invalida");
    e = aplicar(e, 1, { t: "subir", hasta: 55 }).estado;
    expect(asiento(e, 1).estado).toBe("allin");
    expect(e).toMatchObject({ apuesta: 55, subidaMinima: 30 });

    // Quien aún no había actuado sí puede subir, y desde lo que marca la subida anterior completa.
    expect(opcionesDe(e, 2)?.subir).toEqual({ min: 85, max: 500 });
    e = aplicar(e, 2, { t: "igualar" }).estado;
    e = aplicar(e, 3, { t: "igualar" }).estado;

    expect(turno(e)).toBe(4);
    expect(asiento(e, 4).puedeSubir).toBe(false);
    expect(opcionesDe(e, 4)).toEqual({ retirarse: true, pasar: false, igualar: 15, subir: null, ensenar: false });
    expect(error(intentar(e, 4, { t: "subir", hasta: 200 }))).toBe("apuesta_invalida");
    e = aplicar(e, 4, { t: "igualar" }).estado;
    expect(e.calle).toBe("flop");
  });

  it("no se puede subir si no te llega o si nadie más puede responder", () => {
    // El 2 solo puede igualar: sus fichas no pasan de la apuesta.
    let e = mesaCon([500, 40, 500]);
    e = aplicar(e, 1, { t: "subir", hasta: 60 }).estado;
    expect(opcionesDe(e, 2)).toMatchObject({ igualar: 35, subir: null });

    // Con el rival all-in nadie responde a una subida, aunque haya que igualar.
    let f = mesaCon([500, 500]);
    f = aplicar(f, 1, { t: "subir", hasta: 500 }).estado;
    expect(asiento(f, 1).estado).toBe("allin");
    expect(opcionesDe(f, 2)).toEqual({ retirarse: true, pasar: false, igualar: 490, subir: null, ensenar: false });
  });

  it("se puede igualar con menos: va all-in", () => {
    let e = mesaCon([30, 100, 100]);
    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "subir", hasta: 60 }).estado;
    e = aplicar(e, 3, { t: "igualar" }).estado;
    expect(opcionesDe(e, 1)?.igualar).toBe(20);
    const { estado, eventos } = aplicar(e, 1, { t: "igualar" });
    expect(asiento(estado, 1)).toMatchObject({ estado: "allin", fichas: 0, aportado: 30 });
    expect(eventos[0]).toEqual({ tipo: "accion", jugadorId: 1, accion: "allin", cantidad: 20 });
    expect(estado.apuesta).toBe(0);
    expect(estado.calle).toBe("flop");
  });

  it("los eventos de acción dicen lo que puso cada uno", () => {
    let e = mesaCon([100, 100, 100]);
    const igualar = aplicar(e, 1, { t: "igualar" });
    expect(igualar.eventos).toEqual([{ tipo: "accion", jugadorId: 1, accion: "igualar", cantidad: 10 }]);
    e = igualar.estado;
    const subir = aplicar(e, 2, { t: "subir", hasta: 30 });
    expect(subir.eventos).toEqual([{ tipo: "accion", jugadorId: 2, accion: "subir", cantidad: 25 }]);
    e = subir.estado;
    expect(e.ultimoAgresor).toBe(1);
    const retirarse = aplicar(e, 3, { t: "retirarse" });
    expect(retirarse.eventos).toEqual([{ tipo: "accion", jugadorId: 3, accion: "retirarse", cantidad: 0 }]);
    expect(asiento(retirarse.estado, 3).estado).toBe("retirado");
    // Los retirados ya no hablan y lo que pusieron sigue en la mano.
    expect(asiento(retirarse.estado, 3).aportado).toBe(10);
    expect(turno(retirarse.estado)).toBe(1);
  });

  it("si solo queda uno sin retirarse, la mano acaba", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 1, { t: "retirarse" }).estado;
    const { estado } = aplicar(e, 2, { t: "retirarse" }, T0 + 2);
    expect(estado).toMatchObject({ fase: "resultado", turno: null, finFase: T0 + 2 + POKER.RESULTADO_MS });
  });

  it("los botes de la vista solo cuentan las rondas cerradas y los abandonos", () => {
    let e = mesaCon([100, 100, 100]);
    expect(vistaDe(e, 1).botes).toEqual([]);
    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    e = aplicar(e, 3, { t: "pasar" }).estado;
    expect(vistaDe(e, 1).botes).toEqual([{ cantidad: 30, jugadores: [1, 2, 3] }]);
    e = aplicar(e, 2, { t: "subir", hasta: 40 }).estado;
    expect(vistaDe(e, 1).botes).toEqual([{ cantidad: 30, jugadores: [1, 2, 3] }]);
  });

  it("si la ciega grande se levanta antes del flop, sus fichas no desaparecen del bote", () => {
    const e = mesaCon([100, 100, 100]);
    const { estado } = aplicar(e, 3, { t: "levantarse" });
    expect(vistaDe(estado, 1).botes).toEqual([{ cantidad: 10, jugadores: [1, 2] }]);
  });

  it("la vista no lleva las cartas de otro, ni la baraja, ni las cartas futuras", () => {
    let e = mesaCon([100, 100, 100]);
    e = cerrarCalle(e);
    expect(e.mesa).toHaveLength(3);
    const texto = (carta: unknown) => JSON.stringify(carta);

    for (const quien of [1, 2, 3, 9, null]) {
      const json = JSON.stringify(vistaDe(e, quien));
      for (const carta of e.baraja) expect(json).not.toContain(texto(carta));
      for (const a of e.asientos) {
        for (const carta of a.cartas) {
          if (a.jugadorId === quien) expect(json).toContain(texto(carta));
          else expect(json).not.toContain(texto(carta));
        }
      }
      for (const carta of e.mesa) expect(json).toContain(texto(carta));
      expect(json).not.toContain("baraja");
    }

    const v = vistaDe(e, 1);
    expect(v.misCartas).toEqual(asiento(e, 1).cartas);
    expect(v.asientos.map((a) => a.cartas)).toEqual([null, null, null]);
    expect(v.asientos.map((a) => a.tieneCartas)).toEqual([true, true, true]);
    expect(v.asientos.map((a) => a.boton)).toEqual([true, false, false]);
    expect(v.turno).toBe(2);
  });

  it("quien se retira deja de enseñar que tiene cartas, pero sigue viendo las suyas", () => {
    const { estado } = aplicar(mesaCon([100, 100, 100]), 1, { t: "retirarse" });
    expect(vistaDe(estado, 2).asientos[0]).toMatchObject({ estado: "retirado", tieneCartas: false, cartas: null });
    expect(vistaDe(estado, 1).misCartas).toEqual(asiento(estado, 1).cartas);
  });

  it("carta_repartida no lleva la carta", () => {
    const uno = aplicar(poker.crear(T0, rng), 1, { t: "sentarse", fichas: 100 }).estado;
    const { eventos } = aplicar(uno, 2, { t: "sentarse", fichas: 100 });
    const repartos = eventos.filter((x) => x.tipo === "carta_repartida");
    // Una a una, desde el siguiente al botón.
    expect(repartos).toEqual([2, 1, 2, 1].map((a) => ({ tipo: "carta_repartida", a })));
  });
});

/** Quien tiene el turno iguala, o pasa si no hay nada que igualar. */
function cerrarUno(e: EstadoPoker): EstadoPoker {
  const id = turno(e)!;
  return aplicar(e, id, { t: opcionesDe(e, id)!.pasar ? "pasar" : "igualar" }).estado;
}
