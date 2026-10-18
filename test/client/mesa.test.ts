import { describe, expect, it } from "vitest";
import { leerMensajeMesa, recibir, SIN_EVENTOS } from "../../src/client/red/useMesa";

const estado = { t: "estado", version: 7, ahora: 1_700_000_000_000, vista: { fase: "apuestas" }, eventos: [{ tipo: "barajado" }] };

describe("leerMensajeMesa", () => {
  it("devuelve los mensajes de estado y de error tal cual llegan", () => {
    expect(leerMensajeMesa(JSON.stringify(estado))).toEqual(estado);
    expect(leerMensajeMesa(JSON.stringify({ t: "error", codigo: "sin_fichas" }))).toEqual({ t: "error", codigo: "sin_fichas" });
  });

  it("descarta lo que no es texto ni JSON", () => {
    expect(leerMensajeMesa(new ArrayBuffer(4))).toBeNull();
    expect(leerMensajeMesa("no es json")).toBeNull();
    expect(leerMensajeMesa("null")).toBeNull();
    expect(leerMensajeMesa("[]")).toBeNull();
  });

  it("descarta los mensajes a los que les falta algo que la pantalla da por hecho", () => {
    expect(leerMensajeMesa(JSON.stringify({ ...estado, t: "sala" }))).toBeNull();
    expect(leerMensajeMesa(JSON.stringify({ ...estado, version: "7" }))).toBeNull();
    expect(leerMensajeMesa(JSON.stringify({ ...estado, ahora: undefined }))).toBeNull();
    expect(leerMensajeMesa(JSON.stringify({ ...estado, vista: null }))).toBeNull();
    expect(leerMensajeMesa(JSON.stringify({ ...estado, eventos: "barajado" }))).toBeNull();
    expect(leerMensajeMesa(JSON.stringify({ ...estado, eventos: [null] }))).toBeNull();
    expect(leerMensajeMesa(JSON.stringify({ t: "error" }))).toBeNull();
  });
});

describe("recibir", () => {
  const inicial = { vista: null, lote: SIN_EVENTOS, n: 0 };
  const e1 = [{ tipo: "carta_repartida", a: 1, oculta: false }];
  const e2 = [{ tipo: "pago", jugadorId: 1, neto: 50 }];

  it("cada mensaje trae la vista completa y su lote de eventos sustituye al anterior ya pintado", () => {
    const primero = recibir(inicial, { v: 1 }, e1, 0);
    expect(primero).toEqual({ vista: { v: 1 }, lote: e1, n: 1 });
    const segundo = recibir(primero, { v: 2 }, e2, 1);
    expect(segundo).toEqual({ vista: { v: 2 }, lote: e2, n: 2 });
  });

  it("si dos mensajes llegan antes de pintar el primero, sus eventos se juntan en orden y no se pierde ninguno", () => {
    const primero = recibir(inicial, { v: 1 }, e1, 0);
    const segundo = recibir(primero, { v: 2 }, e2, 0);
    expect(segundo).toEqual({ vista: { v: 2 }, lote: [...e1, ...e2], n: 2 });
  });

  it("cada mensaje estrena lote aunque venga vacío: quien anima por lote no repite el anterior", () => {
    const primero = recibir(inicial, { v: 1 }, e1, 0);
    const vacio = recibir(primero, { v: 2 }, [], 1);
    expect(vacio.lote).toEqual([]);
    expect(vacio.lote).not.toBe(primero.lote);
  });
});
