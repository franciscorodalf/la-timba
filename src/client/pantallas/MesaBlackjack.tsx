import { AnimatePresence, motion } from "motion/react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { type AccionBJ, BJ, type VistaBJ } from "../../shared/juegos/blackjack";
import type { JugadorId } from "../../shared/juegos/tipos";
import { AvisoMesa } from "../componentes/AvisoMesa";
import { BarraMesa } from "../componentes/BarraMesa";
import { CartelPremio } from "../componentes/CartelPremio";
import { EstadoMesa } from "../componentes/EstadoMesa";
import { Ficha } from "../componentes/Ficha";
import { FichasVolando } from "../componentes/FichasVolando";
import { Mazo } from "../componentes/Mazo";
import { usePrecargarBaraja } from "../componentes/Naipe";
import { Reconectando } from "../componentes/Reconectando";
import { Neto, Resultado } from "../componentes/Resultado";
import { SinMesa, useSinMesa } from "../componentes/SinMesa";
import { useMovimientoReducido } from "../efectos/movimiento";
import { useBarajando } from "../efectos/useBarajando";
import { useDespues } from "../efectos/useDespues";
import { usePremio } from "../efectos/usePremio";
import { vibrar } from "../efectos/vibrar";
import { sonidos } from "../efectos/sonidos";
import { ORDENADOR_PX, useAltoVentana, useAnchoVentana } from "../efectos/ventana";
import { cuentaAtras, miles } from "../formato";
import { useAhoraServidor } from "../red/reloj";
import { useSesion } from "../red/sesion";
import { useEnvioUnico } from "../red/useEnvioUnico";
import { useFichasAlDia } from "../red/useFichasAlDia";
import { useMesa } from "../red/useMesa";
import { useSalirDeMesa } from "../red/useSalirDeMesa";
import { useSentado } from "../red/useSentado";
import { MesaLlena } from "./MesaLlena";
import { Apostar, Decidir, textoEstado } from "./blackjack/controles";
import { claveCarta, totalVisible } from "./blackjack/guion";
import { Apuesta, Leyenda, Mano, type ManoVista, SimboloMano, Total, tonoDe } from "./blackjack/piezas";
import { aterrizada, girada, restante, useGuion } from "./blackjack/useGuion";

/** Respiro entre la última carta de la ronda y el cartel del premio. */
const PAUSA_PREMIO_MS = 250;

// ---------------------------------------------------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------------------------------------------------

interface Medidas {
  ordenador: boolean;
  banca: number;
  yo: number;
  otros: number;
  mazo: number;
}

/** El ancho de las cartas según la pantalla: en móvil se ajusta al ancho (y a lo bajo que sea), en ordenador a lo alto. */
function useMedidas(): Medidas {
  const ancho = useAnchoVentana();
  const alto = useAltoVentana();
  if (ancho >= ORDENADOR_PX) {
    const k = Math.min(1.15, Math.max(0.75, alto / 820));
    return { ordenador: true, banca: Math.round(78 * k), yo: Math.round(96 * k), otros: Math.round(62 * k), mazo: Math.round(56 * k) };
  }
  const yo = Math.round(Math.min(Math.max(ancho * 0.25, 66), 112, alto * 0.14));
  const banca = Math.round(Math.min(Math.max(ancho * 0.185, 50), 84, alto * 0.105));
  return { ordenador: false, banca, yo, otros: 0, mazo: Math.round(banca * 0.72) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------------------------------------------------

interface Resultados {
  ronda: number;
  netos: Map<JugadorId, number>;
}

interface Otro {
  apodo: string;
  mano: ManoVista | undefined;
}

/** La mesa de blackjack de la partida `codigo`, como en el boceto aprobado. */
export function MesaBlackjack({ codigo }: { codigo: string }) {
  const { jugador, refrescar } = useSesion();
  const { vista, lote, enviar, error, conectado } = useMesa<VistaBJ, AccionBJ>("mesa-blackjack", codigo);
  const medidas = useMedidas();
  const reducido = useMovimientoReducido();

  const mazo = useRef<HTMLDivElement>(null);
  const refFichas = useRef<HTMLParagraphElement>(null);
  const refApuesta = useRef<HTMLSpanElement>(null);
  const reloj = useGuion(lote, vista, mazo);

  const [resultados, setResultados] = useState<Resultados | null>(null);
  const { premio, celebrar } = usePremio();
  const barajando = useBarajando(lote);

  // Temporizadores que no deben cortarse al llegar otro mensaje (el premio de esta ronda).
  const despues = useDespues();

  usePrecargarBaraja();

  // Las fichas se vuelven a leer al (re)conectar y al empezar cada ronda, aunque el pago no traiga evento.
  useFichasAlDia(conectado, vista?.ronda);

  const yo = vista?.yo ?? null;
  const miMano = vista?.manos.find((m) => m.jugadorId === yo);
  const fichas = jugador?.fichas ?? 0;

  // Tu apuesta ya está en la mesa (o la has doblado): el contador baja contando.
  const miApuesta = miMano?.apuesta ?? null;
  const apuestaVista = useRef<number | null>(null);
  useEffect(() => {
    const antes = apuestaVista.current;
    apuestaVista.current = miApuesta;
    if (miApuesta !== null && miApuesta !== antes) void refrescar();
  }, [miApuesta, refrescar]);

  // Lo que trae cada lote además de cartas: barajado y pagos. El premio se enseña cuando ya se ha visto la última carta.
  useEffect(() => {
    if (vista === null) return;
    const pagos = lote.filter((e) => e.tipo === "pago").map((e) => ({ jugadorId: e.jugadorId as JugadorId, neto: e.neto as number }));
    if (pagos.length === 0) return;
    const ronda = vista.ronda;
    const mio = pagos.find((p) => p.jugadorId === vista.yo);
    const pasado = vista.manos.find((m) => m.jugadorId === vista.yo)?.estado === "pasado";
    // Cuando termina de verse el guion en curso, que ya incluye las cartas de este lote si las trae.
    const espera = restante(reloj) + PAUSA_PREMIO_MS;
    despues(espera, () => {
      setResultados({ ronda, netos: new Map(pagos.map((p) => [p.jugadorId, p.neto])) });
      if (mio === undefined) return;
      if (mio.neto < 0 && pasado) vibrar(200);
      celebrar(mio.neto);
    });
    // Solo al llegar un lote nuevo: la vista y el resto son los de ese momento.
  }, [lote]);

  // Tras una acción tuya, los botones esperan a que cambie TU mano (cartas, estado o apuesta, en esta ronda).
  const firmaMano = vista === null ? null : `${vista.ronda}:${miMano === undefined ? "-" : `${miMano.cartas.length}:${miMano.estado}:${miMano.apuesta}`}`;
  const { esperando, marcarEnviado } = useEnvioUnico(firmaMano, error, conectado);
  const actuar = (accion: AccionBJ) => {
    enviar(accion);
    marcarEnviado();
  };

  const apuestaEnJuego = miMano !== undefined && vista?.fase !== "resultado";
  const salida = useSalirDeMesa({ codigo, enviar, apuestaEnJuego });

  const ahora = useAhoraServidor(vista !== null && vista.finFase !== null && vista.fase !== "banca");

  const sinMesa = useSinMesa(vista !== null);
  const sentado = useSentado(vista?.sentados);

  if (error === "mesa_llena") return <MesaLlena codigo={codigo} juego="blackjack" jugadores={BJ.MAX_JUGADORES} />;

  const ronda = vista?.ronda ?? 0;
  const yoApodo = jugador?.apodo.toLowerCase();
  const netos = resultados !== null && resultados.ronda === ronda ? resultados.netos : null;
  const miNeto =
    resultados !== null && yo !== null && (resultados.ronda === ronda || (resultados.ronda === ronda - 1 && miMano === undefined && (vista?.fase === "apuestas" || vista?.fase === "esperando")))
      ? resultados.netos.get(yo)
      : undefined;

  const totalBanca = vista === null ? null : totalVisible(vista.banca, (i) => aterrizada(reloj, claveCarta(ronda, "banca", i)) && (i !== 1 || girada(reloj)));
  const totalDe = (mano: ManoVista) => totalVisible(mano.cartas, (i) => aterrizada(reloj, claveCarta(ronda, mano.jugadorId, i)));
  const miTotal = miMano ? totalDe(miMano) : null;
  const miManoEnLaMesa = miMano === undefined || miMano.cartas.every((_, i) => aterrizada(reloj, claveCarta(ronda, miMano.jugadorId, i)));

  // El resto de la mesa: los sentados por orden de llegada y quien se fue con una mano en juego.
  const otros: Otro[] = [];
  for (const apodo of vista?.sentados ?? []) {
    if (apodo.toLowerCase() !== yoApodo) otros.push({ apodo, mano: vista?.manos.find((m) => m.apodo === apodo) });
  }
  for (const mano of vista?.manos ?? []) {
    if (mano.jugadorId !== yo && !otros.some((o) => o.mano === mano)) otros.push({ apodo: mano.apodo, mano });
  }

  const fase = vista?.fase;
  const conCuenta = vista !== null && vista.finFase !== null && (fase === "apuestas" || fase === "decisiones" || fase === "resultado");
  const cuenta = conCuenta ? cuentaAtras(vista.finFase! - ahora) : null;
  const conTemporizador = fase === "apuestas" || fase === "decisiones";

  let controles: ReactNode = null;
  if (vista !== null && miMano === undefined && (fase === "apuestas" || fase === "esperando")) {
    controles = (
      <Apostar
        fichas={fichas}
        activo={conectado && sentado}
        esperando={esperando}
        onApostar={(cantidad) => {
          sonidos.reproducir("fichas");
          actuar({ t: "apostar", cantidad });
        }}
      />
    );
  } else if (miMano !== undefined && fase === "decisiones") {
    controles = <Decidir mano={miMano} fichas={fichas} activo={conectado && !esperando} onActuar={actuar} />;
  }

  const miEtiqueta = (
    <div className="bj-etiqueta">
      <span>Tú</span>
      <Total valor={miTotal} tono={tonoDe(miMano, miTotal, miNeto)} />
      {miNeto !== undefined && <Resultado key={`${resultados?.ronda}`} neto={miNeto} />}
      {miMano !== undefined && <Apuesta cantidad={miMano.apuesta} refPila={refApuesta} />}
    </div>
  );
  const miSitio = (
    <>
      {miEtiqueta}
      <Mano cartas={miMano?.cartas ?? []} de={yo ?? 0} ronda={ronda} ancho={medidas.yo} reloj={reloj} etiqueta="Tu mano" />
    </>
  );

  return (
    <main className={`marco-mesa bj${medidas.ordenador ? " bj--ordenador" : ""}${premio !== null ? " bj--premio" : ""}`}>
      <Reconectando conectado={conectado || vista === null} />
      <BarraMesa titulo="Blackjack" onVolver={salida.alVolver} refFichas={refFichas} />

      <div className="bj-mesa aparece">
        <section className="bj-banca" aria-label="Banca">
          <div className="bj-banca__juego">
            <Mano cartas={vista?.banca ?? []} de="banca" ronda={ronda} ancho={medidas.banca} reloj={reloj} etiqueta="Banca" />
            <div className="bj-etiqueta">
              <span>Banca</span>
              <Total valor={totalBanca} tono={totalBanca !== null && totalBanca > 21 ? "pasado" : "normal"} />
            </div>
          </div>
          <div className="bj-banca__mazo">
            <Mazo ref={mazo} ancho={medidas.mazo} barajando={barajando && !reducido} />
            <AnimatePresence>
              {barajando && (
                <motion.p className="bj-barajando" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  Barajando
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </section>

        {medidas.ordenador ? (
          <>
          <Leyenda />
          <ol className="bj-asientos" aria-label="Asientos">
            {asientosEnArco(otros).map(({ otro, hueco }) => {
              const total = otro.mano ? totalDe(otro.mano) : null;
              const neto = otro.mano && netos ? netos.get(otro.mano.jugadorId) : undefined;
              return (
                <li key={otro.apodo} className={`bj-asiento${otro.mano ? "" : " bj-asiento--mira"}`} style={estiloHueco(hueco)}>
                  <Mano cartas={otro.mano?.cartas ?? []} de={otro.mano?.jugadorId ?? -1} ronda={ronda} ancho={medidas.otros} reloj={reloj} etiqueta={`Mano de ${otro.apodo}`} />
                  <div className="bj-etiqueta">
                    <span className="bj-asiento__apodo">{otro.apodo}</span>
                    <Total valor={total} tono={tonoDe(otro.mano, total, neto)} />
                    {neto !== undefined && <Neto neto={neto} />}
                    {otro.mano && <Apuesta cantidad={otro.mano.apuesta} />}
                  </div>
                </li>
              );
            })}
            <li className="bj-asiento bj-asiento--yo" style={estiloHueco(0)}>
              {miSitio}
            </li>
          </ol>
          </>
        ) : (
          <>
            {otros.length > 0 && (
              <ul className="bj-otros" aria-label="Otros jugadores">
                {otros.map(({ apodo, mano }) => {
                  const total = mano ? totalDe(mano) : null;
                  const neto = mano && netos ? netos.get(mano.jugadorId) : undefined;
                  return (
                    <li key={apodo} className={`bj-pastilla${mano ? "" : " bj-pastilla--mira"}${total !== null && total > 21 ? " bj-pastilla--pasado" : ""}`}>
                      <span className="bj-pastilla__apodo">{apodo}</span>
                      {mano && mano.cartas.length === 0 && (
                        <span className="bj-pastilla__apuesta">
                          <Ficha tamaño={12} />
                          <span className="solo-lectores">apuesta </span>
                          {miles(mano.apuesta)}
                        </span>
                      )}
                      {mano && total !== null && <b className="bj-pastilla__total">{total}</b>}
                      {mano && <SimboloMano mano={mano} total={total} />}
                      {neto !== undefined && <Neto neto={neto} />}
                    </li>
                  );
                })}
              </ul>
            )}
            <Leyenda />
            <section className="bj-yo" aria-label="Tu sitio">
              {miSitio}
            </section>
          </>
        )}
      </div>

      <section className="bj-panel" aria-label="Tu jugada">
        {sinMesa && <SinMesa codigo={codigo} />}
        <EstadoMesa
          texto={textoEstado(vista, miMano, miManoEnLaMesa)}
          cuenta={cuenta}
          finFase={conTemporizador ? (vista?.finFase ?? null) : null}
          duracionMs={fase === "decisiones" ? BJ.DECISIONES_MS : BJ.APUESTAS_MS}
        />
        {controles}
      </section>

      <CartelPremio premio={premio} />
      <FichasVolando disparo={premio?.id ?? 0} desde={refApuesta} hasta={refFichas} />
      <AvisoMesa error={error} />

      {salida.dialogo}
    </main>
  );
}

/** Huecos alrededor de la banca para el resto: alternando a tu izquierda y a tu derecha, tú siempre en el centro. */
function asientosEnArco(otros: Otro[]): { otro: Otro; hueco: number }[] {
  return otros.map((otro, i) => ({ otro, hueco: (i % 2 === 0 ? -1 : 1) * (Math.floor(i / 2) + 1) }));
}

/** Coloca un asiento en el arco: cada hueco se aparta 23° del centro sobre una elipse bajo la banca. */
function estiloHueco(hueco: number): CSSProperties {
  const angulo = (hueco * 23 * Math.PI) / 180;
  return { "--x": `${(50 + 41 * Math.sin(angulo)).toFixed(2)}%`, "--y": `${(88 * Math.cos(angulo)).toFixed(2)}%` } as CSSProperties;
}
