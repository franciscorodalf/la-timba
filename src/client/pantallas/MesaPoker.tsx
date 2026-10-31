import { useEffect, useRef, useState } from "react";
import { type AccionPoker, POKER, type VistaPoker } from "../../shared/juegos/poker";
import { AvisoMesa } from "../componentes/AvisoMesa";
import { BarraMesa } from "../componentes/BarraMesa";
import { Boton } from "../componentes/Boton";
import { Confirmar } from "../componentes/Confirmar";
import { EstadoMesa } from "../componentes/EstadoMesa";
import { GirarMovil } from "../componentes/GirarMovil";
import { usePrecargarBaraja } from "../componentes/Naipe";
import { Reconectando } from "../componentes/Reconectando";
import { SinMesa, useSinMesa } from "../componentes/SinMesa";
import { sonidos } from "../efectos/sonidos";
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
import { MisCartas } from "./poker/MisCartas";
import { Tapete } from "./poker/Tapete";

/** La mesa de póker de la partida `codigo`: tapete ovalado, vertical en móvil y horizontal en ordenador. */
export function MesaPoker({ codigo }: { codigo: string }) {
  const { jugador, refrescarFichas } = useSesion();
  const { vista, enviar, error, errorDe, conectado } = useMesa<VistaPoker, AccionPoker>("mesa-poker", codigo);
  const ordenador = useAnchoVentana() >= ORDENADOR_PX;

  usePrecargarBaraja();
  usePrecargarTipografia();

  // Las fichas se vuelven a leer al (re)conectar y al empezar cada mano.
  useFichasAlDia(conectado, vista?.ronda);

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
  const tuTurno = vista !== null && vista.turno !== null && vista.turno === vista.yo;

  const levantarmeYa = () => {
    enviar({ t: "levantarse" });
    levantarse.marcarEnviado();
  };

  return (
    <main className={`marco-mesa pk${ordenador ? " pk--ordenador" : ""}`}>
      <Reconectando conectado={conectado || vista === null} />
      <BarraMesa titulo="Póker" onVolver={salida.alVolver} />

      <div className="pk-mesa aparece">{vista !== null ? <Tapete vista={vista} ordenador={ordenador} /> : <div className="pk-tapete" aria-hidden="true" />}</div>

      <section className="pk-panel" aria-label="Tu jugada">
        {sinMesa && <SinMesa codigo={codigo} />}
        <EstadoMesa
          texto={textoEstado(vista)}
          cuenta={cuenta}
          finFase={conCuenta ? vista.finFase : null}
          duracionMs={fase === "resultado" ? POKER.RESULTADO_MS : POKER.TURNO_MS}
        />
        {vista !== null && mio !== undefined && (
          <>
            <MisCartas cartas={vista.misCartas} mesa={vista.mesa} pila={mio.fichas} porEntrar={vista.porEntrar} />
            <Decidir
              opciones={vista.opciones}
              tuTurno={tuTurno}
              activo={conectado && !decidir.esperando}
              onActuar={(accion) => {
                enviar(accion);
                decidir.marcarEnviado();
              }}
            />
            {anadiendo ? (
              <AnadirFichas
                fichas={fichas}
                activo={conectado && !anadir.esperando}
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

      <AvisoMesa error={error} accion={errorDe} />

      {salida.dialogo}
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
