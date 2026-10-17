const COLORES = ["#e8b4b8", "#a8d8ea", "#d4af37", "#c3e6a0", "#f5c28b", "#cdb4e8", "#9fe0d0", "#f2a7c3"];

/** Siempre el mismo color para el mismo apodo (sin distinguir mayúsculas), en todas las pantallas. */
function colorDe(apodo: string): string {
  let suma = 0;
  for (const letra of apodo.toLowerCase()) suma = (suma * 31 + (letra.codePointAt(0) ?? 0)) >>> 0;
  return COLORES[suma % COLORES.length];
}

/** Círculo de color con la inicial del apodo. Decorativo: el apodo se escribe siempre al lado. */
export function Avatar({ apodo }: { apodo: string }) {
  return (
    <span className="avatar" style={{ background: colorDe(apodo) }} aria-hidden="true">
      {(Array.from(apodo)[0] ?? "?").toUpperCase()}
    </span>
  );
}
