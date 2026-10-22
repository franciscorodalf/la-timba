import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { Palo } from "../../shared/cartas";
import { type AccionCarrera, CARRERA, type FaseCarrera, type VistaCarrera } from "../../shared/juegos/carrera";
import { AvisoMesa } from "../componentes/AvisoMesa";
import { BarraMesa } from "../componentes/BarraMesa";
import { CartelPremio } from "../componentes/CartelPremio";
import { EstadoMesa } from "../componentes/EstadoMesa";
import { FichasVolando } from "../componentes/FichasVolando";
import { usePrecargarBaraja } from "../componentes/Naipe";
import { Reconectando } from "../componentes/Reconectando";
import { Resultado } from "../componentes/Resultado";
import { SinMesa, useSinMesa } from "../componentes/SinMesa";
import { sonidos } from "../efectos/sonidos";
import { useBarajando } from "../efectos/useBarajando";
import { usePremio } from "../efectos/usePremio";
import { ORDENADOR_PX, useAnchoVentana } from "../efectos/ventana";
import { cuentaAtras } from "../formato";
import { useAhoraServidor } from "../red/reloj";
import { useSesion } from "../red/sesion";
import { useEnvioUnico } from "../red/useEnvioUnico";
import { useFichasAlDia } from "../red/useFichasAlDia";
import { useMesa } from "../red/useMesa";
import { useSalirDeMesa } from "../red/useSalirDeMesa";
import { useSentado } from "../red/useSentado";
import { PanelApuestas, PanelEnCarrera, PanelGanador, textoEstado } from "./carrera/apuestas";
import { ESCENA_VACIA } from "./carrera/escena";
import { FRANJA_HORIZONTAL, FRANJA_VERTICAL, geometria, variablesDe } from "./carrera/geometria";
import { Cabeceras, Esquina, Franja, Pista } from "./carrera/pista";
import { useEscena } from "./carrera/useEscena";
import { useGeometria } from "./carrera/useGeometria";
import { MesaLlena } from "./MesaLlena";

const SIN_CASILLAS: Record<Palo, number> = { H: 0, D: 0, C: 0, S: 0 };
const SIN_TRAMOS: null[] = Array.from({ length: CARRERA.TRAMOS }, () => null);

/** La mesa de la carrera de caballos de la partida `codigo`: pista vertical en móvil, horizontal en ordenador. */
export function MesaCarrera({ codigo }: { codigo: string }) {
  const { jugador, refrescar } = useSesion();
  const { vista, lote, enviar, error, conectado } = useMesa<VistaCarrera, AccionCarrera>("mesa-carrera", codigo);
  const ordenador = useAnchoVentana() >= ORDENADOR_PX;

  const mazo = useRef<HTMLDivElement>(null);
  const pista = useRef<HTMLDivElement>(null);
  const refFichas = useRef<HTMLParagraphElement>(null);
  const refDesde = useRef<HTMLElement | null>(null);
  const cabeceras = useRef<Partial<Record<Palo, HTMLButtonElement | null>>>({});

  const escena = useEscena(lote, vista, mazo);
  // Antes de la primera vista, la pista vacía.
  const e = escena ?? ESCENA_VACIA;
  const { g, ajustando } = useGeometria(pista, ordenador);

  const [elegido, setElegido] = useState<Palo | null>(null);
  const [montante, setMontante] = useState(0);
  const [resultado, setResultado] = useState<{ ronda: number; neto: number } | null>(null);
  const { premio, celebrar } = usePremio();
  const barajando = useBarajando(lote);

  usePrecargarBaraja();

  // Las fichas se vuelven a leer al (re)conectar y al empezar cada ronda, aunque el pago no traiga evento.
  useFichasAlDia(conectado, vista?.ronda);

  const fase: FaseCarrera | null = vista?.fase ?? null;
  const misApuestas = vista?.misApuestas ?? [];
  const mias = { ...SIN_CASILLAS };
  for (const a of misApuestas) mias[a.caballo] += a.cantidad;
  const fichas = jugador?.fichas ?? 0;

  // Tras apostar, el contador baja contando; y lo preparado para apostar queda hecho.
  const firma = vista === null ? null : `${vista.ronda}:${misApuestas.map((a) => `${a.caballo}${a.cantidad}`).sort().join(",")}`;
  const firmaVista = useRef(firma);
  useEffect(() => {
    const antes = firmaVista.current;
    firmaVista.current = firma;
    if (firma === null || firma === antes) return;
    setMontante(0);
    if (antes !== null) void refrescar();
  }, [firma, refrescar]);

  // Tus pagos, cuando la escena los enseña (tras el ganador): el premio, el resultado y las fichas al día.
  const idPagos = escena?.pagos?.id ?? 0;
  useEffect(() => {
    const pagos = escena?.pagos;
    if (!pagos || !jugador) return;
    const neto = pagos.netos.get(jugador.id);
    if (neto === undefined) return;
    setResultado({ ronda: escena.ronda, neto });
    // Las fichas del premio salen de la cabecera del caballo ganador.
    refDesde.current = (neto > 0 && escena.ganador && cabeceras.current[escena.ganador]) || null;
    celebrar(neto);
  }, [idPagos]);

  // Tras apostar, el botón espera a que cambien TUS apuestas (ronda + apuestas): una novedad de otro jugador no lo reactiva.
  const { esperando, marcarEnviado } = useEnvioUnico(firma, error, conectado);

  const sentado = useSentado(vista?.sentados);
  const apuestaEnJuego = misApuestas.length > 0 && fase !== "resultado";
  const salida = useSalirDeMesa({ codigo, enviar, apuestaEnJuego });

  const sinMesa = useSinMesa(vista !== null);
  const ahora = useAhoraServidor(vista !== null && vista.finFase !== null && vista.fase !== "carrera");

  if (error === "mesa_llena") return <MesaLlena codigo={codigo} juego="carrera" jugadores={CARRERA.MAX_JUGADORES} />;

  // Lo que se ve de la carrera va un poco por detrás del mensaje (el ganador se anuncia cuando llega a la meta): la fase
  // que se enseña es la de la escena, no la de la vista.
  const faseVisible: FaseCarrera | null = fase === "resultado" && e.ganador === null ? "carrera" : fase;
  const abiertas = fase === "apuestas" || fase === "esperando";
  const puedeElegir = abiertas && conectado && sentado;
  const yaEn = elegido === null ? 0 : mias[elegido];
  const tope = elegido === null ? 0 : Math.max(0, Math.min(CARRERA.MAX - yaEn, fichas));

  const apostar = () => {
    if (elegido === null || vista === null) return;
    sonidos.reproducir("fichas");
    enviar({ t: "apostar", caballo: elegido, cantidad: montante });
    marcarEnviado();
  };

  const miNeto =
    resultado !== null && vista !== null && (resultado.ronda === vista.ronda || (resultado.ronda === vista.ronda - 1 && misApuestas.length === 0 && abiertas)) ? resultado.neto : undefined;
  const conCuenta = vista !== null && vista.finFase !== null && (faseVisible === "apuestas" || faseVisible === "resultado");
  const cuenta = conCuenta ? cuentaAtras(vista.finFase! - ahora) : null;

  let controles;
  if (faseVisible === "resultado" && e.ganador) controles = <PanelGanador ganador={e.ganador} />;
  else if (faseVisible === "carrera" || faseVisible === "resultado") controles = <PanelEnCarrera apuestas={misApuestas} />;
  else if (vista !== null) {
    controles = (
      <PanelApuestas
        elegido={elegido}
        montante={montante}
        tope={tope}
        alMaximo={elegido !== null && yaEn >= CARRERA.MAX}
        activo={puedeElegir && !esperando}
        esperando={esperando}
        onCambiar={setMontante}
        onApostar={apostar}
      />
    );
  }

  // Las medidas de ordenador/móvil que no dependen de la pista medida: la franja de los tramos.
  const franja = ordenador ? FRANJA_HORIZONTAL : FRANJA_VERTICAL;
  const estiloMesa = { "--franja": `${franja}px`, ...(g ? variablesDe(g) : {}) } as CSSProperties;
  const medidas = g ?? geometria(400, 240, ordenador);

  return (
    <main className={`marco-mesa carrera${ordenador ? " carrera--ordenador" : ""}`}>
      <Reconectando conectado={conectado || vista === null} />
      <BarraMesa titulo="Carrera" onVolver={salida.alVolver} refFichas={refFichas} />

      <div className={`carrera-mesa aparece${ajustando ? " carrera-mesa--ajustando" : ""}`} style={estiloMesa}>
        <Pista ref={pista} escena={e} elegido={elegido} eligible={puedeElegir} onElegir={setElegido} caballoAncho={escena !== null && g !== null ? g.caballoAncho : null} />
        <Franja escena={e} tramos={vista?.tramos ?? SIN_TRAMOS} ancho={medidas.tramoAncho} />
        <Cabeceras elegido={elegido} activo={puedeElegir} ganador={e.ganador} mias={mias} mesa={vista?.totalesPorCaballo ?? SIN_CASILLAS} onElegir={setElegido} refs={cabeceras} />
        <Esquina escena={e} mazoAncho={medidas.mazoAncho} mazo={mazo} barajando={barajando} />
      </div>

      <section className="carrera-panel" aria-label="Tu jugada">
        {sinMesa && <SinMesa codigo={codigo} />}
        <EstadoMesa
          texto={textoEstado(faseVisible, misApuestas.length > 0)}
          cuenta={cuenta}
          finFase={faseVisible === "apuestas" ? (vista?.finFase ?? null) : null}
          duracionMs={CARRERA.APUESTAS_MS}
        >
          {miNeto !== undefined && <Resultado key={resultado?.ronda} neto={miNeto} />}
        </EstadoMesa>
        <div className="carrera-controles">{controles}</div>
      </section>

      <CartelPremio premio={premio} />
      <FichasVolando disparo={premio?.id ?? 0} desde={refDesde} hasta={refFichas} />
      <AvisoMesa error={error} />

      {salida.dialogo}
    </main>
  );
}
