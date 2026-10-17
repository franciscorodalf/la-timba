import { describe, expect, it } from "vitest";
import { apodoValido, firmarToken, hashPin, pinValido, verificarPin, verificarToken } from "../../src/server/auth";

const SECRETO = "secreto-de-pruebas";
const AHORA = 1_800_000_000_000;
const DIA = 24 * 60 * 60 * 1000;

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Firma un payload arbitrario con el mismo formato que `firmarToken`, para probar payloads mal formados. */
async function firmarCrudo(payload: unknown, secreto: string): Promise<string> {
  const parteA = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(parteA)));
  return `${parteA}.${b64url(firma)}`;
}

/** Devuelve el token con el carácter en `pos` sustituido por otro distinto del alfabeto base64url. */
function cambiarCaracter(token: string, pos: number): string {
  const nuevo = token[pos] === "A" ? "B" : "A";
  return token.slice(0, pos) + nuevo + token.slice(pos + 1);
}

describe("hashPin", () => {
  it("devuelve hash de 32 bytes y sal de 16 bytes en hexadecimal minúsculas", async () => {
    const { hash, sal } = await hashPin("1234");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sal).toMatch(/^[0-9a-f]{32}$/);
  });

  it("el mismo PIN con sales distintas da hashes distintos", async () => {
    const a = await hashPin("1234");
    const b = await hashPin("1234");
    expect(a.sal).not.toBe(b.sal);
    expect(a.hash).not.toBe(b.hash);
  });

  it("con la misma sal dada el hash es determinista y la sal se devuelve tal cual", async () => {
    const sal = "00112233445566778899aabbccddeeff";
    const a = await hashPin("1234", sal);
    const b = await hashPin("1234", sal);
    expect(a).toEqual({ hash: b.hash, sal });
    expect(b.sal).toBe(sal);
  });

  it("PINs distintos con la misma sal dan hashes distintos", async () => {
    const sal = "00112233445566778899aabbccddeeff";
    expect((await hashPin("1234", sal)).hash).not.toBe((await hashPin("1235", sal)).hash);
  });

  it("rechaza una sal que no es hexadecimal de 16 bytes", async () => {
    await expect(hashPin("1234", "zz")).rejects.toThrow();
    await expect(hashPin("1234", "00112233")).rejects.toThrow();
  });
});

describe("verificarPin", () => {
  it("true con el PIN correcto y false con otro", async () => {
    const { hash, sal } = await hashPin("4321");
    expect(await verificarPin("4321", hash, sal)).toBe(true);
    expect(await verificarPin("4322", hash, sal)).toBe(false);
    expect(await verificarPin("", hash, sal)).toBe(false);
  });

  it("false con otra sal o con un hash de longitud distinta", async () => {
    const { hash, sal } = await hashPin("4321");
    const otraSal = (await hashPin("4321")).sal;
    expect(await verificarPin("4321", hash, otraSal)).toBe(false);
    expect(await verificarPin("4321", hash.slice(0, -2), sal)).toBe(false);
    expect(await verificarPin("4321", `${hash}00`, sal)).toBe(false);
    expect(await verificarPin("4321", "", sal)).toBe(false);
  });
});

describe("firmarToken / verificarToken", () => {
  it("un token válido devuelve { id, apodo } y nada más", async () => {
    const token = await firmarToken({ id: 7, apodo: "Fran_99" }, SECRETO, AHORA);
    expect(await verificarToken(token, SECRETO, AHORA)).toEqual({ id: 7, apodo: "Fran_99" });
  });

  it("tiene formato base64url(json).base64url(hmac) sin relleno", async () => {
    const token = await firmarToken({ id: 7, apodo: "Fran_99" }, SECRETO, AHORA);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const [parteA] = token.split(".");
    const payload = JSON.parse(atob(parteA.replace(/-/g, "+").replace(/_/g, "/")));
    expect(payload).toEqual({ id: 7, apodo: "Fran_99", exp: AHORA + 30 * DIA });
  });

  it("caduca a los 30 días: válido un ms antes, nulo en el instante exacto y después", async () => {
    const token = await firmarToken({ id: 1, apodo: "abc" }, SECRETO, AHORA);
    expect(await verificarToken(token, SECRETO, AHORA + 30 * DIA - 1)).toEqual({ id: 1, apodo: "abc" });
    expect(await verificarToken(token, SECRETO, AHORA + 30 * DIA)).toBeNull();
    expect(await verificarToken(token, SECRETO, AHORA + 31 * DIA)).toBeNull();
  });

  it("un token con cualquier carácter cambiado da null (payload, firma y último carácter)", async () => {
    const token = await firmarToken({ id: 7, apodo: "Fran_99" }, SECRETO, AHORA);
    const punto = token.indexOf(".");
    const posiciones = [0, 5, punto - 1, punto + 1, punto + 20, token.length - 1];
    for (const pos of posiciones) {
      expect(await verificarToken(cambiarCaracter(token, pos), SECRETO, AHORA), `posición ${pos}`).toBeNull();
    }
  });

  it("sustituir el último carácter de la firma por cualquier otro del alfabeto da null (sin codificaciones alternativas)", async () => {
    const token = await firmarToken({ id: 7, apodo: "Fran_99" }, SECRETO, AHORA);
    const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (const c of alfabeto) {
      if (c === token.at(-1)) continue;
      expect(await verificarToken(token.slice(0, -1) + c, SECRETO, AHORA), `último carácter ${c}`).toBeNull();
    }
  });

  it("con otro secreto da null", async () => {
    const token = await firmarToken({ id: 7, apodo: "Fran_99" }, SECRETO, AHORA);
    expect(await verificarToken(token, "otro-secreto", AHORA)).toBeNull();
  });

  it("un payload alterado con la firma original da null", async () => {
    const token = await firmarToken({ id: 7, apodo: "Fran_99" }, SECRETO, AHORA);
    const falso = await firmarToken({ id: 8, apodo: "Fran_99" }, SECRETO, AHORA);
    const forjado = `${falso.split(".")[0]}.${token.split(".")[1]}`;
    expect(await verificarToken(forjado, SECRETO, AHORA)).toBeNull();
  });

  it("tokens mal formados dan null sin lanzar", async () => {
    const valido = await firmarToken({ id: 7, apodo: "Fran_99" }, SECRETO, AHORA);
    const [parteA, parteB] = valido.split(".");
    const malos = [
      "",
      ".",
      "abc",
      "a.b.c",
      `${parteA}.`,
      `.${parteB}`,
      `${valido}.${parteB}`,
      `${parteA}.${parteB.slice(0, -4)}`,
      `${parteA}.${parteB}=`,
      `${parteA}+.${parteB}`,
      `${parteA}.${parteB}/`,
      `${parteA} .${parteB}`,
      "%%%.%%%",
      "a".repeat(5000),
    ];
    for (const malo of malos) {
      expect(await verificarToken(malo, SECRETO, AHORA), JSON.stringify(malo.slice(0, 40))).toBeNull();
    }
  });

  it("un payload bien firmado pero con otra forma da null", async () => {
    const exp = AHORA + DIA;
    const casos: unknown[] = [
      { id: "7", apodo: "Fran_99", exp },
      { id: 7, apodo: 99, exp },
      { id: 7, apodo: "Fran_99", exp: String(exp) },
      { id: 7, apodo: "Fran_99" },
      { id: 7, exp },
      { apodo: "Fran_99", exp },
      { id: null, apodo: "Fran_99", exp },
      null,
      [],
      "texto",
      7,
    ];
    for (const caso of casos) {
      const token = await firmarCrudo(caso, SECRETO);
      expect(await verificarToken(token, SECRETO, AHORA), JSON.stringify(caso)).toBeNull();
    }
    // Control: el mismo montaje con la forma correcta sí es válido.
    const bueno = await firmarCrudo({ id: 7, apodo: "Fran_99", exp }, SECRETO);
    expect(await verificarToken(bueno, SECRETO, AHORA)).toEqual({ id: 7, apodo: "Fran_99" });
  });

  it("un payload bien firmado que no es JSON da null", async () => {
    const parteA = b64url(new TextEncoder().encode("no es json"));
    const clave = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRETO), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const firma = new Uint8Array(await crypto.subtle.sign("HMAC", clave, new TextEncoder().encode(parteA)));
    expect(await verificarToken(`${parteA}.${b64url(firma)}`, SECRETO, AHORA)).toBeNull();
  });
});

describe("apodoValido", () => {
  it("acepta 3–16 caracteres [A-Za-z0-9_]", () => {
    expect(apodoValido("Fran_99")).toBe(true);
    expect(apodoValido("abc")).toBe(true);
    expect(apodoValido("diecisietecarac")).toBe(true);
    expect(apodoValido("dieciseiscaracte")).toBe(true);
    expect(apodoValido("A_B_C_1_2_3")).toBe(true);
  });

  it("rechaza demasiado corto, demasiado largo, espacios y caracteres no ASCII", () => {
    expect(apodoValido("ab")).toBe(false);
    expect(apodoValido("")).toBe(false);
    expect(apodoValido("diecisietecaract" + "x")).toBe(false);
    expect(apodoValido("Fran ")).toBe(false);
    expect(apodoValido("Fran\n")).toBe(false);
    expect(apodoValido("Frañ")).toBe(false);
    expect(apodoValido("Fran-99")).toBe(false);
  });

  it("rechaza lo que no es una cadena", () => {
    expect(apodoValido(undefined)).toBe(false);
    expect(apodoValido(null)).toBe(false);
    expect(apodoValido(1234)).toBe(false);
    expect(apodoValido(["Fran_99"])).toBe(false);
  });
});

describe("pinValido", () => {
  it("acepta exactamente 4 dígitos", () => {
    expect(pinValido("1234")).toBe(true);
    expect(pinValido("0000")).toBe(true);
  });

  it("rechaza longitudes distintas de 4 y caracteres que no son dígitos", () => {
    expect(pinValido("123")).toBe(false);
    expect(pinValido("12345")).toBe(false);
    expect(pinValido("12a4")).toBe(false);
    expect(pinValido("")).toBe(false);
    expect(pinValido("123\n")).toBe(false);
    expect(pinValido(" 123")).toBe(false);
  });

  it("rechaza lo que no es una cadena", () => {
    expect(pinValido(undefined)).toBe(false);
    expect(pinValido(null)).toBe(false);
    expect(pinValido(1234)).toBe(false);
    expect(pinValido(["1234"])).toBe(false);
  });
});
