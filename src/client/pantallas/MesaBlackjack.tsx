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
import { FichasVolando } from "../componentes/FichasVolando";
import { Mazo } from "../componentes/Mazo";
import { usePrecargarBaraja } from "../componentes/Naipe";
import { Reconectando } from "../componentes/Reconectando";
import { Resultado } from "../componentes/Resultado";
import { SinMesa, useSinMesa } from "../componentes/SinMesa";
import { useMovimientoReducido } from "../efectos/movimiento";
import { useBarajando } from "../efectos/useBarajando";
import { useDespues } from "../efectos/useDespues";
import { usePremio } from "../efectos/usePremio";
import { vibrar } from "../efectos/vibrar";
import { sonidos } from "../efectos/sonidos";
import { ORDENADOR_PX, useAltoVentana, useAnchoVentana } from "../efectos/ventana";
import { usePrecargarTipografia } from "../efectos/usePrecargarTipografia";
import { cuentaAtras } from "../formato";
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
import { AsientoOtro, MisManos, PastillaOtro } from "./blackjack/asientos";
import { activaDe, agruparOtros, ARCO, disponerEnElArco, type ManoVista, type Otro } from "./blackjack/manos";
import { Apuesta, Leyenda, Mano, Rendida, Total, tonoDe } from "./blackjack/piezas";
import { useDeslizarAlDividir } from "./blackjack/useDeslizar";
import { useEspacioDelArco } from "./blackjack/useEspacio";
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
  /** El ancho como mucho en el que se ponen tus manos en fila (en el ordenador, el hueco entre tus vecinos lo mide `useEspacioDelArco`). */
  disponible: number;
}

/** Entre una mano tuya y la siguiente. */
const HUECO_MANOS = 8;

/** El ancho de las cartas según la pantalla: en móvil se ajusta al ancho (y a lo bajo que sea), en ordenador a lo alto. */
function useMedidas(): Medidas {
  const ancho = useAnchoVentana();
  const alto = useAltoVentana();
  if (ancho >= ORDENADOR_PX) {
    const k = Math.min(1.15, Math.max(0.75, alto / 820));
    const tapete = Math.min(ancho - 120, 1180);
    return {
      ordenador: true,
      banca: Math.round(78 * k),
      yo: Math.round(96 * k),
      otros: Math.round(62 * k),
      mazo: Math.round(56 * k),
      disponible: Math.min(tapete, 640),
    };
  }
  const yo = Math.round(Math.min(Math.max(ancho * 0.25, 66), 112, alto * 0.14));
  const banca = Math.round(Math.min(Math.max(ancho * 0.185, 50), 84, alto * 0.105));
  // El marco de la mesa deja 18 px a cada lado.
  return { ordenador: false, banca, yo, otros: 0, mazo: Math.round(banca * 0.72), disponible: ancho - 36 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Pantalla
// ---------------------------------------------------------------------------------------------------------------------

interface Resultados {
  ronda: number;
  netos: Map<JugadorId, number>;
}

/** La mesa de blackjack de la partida `codigo`, como en el boceto aprobado. */
export function MesaBlackjack({ codigo }: { codigo: string }) {
  const { jugador, refrescarFichas } = useSesion();
  const { vista, lote, enviar, error, errorDe, conectado } = useMesa<VistaBJ, AccionBJ>("mesa-blackjack", codigo);
  const medidas = useMedidas();
  const reducido = useMovimientoReducido();

  const mazo = useRef<HTMLDivElement>(null);
  const tapete = useRef<HTMLDivElement>(null);
  const refFichas = useRef<HTMLParagraphElement>(null);
  const refApuesta = useRef<HTMLSpanElement>(null);
  // Tus casillas del tapete (la primera y la segunda), adonde vuelan las fichas.
  const refCasillas = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)] as const;
  const reloj = useGuion(lote, vista, mazo);
  // Al dividir, la segunda carta se desliza a la mano nueva (ver `useDeslizarAlDividir`).
  useDeslizarAlDividir(lote, tapete);
  // Cuánto hueco hay entre tus vecinos y cuánto mide el tapete (en el ordenador): de ello depende dónde y cómo caben tus manos.
  const espacio = useEspacioDelArco(tapete, medidas.ordenador);
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
  // Todas tus manos, por orden; mientras se apuesta, la primera y la segunda casilla por orden de apuesta.
  const misManos = (vista?.manos ?? []).filter((m) => m.jugadorId === yo).sort((a, b) => a.indice - b.indice);
  const miMano = misManos[0];
  // La mano que juegas ahora (la primera que sigue en juego) solo existe mientras se decide.
  const lugarActiva = vista?.fase === "decisiones" ? activaDe(misManos) : -1;
  const activa = lugarActiva >= 0 ? misManos[lugarActiva] : undefined;
  const variasManos = misManos.length > 1;
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

  const totalBanca = vista === null ? null : totalVisible(vista.banca, (i) => aterrizada(reloj, claveCarta(ronda, "banca", 0, i)) && (i !== 1 || girada(reloj)));
  const totalDe = (mano: ManoVista) => totalVisible(mano.cartas, (i) => aterrizada(reloj, claveCarta(ronda, mano.jugadorId, mano.indice, i)));
  const miTotal = miMano ? totalDe(miMano) : null;
  const manoEnLaMesa = (mano: ManoVista) => mano.cartas.every((_, i) => aterrizada(reloj, claveCarta(ronda, mano.jugadorId, mano.indice, i)));
  const miManoEnLaMesa = misManos.every(manoEnLaMesa);

  // El resto de la mesa: los sentados por orden de llegada y quien se fue con una mano en juego, cada uno con todas sus manos.
  const otros = vista === null ? [] : agruparOtros(vista, yoApodo);
  const cartasPorMano = misManos.length === 0 ? [0] : misManos.map((m) => m.cartas.length);
  // En el ordenador, tus manos van en fila en tu sitio si caben entre tus vecinos y, si no, acopladas bajo ellos (ver `disponerEnElArco`).
  const disposicion = disponerEnElArco(cartasPorMano, medidas.yo, espacio, medidas.disponible, HUECO_MANOS);

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
  } else if (vista !== null && miMano !== undefined && fase === "decisiones") {
    controles = <Decidir mano={activa} opciones={vista.opciones} fichas={fichas} activo={conectado && !esperando} onActuar={actuar} />;
  }

  // Con varias manos, cada una lleva su total y su apuesta debajo (con la que se cubre el mismo hueco que con una sola); la línea de tu
  // nombre dice cuál juegas.
  const miEtiqueta = (
    <div className="bj-etiqueta">
      <span>Tú</span>
      {variasManos ? (
        lugarActiva >= 0 && <span className="bj-etiqueta__mano">{`Mano ${lugarActiva + 1} de ${misManos.length}`}</span>
      ) : (
        <>
          <Total valor={miTotal} tono={tonoDe(miMano, miTotal, miNeto)} />
          {miMano?.estado === "rendido" && <Rendida />}
        </>
      )}
      {miNeto !== undefined && <Resultado key={`${resultados?.ronda}`} neto={miNeto} />}
      {!variasManos && miApuesta !== null && <Apuesta cantidad={miApuesta} refPila={refApuesta} />}
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
        <MisManos
          manos={misManos}
          jugadorId={yo ?? 0}
          ronda={ronda}
          reloj={reloj}
          disposicion={disposicion}
          activa={lugarActiva}
          totalDe={totalDe}
          refApuesta={refApuesta}
        />
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

      <div className="bj-mesa aparece" ref={tapete}>
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
            {asientosEnArco(otros).map(({ otro, hueco }) => (
              <AsientoOtro key={otro.apodo} otro={otro} estilo={estiloHueco(hueco)} ronda={ronda} reloj={reloj} ancho={medidas.otros} totalDe={totalDe} netos={netos} />
            ))}
            <li
              className={`bj-asiento bj-asiento--yo${disposicion.modo === "acoplada" ? " bj-asiento--yo-acoplado" : ""}`}
              style={{ ...estiloHueco(0), "--sube": `${disposicion.sube}px` } as CSSProperties}
            >
              {miSitio}
            </li>
          </ol>
          </>
        ) : (
          <>
            {otros.length > 0 && (
              <ul className="bj-otros" aria-label="Otros jugadores">
                {otros.map((otro) => (
                  <PastillaOtro key={otro.apodo} otro={otro} totalDe={totalDe} netos={netos} />
                ))}
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
          texto={textoEstado(vista, activa ?? misManos.at(-1), miManoEnLaMesa, misManos.length)}
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

/** Coloca un asiento en el arco: cada hueco se aparta `ARCO.paso` grados del centro sobre una elipse bajo la banca. */
function estiloHueco(hueco: number): CSSProperties {
  const angulo = (hueco * ARCO.paso * Math.PI) / 180;
  return { "--x": `${(50 + ARCO.radioX * Math.sin(angulo)).toFixed(2)}%`, "--y": `${(ARCO.radioY * Math.cos(angulo)).toFixed(2)}%` } as CSSProperties;
}
