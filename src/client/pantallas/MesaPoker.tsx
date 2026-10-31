import { useEffect, useRef } from "react";
import { type AccionPoker, POKER, type VistaPoker } from "../../shared/juegos/poker";
import { AvisoMesa } from "../componentes/AvisoMesa";
import { BarraMesa } from "../componentes/BarraMesa";
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
import { Mirando, textoEstado } from "./poker/controles";
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

  // Tras pedir sentarte, el botón espera a que la mesa te siente (o conteste con un error).
  const firma = vista === null ? null : sentado ? "sentado" : "mirando";
  const { esperando, marcarEnviado } = useEnvioUnico(firma, error, conectado);

  const sinMesa = useSinMesa(vista !== null);
  const fase = vista?.fase;
  const conCuenta = vista !== null && vista.finFase !== null && (fase === "mano" || fase === "resultado");
  const ahora = useAhoraServidor(conCuenta);
  const cuenta = conCuenta ? cuentaAtras(vista.finFase! - ahora) : null;

  // Salir en plena mano te retira y deja en el bote lo que llevas puesto.
  const enLaMano = fase === "mano" && (mio?.estado === "juega" || mio?.estado === "allin");
  const salida = useSalirDeMesa({ codigo, enviar, apuestaEnJuego: enLaMano, perdidas: "lo que llevas puesto en esta mano" });

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
      <GirarMovil />
    </main>
  );
}
