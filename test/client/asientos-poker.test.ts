import { describe, expect, it } from "vitest";
import { POKER, type AsientoVista } from "../../src/shared/juegos/poker";
import { anclaDeApuesta, CAJA_ASIENTO, CAJA_APUESTA, CAJA_CENTRO, colocarAsientos, TAPETE_REFERENCIA, type Caja } from "../../src/client/pantallas/poker/asientos";

/** `n` asientos sentados (el 0, el 1…), con el jugador `i + 1` en el asiento `i`. */
function sentados(n: number, desde = 0): AsientoVista[] {
  return Array.from({ length: n }, (_, i) => ({
    asiento: desde + i,
    jugadorId: desde + i + 1,
    apodo: `J${desde + i + 1}`,
    fichas: 1000,
    apostado: 0,
    estado: "juega" as const,
    conectado: true,
    boton: i === 0,
    tieneCartas: true,
    cartas: null,
  }));
}

/** El rectángulo en píxeles de un punto del tapete (en %) con la caja dada, centrado en él. */
function caja(x: number, y: number, medidas: { ancho: number; alto: number }, tapete: { ancho: number; alto: number }): Caja {
  const cx = (x / 100) * tapete.ancho;
  const cy = (y / 100) * tapete.alto;
  return { izq: cx - medidas.ancho / 2, der: cx + medidas.ancho / 2, arr: cy - medidas.alto / 2, aba: cy + medidas.alto / 2 };
}

/** El rectángulo de lo apostado: sujeto por el borde que mira al centro (ver `anclaDeApuesta`). */
function cajaApuesta(x: number, y: number, medidas: { ancho: number; alto: number }, tapete: { ancho: number; alto: number }): Caja {
  const c = caja(x, y, medidas, tapete);
  const ancla = anclaDeApuesta(x);
  if (ancla === "izq") return { ...c, izq: c.izq + medidas.ancho / 2, der: c.der + medidas.ancho / 2 };
  if (ancla === "der") return { ...c, izq: c.izq - medidas.ancho / 2, der: c.der - medidas.ancho / 2 };
  return c;
}

const seSolapan = (a: Caja, b: Caja) => a.izq < b.der && b.izq < a.der && a.arr < b.aba && b.arr < a.aba;

describe("colocar los asientos de la mesa de póker", () => {
  for (const ordenador of [false, true]) {
    const vista = ordenador ? "ordenador" : "móvil";

    it(`tú siempre abajo, con cualquier número de jugadores (${vista})`, () => {
      for (let n = 1; n <= POKER.MAX_JUGADORES; n++) {
        for (let miAsiento = 0; miAsiento < n; miAsiento++) {
          const asientos = sentados(n);
          const yo = asientos[miAsiento].jugadorId;
          const puestos = colocarAsientos(asientos, yo, ordenador);
          expect(puestos, `${n} jugadores`).toHaveLength(n);
          const mio = puestos.find((p) => p.asiento.jugadorId === yo)!;
          expect(mio.x, `${n} jugadores, asiento ${miAsiento}`).toBe(50);
          // Ningún otro está más abajo que tú ni a tu altura.
          for (const otro of puestos) if (otro !== mio) expect(otro.y).toBeLessThan(mio.y);
        }
      }
    });

    it(`los demás van en el orden de sus asientos, empezando por el siguiente al tuyo, en el sentido del reloj (${vista})`, () => {
      const asientos = sentados(5);
      const puestos = colocarAsientos(asientos, asientos[2].jugadorId, ordenador);
      expect(puestos.map((p) => p.asiento.asiento)).toEqual([2, 3, 4, 0, 1]);
      // Sentido del reloj visto desde arriba: de abajo hacia la izquierda, luego arriba y por último a la derecha.
      const [, siguiente, , , ultimo] = puestos;
      expect(siguiente.x).toBeLessThan(50);
      expect(ultimo.x).toBeGreaterThan(50);
    });

    it(`quien mira ve el asiento 0 abajo (${vista})`, () => {
      for (const yo of [null, 99]) {
        for (let n = 2; n <= POKER.MAX_JUGADORES; n++) {
          const puestos = colocarAsientos(sentados(n), yo, ordenador);
          const abajo = puestos.reduce((a, b) => (b.y > a.y ? b : a));
          expect(abajo.asiento.asiento, `${n} jugadores, yo=${yo}`).toBe(0);
          expect(abajo.x).toBe(50);
        }
      }
    });

    it(`ningún par de asientos se pisa con 8 jugadores, ni con lo apostado ni con las cartas de la mesa (${vista})`, () => {
      const tapete = TAPETE_REFERENCIA[ordenador ? "ordenador" : "movil"];
      const medidas = CAJA_ASIENTO[ordenador ? "ordenador" : "movil"];
      const apuesta = CAJA_APUESTA[ordenador ? "ordenador" : "movil"];
      const centro = CAJA_CENTRO[ordenador ? "ordenador" : "movil"];
      for (let n = 2; n <= POKER.MAX_JUGADORES; n++) {
        const asientos = sentados(n);
        const puestos = colocarAsientos(asientos, asientos[0].jugadorId, ordenador);
        const cajas = puestos.map((p) => caja(p.x, p.y, medidas, tapete));
        const apuestas = puestos.map((p) => cajaApuesta(p.apuesta.x, p.apuesta.y, apuesta, tapete));
        const mesa = caja(50, centro.y, centro, tapete);
        puestos.forEach((p, i) => {
          // Todo cabe en el tapete.
          for (const c of [cajas[i], apuestas[i]]) {
            expect(c.izq, `${n} jugadores, ${p.asiento.apodo}`).toBeGreaterThanOrEqual(0);
            expect(c.der).toBeLessThanOrEqual(tapete.ancho);
            expect(c.arr).toBeGreaterThanOrEqual(0);
            expect(c.aba).toBeLessThanOrEqual(tapete.alto);
          }
          expect(seSolapan(cajas[i], mesa), `${p.asiento.apodo} con ${n} jugadores pisa las cartas de la mesa`).toBe(false);
          expect(seSolapan(apuestas[i], mesa), `la apuesta de ${p.asiento.apodo} con ${n} jugadores pisa las cartas de la mesa`).toBe(false);
          puestos.forEach((q, j) => {
            if (j > i) expect(seSolapan(cajas[i], cajas[j]), `${p.asiento.apodo} y ${q.asiento.apodo} con ${n} jugadores`).toBe(false);
            expect(seSolapan(apuestas[i], cajas[j]), `la apuesta de ${p.asiento.apodo} pisa a ${q.asiento.apodo} con ${n} jugadores`).toBe(false);
            if (j > i) expect(seSolapan(apuestas[i], apuestas[j]), `las apuestas de ${p.asiento.apodo} y ${q.asiento.apodo}`).toBe(false);
          });
        });
      }
    });

    it(`lo apostado queda entre el asiento y el centro (${vista})`, () => {
      const asientos = sentados(8);
      for (const p of colocarAsientos(asientos, asientos[0].jugadorId, ordenador)) {
        if (p.asiento.asiento === 0) continue;
        // Más cerca del centro del tapete que el propio asiento.
        const antes = Math.hypot(p.x - 50, p.y - 50);
        const despues = Math.hypot(p.apuesta.x - 50, p.apuesta.y - 50);
        expect(despues, p.asiento.apodo).toBeLessThan(antes);
      }
    });
  }

  it("sin nadie en la mesa no hay nada que colocar", () => {
    expect(colocarAsientos([], 1, false)).toEqual([]);
  });

  it("no depende del orden en que lleguen los asientos", () => {
    const asientos = sentados(4);
    const desordenados = [asientos[2], asientos[0], asientos[3], asientos[1]];
    const a = colocarAsientos(asientos, asientos[1].jugadorId, false).map((p) => [p.asiento.asiento, p.x, p.y]);
    const b = colocarAsientos(desordenados, asientos[1].jugadorId, false).map((p) => [p.asiento.asiento, p.x, p.y]);
    expect(b).toEqual(a);
  });
});
