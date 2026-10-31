import { useEffect, useRef, useState } from "react";
import { type AccionPoker, POKER, type VistaPoker } from "../../shared/juegos/poker";
import { mejorJugada } from "../../shared/juegos/poker-jugadas";
import { AvisoMesa } from "../componentes/AvisoMesa";
import { BarraMesa } from "../componentes/BarraMesa";
import { Boton } from "../componentes/Boton";
import { CartelPremio } from "../componentes/CartelPremio";
import { Confirmar } from "../componentes/Confirmar";
import { EstadoMesa } from "../componentes/EstadoMesa";
import { FichasVolando } from "../componentes/FichasVolando";
import { GirarMovil } from "../componentes/GirarMovil";
import { usePrecargarBaraja } from "../componentes/Naipe";
import { Reconectando } from "../componentes/Reconectando";
import { SinMesa, useSinMesa } from "../componentes/SinMesa";
import { sonidos } from "../efectos/sonidos";
import { usePremio } from "../efectos/usePremio";
import { ORDENADOR_PX, useAnchoVentana } from "../efectos/ventana";
import { usePrecargarTipografia } from "../efectos/usePrecargarTipografia";
import { cuentaAtras } from "../formato";
import { useAhoraServidor } from "../red/reloj";
import { useSesion } from "../red/sesion";
import { useEnvioUnico } from "../red/useEnvioUnico";
import { useFichasAlDia } from "../red/useFichasAlDia";
import { useMesa } from "../red/useMesa";
import { useSalirDeMesa } from "../red/useSalirDeMesa";
import { AnadirFichas, Decidir, Mirando, textoEstado } from "./poker/controles";
import { MisCartas, useTapadas } from "./poker/MisCartas";
import { TablaJugadas } from "./poker/TablaJugadas";
import { Tapete } from "./poker/Tapete";
import { cartasRepartidas, useGuion, vistaMostrada } from "./poker/useGuion";

/** La mesa de póker de la partida `codigo`: tapete ovalado, vertical en móvil y horizontal en ordenador. */
export function MesaPoker({ codigo }: { codigo: string }) {
  const { jugador, refrescarFichas } = useSesion();
  const { vista, lote, enviar, error, errorDe, conectado } = useMesa<VistaPoker, AccionPoker>("mesa-poker", codigo);
  const ordenador = useAnchoVentana() >= ORDENADOR_PX;

  // El mazo, de donde salen las cartas; el bote y tu pila, entre los que vuelan las fichas que ganas.
  const mazo = useRef<HTMLDivElement>(null);
  const refBote = useRef<HTMLParagraphElement>(null);
  const refPila = useRef<HTMLParagraphElement>(null);
  const { premio, celebrar } = usePremio();
  const reloj = useGuion(lote, vista, mazo, conectado, celebrar);
  // Lo que se enseña: la vista ya lo trae todo hecho y aquí se retiene lo que el guion aún no ha enseñado. Sin guion, es la vista.
  const mostrada = vista === null ? null : vistaMostrada(vista, reloj);

  usePrecargarBaraja();
  usePrecargarTipografia();

  // Las fichas se vuelven a leer solo al (re)conectar: el saldo no cambia entre manos, porque lo que juegas está en la mesa y no en tu
  // cuenta. Pasar la ronda pediría `/api/fichas` en cada mano por cada cliente. Los cambios reales (sentarse, levantarse, añadir) los
  // cubren los efectos de `sentado` y `porEntrar`.
  useFichasAlDia(conectado, undefined);

  const fichas = jugador?.fichas ?? 0;
  const mio = vista?.asientos.find((a) => a.jugadorId === vista.yo);
  const sentado = mio !== undefined;

  // Sentarse cobra tus fichas y levantarse (o que te levanten) las devuelve: el contador se pone al día cuando cambia eso.
  const estabaSentado = useRef(sentado);
  useEffect(() => {
    const antes = estabaSentado.current;
    estabaSentado.current = sentado;
    if (antes !== sentado) void refrescarFichas();
  }, [sentado, refrescarFichas]);

  // Lo que añades entra en tu pila al empezar la mano siguiente, pero se cobra del saldo ya: el contador se pone al día.
  const porEntrar = vista?.porEntrar ?? 0;
  const porEntrarAntes = useRef(porEntrar);
  useEffect(() => {
    const antes = porEntrarAntes.current;
    porEntrarAntes.current = porEntrar;
    if (porEntrar > antes) void refrescarFichas();
  }, [porEntrar, refrescarFichas]);

  // Tras pedir sentarte, el botón espera a que la mesa te siente (o conteste con un error).
  const firma = vista === null ? null : sentado ? "sentado" : "mirando";
  const { esperando, marcarEnviado } = useEnvioUnico(firma, error, conectado);
  // Lo mismo con levantarte y con añadir fichas: esperan a que cambie lo tuyo.
  const levantarse = useEnvioUnico(firma, error, conectado);
  const anadir = useEnvioUnico(vista === null || mio === undefined ? null : `${vista.ronda}:${mio.fichas}:${vista.porEntrar}`, error, conectado);
  // Y con decidir: hasta que cambie el turno o lo que llevas puesto, un segundo toque no manda otra acción.
  const decidir = useEnvioUnico(vista === null || mio === undefined ? null : `${vista.ronda}:${vista.fase}:${vista.calle}:${vista.turno}:${mio.estado}:${mio.apostado}:${mio.fichas}:${vista.opciones?.ensenar}`, error, conectado);

  // Las hojas de subir y de añadir fichas se abren en el `main`, para que puedan pegarse abajo de la pantalla.
  const [hoja, setHoja] = useState<HTMLElement | null>(null);
  const [anadiendo, setAnadiendo] = useState(false);
  const [levantando, setLevantando] = useState(false);
  // Levantado (por ti o por la mesa), lo que tenías abierto no sigue: al volver a sentarte no reaparece.
  useEffect(() => {
    if (!sentado) {
      setAnadiendo(false);
      setLevantando(false);
    }
  }, [sentado]);

  const sinMesa = useSinMesa(vista !== null);
  const fase = vista?.fase;
  const conCuenta = vista !== null && vista.finFase !== null && (fase === "mano" || fase === "resultado");
  const ahora = useAhoraServidor(conCuenta);
  const cuenta = conCuenta ? cuentaAtras(vista.finFase! - ahora) : null;

  // Salir en plena mano te retira y deja en el bote lo que llevas puesto.
  const enLaMano = fase === "mano" && (mio?.estado === "juega" || mio?.estado === "allin");
  const salida = useSalirDeMesa({ codigo, enviar, apuestaEnJuego: enLaMano, perdidas: "lo que llevas puesto en esta mano" });
  const tuTurno = mostrada !== null && mostrada.turno !== null && mostrada.turno === mostrada.yo;
  // Tu pila con lo que el guion aún retiene.
  const miPila = mostrada?.asientos.find((a) => a.jugadorId === mostrada.yo)?.fichas ?? 0;

  // Tu jugada y si tienes las cartas tapadas se calculan aquí porque los usan tus cartas y la tabla de jugadas: con Tapar, la tabla
  // no resalta nada. Solo cuentan las cartas que ya se ven: tu jugada no adelanta una carta que aún no ha salido.
  const [tapadas, alternarTapadas] = useTapadas();
  const misCartasVistas = mostrada?.misCartas && mostrada.yo !== null && cartasRepartidas(reloj, mostrada.ronda, mostrada.yo) ? mostrada.misCartas : null;
  const jugada = misCartasVistas !== null && mostrada !== null ? mejorJugada([...misCartasVistas, ...mostrada.mesa]) : null;
  const [tablaAbierta, setTablaAbierta] = useState(false);

  const levantarmeYa = () => {
    enviar({ t: "levantarse" });
    levantarse.marcarEnviado();
  };

  return (
    <main ref={setHoja} className={`marco-mesa pk${ordenador ? " pk--ordenador" : ""}`}>
      <Reconectando conectado={conectado || vista === null} />
      <BarraMesa
        titulo="Póker"
        onVolver={salida.alVolver}
        extra={
          <button type="button" className="barra-mesa__jugadas" aria-haspopup="dialog" onClick={() => setTablaAbierta(true)}>
            Jugadas
          </button>
        }
      />

      <div className="pk-mesa aparece">{mostrada !== null ? <Tapete vista={mostrada} ordenador={ordenador} reloj={reloj} refMazo={mazo} refBote={refBote} /> : <div className="pk-tapete" aria-hidden="true" />}</div>

      <section className="pk-panel" aria-label="Tu jugada">
        {sinMesa && <SinMesa codigo={codigo} />}
        <EstadoMesa
          texto={textoEstado(mostrada)}
          cuenta={cuenta}
          finFase={conCuenta ? vista.finFase : null}
          duracionMs={fase === "resultado" ? POKER.RESULTADO_MS : POKER.TURNO_MS}
        />
        {vista !== null && mio !== undefined && (
          <>
            <MisCartas
              cartas={vista.misCartas}
              jugada={jugada}
              tapadas={tapadas}
              onAlternar={alternarTapadas}
              pila={miPila}
              porEntrar={vista.porEntrar}
              refPila={refPila}
              yo={mio.jugadorId}
              ronda={vista.ronda}
              reloj={reloj}
            />
            <Decidir
              opciones={vista.opciones}
              tuTurno={tuTurno}
              activo={conectado && !decidir.esperando}
              cuenta={tuTurno ? cuenta : null}
              hoja={hoja}
              onActuar={(accion) => {
                enviar(accion);
                decidir.marcarEnviado();
              }}
            />
            {anadiendo ? (
              <AnadirFichas
                fichas={fichas}
                activo={conectado && !anadir.esperando}
                cuenta={tuTurno && fase === "mano" ? cuenta : null}
                hoja={hoja}
                onCancelar={() => setAnadiendo(false)}
                onAnadir={(cantidad) => {
                  enviar({ t: "anadir", fichas: cantidad });
                  anadir.marcarEnviado();
                  setAnadiendo(false);
                }}
              />
            ) : (
              <div className="pk-mas">
                <Boton variante="secundario" disabled={!conectado} onClick={() => setAnadiendo(true)}>
                  Añadir fichas
                </Boton>
                <Boton variante="secundario" disabled={!conectado || levantarse.esperando} onClick={() => (enLaMano ? setLevantando(true) : levantarmeYa())}>
                  Levantarme
                </Boton>
              </div>
            )}
          </>
        )}
        {vista !== null && !sentado && (
          <Mirando
            libres={vista.asientosLibres}
            fichas={fichas}
            activo={conectado && !esperando}
            esperando={esperando}
            onSentarse={(cantidad) => {
              sonidos.reproducir("fichas");
              enviar({ t: "sentarse", fichas: cantidad });
              marcarEnviado();
            }}
          />
        )}
      </section>

      <CartelPremio premio={premio} />
      <FichasVolando disparo={premio?.id ?? 0} desde={refBote} hasta={refPila} />
      <AvisoMesa error={error} accion={errorDe} />

      {salida.dialogo}
      <TablaJugadas abierta={tablaAbierta} jugada={tapadas ? null : jugada} onCerrar={() => setTablaAbierta(false)} aviso={tuTurno && fase === "mano" ? cuenta : null} />
      {levantando && (
        <Confirmar
          titulo="¿Levantarte de la mesa?"
          texto="Si te levantas ahora pierdes lo que llevas puesto en esta mano"
          aceptar="Levantarme"
          cancelar="Seguir jugando"
          onAceptar={() => {
            setLevantando(false);
            levantarmeYa();
          }}
          onCancelar={() => setLevantando(false)}
        />
      )}
      <GirarMovil />
    </main>
  );
}
