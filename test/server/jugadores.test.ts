import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { IdJuego } from "../../src/shared/juegos/tipos";

const T0 = 1_800_000_000_000;
const QUINCE_MIN = 900_000;

/** Una instancia nueva por prueba: la clase no depende del nombre del objeto. */
const nuevo = () => env.Jugadores.get(env.Jugadores.idFromName(crypto.randomUUID()));
type Stub = ReturnType<typeof nuevo>;

/** Registra y devuelve el id; falla la prueba si el registro no sale bien. */
async function crear(j: Stub, apodo = "Fran", pin = "1234"): Promise<number> {
  const r = await j.registrar(apodo, pin, T0);
  if (!r.ok) throw new Error(`No se pudo registrar ${apodo}: ${r.error}`);
  return r.jugador.id;
}

const fichasDe = async (j: Stub, id: number): Promise<number> => (await j.perfil(id))!.fichas;

let contadorRondas = 0;
const nuevaRonda = () => `ronda-${++contadorRondas}`;

/** Apuesta `apuesta` y liquida con `pago` una ronda de un solo jugador. */
async function jugar(
  j: Stub,
  jugadorId: number,
  apuesta: number,
  pago: number,
  extra: { juego?: IdJuego; codigoPartida?: string; ahora?: number } = {},
): Promise<void> {
  const rondaId = nuevaRonda();
  expect(await j.apostar(jugadorId, apuesta, rondaId)).toBe("ok");
  await j.liquidar(
    { rondaId, juego: extra.juego ?? "blackjack", codigoPartida: extra.codigoPartida ?? "ABCD", filas: [{ jugadorId, apuesta, pago }] },
    extra.ahora ?? T0,
  );
}

describe("registrar", () => {
  it("crea con 1000 fichas", async () => {
    const j = nuevo();
    const r = await j.registrar("Fran", "1234", T0);
    expect(r).toEqual({ ok: true, jugador: { id: expect.any(Number), apodo: "Fran", fichas: 1000 } });
  });

  it("rechaza apodo o PIN inválidos sin crear nada", async () => {
    const j = nuevo();
    expect(await j.registrar("ab", "1234", T0)).toEqual({ ok: false, error: "apodo_invalido" });
    expect(await j.registrar("con espacio", "1234", T0)).toEqual({ ok: false, error: "apodo_invalido" });
    expect(await j.registrar("Fran", "123", T0)).toEqual({ ok: false, error: "pin_invalido" });
    expect(await j.registrar("Fran", "abcd", T0)).toEqual({ ok: false, error: "pin_invalido" });
    expect(await j.registrar("Fran", "12345", T0)).toEqual({ ok: false, error: "pin_invalido" });
    expect(await j.entrar("Fran", "1234", T0)).toEqual({ ok: false, error: "no_existe" });
  });

  it("apodo sin distinguir mayúsculas: 'fran' choca con 'Fran'", async () => {
    const j = nuevo();
    await crear(j, "Fran");
    expect(await j.registrar("fran", "1234", T0)).toEqual({ ok: false, error: "apodo_ocupado" });
    expect(await j.registrar("FRAN", "5678", T0)).toEqual({ ok: false, error: "apodo_ocupado" });
  });

  it("dos registros simultáneos del mismo apodo: solo uno entra", async () => {
    const j = nuevo();
    const [a, b] = await Promise.all([j.registrar("Fran", "1234", T0), j.registrar("fran", "1234", T0)]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const perdedor = a.ok ? b : a;
    expect(perdedor).toEqual({ ok: false, error: "apodo_ocupado" });
  });
});

describe("entrar", () => {
  it("no_existe; fallos 1-4 → pin con intentosRestantes 4,3,2,1; 5º fallo → bloqueado 15 min", async () => {
    const j = nuevo();
    expect(await j.entrar("Fran", "1234", T0)).toEqual({ ok: false, error: "no_existe" });
    await crear(j);

    for (const [i, intentosRestantes] of [4, 3, 2, 1].entries()) {
      expect(await j.entrar("Fran", "0000", T0 + i * 1000)).toEqual({ ok: false, error: "pin", intentosRestantes });
    }
    const quinto = T0 + 4000;
    expect(await j.entrar("Fran", "0000", quinto)).toEqual({ ok: false, error: "bloqueado", hasta: quinto + QUINCE_MIN });
  });

  it("bloqueado: ni siquiera el PIN correcto entra hasta que pasan 15 min; después los fallos vuelven a 0", async () => {
    const j = nuevo();
    await crear(j);
    for (let i = 0; i < 5; i++) await j.entrar("Fran", "0000", T0);
    const hasta = T0 + QUINCE_MIN;

    expect(await j.entrar("Fran", "1234", T0 + 1)).toEqual({ ok: false, error: "bloqueado", hasta });
    expect(await j.entrar("Fran", "0000", hasta - 1)).toEqual({ ok: false, error: "bloqueado", hasta });
    // Los intentos durante el bloqueo no lo alargan.
    expect(await j.entrar("Fran", "1234", hasta - 1)).toEqual({ ok: false, error: "bloqueado", hasta });

    expect(await j.entrar("Fran", "0000", hasta)).toEqual({ ok: false, error: "pin", intentosRestantes: 4 });
    const ok = await j.entrar("Fran", "1234", hasta + 1);
    expect(ok).toMatchObject({ ok: true, jugador: { apodo: "Fran" } });
  });

  it("intentos simultáneos no esquivan el bloqueo: 4 fallos con aviso y el resto bloqueado", async () => {
    const j = nuevo();
    await crear(j);
    const resultados = await Promise.all(Array.from({ length: 8 }, () => j.entrar("Fran", "0000", T0)));

    expect(resultados.filter((r) => !r.ok && r.error === "pin").map((r) => !r.ok && r.error === "pin" && r.intentosRestantes).sort()).toEqual([1, 2, 3, 4]);
    const bloqueados = resultados.filter((r) => !r.ok && r.error === "bloqueado");
    expect(bloqueados).toHaveLength(4);
    for (const b of bloqueados) expect(b).toEqual({ ok: false, error: "bloqueado", hasta: T0 + QUINCE_MIN });
  });

  it("un acierto pone los fallos a 0", async () => {
    const j = nuevo();
    await crear(j);
    await j.entrar("Fran", "0000", T0);
    await j.entrar("Fran", "0000", T0);
    expect(await j.entrar("Fran", "0000", T0)).toEqual({ ok: false, error: "pin", intentosRestantes: 2 });

    expect(await j.entrar("Fran", "1234", T0)).toMatchObject({ ok: true });
    expect(await j.entrar("Fran", "0000", T0)).toEqual({ ok: false, error: "pin", intentosRestantes: 4 });
  });

  it("un apodo desconocido no registra nada: nunca se bloquea y no deja fallos al registrarlo después", async () => {
    const j = nuevo();
    for (let i = 0; i < 6; i++) expect(await j.entrar("Nadie", "0000", T0)).toEqual({ ok: false, error: "no_existe" });
    await crear(j, "Nadie");
    expect(await j.entrar("Nadie", "0000", T0)).toEqual({ ok: false, error: "pin", intentosRestantes: 4 });
  });

  it("entrar con 'FRAN' encuentra a 'Fran' y conserva su mayúscula", async () => {
    const j = nuevo();
    const id = await crear(j, "Fran");
    expect(await j.entrar("FRAN", "1234", T0)).toEqual({ ok: true, jugador: { id, apodo: "Fran", fichas: 1000 } });
  });

  it("los fallos cuentan juntos aunque se escriba el apodo con otra mayúscula", async () => {
    const j = nuevo();
    await crear(j, "Fran");
    expect(await j.entrar("fran", "0000", T0)).toEqual({ ok: false, error: "pin", intentosRestantes: 4 });
    expect(await j.entrar("FRAN", "0000", T0)).toEqual({ ok: false, error: "pin", intentosRestantes: 3 });
    expect(await j.entrar("Fran", "0000", T0)).toEqual({ ok: false, error: "pin", intentosRestantes: 2 });
  });
});

describe("apostar", () => {
  it("descuenta y deja pendiente; sin fichas no descuenta", async () => {
    const j = nuevo();
    const id = await crear(j);
    expect(await j.apostar(id, 300, "r1")).toBe("ok");
    expect(await fichasDe(j, id)).toBe(700);

    expect(await j.apostar(id, 701, "r2")).toBe("sin_fichas");
    expect(await fichasDe(j, id)).toBe(700);
    expect(await j.apostar(id, 700, "r2")).toBe("ok");
    expect(await fichasDe(j, id)).toBe(0);
  });

  it("apostar 1001 teniendo 1000 → sin_fichas y las fichas siguen en 1000", async () => {
    const j = nuevo();
    const id = await crear(j);
    expect(await j.apostar(id, 1001, "r1")).toBe("sin_fichas");
    expect(await fichasDe(j, id)).toBe(1000);
  });

  it("un jugador que no existe no puede apostar", async () => {
    const j = nuevo();
    expect(await j.apostar(999, 10, "r1")).toBe("sin_fichas");
  });

  it("cantidad 0, -10, 50.5, NaN o Infinity → cantidad_invalida sin descontar", async () => {
    const j = nuevo();
    const id = await crear(j);
    for (const cantidad of [0, -10, 50.5, NaN, Infinity]) {
      expect(await j.apostar(id, cantidad, "r1")).toBe("cantidad_invalida");
    }
    expect(await fichasDe(j, id)).toBe(1000);
    // Las apuestas rechazadas no dejan filas pendientes: si las dejaran, el rescate de abajo fallaría.
    expect(await j.apostar(id, 1000, "r2")).toBe("ok");
    await j.liquidar({ rondaId: "r2", juego: "blackjack", codigoPartida: "ABCD", filas: [{ jugadorId: id, apuesta: 1000, pago: 0 }] }, T0);
    expect(await j.rescate(id)).toEqual({ ok: true, fichas: 200 });
  });
});

describe("liquidar", () => {
  it("suma el pago y es idempotente por rondaId", async () => {
    const j = nuevo();
    const id = await crear(j);
    expect(await j.apostar(id, 50, "r1")).toBe("ok");
    const liquidacion = { rondaId: "r1", juego: "blackjack" as const, codigoPartida: "ABCD", filas: [{ jugadorId: id, apuesta: 50, pago: 100 }] };

    await j.liquidar(liquidacion, T0);
    expect(await fichasDe(j, id)).toBe(1050);
    await j.liquidar(liquidacion, T0 + 1000);
    expect(await fichasDe(j, id)).toBe(1050);
    expect((await j.perfil(id))!.partidas).toBe(1);
  });

  it("liquida a varios jugadores de la misma ronda", async () => {
    const j = nuevo();
    const a = await crear(j, "Ana");
    const b = await crear(j, "Beto");
    await j.apostar(a, 100, "r1");
    await j.apostar(b, 200, "r1");
    await j.liquidar(
      {
        rondaId: "r1",
        juego: "carrera",
        codigoPartida: "ABCD",
        filas: [
          { jugadorId: a, apuesta: 100, pago: 400 },
          { jugadorId: b, apuesta: 200, pago: 0 },
        ],
      },
      T0,
    );
    expect(await fichasDe(j, a)).toBe(1300);
    expect(await fichasDe(j, b)).toBe(800);
  });

  it("las fichas siempre cuadran tras varias rondas: fichas = 1000 + Σ(pago - apuesta)", async () => {
    const j = nuevo();
    const id = await crear(j);
    const rondas = [
      [50, 100],
      [200, 0],
      [100, 150],
      [10, 10],
      [500, 1000],
      [300, 0],
      [75, 0],
      [25, 62],
    ];
    let esperado = 1000;
    for (const [apuesta, pago] of rondas) {
      await jugar(j, id, apuesta, pago);
      esperado += pago - apuesta;
      expect(await fichasDe(j, id)).toBe(esperado);
    }
    expect(esperado).toBe(1000 + rondas.reduce((s, [a, p]) => s + p - a, 0));
  });

  it("rachas: gana, gana, empata, pierde → mejor 2, actual 0", async () => {
    const j = nuevo();
    const id = await crear(j);
    const racha = async () => {
      const p = (await j.perfil(id))!;
      return [p.rachaActual, p.mejorRacha];
    };

    await jugar(j, id, 10, 20); // gana
    await jugar(j, id, 10, 20); // gana
    expect(await racha()).toEqual([2, 2]);
    await jugar(j, id, 10, 10); // empata: no cambia
    expect(await racha()).toEqual([2, 2]);
    await jugar(j, id, 10, 0); // pierde
    expect(await racha()).toEqual([0, 2]);
    await jugar(j, id, 10, 20); // gana
    expect(await racha()).toEqual([1, 2]);
  });
});

describe("rescate", () => {
  it("solo con 0 fichas y sin pendientes; suma quiebra", async () => {
    const j = nuevo();
    const id = await crear(j);
    expect(await j.rescate(id)).toEqual({ ok: false, error: "tiene_fichas" });

    // Se apuesta todo en dos tramos de la misma ronda (como en la carrera).
    expect(await j.apostar(id, 600, "r1")).toBe("ok");
    expect(await j.apostar(id, 400, "r1")).toBe("ok");
    expect(await fichasDe(j, id)).toBe(0);
    expect(await j.rescate(id)).toEqual({ ok: false, error: "apuestas_pendientes" });

    await j.liquidar({ rondaId: "r1", juego: "carrera", codigoPartida: "ABCD", filas: [{ jugadorId: id, apuesta: 1000, pago: 0 }] }, T0);
    expect(await j.rescate(id)).toEqual({ ok: true, fichas: 200 });
    const perfil = (await j.perfil(id))!;
    expect(perfil.fichas).toBe(200);
    expect(perfil.quiebras).toBe(1);

    expect(await j.rescate(id)).toEqual({ ok: false, error: "tiene_fichas" });
    expect((await j.perfil(id))!.quiebras).toBe(1);
  });

  it("liquidar una ronda no borra las apuestas pendientes de otra", async () => {
    const j = nuevo();
    const id = await crear(j);
    expect(await j.apostar(id, 900, "r1")).toBe("ok");
    expect(await j.apostar(id, 100, "r2")).toBe("ok");
    await j.liquidar({ rondaId: "r1", juego: "blackjack", codigoPartida: "ABCD", filas: [{ jugadorId: id, apuesta: 900, pago: 0 }] }, T0);
    expect(await j.rescate(id)).toEqual({ ok: false, error: "apuestas_pendientes" });

    await j.liquidar({ rondaId: "r2", juego: "blackjack", codigoPartida: "ABCD", filas: [{ jugadorId: id, apuesta: 100, pago: 0 }] }, T0);
    expect(await j.rescate(id)).toEqual({ ok: true, fichas: 200 });
  });
});

describe("perfil", () => {
  it("devuelve null si el jugador no existe", async () => {
    expect(await nuevo().perfil(42)).toBeNull();
  });

  it("sin partidas: todo a cero y ambos juegos presentes", async () => {
    const j = nuevo();
    const id = await crear(j);
    expect(await j.perfil(id)).toEqual({
      id,
      apodo: "Fran",
      fichas: 1000,
      quiebras: 0,
      rachaActual: 0,
      mejorRacha: 0,
      partidas: 0,
      gananciasTotales: 0,
      mayorPremio: 0,
      porJuego: { blackjack: { partidas: 0, victorias: 0 }, carrera: { partidas: 0, victorias: 0 } },
    });
  });

  it("calcula partidas, ganancias, mayor premio y por juego", async () => {
    const j = nuevo();
    const id = await crear(j);
    await jugar(j, id, 50, 100, { juego: "blackjack" }); // +50
    await jugar(j, id, 100, 0, { juego: "blackjack" }); // -100
    await jugar(j, id, 100, 400, { juego: "carrera" }); // +300
    await jugar(j, id, 20, 20, { juego: "carrera" }); // 0

    expect(await j.perfil(id)).toEqual({
      id,
      apodo: "Fran",
      fichas: 1250,
      quiebras: 0,
      rachaActual: 1,
      mejorRacha: 1,
      partidas: 4,
      gananciasTotales: 250,
      mayorPremio: 300,
      porJuego: { blackjack: { partidas: 2, victorias: 1 }, carrera: { partidas: 2, victorias: 1 } },
    });
  });
});

describe("ranking", () => {
  it("por fichas con mi posición aunque no esté en el top", async () => {
    const j = nuevo();
    const ids: number[] = [];
    // J00 conserva más fichas que J01, y así hasta J54: 55 jugadores, el último fuera del top 50.
    for (let i = 0; i < 55; i++) {
      const id = await crear(j, `J${String(i).padStart(2, "0")}`);
      ids.push(id);
      await j.apostar(id, i + 1, nuevaRonda());
    }

    const ultimo = await j.ranking("fichas", ids[54]);
    expect(ultimo.top).toHaveLength(50);
    expect(ultimo.top[0]).toEqual({ posicion: 1, apodo: "J00", valor: 999 });
    expect(ultimo.top[49]).toEqual({ posicion: 50, apodo: "J49", valor: 950 });
    expect(ultimo.top.some((f) => f.apodo === "J54")).toBe(false);
    expect(ultimo.yo).toEqual({ posicion: 55, apodo: "J54", valor: 945 });

    const primero = await j.ranking("fichas", ids[0]);
    expect(primero.yo).toEqual({ posicion: 1, apodo: "J00", valor: 999 });
    expect(primero.top).toEqual(ultimo.top);

    expect((await j.ranking("fichas", null)).yo).toBeNull();
    expect((await j.ranking("fichas", 987_654)).yo).toBeNull();
  });

  it("empata por valor → desempata por apodo sin distinguir mayúsculas", async () => {
    const j = nuevo();
    await crear(j, "carla");
    await crear(j, "Beto");
    await crear(j, "ana");
    const { top } = await j.ranking("fichas", null);
    expect(top).toEqual([
      { posicion: 1, apodo: "ana", valor: 1000 },
      { posicion: 2, apodo: "Beto", valor: 1000 },
      { posicion: 3, apodo: "carla", valor: 1000 },
    ]);
  });

  describe("otros órdenes", () => {
    /**
     * Ana: 12 partidas (8 ganadas, mejor racha 4, neto +4). Beto: 9 victorias seguidas (+9).
     * Carla: 1 victoria de +500. Dani: sin partidas. Eva: lo pierde todo y se rescata (1 quiebra).
     */
    async function escenario() {
      const j = nuevo();
      const ana = await crear(j, "Ana");
      const beto = await crear(j, "Beto");
      const carla = await crear(j, "Carla");
      const dani = await crear(j, "Dani");
      const eva = await crear(j, "Eva");
      for (const gana of "WWWLWWWWLLWL") await jugar(j, ana, 1, gana === "W" ? 2 : 0);
      for (let i = 0; i < 9; i++) await jugar(j, beto, 1, 2);
      await jugar(j, carla, 100, 600);
      await jugar(j, eva, 1000, 0);
      expect(await j.rescate(eva)).toEqual({ ok: true, fichas: 200 });
      return { j, ana, beto, carla, dani, eva };
    }

    it("fichas", async () => {
      const { j } = await escenario();
      expect((await j.ranking("fichas", null)).top).toEqual([
        { posicion: 1, apodo: "Carla", valor: 1500 },
        { posicion: 2, apodo: "Beto", valor: 1009 },
        { posicion: 3, apodo: "Ana", valor: 1004 },
        { posicion: 4, apodo: "Dani", valor: 1000 },
        { posicion: 5, apodo: "Eva", valor: 200 },
      ]);
    });

    it("ganancias: suma de netos; quien no ha jugado cuenta 0", async () => {
      const { j, dani } = await escenario();
      const r = await j.ranking("ganancias", dani);
      expect(r.top).toEqual([
        { posicion: 1, apodo: "Carla", valor: 500 },
        { posicion: 2, apodo: "Beto", valor: 9 },
        { posicion: 3, apodo: "Ana", valor: 4 },
        { posicion: 4, apodo: "Dani", valor: 0 },
        { posicion: 5, apodo: "Eva", valor: -1000 },
      ]);
      expect(r.yo).toEqual({ posicion: 4, apodo: "Dani", valor: 0 });
    });

    it("victorias: porcentaje redondeado y solo con 10 partidas o más", async () => {
      const { j, ana, beto } = await escenario();
      // Beto tiene 9 victorias de 9 partidas: no cuenta. Ana: 8/12 = 66,67 → 67.
      expect((await j.ranking("victorias", ana)).top).toEqual([{ posicion: 1, apodo: "Ana", valor: 67 }]);
      expect((await j.ranking("victorias", ana)).yo).toEqual({ posicion: 1, apodo: "Ana", valor: 67 });
      expect((await j.ranking("victorias", beto)).yo).toBeNull();
    });

    it("premio: mayor neto, solo con al menos una partida", async () => {
      const { j, dani, eva } = await escenario();
      const r = await j.ranking("premio", dani);
      expect(r.top).toEqual([
        { posicion: 1, apodo: "Carla", valor: 500 },
        { posicion: 2, apodo: "Ana", valor: 1 },
        { posicion: 3, apodo: "Beto", valor: 1 },
        { posicion: 4, apodo: "Eva", valor: -1000 },
      ]);
      expect(r.yo).toBeNull();
      expect((await j.ranking("premio", eva)).yo).toEqual({ posicion: 4, apodo: "Eva", valor: -1000 });
    });

    it("racha: mejor racha", async () => {
      const { j, carla } = await escenario();
      const r = await j.ranking("racha", carla);
      expect(r.top).toEqual([
        { posicion: 1, apodo: "Beto", valor: 9 },
        { posicion: 2, apodo: "Ana", valor: 4 },
        { posicion: 3, apodo: "Carla", valor: 1 },
        { posicion: 4, apodo: "Dani", valor: 0 },
        { posicion: 5, apodo: "Eva", valor: 0 },
      ]);
      expect(r.yo).toEqual({ posicion: 3, apodo: "Carla", valor: 1 });
    });

    it("quiebras", async () => {
      const { j } = await escenario();
      expect((await j.ranking("quiebras", null)).top).toEqual([
        { posicion: 1, apodo: "Eva", valor: 1 },
        { posicion: 2, apodo: "Ana", valor: 0 },
        { posicion: 3, apodo: "Beto", valor: 0 },
        { posicion: 4, apodo: "Carla", valor: 0 },
        { posicion: 5, apodo: "Dani", valor: 0 },
      ]);
    });
  });
});

describe("rankingPartida", () => {
  it("suma netos por código", async () => {
    const j = nuevo();
    const ana = await crear(j, "Ana");
    const beto = await crear(j, "Beto");
    const carla = await crear(j, "Carla");

    // Partida ABCD: dos rondas. Ana +100 -40 = +60; Beto -50 +10 = -40; Carla solo juega en otra partida.
    await j.apostar(ana, 100, "r1");
    await j.apostar(beto, 50, "r1");
    await j.liquidar(
      { rondaId: "r1", juego: "blackjack", codigoPartida: "ABCD", filas: [{ jugadorId: ana, apuesta: 100, pago: 200 }, { jugadorId: beto, apuesta: 50, pago: 0 }] },
      T0,
    );
    await j.apostar(ana, 40, "r2");
    await j.apostar(beto, 10, "r2");
    await j.liquidar(
      { rondaId: "r2", juego: "carrera", codigoPartida: "ABCD", filas: [{ jugadorId: ana, apuesta: 40, pago: 0 }, { jugadorId: beto, apuesta: 10, pago: 20 }] },
      T0 + 1000,
    );
    await jugar(j, carla, 500, 1500, { codigoPartida: "WXYZ" });

    expect(await j.rankingPartida("ABCD")).toEqual([
      { apodo: "Ana", neto: 60 },
      { apodo: "Beto", neto: -40 },
    ]);
    expect(await j.rankingPartida("WXYZ")).toEqual([{ apodo: "Carla", neto: 1000 }]);
    expect(await j.rankingPartida("NADA")).toEqual([]);
  });

  it("empata por neto → desempata por apodo", async () => {
    const j = nuevo();
    const beto = await crear(j, "Beto");
    const ana = await crear(j, "ana");
    await jugar(j, beto, 10, 20, { codigoPartida: "ABCD" });
    await jugar(j, ana, 10, 20, { codigoPartida: "ABCD" });
    expect(await j.rankingPartida("ABCD")).toEqual([
      { apodo: "ana", neto: 10 },
      { apodo: "Beto", neto: 10 },
    ]);
  });
});
