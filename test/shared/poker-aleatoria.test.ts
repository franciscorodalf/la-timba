import { describe, expect, it } from "vitest";
import type { Carta, Rng } from "../../src/shared/cartas";
import { POKER, poker, type AccionPoker, type EstadoPoker, type VistaPoker } from "../../src/shared/juegos/poker";
import type { CodigoError, Evento, JugadorId, Paso } from "../../src/shared/juegos/tipos";
import { T0, apodoDe } from "./ayudas-poker";

const MANOS_POR_MESA = 100;
const SEMILLAS = [1, 7, 42, 1278, 20261031, 3, 99, 2718];
/** Un tope que una mesa sana nunca alcanza: si se llega, la mesa se ha quedado colgada. */
const PASOS_MAX = 20_000;

/** mulberry32: el mismo generador en cualquier máquina, para poder repetir un fallo con su semilla. */
function generador(semilla: number): Rng {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idCarta = (carta: Carta) => `${carta.valor}${carta.palo}`;
const CARTA_EN_JSON = /"palo":"(\w)","valor":"(\w+)"/g;
/** Todas las cartas que aparecen en un texto JSON. Solo reconoce el orden de claves de `crearBaraja`, el de la partida. */
const cartasEn = (json: string): string[] => [...json.matchAll(CARTA_EN_JSON)].map(([, palo, valor]) => `${valor}${palo}`);

const entera = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;

class Partida {
  e: EstadoPoker;
  ahora = T0;
  comprado = 0;
  pagado = 0;
  pasos = 0;
  /** Lo que ha ido pasando: para saber que la prueba llega a los casos difíciles. */
  readonly vistos = new Set<string>();
  private readonly azar: Rng;

  constructor(
    semilla: number,
    private readonly jugadores: number,
  ) {
    this.azar = generador(semilla);
    this.e = poker.crear(T0, this.azar);
  }

  private fallar(mensaje: string): never {
    throw new Error(`${mensaje} (paso ${this.pasos}, mano ${this.e.ronda}, fase ${this.e.fase}): ${JSON.stringify(this.e)}`);
  }

  private entero(n: number): number {
    return Math.floor(this.azar() * n);
  }

  private uno<T>(lista: readonly T[]): T {
    return lista[this.entero(lista.length)];
  }

  /** Lo que comprobamos tras cada paso. Con `if` y no con `expect`: son cientos de miles de comprobaciones. */
  private comprobar(eventos: Evento[]) {
    const { e } = this;
    this.pasos += 1;
    if (this.pasos > PASOS_MAX) this.fallar("la mesa no avanza");

    let enLaMesa = 0;
    for (const a of e.asientos) {
      enLaMesa += a.fichas + a.porEntrar + a.aportado;
      for (const n of [a.fichas, a.porEntrar, a.aportado, a.apostado, a.comprado, a.faltas]) if (!entera(n)) this.fallar(`cantidad inválida ${n} en el asiento ${a.asiento}`);
    }
    for (const { aportado } of e.abandonos) {
      enLaMesa += aportado;
      if (!entera(aportado)) this.fallar(`abandono inválido ${aportado}`);
    }
    if (enLaMesa !== this.comprado - this.pagado) this.fallar(`el libro no cuadra: ${enLaMesa} frente a ${this.comprado} - ${this.pagado}`);
    for (const { cantidad } of e.botes) if (!entera(cantidad)) this.fallar(`bote inválido ${cantidad}`);
    for (const evento of eventos) {
      if ("cantidad" in evento && !entera(evento.cantidad)) this.fallar(`evento inválido ${JSON.stringify(evento)}`);
      this.vistos.add(evento.tipo === "bote_ganado" && (evento.indiceBote as number) > 0 ? "bote_paralelo" : evento.tipo);
    }

    if (e.asientos.length > 0 && poker.proximaAlarma(e) === null) this.fallar("hay fichas en una mesa sin alarma");
    if (e.fase === "mano") {
      if (e.asientos.filter((a) => a.estado === "juega" || a.estado === "allin").length < 2) this.fallar("mano sin rivales");
      const conTurno = e.asientos.find((a) => a.asiento === e.turno);
      if (conTurno === undefined || conTurno.estado !== "juega") this.fallar("nadie tiene la palabra");
    }

    // Lo que puede verse: la mesa y lo enseñado. Quien mire solo añade sus cartas.
    const publicas = new Set(e.mesa.map(idCarta));
    for (const a of e.asientos) if (a.ensenadas) for (const carta of a.cartas) publicas.add(idCarta(carta));
    for (const carta of cartasEn(JSON.stringify(eventos))) if (!publicas.has(carta)) this.fallar(`un evento filtra ${carta}`);

    for (const id of [null, ...e.asientos.map((a) => a.jugadorId)]) {
      const json = JSON.stringify(poker.vista(e, id, this.ahora));
      if (json.includes("baraja")) this.fallar("la vista lleva la baraja");
      const propias = e.asientos.find((a) => a.jugadorId === id)?.cartas.map(idCarta) ?? [];
      for (const carta of cartasEn(json)) if (!publicas.has(carta) && !propias.includes(carta)) this.fallar(`${id} ve ${carta}`);
    }
  }

  private registrar(p: Paso<EstadoPoker> & { ok: true }) {
    this.e = p.estado;
    if ((p.liquidaciones?.length ?? 0) > 1) this.vistos.add("varias_liquidaciones");
    if (p.estado.abandonos.length > 0) this.vistos.add("abandono");
    for (const { filas } of [...(p.liquidacion ? [p.liquidacion] : []), ...(p.liquidaciones ?? [])]) for (const { pago } of filas) this.pagado += pago;
    this.comprobar(p.eventos);
  }

  /** `tolerado`: un error que la mesa puede dar sin que sea un fallo, porque no cambia nada. */
  private actuar(id: JugadorId, accion: AccionPoker, tolerado?: CodigoError): boolean {
    const p = poker.aplicar(this.e, id, accion, this.ahora, this.azar, apodoDe(id));
    if (!p.ok && p.error === tolerado) return false;
    if (!p.ok) this.fallar(`${id} no pudo hacer ${JSON.stringify(accion)}: ${p.error}`);
    if (accion.t === "sentarse" || accion.t === "anadir") this.comprado += accion.fichas;
    this.registrar(p);
    return true;
  }

  private tick() {
    const p = poker.tick(this.e, this.ahora, this.azar);
    if (!p.ok) this.fallar(`el tick falló: ${p.error}`);
    this.registrar(p);
  }

  private opciones(id: JugadorId) {
    return (poker.vista(this.e, id, this.ahora) as VistaPoker).opciones!;
  }

  /** Una de las acciones que `opciones` permite a quien tiene la palabra. */
  private decidir(id: JugadorId) {
    const o = this.opciones(id);
    const validas: AccionPoker[] = [];
    if (o.pasar) validas.push({ t: "pasar" }, { t: "pasar" });
    if (o.igualar !== null) validas.push({ t: "igualar" }, { t: "igualar" }, { t: "igualar" });
    if (o.subir !== null) {
      const { min, max } = o.subir;
      validas.push({ t: "subir", hasta: min + this.entero(Math.min(max - min, 60) + 1) }, { t: "subir", hasta: max });
    }
    if (o.retirarse) validas.push({ t: "retirarse" });
    this.actuar(id, this.uno(validas));
  }

  private sentarAlguien() {
    const libres = Array.from({ length: this.jugadores }, (_, i) => i + 1).filter((id) => !this.e.asientos.some((a) => a.jugadorId === id));
    if (libres.length === 0) return;
    const id = this.uno(libres);
    const accion: AccionPoker = { t: "sentarse", fichas: this.uno([POKER.COMPRA_MIN, 15, 25, 60, 150, 400]) };
    // Con tantas entradas y salidas, alguien llega al límite de sesiones por hora: la mesa lo rechaza sin cobrar y pasa un rato antes del siguiente intento.
    if (!this.actuar(id, accion, "demasiadas_sesiones")) this.ahora += 600_000;
  }

  /** Lo que puede pasar en cualquier momento, sin ser el turno de nadie en concreto. */
  private ruido() {
    const { e } = this;
    if (e.asientos.length === 0) return;
    const a = this.uno(e.asientos);
    switch (this.entero(4)) {
      case 0:
        return this.actuar(a.jugadorId, { t: "anadir", fichas: this.uno([POKER.COMPRA_MIN, 33, 80]) });
      case 1:
        return this.actuar(a.jugadorId, { t: "levantarse" });
      case 2: {
        const p = poker.desconectar(e, a.jugadorId, this.ahora, this.azar);
        if (!p.ok) this.fallar(`desconectar falló: ${p.error}`);
        return this.registrar(p);
      }
      default: {
        const p = poker.sentar(e, a.jugadorId, a.apodo, this.ahora);
        if (!p.ok) this.fallar(`volver falló: ${p.error}`);
        return this.registrar(p);
      }
    }
  }

  /** Un paso de la partida. */
  private paso() {
    const { e } = this;
    const dado = this.azar();
    if (dado < 0.05) return this.ruido();
    if (dado < 0.15 && e.asientos.length < this.jugadores) return this.sentarAlguien();
    if (dado < 0.2) {
      // Una acción fuera de turno se rechaza y no cambia nada.
      const otro = e.asientos.find((a) => a.asiento !== e.turno);
      if (otro !== undefined && e.fase === "mano") {
        const p = poker.aplicar(e, otro.jugadorId, { t: "igualar" }, this.ahora, this.azar, otro.apodo);
        if (p.ok) this.fallar(`${otro.jugadorId} actuó fuera de turno`);
      }
    }

    if (e.fase === "esperando") {
      if (e.asientos.length === 0 || this.azar() < 0.8) return this.sentarAlguien();
      this.ahora = e.finFase!;
      return this.tick();
    }
    if (e.fase === "resultado") {
      const quiere = e.asientos.find((a) => this.opciones(a.jugadorId).ensenar);
      if (quiere !== undefined && this.azar() < 0.2) return this.actuar(quiere.jugadorId, { t: "ensenar" });
      this.ahora = e.finFase!;
      return this.tick();
    }
    this.ahora += this.entero(3_000);
    if (this.azar() < 0.05) {
      // Se le acaba el tiempo.
      this.ahora = e.finFase!;
      return this.tick();
    }
    this.decidir(e.asientos.find((a) => a.asiento === e.turno)!.jugadorId);
  }

  /** Juega hasta `manos` manos y levanta a todos. */
  jugar(manos: number) {
    while (this.e.ronda < manos) this.paso();
    for (const { jugadorId } of this.e.asientos) this.actuar(jugadorId, { t: "levantarse" });
  }
}

describe("póker: prueba aleatoria", () => {
  it("miles de manos al azar: el libro cuadra y nada se filtra", () => {
    let manos = 0;
    const vistos = new Set<string>();
    for (const semilla of SEMILLAS) {
      for (let jugadores = POKER.MIN_JUGADORES; jugadores <= POKER.MAX_JUGADORES; jugadores++) {
        const partida = new Partida(semilla + jugadores, jugadores);
        partida.jugar(MANOS_POR_MESA);
        // Levantados todos, no queda ni una ficha en la mesa: aunque la última mano fuera a medias, el último vivo cobró el bote.
        expect(partida.e.asientos).toEqual([]);
        expect(partida.e.abandonos).toEqual([]);
        expect(partida.pagado).toBe(partida.comprado);
        manos += partida.e.ronda;
        partida.vistos.forEach((x) => vistos.add(x));
      }
    }
    expect(manos).toBeGreaterThanOrEqual(5_000);
    expect([...vistos].sort()).toEqual(
      ["abandono", "accion", "bote_devuelto", "bote_ganado", "bote_paralelo", "calle_abierta", "carta_repartida", "cartas_ensenadas", "ciega", "mano_empezada", "varias_liquidaciones"].sort(),
    );
  });
});
