import { describe, expect, it } from "vitest";
import { ColaDeMarcos, type Reloj } from "../../src/client/pantallas/carrera/cola";
import { aplicarMarco, type Escena, GANADOR_MS, GIRO_TRAMO_MS, type Marco, PAGOS_TRAS_GANADOR_MS, planDeLote, RETROCESO_MS } from "../../src/client/pantallas/carrera/escena";
import type { Carta, Palo } from "../../src/shared/cartas";
import type { VistaCarrera } from "../../src/shared/juegos/carrera";

const c = (texto: string): Carta => ({ palo: texto.at(-1) as Palo, valor: texto.slice(0, -1) as Carta["valor"] });
const pos = (H: number, D: number, C: number, S: number): Record<Palo, number> => ({ H, D, C, S });
const tramos = (...cartas: string[]): VistaCarrera["tramos"] => Array.from({ length: 7 }, (_, i) => (cartas[i] ? c(cartas[i]) : null));

/**
 * Un reloj de mentira que dispara los temporizadores como lo hace Chromium en el peor caso: un retraso con decimales se queda
 * en su parte entera (el temporizador salta hasta 1 ms antes de lo pedido) y, entre los que caen en el mismo milisegundo,
 * sale primero el último que se puso. Con eso, dos fotogramas del mismo instante salen al revés si cada uno tiene su temporizador.
 */
class RelojDeMentira implements Reloj {
  private t = 0;
  private temporizadores: { id: number; en: number; hacer: () => void }[] = [];
  private siguiente = 0;

  ahora(): number {
    return this.t;
  }

  poner(hacer: () => void, ms: number): number {
    const id = ++this.siguiente;
    this.temporizadores.push({ id, en: this.t + Math.trunc(ms), hacer });
    return id;
  }

  quitar(id: unknown): void {
    this.temporizadores = this.temporizadores.filter((x) => x.id !== id);
  }

  /** Avanza el tiempo hasta `hasta`, disparando lo que toque por el camino. */
  avanzar(hasta: number): void {
    for (;;) {
      const vencidos = this.temporizadores.filter((x) => x.en <= hasta);
      if (vencidos.length === 0) break;
      const primero = Math.min(...vencidos.map((x) => x.en));
      // Entre los del mismo instante, el último que se puso.
      const elegido = vencidos.filter((x) => x.en === primero).at(-1)!;
      this.temporizadores = this.temporizadores.filter((x) => x !== elegido);
      this.t = Math.max(this.t, primero);
      elegido.hacer();
    }
    this.t = hasta;
  }

  /** Salta a `t` (sin disparar nada): un instante en que llega un mensaje. */
  en(t: number): void {
    this.avanzar(t);
  }
}

function vista(resto: Partial<VistaCarrera> = {}): VistaCarrera {
  return {
    ronda: 4,
    fase: "carrera",
    finFase: 0,
    posiciones: pos(0, 0, 0, 0),
    tramos: tramos(),
    ultimaCarta: null,
    misApuestas: [],
    totalesPorCaballo: pos(0, 0, 0, 0),
    sentados: [],
    ganador: null,
    ...resto,
  };
}

/** Lo que ve la pantalla: la escena y todo lo que se ha ido aplicando (con su hora). */
function pantalla() {
  const reloj = new RelojDeMentira();
  let escena: Escena | null = null;
  const vistas: { t: number; posiciones: Record<Palo, number>; ganador: Palo | null; pagos: boolean }[] = [];
  const cola = new ColaDeMarcos((marco: Marco) => {
    escena = escena === null ? (marco.parche as Escena) : aplicarMarco(escena, marco);
    vistas.push({ t: reloj.ahora(), posiciones: { ...escena.posiciones }, ganador: escena.ganador, pagos: escena.pagos !== null });
  }, reloj);
  /** Llega un mensaje: se planea sobre cómo quedará la escena al acabar lo que hay en marcha y se pone detrás. */
  const llega = (lote: Parameters<typeof planDeLote>[1], v: VistaCarrera) => {
    cola.vencidos();
    const plan = planDeLote(escena === null ? null : cola.proyectar(escena), lote, v);
    if (plan.marcos.some((m) => m.salto)) {
      cola.terminar();
      cola.encolar(planDeLote(escena, lote, v).marcos);
    } else cola.encolar(plan.marcos);
  };
  return { reloj, cola, llega, vistas, escena: () => escena! };
}

describe("ColaDeMarcos", () => {
  it("un paso que llega con otro en marcha sale detrás aunque su primer fotograma caiga en el mismo instante que el último del anterior", () => {
    const p = pantalla();
    const inicial = vista({ posiciones: pos(7, 3, 3, 3), tramos: tramos("5H", "6D"), ultimaCarta: c("2D"), misApuestas: [{ caballo: "H", cantidad: 50 }] });
    p.llega([], inicial);
    expect(p.escena().posiciones).toEqual(pos(7, 3, 3, 3));

    // Paso 1: sale un diamante (D 3→4), se gira el tramo 2 (un 7 de tréboles) y tréboles retrocede (3→2): avance a 0, giro a 250, retroceso a 480.
    const paso1 = vista({ posiciones: pos(7, 4, 2, 3), tramos: tramos("5H", "6D", "7C"), ultimaCarta: c("8D"), misApuestas: inicial.misApuestas });
    p.reloj.en(1000);
    p.llega([{ tipo: "caballo_avanza", palo: "D", carta: c("8D") }, { tipo: "tramo_girado", indice: 2, palo: "C" }], paso1);
    // Paso 2, 300 ms después (el anterior aún va por la mitad): H gana (7→8), con su cobro. Su primer fotograma sale cuando acaba el paso 1.
    p.reloj.en(1300);
    const paso2 = vista({ fase: "resultado", posiciones: pos(8, 4, 2, 3), tramos: paso1.tramos, ultimaCarta: c("JH"), ganador: "H", misApuestas: inicial.misApuestas });
    p.llega([{ tipo: "caballo_avanza", palo: "H", carta: c("JH") }, { tipo: "ganador", palo: "H" }, { tipo: "pago", jugadorId: 7, neto: 150 }], paso2);

    p.reloj.avanzar(1000 + RETROCESO_MS + GANADOR_MS + PAGOS_TRAS_GANADOR_MS + 500);

    // La escena acaba en la última vista: H en la meta, el retroceso del paso 1 y el ganador.
    expect(p.escena().posiciones).toEqual(pos(8, 4, 2, 3));
    expect(p.escena().ganador).toBe("H");
    expect(p.escena().pagos).not.toBeNull();
    // El caballo nunca vuelve atrás, y el ganador y los pagos salen con el caballo ya en la meta.
    const h = p.vistas.map((v) => v.posiciones.H);
    for (let i = 1; i < h.length; i++) expect(h[i]).toBeGreaterThanOrEqual(h[i - 1]);
    for (const v of p.vistas.filter((x) => x.ganador !== null || x.pagos)) expect(v.posiciones.H).toBe(8);
  });

  it("un paso con giro seguido de otro cualquiera acaba convergido a la última vista (casillas, tramos y ganador)", () => {
    const p = pantalla();
    const v0 = vista({ posiciones: pos(1, 1, 1, 0) });
    p.llega([], v0);
    p.reloj.en(500);
    // Sale un corazón (H 1→2): nada se gira (S sigue en 0). Después, 120 ms más tarde, otro corazón (H 2→3).
    p.llega([{ tipo: "caballo_avanza", palo: "H", carta: c("2H") }], vista({ posiciones: pos(2, 1, 1, 0), ultimaCarta: c("2H") }));
    p.reloj.en(620);
    p.llega([{ tipo: "caballo_avanza", palo: "H", carta: c("3H") }], vista({ posiciones: pos(3, 1, 1, 0), ultimaCarta: c("3H") }));
    p.reloj.avanzar(3000);
    expect(p.escena().posiciones).toEqual(pos(3, 1, 1, 0));
    expect(p.escena().cartas.map((x) => x.carta)).toEqual([c("2H"), c("3H")]);
  });

  it("si el temporizador llega tarde (pestaña dormida), lo vencido se aplica en orden y de una vez", () => {
    const p = pantalla();
    p.llega([], vista({ posiciones: pos(0, 1, 1, 1) }));
    p.reloj.en(100);
    p.llega([{ tipo: "caballo_avanza", palo: "H", carta: c("4H") }, { tipo: "tramo_girado", indice: 0, palo: "H" }], vista({ posiciones: pos(0, 1, 1, 1), tramos: tramos("5H"), ultimaCarta: c("4H") }));
    // Un mensaje llega mucho después de lo previsto (el reloj se ha dormido): antes de planear se aplica lo vencido.
    p.reloj.en(100 + RETROCESO_MS + 400);
    p.cola.vencidos();
    expect(p.escena().posiciones).toEqual(pos(0, 1, 1, 1));
    expect(p.escena().girados).toBe(1);
    expect(p.cola.restante()).toBe(0);
  });

  it("los fotogramas salen a su hora y en orden: avance, giro, retroceso", () => {
    const p = pantalla();
    p.llega([], vista({ posiciones: pos(0, 1, 1, 1) }));
    p.reloj.en(100);
    p.llega([{ tipo: "caballo_avanza", palo: "H", carta: c("4H") }, { tipo: "tramo_girado", indice: 0, palo: "H" }], vista({ posiciones: pos(0, 1, 1, 1), tramos: tramos("5H"), ultimaCarta: c("4H") }));
    p.reloj.avanzar(100 + RETROCESO_MS + 50);
    const horas = p.vistas.slice(1).map((v) => v.t - 100);
    expect(horas).toEqual([0, GIRO_TRAMO_MS, RETROCESO_MS]);
    expect(p.vistas.slice(1).map((v) => v.posiciones.H)).toEqual([1, 1, 0]);
  });

  it("terminar() aplica lo que queda en orden y deja la cola vacía; cancelar() lo olvida", () => {
    const p = pantalla();
    p.llega([], vista({ posiciones: pos(0, 1, 1, 1) }));
    p.llega([{ tipo: "caballo_avanza", palo: "H", carta: c("4H") }, { tipo: "tramo_girado", indice: 0, palo: "H" }], vista({ posiciones: pos(0, 1, 1, 1), tramos: tramos("5H"), ultimaCarta: c("4H") }));
    expect(p.cola.restante()).toBeGreaterThan(0);
    p.cola.terminar();
    expect(p.cola.restante()).toBe(0);
    expect(p.escena().posiciones).toEqual(pos(0, 1, 1, 1));
    p.reloj.avanzar(5000);
    expect(p.vistas.length).toBe(4);

    const q = pantalla();
    q.llega([], vista({ posiciones: pos(0, 1, 1, 1) }));
    q.llega([{ tipo: "caballo_avanza", palo: "H", carta: c("4H") }, { tipo: "tramo_girado", indice: 0, palo: "H" }], vista({ posiciones: pos(0, 1, 1, 1), tramos: tramos("5H"), ultimaCarta: c("4H") }));
    q.cola.cancelar();
    q.reloj.avanzar(5000);
    expect(q.vistas.length).toBe(2);
  });
});
