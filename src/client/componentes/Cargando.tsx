/** Pantalla de espera mientras se averigua algo del servidor. */
export function Cargando() {
  return (
    <main className="pantalla" aria-busy="true">
      <div className="giro" role="status" aria-label="Cargando" />
    </main>
  );
}
