import { describe, expect, it } from "vitest";
import { leerMensajeSala } from "../../src/client/red/usePartida";

const sala = {
  t: "sala",
  codigo: "KXP4",
  conectados: ["Ana"],
  mesas: {
    blackjack: { jugadores: [], fase: "esperando", finFase: null },
    carrera: { jugadores: ["Ana"], fase: "apuestas", finFase: 1_000 },
  },
  rankingNoche: [{ apodo: "Ana", neto: 50 }],
};

describe("leerMensajeSala", () => {
  it("devuelve el mensaje de sala tal cual llega", () => {
    expect(leerMensajeSala(JSON.stringify(sala))).toEqual(sala);
  });

  it("descarta lo que no es texto ni JSON", () => {
    expect(leerMensajeSala(new ArrayBuffer(4))).toBeNull();
    expect(leerMensajeSala("no es json")).toBeNull();
    expect(leerMensajeSala("null")).toBeNull();
    expect(leerMensajeSala("[]")).toBeNull();
  });

  it("descarta los mensajes que no son de sala o a los que les falta algo que la pantalla da por hecho", () => {
    expect(leerMensajeSala(JSON.stringify({ ...sala, t: "estado" }))).toBeNull();
    expect(leerMensajeSala(JSON.stringify({ ...sala, conectados: "Ana" }))).toBeNull();
    expect(leerMensajeSala(JSON.stringify({ ...sala, rankingNoche: undefined }))).toBeNull();
    expect(leerMensajeSala(JSON.stringify({ ...sala, mesas: { blackjack: sala.mesas.blackjack } }))).toBeNull();
    expect(leerMensajeSala(JSON.stringify({ ...sala, mesas: null }))).toBeNull();
  });
});
