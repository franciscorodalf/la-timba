// PIN (PBKDF2-SHA256) y tokens firmados (HMAC-SHA256). Solo Web Crypto: corre en el runtime de Workers.

const ITERACIONES = 100_000; // máximo que permite Workers
const BYTES_SAL = 16;
const BITS_HASH = 256;
const VIGENCIA_TOKEN_MS = 30 * 24 * 60 * 60 * 1000;

const codificador = new TextEncoder();
const decodificador = new TextDecoder();

export const apodoValido = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_]{3,16}$/.test(s);
export const pinValido = (s: unknown): s is string => typeof s === "string" && /^\d{4}$/.test(s);

// ---------- Codificaciones ----------

function aHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function deHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) throw new Error("Hexadecimal inválido");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function aBase64Url(bytes: Uint8Array): string {
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decodifica base64url sin relleno; devuelve `null` si la entrada no es base64url válido. */
function deBase64Url(texto: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(texto) || texto.length % 4 === 1) return null;
  try {
    const base64 = texto.replace(/-/g, "+").replace(/_/g, "/");
    const binario = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return Uint8Array.from(binario, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

// ---------- PIN ----------

async function derivarPin(pin: string, sal: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", codificador.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: ITERACIONES }, material, BITS_HASH);
  return new Uint8Array(bits);
}

/** Deriva el hash del PIN. Sin `salHex` genera una sal aleatoria de 16 bytes. Hash y sal en hexadecimal minúsculas. */
export async function hashPin(pin: string, salHex?: string): Promise<{ hash: string; sal: string }> {
  const sal = salHex === undefined ? crypto.getRandomValues(new Uint8Array(BYTES_SAL)) : deHex(salHex);
  if (sal.length !== BYTES_SAL) throw new Error("La sal debe tener 16 bytes");
  return { hash: aHex(await derivarPin(pin, sal)), sal: aHex(sal) };
}

/** Compara el hash derivado con el guardado recorriendo todos los bytes (sin salida anticipada). */
export async function verificarPin(pin: string, hash: string, sal: string): Promise<boolean> {
  const calculado = aHex(await derivarPin(pin, deHex(sal)));
  if (calculado.length !== hash.length) return false;
  let diferencia = 0;
  for (let i = 0; i < calculado.length; i++) diferencia |= calculado.charCodeAt(i) ^ hash.charCodeAt(i);
  return diferencia === 0;
}

// ---------- Tokens ----------

function claveHmac(secreto: string, uso: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", codificador.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, [uso]);
}

/** Token `base64url(json).base64url(hmac)`; caduca a los 30 días de `ahora` (ms). */
export async function firmarToken(p: { id: number; apodo: string }, secreto: string, ahora: number): Promise<string> {
  const carga = aBase64Url(codificador.encode(JSON.stringify({ id: p.id, apodo: p.apodo, exp: ahora + VIGENCIA_TOKEN_MS })));
  const firma = await crypto.subtle.sign("HMAC", await claveHmac(secreto, "sign"), codificador.encode(carga));
  return `${carga}.${aBase64Url(new Uint8Array(firma))}`;
}

/** Devuelve `{ id, apodo }` si el token es auténtico, no ha caducado y tiene la forma esperada; si no, `null`. */
export async function verificarToken(token: string, secreto: string, ahora: number): Promise<{ id: number; apodo: string } | null> {
  const partes = token.split(".");
  if (partes.length !== 2) return null;
  const [carga, firmaTexto] = partes;
  const firma = deBase64Url(firmaTexto);
  // Rechaza codificaciones no canónicas (bits de relleno distintos de cero): una firma tiene una única forma válida.
  if (firma === null || aBase64Url(firma) !== firmaTexto) return null;
  if (!(await crypto.subtle.verify("HMAC", await claveHmac(secreto, "verify"), firma, codificador.encode(carga)))) return null;

  const bytes = deBase64Url(carga);
  if (bytes === null) return null;
  let datos: unknown;
  try {
    datos = JSON.parse(decodificador.decode(bytes));
  } catch {
    return null;
  }
  if (typeof datos !== "object" || datos === null) return null;
  const { id, apodo, exp } = datos as Record<string, unknown>;
  if (typeof id !== "number" || typeof apodo !== "string" || typeof exp !== "number") return null;
  if (ahora >= exp) return null;
  return { id, apodo };
}
