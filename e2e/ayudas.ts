/** Un apodo válido (3–16 caracteres) distinto en cada ejecución: el servidor de desarrollo conserva el estado entre ejecuciones. */
export function apodoUnico(): string {
  const azar = Math.random().toString(36).slice(2, 6);
  return `${Date.now().toString(36)}${azar}`.slice(0, 16);
}
