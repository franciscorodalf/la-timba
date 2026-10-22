import { useRef, useState } from "react";
import type { OrdenRanking } from "../../shared/api";
import { retardo } from "../animacion";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { Navegacion } from "../componentes/Navegacion";
import { ultimaPartida } from "../red/ultimaPartida";
import { EsqueletoRanking, Filas } from "./ranking/Filas";
import { BarraPestanas, ID_PANEL, idPestana } from "./ranking/BarraPestanas";
import { PESTANAS } from "./ranking/pestanas";
import { useRanking } from "./ranking/useRanking";

/** El ranking global: seis pestañas, el top 50 de cada una con medallas y tu fila a la vista. */
export function Ranking() {
  const [orden, setOrden] = useState<OrdenRanking>("fichas");
  const ranking = useRanking(orden);
  // «Sala» vuelve a la última partida visitada en esta pestaña; se lee una vez, al abrir la pantalla.
  const [partida] = useState(ultimaPartida);
  const leyenda = PESTANAS.find((p) => p.orden === orden)?.leyenda;
  const panel = useRef<HTMLDivElement>(null);

  return (
    <main className="con-navegacion ranking">
      <div className="con-navegacion__columna">
        <header className="ranking__cabecera aparece">
          <h1 className="marca__logo ranking__titulo">Ranking</h1>
          <p className="ranking__lema">Quién manda en La Timba</p>
        </header>

        {/* La barra se queda arriba al recorrer la lista; la muesca tapa el área segura de arriba (el notch) mientras tanto. */}
        <div className="ranking__muesca" aria-hidden="true" />
        <div className="ranking__barra aparece" style={retardo(80)}>
          <BarraPestanas activa={orden} onElegir={setOrden} />
        </div>

        <div className="ranking__panel" ref={panel} role="tabpanel" id={ID_PANEL} aria-labelledby={idPestana(orden)} tabIndex={0} aria-busy={ranking.estado === "cargando" || undefined}>
          <p className="ranking__leyenda">{leyenda}</p>
          {ranking.estado === "cargando" && <EsqueletoRanking />}
          {ranking.estado === "error" && (
            <div className="ranking__error">
              <Aviso>{ranking.mensaje}</Aviso>
              <Boton
                variante="secundario"
                ancho
                onClick={() => {
                  // El botón se va al empezar a cargar: el foco se queda en el panel, que es lo que va a cambiar.
                  panel.current?.focus({ preventScroll: true });
                  ranking.reintentar();
                }}
              >
                Reintentar
              </Boton>
            </div>
          )}
          {ranking.estado === "listo" && <Filas key={orden} orden={orden} datos={ranking.datos} />}
        </div>
      </div>

      <Navegacion activa="ranking" codigo={partida ?? undefined} />
    </main>
  );
}
