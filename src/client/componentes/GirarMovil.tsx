/**
 * «Gira el móvil para jugar»: las mesas no tienen vista para un móvil tumbado (el tapete de ordenador no cabe en 400 px de alto y
 * obligaría a desplazarse). Va dentro de la mesa y solo se ve cuando el puntero es táctil, la pantalla está apaisada y mide
 * 500 px de alto o menos (ver `girar-movil.css`); el resto de la mesa se esconde pero sigue montado, con su socket y su sitio
 * en la mesa: al volver a ponerlo de pie, todo está como estaba.
 */
export function GirarMovil() {
  return (
    <div className="girar-movil" role="status">
      <svg className="girar-movil__icono" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
        <path className="girar-movil__flecha" d="M26 40a44 44 0 0 1 70 0" />
        <path className="girar-movil__flecha" d="m97.5 28 .5 14.5-14.2-2.6" />
        <g className="girar-movil__giro">
          <rect className="girar-movil__cuerpo" x="30" y="46" width="60" height="38" rx="7" />
          <rect className="girar-movil__pantalla" x="35.5" y="51.5" width="41" height="27" rx="2.5" />
          <circle className="girar-movil__boton" cx="83" cy="65" r="2" />
        </g>
      </svg>
      <div className="girar-movil__texto">
        <h2 className="girar-movil__titulo">Gira el móvil para jugar</h2>
        <p>Las mesas se juegan con el móvil en vertical. Sigues sentado en tu sitio.</p>
      </div>
    </div>
  );
}
