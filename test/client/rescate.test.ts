import { describe, expect, it } from "vitest";
import { errorRescate } from "../../src/client/pantallas/perfil/rescate";
import { ErrorApi, MENSAJE_DESCANSANDO } from "../../src/client/red/api";

describe("errorRescate", () => {
  it("con apuestas pendientes pide esperar a que acabe la ronda", () => {
    expect(errorRescate(new ErrorApi(409, "apuestas_pendientes", { error: "apuestas_pendientes" }))).toEqual({
      tipo: "aviso",
      texto: "Espera a que acabe tu ronda",
    });
  });

  it("si ya tienes fichas no es un aviso: hay que ponerse al día", () => {
    expect(errorRescate(new ErrorApi(409, "tiene_fichas", { error: "tiene_fichas" }))).toEqual({ tipo: "tiene_fichas" });
  });

  it("cualquier otro fallo usa el texto general", () => {
    expect(errorRescate(new ErrorApi(503, "descansando", null))).toEqual({ tipo: "aviso", texto: MENSAJE_DESCANSANDO });
    expect(errorRescate(new ErrorApi(0, "sin_conexion", null))).toEqual({
      tipo: "aviso",
      texto: "No hay conexión con La Timba. Revisa tu red e inténtalo de nuevo",
    });
    expect(errorRescate(new ErrorApi(409, "otra_cosa", null))).toEqual({ tipo: "aviso", texto: "Algo ha salido mal. Inténtalo de nuevo" });
    expect(errorRescate(new Error("raro"))).toEqual({ tipo: "aviso", texto: "Algo ha salido mal. Inténtalo de nuevo" });
  });
});
