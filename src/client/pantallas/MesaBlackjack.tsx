import { AnimatePresence, motion } from "motion/react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { type AccionBJ, BJ, type VistaBJ } from "../../shared/juegos/blackjack";
import type { JugadorId } from "../../shared/juegos/tipos";
import { AvisoMesa } from "../componentes/AvisoMesa";
import { BarraMesa } from "../componentes/BarraMesa";
import { Boton } from "../componentes/Boton";
import { CartelPremio } from "../componentes/CartelPremio";
import { CasillaApuesta } from "../componentes/CasillaApuesta";
import { EstadoMesa } from "../componentes/EstadoMesa";
import { GirarMovil } from "../componentes/GirarMovil";
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
import { usePrecargarTipografia } from "../efectos/usePrecargarTipografia";
import { cuentaAtras, miles } from "../formato";
import { useAhoraServidor } from "../red/reloj";
import { useSesion } from "../red/sesion";
import { useEnvioUnico } from "../red/useEnvioUnico";
import { useFichasAlDia } from "../red/useFichasAlDia";
import { useMesa } from "../red/useMesa";
import { useSalirDeMesa } from "../red/useSalirDeMesa";
import { useSentado } from "../red/useSentado";
import { MesaLlena } from "./MesaLlena";
import { Apostar, apuestaRecordada, Decidir, ElegirCasilla, textoEstado } from "./blackjack/controles";
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
  const { jugador, refrescarFichas } = useSesion();
  const { vista, lote, enviar, error, errorDe, conectado } = useMesa<VistaBJ, AccionBJ>("mesa-blackjack", codigo);
  const medidas = useMedidas();
  const reducido = useMovimientoReducido();

  const mazo = useRef<HTMLDivElement>(null);
  const refFichas = useRef<HTMLParagraphElement>(null);
  const refApuesta = useRef<HTMLSpanElement>(null);
  // Tus casillas del tapete (la primera y la segunda), adonde vuelan las fichas.
  const refCasillas = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)] as const;
  const reloj = useGuion(lote, vista, mazo);
  // Lo que llevas preparado para apostar: se ve a la vez en tus casillas del tapete y en el botón. La primera se recuerda de una
  // ronda a otra; la segunda (`null`: no la has pedido) se olvida. `elegida` es la casilla a la que van las fichas.
  const [montante, setMontante] = useState(apuestaRecordada);
  const [montanteSegunda, setMontanteSegunda] = useState<number | null>(null);
  const [elegida, setElegida] = useState<0 | 1>(0);
  // La segunda apuesta sale cuando la mesa confirma la primera (`enviada`: ya se ha mandado).
  const [envioSegunda, setEnvioSegunda] = useState<{ cantidad: number; enviada: boolean } | null>(null);

  const [resultados, setResultados] = useState<Resultados | null>(null);
  const { premio, celebrar } = usePremio();
  const barajando = useBarajando(lote);

  // Temporizadores que no deben cortarse al llegar otro mensaje (el premio de esta ronda).
  const despues = useDespues();

  usePrecargarBaraja();
  usePrecargarTipografia();

  // Las fichas se vuelven a leer al (re)conectar y al empezar cada ronda, aunque el pago no traiga evento.
  useFichasAlDia(conectado, vista?.ronda);

  const yo = vista?.yo ?? null;
  const miMano = vista?.manos.find((m) => m.jugadorId === yo);
  // Todas tus manos; mientras se apuesta, la primera y la segunda casilla por orden de apuesta.
  const misManos = (vista?.manos ?? []).filter((m) => m.jugadorId === yo).sort((a, b) => a.indice - b.indice);
  const fichas = jugador?.fichas ?? 0;
  // Lo preparado en cada casilla sin pasarse de tus fichas; la primera deja de reservarlas cuando ya está apostada.
  const primeraPreparada = montante <= fichas ? montante : 0;
  const segundaPreparada = montanteSegunda === null ? null : montanteSegunda <= fichas - (miMano === undefined ? primeraPreparada : 0) ? montanteSegunda : 0;

  // Tu apuesta ya está en la mesa (o la has doblado): el contador baja contando. Una vez por apuesta confirmada, de cada mano.
  const miApuesta = misManos.length === 0 ? null : misManos.reduce((suma, m) => suma + m.apuesta, 0);
  const apuestaVista = useRef<number | null>(null);
  useEffect(() => {
    const antes = apuestaVista.current;
    apuestaVista.current = miApuesta;
    if (miApuesta !== null && miApuesta !== antes) void refrescarFichas();
  }, [miApuesta, refrescarFichas]);

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
  const firmaMano =
    vista === null ? null : `${vista.ronda}:${misManos.length === 0 ? "-" : misManos.map((m) => `${m.casilla}.${m.indice}:${m.cartas.length}:${m.estado}:${m.apuesta}`).join("|")}`;
  const { esperando, marcarEnviado } = useEnvioUnico(firmaMano, error, conectado);
  const actuar = (accion: AccionBJ) => {
    enviar(accion);
    marcarEnviado();
  };

  // Sin mano tuya (empieza otra ronda) se olvida la segunda casilla; lo que preparas para la primera sí se recuerda.
  const sinMano = miMano === undefined;
  useEffect(() => {
    if (!sinMano) return;
    setMontanteSegunda(null);
    setElegida(0);
    setEnvioSegunda(null);
  }, [sinMano]);

  // Con la primera ya apostada y nada por mandar, una segunda preparada que no llegó a salir (falló la primera y se apostó por otro lado)
  // ya no se puede apostar: se quita.
  useEffect(() => {
    if (sinMano || envioSegunda !== null || montanteSegunda === null || misManos.length > 1) return;
    setMontanteSegunda(null);
    setElegida(0);
  }, [sinMano, envioSegunda, montanteSegunda, misManos.length]);

  // La segunda apuesta sale, una sola vez, en cuanto llega la vista con tu primera mano: la mesa ya la ha cobrado. Si ya se han
  // visto las dos manos o la ventana ya se cerró, no queda nada que mandar.
  const enApuestas = vista?.fase === "apuestas" || vista?.fase === "esperando";
  useEffect(() => {
    if (envioSegunda === null) return;
    if (misManos.length > 1 || !enApuestas) {
      setEnvioSegunda(null);
      return;
    }
    if (envioSegunda.enviada || miMano === undefined || !conectado) return;
    setEnvioSegunda({ ...envioSegunda, enviada: true });
    actuar({ t: "apostar", cantidad: envioSegunda.cantidad, segunda: true });
    // `actuar` y `misManos` son los de este render; lo que dispara el envío es la mesa (tu mano), la conexión o el propio envío.
  }, [envioSegunda, miMano, conectado, enApuestas]);

  // Un error de la mesa cancela lo que esperaba salir; si respondía a la segunda apuesta (ya mandada), esa casilla no existe.
  useEffect(() => {
    if (error === null) return;
    if (envioSegunda?.enviada) {
      setMontanteSegunda(null);
      setElegida(0);
    }
    setEnvioSegunda(null);
    // Solo cuando llega un error nuevo.
  }, [error]);

  // Al cerrarse las decisiones la ronda ya está decidida: durante la banca (y el resultado) salir no cambia lo que cobras.
  const apuestaEnJuego = miMano !== undefined && vista?.fase !== "banca" && vista?.fase !== "resultado";
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

  // Preparando la apuesta: tu casilla del tapete es tu sitio y, con la segunda, hay dos entre las que elegir.
  const apostando = vista !== null && miMano === undefined && (fase === "apuestas" || fase === "esperando");
  const hayDos = segundaPreparada !== null || misManos.length > 1;
  const casillaElegida = hayDos ? elegida : 0;
  // La segunda casilla necesita una casilla libre más que la primera: con ninguna mano tuya aún, la primera se llevará una de las libres.
  const puedeSegunda = apostando && !hayDos && (vista.casillasLibres - (misManos.length === 0 ? 1 : 0)) > 0;

  let controles: ReactNode = null;
  if (apostando) {
    controles = (
      <Apostar
        preparado={[primeraPreparada, segundaPreparada]}
        elegida={casillaElegida}
        fichas={fichas}
        activo={conectado && sentado}
        esperando={esperando}
        onCambiar={casillaElegida === 0 ? setMontante : setMontanteSegunda}
        onQuitarSegunda={() => {
          setMontanteSegunda(null);
          setElegida(0);
        }}
        destino={refCasillas[casillaElegida]}
        onApostar={(primera, segunda) => {
          sonidos.reproducir("fichas");
          // La segunda sale sola cuando la mesa confirma la primera (su efecto, arriba).
          setEnvioSegunda(segunda === null ? null : { cantidad: segunda, enviada: false });
          actuar({ t: "apostar", cantidad: primera });
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
      {miApuesta !== null && <Apuesta cantidad={miApuesta} refPila={refApuesta} />}
      {puedeSegunda && (
        <Boton
          variante="secundario"
          className="bj-segunda"
          onClick={() => {
            setMontanteSegunda(0);
            setElegida(1);
          }}
        >
          + Segunda mano
        </Boton>
      )}
    </div>
  );
  // Mientras se apuesta, tu casilla ocupa en el tapete el sitio de tu mano: lo que preparas se apila ahí, en grande.
  const conCasilla = vista !== null && (fase === "apuestas" || fase === "esperando");
  const casillas = hayDos ? ([0, 1] as const) : ([0] as const);
  // Lo apostado (ya cobrado) y lo preparado de cada casilla: la primera apuesta es la de la primera casilla, aunque la segunda tenga un número menor.
  const apostadoEn = [misManos[0]?.apuesta ?? 0, misManos[1]?.apuesta ?? 0] as const;
  const preparadoEn = [misManos[0] === undefined ? primeraPreparada : 0, misManos[1] === undefined ? (segundaPreparada ?? 0) : 0] as const;
  const todoPreparado = preparadoEn[0] + preparadoEn[1] === fichas;
  const miSitio = (
    <>
      {miEtiqueta}
      <div className="bj-yo__juego" style={{ "--sitio": `${Math.round(medidas.yo * 1.4)}px` } as CSSProperties}>
        <Mano cartas={miMano?.cartas ?? []} de={yo ?? 0} ronda={ronda} ancho={medidas.yo} reloj={reloj} etiqueta="Tu mano" />
        <AnimatePresence>
          {conCasilla && (
            <motion.div
              key="casilla"
              className={`bj-casilla${hayDos ? " bj-casilla--doble" : ""}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reducido ? { opacity: 0 } : { opacity: 0, transform: "scale(0.9)" }}
              transition={{ duration: 0.22 }}
            >
              {casillas.map((i) => (
                <div key={i} className={`bj-casilla__sitio${apostando && hayDos ? (casillaElegida === i ? " bj-casilla__sitio--elegida" : " bj-casilla__sitio--otra") : ""}`}>
                  <CasillaApuesta
                    ref={refCasillas[i]}
                    apostado={apostadoEn[i]}
                    preparado={preparadoEn[i]}
                    todo={todoPreparado && preparadoEn[i] > 0 && (casillaElegida === i || preparadoEn[1 - i] === 0)}
                  />
                  {apostando && hayDos && <ElegirCasilla cual={i === 0 ? "primera" : "segunda"} elegida={casillaElegida === i} onElegir={() => setElegida(i)} />}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );

  return (
    <main className={`marco-mesa bj${medidas.ordenador ? " bj--ordenador" : ""}${premio !== null ? " bj--premio" : ""}${conCasilla && hayDos ? " bj--dos-casillas" : ""}`}>
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
      <AvisoMesa error={error} accion={errorDe} />

      {salida.dialogo}
      <GirarMovil />
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
