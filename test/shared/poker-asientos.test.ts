import { describe, expect, it } from "vitest";
import { POKER, opcionesDe, poker, type EstadoPoker } from "../../src/shared/juegos/poker";
import { T0, aplicar, asiento, error, intentar, mesaCon, rng, turno, vistaDe } from "./ayudas-poker";

const SIN_OPCIONES = { retirarse: false, pasar: false, igualar: null, subir: null, ensenar: false };

const vacia = (): EstadoPoker => poker.crear(T0, rng);
/** Una mesa con una sola persona sentada, a la espera de rival. */
const conUno = (fichas = 100): EstadoPoker => aplicar(vacia(), 1, { t: "sentarse", fichas }).estado;

describe("póker: asientos", () => {
  it("entrar no sienta: la vista de quien mira no tiene cartas ni opciones", () => {
    const e = vacia();
    const paso = poker.sentar(e, 1, "Ana", T0);
    expect(paso).toEqual({ ok: true, estado: e, eventos: [] });
    expect(paso.ok && paso.estado).toBe(e);

    const mano = mesaCon([100, 100]);
    for (const quien of [9, null]) {
      const v = vistaDe(mano, quien);
      expect(v.misCartas).toBeNull();
      expect(v.opciones).toBeNull();
      expect(v.porEntrar).toBe(0);
      expect(v.asientos).toHaveLength(2);
    }
    expect(opcionesDe(mano, 9)).toBeNull();
  });

  it("sentar solo devuelve la conexión a quien ya estaba sentado", () => {
    const e = mesaCon([100, 100]);
    const fuera = poker.desconectar(e, 1, T0, rng);
    if (!fuera.ok) throw new Error("no se pudo desconectar");
    expect(asiento(fuera.estado, 1).conectado).toBe(false);
    const dentro = poker.sentar(fuera.estado, 1, "J1", T0);
    if (!dentro.ok) throw new Error("no se pudo volver");
    expect(asiento(dentro.estado, 1).conectado).toBe(true);
    expect(asiento(fuera.estado, 1).conectado).toBe(false);
    // Ya conectado no hay nada que guardar.
    const otra = poker.sentar(dentro.estado, 1, "J1", T0);
    expect(otra.ok && otra.estado).toBe(dentro.estado);
  });

  it("sentarse ocupa el asiento más bajo y abre una sesión", () => {
    const antes = vacia();
    const accion = { t: "sentarse", fichas: 250 } as const;
    expect(poker.rondaDelCobro?.(antes, 1, accion)).toBe(antes.siguienteSesion);
    expect(poker.costo(antes, 1, accion)).toBe(250);

    const e = aplicar(antes, 1, accion).estado;
    const a = asiento(e, 1);
    expect(a).toMatchObject({ asiento: 0, apodo: "J1", sesion: antes.siguienteSesion, comprado: 250, fichas: 250, porEntrar: 0, conectado: true, estado: "fuera" });
    expect(e.siguienteSesion).toBe(antes.siguienteSesion + 1);

    expect(poker.rondaDelCobro?.(e, 1, { t: "anadir", fichas: 50 })).toBe(a.sesion);
    expect(poker.costo(e, 1, { t: "anadir", fichas: 50 })).toBe(50);
    expect(poker.costo(e, 1, { t: "levantarse" })).toBe(0);
    expect(poker.costo(e, 1, { t: "subir", hasta: 50 })).toBe(0);

    // El hueco que deja quien se va es el primero que se ocupa.
    const llena = mesaCon([100, 100, 100]);
    const conHueco = aplicar(llena, 2, { t: "levantarse" }).estado;
    expect(asiento(aplicar(conHueco, 7, { t: "sentarse", fichas: 10 }).estado, 7).asiento).toBe(1);
    expect(aplicar(conHueco, 7, { t: "sentarse", fichas: 10 }).estado.asientos.map((x) => x.asiento)).toEqual([0, 1, 2]);
  });

  it("con el segundo sentado empieza la mano", () => {
    const uno = conUno();
    expect(uno).toMatchObject({ fase: "esperando", ronda: 0, finFase: T0 + POKER.SOLO_MS });
    const { estado, eventos } = aplicar(uno, 2, { t: "sentarse", fichas: 100 }, T0 + 5);
    expect(estado).toMatchObject({ fase: "mano", ronda: 1, calle: "preflop", boton: 0, finFase: T0 + 5 + POKER.TURNO_MS });
    expect(eventos[0]).toEqual({ tipo: "mano_empezada", ronda: 1, boton: 0 });
    expect(asiento(estado, 1).cartas).toHaveLength(2);
    expect(asiento(estado, 2).cartas).toHaveLength(2);
    expect(estado.baraja).toHaveLength(48);
  });

  it("con 8 sentados, sentarse da sin_asiento", () => {
    const e = mesaCon(Array<number>(POKER.MAX_JUGADORES).fill(100));
    expect(vistaDe(e, null).asientosLibres).toBe(0);
    expect(error(intentar(e, 9, { t: "sentarse", fichas: 100 }))).toBe("sin_asiento");
  });

  it("la sesión 11 en una hora da demasiadas_sesiones y no cobra", () => {
    let e = vacia();
    for (let i = 0; i < POKER.SESIONES_POR_HORA; i++) {
      const ahora = T0 + i * 1000;
      e = aplicar(e, 1, { t: "sentarse", fichas: 100 }, ahora).estado;
      e = aplicar(e, 1, { t: "levantarse" }, ahora + 500).estado;
    }
    expect(e.asientos).toEqual([]);
    const intento = intentar(e, 1, { t: "sentarse", fichas: 100 }, T0 + 20_000);
    expect(error(intento)).toBe("demasiadas_sesiones");
    // Otro jugador no paga las sesiones de este, y la mesa sigue igual.
    expect(error(intentar(e, 2, { t: "sentarse", fichas: 100 }, T0 + 20_000))).toBe("ok");
    expect(e.siguienteSesion).toBe(POKER.SESIONES_POR_HORA + 1);
  });

  it("pasada la hora se puede volver a sentar", () => {
    let e = vacia();
    for (let i = 0; i < POKER.SESIONES_POR_HORA; i++) {
      e = aplicar(e, 1, { t: "sentarse", fichas: 100 }, T0 + i).estado;
      e = aplicar(e, 1, { t: "levantarse" }, T0 + i).estado;
    }
    // La más antigua cumple la hora justo cuando deja de contar; la siguiente sigue dentro.
    expect(error(intentar(e, 1, { t: "sentarse", fichas: 100 }, T0 + 3_600_000 - 1))).toBe("demasiadas_sesiones");
    const libre = intentar(e, 1, { t: "sentarse", fichas: 100 }, T0 + 3_600_000);
    expect(error(libre)).toBe("ok");
    // Solo una ha caducado: la siguiente se sienta, pero la otra sesión vuelve a llenar el cupo.
    if (!libre.ok) throw new Error("no se pudo sentar");
    expect(error(intentar(aplicar(libre.estado, 1, { t: "levantarse" }, T0 + 3_600_000).estado, 1, { t: "sentarse", fichas: 100 }, T0 + 3_600_000))).toBe("demasiadas_sesiones");
    // Y con la hora entera pasada para todas, el estado ya no guarda nada de ellas.
    const tarde = aplicar(e, 1, { t: "sentarse", fichas: 100 }, T0 + 2 * 3_600_000).estado;
    expect(Object.values(tarde.sesiones).flat()).toEqual([T0 + 2 * 3_600_000]);
  });

  it("sentarse dos veces da accion_invalida", () => {
    expect(error(intentar(conUno(), 1, { t: "sentarse", fichas: 100 }))).toBe("accion_invalida");
  });

  it("sentarse con 9 fichas da apuesta_invalida", () => {
    for (const fichas of [9, 0, -10, 10.5, Number.MAX_SAFE_INTEGER + 1, "20" as unknown as number, undefined as unknown as number]) {
      expect(error(intentar(vacia(), 1, { t: "sentarse", fichas }))).toBe("apuesta_invalida");
    }
  });

  it("sentarse no tiene máximo: la compra es desde COMPRA_MIN", () => {
    expect(asiento(aplicar(vacia(), 1, { t: "sentarse", fichas: POKER.COMPRA_MIN }).estado, 1).fichas).toBe(10);
    expect(asiento(aplicar(vacia(), 1, { t: "sentarse", fichas: 1_000_000 }).estado, 1).fichas).toBe(1_000_000);
  });

  it("sin apodo no se ocupa un asiento: la mesa siempre tiene que pasarlo", () => {
    expect(error(poker.aplicar(vacia(), 1, { t: "sentarse", fichas: 100 }, T0, rng))).toBe("no_disponible");
  });

  it("quien se sienta a mitad de mano la mira sin cartas ni opciones y juega la siguiente", () => {
    const e = mesaCon([100, 100]);
    const { estado, eventos } = aplicar(e, 3, { t: "sentarse", fichas: 100 });
    expect(eventos).toEqual([]);
    const a = asiento(estado, 3);
    expect(a).toMatchObject({ estado: "fuera", fichas: 100, apostado: 0, aportado: 0, cartas: [] });
    expect(estado.turno).toBe(e.turno);
    expect(estado.finFase).toBe(e.finFase);

    const v = vistaDe(estado, 3);
    expect(v.misCartas).toBeNull();
    expect(v.opciones).toEqual(SIN_OPCIONES);
    expect(v.asientos.find((x) => x.jugadorId === 3)).toMatchObject({ tieneCartas: false, cartas: null });
    expect(error(intentar(estado, 3, { t: "pasar" }))).toBe("accion_invalida");

    // Solo juega cuando empieza la mano siguiente, y entonces ya no está fuera.
    const siguiente = aplicar({ ...estado, fase: "esperando", asientos: estado.asientos.map((x) => ({ ...x, aportado: 0 })) }, 4, { t: "sentarse", fichas: 100 }).estado;
    expect(asiento(siguiente, 3).estado).toBe("juega");
    expect(asiento(siguiente, 3).cartas).toHaveLength(2);
  });

  it("lo añadido a mitad de mano no cuenta hasta la siguiente", () => {
    const e = mesaCon([100, 100, 100]);
    expect(turno(e)).toBe(1);
    const { estado } = aplicar(e, 1, { t: "anadir", fichas: 500 });
    expect(asiento(estado, 1)).toMatchObject({ fichas: 100, porEntrar: 500, comprado: 600 });
    expect(vistaDe(estado, 1).porEntrar).toBe(500);
    expect(vistaDe(estado, 2).porEntrar).toBe(0);
    expect(vistaDe(estado, 1).asientos[0].fichas).toBe(100);
    // Tampoco sirve para subir en esta mano.
    expect(opcionesDe(estado, 1)?.subir?.max).toBe(100);
    expect(error(intentar(estado, 1, { t: "subir", hasta: 101 }))).toBe("apuesta_invalida");

    const siguiente = aplicar({ ...estado, fase: "esperando", asientos: estado.asientos.map((x) => ({ ...x, aportado: 0 })) }, 4, { t: "sentarse", fichas: 100 }).estado;
    expect(asiento(siguiente, 1)).toMatchObject({ fichas: 600, porEntrar: 0, comprado: 600 });
  });

  it("añadir exige estar sentado y una cantidad válida", () => {
    expect(error(intentar(vacia(), 1, { t: "anadir", fichas: 100 }))).toBe("no_sentado");
    expect(error(intentar(conUno(), 1, { t: "anadir", fichas: 9 }))).toBe("apuesta_invalida");
    // Entre manos también espera a la siguiente.
    expect(asiento(aplicar(conUno(), 1, { t: "anadir", fichas: 10 }).estado, 1)).toMatchObject({ fichas: 100, porEntrar: 10, comprado: 110 });
  });

  it("levantarse devuelve fichas y lo añadido en una liquidación de su sesión", () => {
    for (const t of ["levantarse", "salir"] as const) {
      const e = aplicar(conUno(100), 1, { t: "anadir", fichas: 50 }).estado;
      const { estado, liquidacion } = aplicar(e, 1, { t }, T0 + 1);
      expect(liquidacion).toEqual({ ronda: asiento(e, 1).sesion, filas: [{ jugadorId: 1, apuesta: 150, pago: 150 }] });
      expect(estado.asientos).toEqual([]);
      expect(estado.finFase).toBeNull();
      expect(poker.proximaAlarma(estado)).toBeNull();
    }
  });

  it("quien no está sentado no tiene nada de lo que levantarse", () => {
    const e = vacia();
    for (const t of ["levantarse", "salir"] as const) {
      const p = aplicar(e, 1, { t });
      expect(p.estado).toBe(e);
      expect(p.liquidacion).toBeUndefined();
    }
  });

  it("levantarse a mitad de mano retira, y lo aportado se queda", () => {
    const e = aplicar(mesaCon([100, 100, 100]), 1, { t: "anadir", fichas: 20 }).estado;
    // El jugador 3 es la ciega grande y no tiene el turno: se va con 90 y lo añadido, y sus 10 se quedan en el bote.
    const { estado, liquidacion, eventos } = aplicar(e, 3, { t: "levantarse" });
    expect(liquidacion).toEqual({ ronda: asiento(e, 3).sesion, filas: [{ jugadorId: 3, apuesta: 100, pago: 90 }] });
    expect(estado.abandonos).toEqual([{ jugadorId: 3, aportado: 10 }]);
    expect(estado.asientos.map((a) => a.jugadorId)).toEqual([1, 2]);
    expect(eventos).toEqual([{ tipo: "accion", jugadorId: 3, accion: "retirarse", cantidad: 0 }]);
    // La apuesta de la ronda sigue en pie aunque se haya ido quien la puso.
    expect(estado.apuesta).toBe(10);
    expect(turno(estado)).toBe(1);
    expect(estado.finFase).toBe(e.finFase);
    // Lo que puso aún no lo ha cerrado ninguna ronda, pero ya no vuelve: se ve en el bote.
    expect(vistaDe(estado, 1).botes).toEqual([{ cantidad: 10, jugadores: [1, 2] }]);
  });

  it("levantarse tras una ronda cerrada deja lo aportado en el bote de los que siguen", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    e = aplicar(e, 3, { t: "pasar" }).estado;
    expect(e.calle).toBe("flop");
    e = aplicar(e, 2, { t: "subir", hasta: 30 }).estado;
    const { estado, liquidacion } = aplicar(e, 2, { t: "levantarse" }, T0 + 1);
    expect(liquidacion?.filas).toEqual([{ jugadorId: 2, apuesta: 100, pago: 60 }]);
    expect(estado.abandonos).toEqual([{ jugadorId: 2, aportado: 40 }]);
    expect(vistaDe(estado, 1).botes).toEqual([{ cantidad: 60, jugadores: [1, 3] }]);
  });

  it("se levanta quien tiene el turno: el turno pasa al siguiente con su tiempo", () => {
    const e = mesaCon([100, 100, 100]);
    expect(turno(e)).toBe(1);
    const { estado } = aplicar(e, 1, { t: "levantarse" }, T0 + 7);
    expect(turno(estado)).toBe(2);
    expect(estado.finFase).toBe(T0 + 7 + POKER.TURNO_MS);
  });

  it("levantarse tras retirarse no cambia el turno ni deja de contar lo aportado", () => {
    let e = mesaCon([100, 100, 100]);
    e = aplicar(e, 1, { t: "igualar" }).estado;
    e = aplicar(e, 2, { t: "retirarse" }).estado;
    const { estado, eventos } = aplicar(e, 2, { t: "levantarse" }, T0 + 1);
    expect(eventos).toEqual([]);
    expect(turno(estado)).toBe(3);
    expect(estado.finFase).toBe(e.finFase);
    expect(estado.abandonos).toEqual([{ jugadorId: 2, aportado: 5 }]);
  });

  it("se levantan todos menos uno a mitad de mano: la mano se acaba", () => {
    const e = aplicar(mesaCon([100, 100, 100]), 2, { t: "levantarse" }).estado;
    const { estado } = aplicar(e, 3, { t: "levantarse" }, T0 + 1);
    expect(estado).toMatchObject({ fase: "resultado", turno: null, finFase: T0 + 1 + POKER.RESULTADO_MS });
  });

  it("si se va el último rival con fichas, quien ya igualó no espera a nadie", () => {
    // Asientos: botón 1, pequeña 2, grande 3. El 1 va all-in con 50, el 2 iguala y le queda la grande por hablar.
    let e = mesaCon([50, 100, 100]);
    e = aplicar(e, 1, { t: "subir", hasta: 50 }).estado;
    e = aplicar(e, 2, { t: "igualar" }).estado;
    e = aplicar(e, 3, { t: "igualar" }).estado;
    expect(e).toMatchObject({ calle: "flop", turno: 1 });
    // Ya en el flop hablan 2 y 3; si se va el 3 sin tener el turno, el 2 ya no tiene a quién apostarle.
    expect(turno(e)).toBe(2);
    const { estado } = aplicar(e, 3, { t: "levantarse" }, T0 + 1);
    expect(estado.fase).toBe("resultado");
    expect(estado.mesa).toHaveLength(5);
  });

  it("solo durante SOLO_MS te levanta y la mesa se duerme", () => {
    const e = conUno(100);
    expect(poker.proximaAlarma(e)).toBe(T0 + POKER.SOLO_MS);

    const antes = poker.tick(e, T0 + POKER.SOLO_MS - 1, rng);
    expect(antes.ok && antes.estado).toBe(e);

    const p = poker.tick(e, T0 + POKER.SOLO_MS, rng);
    if (!p.ok) throw new Error("el tick falló");
    expect(p.liquidacion).toEqual({ ronda: asiento(e, 1).sesion, filas: [{ jugadorId: 1, apuesta: 100, pago: 100 }] });
    expect(p.estado.asientos).toEqual([]);
    expect(poker.proximaAlarma(p.estado)).toBeNull();

    const dormida = poker.tick(p.estado, T0 + 2 * POKER.SOLO_MS, rng);
    expect(dormida.ok && dormida.estado).toBe(p.estado);
  });

  it("sin nadie sentado no hay nada que esperar", () => {
    expect(vacia()).toMatchObject({ fase: "esperando", finFase: null, ronda: 0, boton: null });
    expect(poker.proximaAlarma(vacia())).toBeNull();
  });

  it("desconectarse entre manos te levanta en el acto", () => {
    const e = conUno(100);
    const p = poker.desconectar(e, 1, T0 + 1, rng);
    if (!p.ok) throw new Error("no se pudo desconectar");
    expect(p.estado.asientos).toEqual([]);
    expect(p.liquidacion?.filas).toEqual([{ jugadorId: 1, apuesta: 100, pago: 100 }]);
    const nadie = poker.desconectar(p.estado, 1, T0 + 2, rng);
    expect(nadie.ok && nadie.estado).toBe(p.estado);
  });

  it("no muta el estado que recibe", () => {
    const e = mesaCon([100, 100, 100]);
    const copia = structuredClone(e);
    aplicar(e, 1, { t: "subir", hasta: 40 });
    aplicar(e, 2, { t: "levantarse" });
    aplicar(e, 2, { t: "anadir", fichas: 10 });
    aplicar(e, 9, { t: "sentarse", fichas: 100 });
    expect(e).toEqual(copia);
  });

  it("el resumen de la sala no cambia con cada turno", () => {
    const e = mesaCon([100, 100, 100]);
    const siguiente = aplicar(e, 1, { t: "igualar" }, T0 + 500).estado;
    expect(poker.resumen(e, T0)).toEqual({ jugadores: ["J1", "J2", "J3"], fase: "mano", finFase: null });
    expect(poker.resumen(siguiente, T0 + 500)).toEqual(poker.resumen(e, T0));
    expect(poker.resumen({ ...e, fase: "resultado", finFase: T0 + 9 }, T0)).toEqual({ jugadores: ["J1", "J2", "J3"], fase: "resultado", finFase: T0 + 9 });
    expect(poker.resumen(conUno(), T0)).toEqual({ jugadores: ["J1"], fase: "esperando", finFase: null });
  });
});
