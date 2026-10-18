import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { type CSSProperties, type ReactNode, type Ref, type RefObject, useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Link, useLocation } from "wouter";
import type { Carta } from "../../shared/cartas";
import { type AccionBJ, BJ, type VistaBJ } from "../../shared/juegos/blackjack";
import type { CodigoError, Evento, JugadorId } from "../../shared/juegos/tipos";
import { Aviso } from "../componentes/Aviso";
import { BarraMesa } from "../componentes/BarraMesa";
import { Boton } from "../componentes/Boton";
import { Confirmar } from "../componentes/Confirmar";
import { Destellos } from "../componentes/Destellos";
import { Ficha } from "../componentes/Ficha";
import { FichasVolando } from "../componentes/FichasVolando";
import { Mazo } from "../componentes/Mazo";
import { cargarBaraja, Naipe } from "../componentes/Naipe";
import { Reconectando } from "../componentes/Reconectando";
import { Temporizador } from "../componentes/Temporizador";
import { useMovimientoReducido } from "../efectos/movimiento";
import { sonidos } from "../efectos/sonidos";
import { vibrar } from "../efectos/vibrar";
import { cuentaAtras, miles } from "../formato";
import { useAhoraServidor } from "../red/reloj";
import { useSesion } from "../red/sesion";
import { useMesa } from "../red/useMesa";
import { claveCarta, GIRO_MS, type Guion, GUION_VACIO, guionDelLote, totalVisible, VUELO_MS } from "./guion-blackjack";

type ManoVista = VistaBJ["manos"][number];

/** A partir de este ancho, la mesa entera con los asientos en semicírculo; por debajo, la vista de móvil. */
const ORDENADOR_PX = 900;
/** Respiro entre la última carta de la ronda y el cartel del premio. */
const PAUSA_PREMIO_MS = 250;
/** Lo que se queda el cartel «¡Ganas +N!». */
const CARTEL_MS = 2_000;
/** Las fichas que vuelan tardan esto en empezar a llegar al contador: entonces empieza a contar. */
const LLEGADA_FICHAS_MS = 450;
/** Lo que dura el aviso «Barajando». */
const BARAJADO_MS = 1_600;
const VALORES_FICHA = [10, 25, 50, 100, 500] as const;

const TEXTO_ERROR: Partial<Record<CodigoError, string>> = {
  sin_fichas: "No tienes fichas suficientes",
  no_disponible: "No se pudo hacer la apuesta. Inténtalo de nuevo",
};

/** La última apuesta hecha en esta pestaña: la siguiente ronda empieza con ella preparada. */
let ultimaApuesta = 0;

// ---------------------------------------------------------------------------------------------------------------------
// Medidas
// ---------------------------------------------------------------------------------------------------------------------

function suscribirVentana(avisar: () => void): () => void {
  window.addEventListener("resize", avisar);
  return () => window.removeEventListener("resize", avisar);
}

interface Medidas {
  ordenador: boolean;
  banca: number;
  yo: number;
  otros: number;
  mazo: number;
}

/** El ancho de las cartas según la pantalla: en móvil se ajusta al ancho (y a lo bajo que sea), en ordenador a lo alto. */
function useMedidas(): Medidas {
  const ancho = useSyncExternalStore(suscribirVentana, () => window.innerWidth, () => 1024);
  const alto = useSyncExternalStore(suscribirVentana, () => window.innerHeight, () => 768);
  if (ancho >= ORDENADOR_PX) {
    const k = Math.min(1.15, Math.max(0.75, alto / 820));
    return { ordenador: true, banca: Math.round(78 * k), yo: Math.round(96 * k), otros: Math.round(62 * k), mazo: Math.round(56 * k) };
  }
  const yo = Math.round(Math.min(Math.max(ancho * 0.25, 66), 112, alto * 0.14));
  const banca = Math.round(Math.min(Math.max(ancho * 0.185, 50), 84, alto * 0.105));
  return { ordenador: false, banca, yo, otros: 0, mazo: Math.round(banca * 0.72) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Guion: cuándo sale y cuándo ha llegado cada carta
// ---------------------------------------------------------------------------------------------------------------------

const hayCartas = (lote: Evento[]): boolean => lote.some((e) => e.tipo === "carta_repartida" || e.tipo === "carta_girada");

interface Reloj {
  lote: Evento[];
  guion: Guion;
  /** Milisegundos del guion que ya han pasado (a saltos: cada llegada de una carta). */
  hito: number;
  /** Dónde estaba el mazo cuando llegó el guion: de ahí salen sus cartas. */
  origen: DOMRect | null;
}

/**
 * El guion del último lote con cartas y su avance. Un lote sin cartas (alguien apuesta, otro se sienta) no interrumpe el
 * reparto en curso. Cada carta suena al salir del mazo.
 */
function useGuion(lote: Evento[], vista: VistaBJ | null, mazo: RefObject<HTMLElement | null>): Reloj {
  const [reloj, setReloj] = useState<Reloj>({ lote, guion: GUION_VACIO, hito: Infinity, origen: null });
  let actual = reloj;
  if (lote !== reloj.lote) {
    actual =
      vista !== null && hayCartas(lote)
        ? { lote, guion: guionDelLote(lote, vista), hito: 0, origen: mazo.current?.getBoundingClientRect() ?? null }
        : { ...reloj, lote };
    setReloj(actual);
  }

  const { guion } = actual;
  useEffect(() => {
    if (guion === GUION_VACIO) return;
    const hitos = new Set([...guion.cartas.values()].map((t) => t + VUELO_MS));
    if (guion.giro) hitos.add(GIRO_MS);
    hitos.add(guion.fin);
    const relojes = [...hitos].map((t) => setTimeout(() => setReloj((r) => (r.guion === guion ? { ...r, hito: Math.max(r.hito, t) } : r)), t));
    for (const t of guion.cartas.values()) relojes.push(setTimeout(() => sonidos.reproducir("carta"), t));
    if (guion.giro) sonidos.reproducir("carta");
    return () => relojes.forEach(clearTimeout);
  }, [guion]);

  return actual;
}

/** La carta ya está en su sitio (o no venía en el guion en curso). */
function aterrizada(reloj: Reloj, clave: string): boolean {
  const salida = reloj.guion.cartas.get(clave);
  return salida === undefined || reloj.hito >= salida + VUELO_MS;
}

// ---------------------------------------------------------------------------------------------------------------------
// Piezas de la mesa
// ---------------------------------------------------------------------------------------------------------------------

/** Las cartas de una ronda. Al cambiar de ronda, las de la anterior se retiran con un fundido. */
function CapaMano({ children }: { children: ReactNode }) {
  const presente = useIsPresent();
  const reducido = useMovimientoReducido();
  return (
    <motion.div
      className="bj-mano__cartas"
      aria-hidden={presente ? undefined : true}
      exit={reducido ? { opacity: 0 } : { opacity: 0, transform: "translateY(-12px) scale(0.94)" }}
      transition={{ duration: 0.32, ease: "easeIn" }}
    >
      {children}
    </motion.div>
  );
}

interface ManoProps {
  cartas: (Carta | null)[];
  de: JugadorId | "banca";
  ronda: number;
  ancho: number;
  reloj: Reloj;
  etiqueta: string;
}

function Mano({ cartas, de, ronda, ancho, reloj, etiqueta }: ManoProps) {
  const estilo = { "--ancho": `${ancho}px`, "--solape": cartas.length > 5 ? -0.62 : -0.42 } as CSSProperties;
  return (
    <div className="bj-mano" role="group" aria-label={etiqueta} style={estilo}>
      <AnimatePresence initial={false}>
        <CapaMano key={ronda}>
          {cartas.map((carta, i) => {
            const clave = claveCarta(ronda, de, i);
            const salida = reloj.guion.cartas.get(clave);
            return <Naipe key={clave} carta={carta} ancho={ancho} retardo={salida} origen={salida === undefined ? null : reloj.origen} />;
          })}
        </CapaMano>
      </AnimatePresence>
    </div>
  );
}

type Tono = "normal" | "pasado" | "gana" | "blackjack";

/** El total de una mano, que aparece con un pequeño rebote cada vez que cambia. */
function Total({ valor, tono = "normal" }: { valor: number | null; tono?: Tono }) {
  const reducido = useMovimientoReducido();
  if (valor === null) return null;
  return (
    <motion.span
      key={valor}
      className={`bj-total bj-total--${tono}`}
      initial={reducido ? { opacity: 0 } : { transform: "scale(0.2)" }}
      animate={reducido ? { opacity: 1 } : { transform: ["scale(0.2)", "scale(1.15)", "scale(1)"] }}
      transition={{ duration: reducido ? 0.2 : 0.38, ease: [0.2, 0.8, 0.2, 1.4], times: reducido ? undefined : [0, 0.6, 1] }}
    >
      <span className="solo-lectores">Total </span>
      {valor}
    </motion.span>
  );
}

/** Las fichas apostadas en una mano: una pila y la cantidad. */
function Apuesta({ cantidad, refPila }: { cantidad: number; refPila?: Ref<HTMLSpanElement> }) {
  const reducido = useMovimientoReducido();
  return (
    <span className="bj-apuesta" ref={refPila}>
      <span className="bj-apuesta__pila" aria-hidden="true">
        <Ficha tamaño={18} />
        <Ficha tamaño={18} />
        <Ficha tamaño={18} />
      </span>
      <span className="solo-lectores">Apuesta </span>
      <motion.b key={cantidad} initial={reducido ? { opacity: 0 } : { transform: "scale(0.6)" }} animate={reducido ? { opacity: 1 } : { transform: "scale(1)" }} transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1.4] }}>
        {miles(cantidad)}
      </motion.b>
    </span>
  );
}

/** «Ganas 50», «Pierdes 50» o «Empate»: lo que ha dejado la mano, cuando ya se ha visto el final. */
function Resultado({ neto }: { neto: number }) {
  const reducido = useMovimientoReducido();
  const texto = neto > 0 ? `Ganas ${neto}` : neto < 0 ? `Pierdes ${-neto}` : "Empate";
  const tono = neto > 0 ? "gana" : neto < 0 ? "pierde" : "empata";
  return (
    <motion.span
      className={`bj-resultado bj-resultado--${tono}`}
      role="status"
      initial={reducido ? { opacity: 0 } : { opacity: 0, transform: "translateY(6px)" }}
      animate={reducido ? { opacity: 1 } : { opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.3, ease: "easeOut" }}
    >
      {texto}
    </motion.span>
  );
}

function tonoDe(mano: ManoVista | undefined, total: number | null, neto: number | undefined): Tono {
  if (total !== null && total > 21) return "pasado";
  if (mano?.estado === "blackjack" && total === 21) return "blackjack";
  if (neto !== undefined && neto > 0) return "gana";
  return "normal";
}

/** Texto corto del estado de otra mano para su pastilla. */
function SimboloMano({ mano, total }: { mano: ManoVista; total: number | null }) {
  if (mano.estado === "plantado" && total !== null) return <span className="bj-pastilla__simbolo">✓<span className="solo-lectores"> se planta</span></span>;
  if (mano.estado === "pasado" && total !== null && total > 21) return <span className="solo-lectores">se pasa</span>;
  return null;
}

/** El arco dorado impreso en el tapete. Decorativo. */
function Leyenda() {
  const id = useId();
  return (
    <svg className="bj-leyenda" viewBox="0 0 340 74" aria-hidden="true" focusable="false">
      <path id={id} d="M 12 10 Q 170 84 328 10" fill="none" />
      <text className="bj-leyenda__arco">
        <textPath href={`#${id}`} startOffset="50%" textAnchor="middle">
          Blackjack paga 3 a 2
        </textPath>
      </text>
      <text className="bj-leyenda__linea" x="170" y="68" textAnchor="middle">
        La banca se planta en 17
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------------------------------------------------

interface ApostarProps {
  fichas: number;
  activo: boolean;
  esperando: boolean;
  onApostar(cantidad: number): void;
}

/** Las fichas de 10 a 500 para ir sumando la apuesta, «Borrar» y «Apostar N». No deja pasar de 500 ni de tus fichas. */
function Apostar({ fichas, activo, esperando, onApostar }: ApostarProps) {
  const tope = Math.min(BJ.MAX, fichas);
  const [montante, setMontante] = useState(() => (ultimaApuesta <= tope ? ultimaApuesta : 0));
  const cantidad = montante <= tope ? montante : 0;
  return (
    <div className="bj-apostar">
      <div className="bj-fichas" role="group" aria-label="Fichas para apostar">
        {VALORES_FICHA.map((valor) => (
          <button
            key={valor}
            type="button"
            className={`bj-ficha bj-ficha--${valor}`}
            aria-label={`Añadir ${valor}`}
            disabled={!activo || cantidad + valor > tope}
            onClick={() => setMontante(cantidad + valor)}
          >
            <Ficha tamaño={50} />
            <span className="bj-ficha__valor" aria-hidden="true">
              {valor}
            </span>
          </button>
        ))}
      </div>
      <div className="bj-apostar__fila">
        <Boton variante="secundario" className="bj-apostar__borrar" aria-label="Borrar apuesta" disabled={cantidad === 0} onClick={() => setMontante(0)}>
          Borrar
        </Boton>
        <Boton className="bj-apostar__boton" disabled={!activo || cantidad < BJ.MIN} cargando={esperando} onClick={() => onApostar(cantidad)}>
          {cantidad === 0 ? "Elige tu apuesta" : `Apostar ${miles(cantidad)}`}
        </Boton>
      </div>
    </div>
  );
}

function Decidir({ mano, fichas, activo, onActuar }: { mano: ManoVista; fichas: number; activo: boolean; onActuar(accion: AccionBJ): void }) {
  const puede = activo && mano.estado === "jugando";
  const puedeDoblar = puede && mano.cartas.length === 2 && fichas >= mano.apuesta;
  return (
    <div className="bj-decidir">
      <Boton variante="secundario" disabled={!puede} onClick={() => onActuar({ t: "plantarse" })}>
        Plantarse
      </Boton>
      <Boton disabled={!puede} onClick={() => onActuar({ t: "pedir" })}>
        Pedir
      </Boton>
      <Boton
        variante="secundario"
        disabled={!puedeDoblar}
        onClick={() => {
          sonidos.reproducir("fichas");
          onActuar({ t: "doblar" });
        }}
      >
        Doblar
      </Boton>
    </div>
  );
}

function textoEstado(vista: VistaBJ | null, mano: ManoVista | undefined): string {
  if (vista === null) return "Sentándote en la mesa…";
  switch (vista.fase) {
    case "esperando":
      return "Apuesta para empezar la ronda";
    case "apuestas":
      return mano ? "Apuesta hecha. Esperando al reparto" : "Haz tu apuesta";
    case "decisiones":
      if (!mano) return "Miras esta ronda";
      if (mano.estado === "jugando") return "Tu turno: ¿pides o te plantas?";
      if (mano.estado === "blackjack") return "¡Blackjack! Esperando al resto";
      if (mano.estado === "pasado") return "Te has pasado. Esperando al resto";
      return "Esperando al resto";
    case "banca":
      return "Juega la banca";
    case "resultado":
      return "Nueva ronda en";
  }
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
  const [, navegar] = useLocation();
  const medidas = useMedidas();
  const reducido = useMovimientoReducido();

  const mazo = useRef<HTMLDivElement>(null);
  const refFichas = useRef<HTMLParagraphElement>(null);
  const refApuesta = useRef<HTMLSpanElement>(null);
  const reloj = useGuion(lote, vista, mazo);

  const [resultados, setResultados] = useState<Resultados | null>(null);
  const [premio, setPremio] = useState<{ neto: number; id: number } | null>(null);
  const [barajando, setBarajando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviadoCon, setEnviadoCon] = useState<Evento[] | null>(null);
  const premios = useRef(0);

  // Temporizadores que no deben cortarse al llegar otro mensaje (el premio de esta ronda); se cancelan al salir.
  const pendientes = useRef(new Set<ReturnType<typeof setTimeout>>());
  const despues = useCallback((ms: number, hacer: () => void) => {
    const id = setTimeout(() => {
      pendientes.current.delete(id);
      hacer();
    }, ms);
    pendientes.current.add(id);
  }, []);
  useEffect(() => {
    const relojes = pendientes.current;
    return () => relojes.forEach(clearTimeout);
  }, []);

  // Las caras de las cartas se piden al entrar, para tenerlas antes del primer reparto.
  useEffect(() => {
    cargarBaraja().catch(() => {});
    void refrescar();
  }, [refrescar]);

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
    if (lote.some((e) => e.tipo === "barajado")) {
      setBarajando(true);
      despues(BARAJADO_MS, () => setBarajando(false));
    }
    const pagos = lote.filter((e) => e.tipo === "pago").map((e) => ({ jugadorId: e.jugadorId as JugadorId, neto: e.neto as number }));
    if (pagos.length === 0) return;
    const ronda = vista.ronda;
    const mio = pagos.find((p) => p.jugadorId === vista.yo);
    const pasado = vista.manos.find((m) => m.jugadorId === vista.yo)?.estado === "pasado";
    const espera = (hayCartas(lote) ? guionDelLote(lote, vista).fin : 0) + PAUSA_PREMIO_MS;
    despues(espera, () => {
      setResultados({ ronda, netos: new Map(pagos.map((p) => [p.jugadorId, p.neto])) });
      if (mio === undefined) return;
      if (mio.neto > 0) {
        premios.current += 1;
        setPremio({ neto: mio.neto, id: premios.current });
        sonidos.reproducir("victoria");
        vibrar(80);
        despues(CARTEL_MS, () => setPremio(null));
        despues(LLEGADA_FICHAS_MS, () => void refrescar());
      } else {
        if (mio.neto < 0 && pasado) vibrar(200);
        void refrescar();
      }
    });
    // Solo al llegar un lote nuevo: la vista y el resto son los de ese momento.
  }, [lote]);

  // Un error de la mesa responde a lo último que se mandó: se puede volver a intentar.
  useEffect(() => {
    if (error !== null) setEnviadoCon(null);
  }, [error]);
  const esperando = enviadoCon === lote;
  const actuar = (accion: AccionBJ) => {
    enviar(accion);
    setEnviadoCon(lote);
  };

  const apuestaEnJuego = miMano !== undefined && vista?.fase !== "resultado";
  const salirDeLaMesa = () => {
    enviar({ t: "salir" });
    navegar(`~/p/${codigo}`);
  };

  const ahora = useAhoraServidor(vista !== null && vista.finFase !== null && vista.fase !== "banca");

  if (error === "mesa_llena") return <MesaLlena codigo={codigo} />;

  const ronda = vista?.ronda ?? 0;
  const yoApodo = jugador?.apodo.toLowerCase();
  const sentado = vista?.sentados.some((a) => a.toLowerCase() === yoApodo) ?? false;
  const netos = resultados !== null && resultados.ronda === ronda ? resultados.netos : null;
  const miNeto =
    resultados !== null && yo !== null && (resultados.ronda === ronda || (resultados.ronda === ronda - 1 && miMano === undefined && (vista?.fase === "apuestas" || vista?.fase === "esperando")))
      ? resultados.netos.get(yo)
      : undefined;

  const girada = !reloj.guion.giro || reloj.hito >= GIRO_MS;
  const totalBanca = vista === null ? null : totalVisible(vista.banca, (i) => aterrizada(reloj, claveCarta(ronda, "banca", i)) && (i !== 1 || girada));
  const totalDe = (mano: ManoVista) => totalVisible(mano.cartas, (i) => aterrizada(reloj, claveCarta(ronda, mano.jugadorId, i)));
  const miTotal = miMano ? totalDe(miMano) : null;

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
          ultimaApuesta = cantidad;
          sonidos.reproducir("fichas");
          actuar({ t: "apostar", cantidad });
        }}
      />
    );
  } else if (miMano !== undefined && fase === "decisiones") {
    controles = <Decidir mano={miMano} fichas={fichas} activo={conectado && !esperando} onActuar={actuar} />;
  }

  const textoError = error === null ? null : (TEXTO_ERROR[error] ?? "No puedes hacer eso ahora");

  const miEtiqueta = (
    <div className="bj-etiqueta bj-etiqueta--yo">
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
    <main className={`bj${medidas.ordenador ? " bj--ordenador" : ""}`}>
      <Reconectando conectado={conectado || vista === null} />
      <BarraMesa titulo="Blackjack" onVolver={() => (apuestaEnJuego ? setConfirmando(true) : salirDeLaMesa())} refFichas={refFichas} />

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
        <div className="bj-estado">
          <p role="status">{textoEstado(vista, miMano)}</p>
          {cuenta !== null && (
            <span className="bj-estado__cuenta" aria-hidden="true">
              {cuenta}
            </span>
          )}
        </div>
        <Temporizador finFase={conTemporizador ? (vista?.finFase ?? null) : null} duracionMs={fase === "decisiones" ? BJ.DECISIONES_MS : BJ.APUESTAS_MS} />
        {controles}
      </section>

      <AnimatePresence>
        {premio !== null && (
          <motion.div
            key={premio.id}
            className="bj-premio"
            aria-hidden="true"
            initial={reducido ? { opacity: 0 } : { opacity: 0, transform: "scale(0.3)" }}
            animate={reducido ? { opacity: 1 } : { opacity: [0, 1, 1], transform: ["scale(0.3)", "scale(1.12)", "scale(1)"] }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
            transition={{ duration: reducido ? 0.3 : 0.52, ease: [0.2, 0.8, 0.2, 1.3], times: reducido ? undefined : [0, 0.6, 1] }}
          >
            <span className="bj-premio__texto">¡Ganas +{miles(premio.neto)}!</span>
            <Destellos disparo={premio.id} />
          </motion.div>
        )}
      </AnimatePresence>
      <FichasVolando disparo={premio?.id ?? 0} desde={refApuesta} hasta={refFichas} />

      <AnimatePresence>
        {textoError !== null && (
          <motion.div key={error} className="bj-aviso" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <Aviso>{textoError}</Aviso>
          </motion.div>
        )}
      </AnimatePresence>

      {confirmando && (
        <Confirmar
          titulo="¿Salir de la mesa?"
          texto="Si sales ahora pierdes tu apuesta"
          aceptar="Salir"
          cancelar="Seguir jugando"
          onAceptar={salirDeLaMesa}
          onCancelar={() => setConfirmando(false)}
        />
      )}
    </main>
  );
}

/** «+50», «−50» o «=»: lo que se ha llevado otro jugador. */
function Neto({ neto }: { neto: number }) {
  const tono = neto > 0 ? "gana" : neto < 0 ? "pierde" : "empata";
  return <span className={`bj-neto bj-neto--${tono}`}>{neto > 0 ? `+${miles(neto)}` : neto < 0 ? `−${miles(-neto)}` : "="}</span>;
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

function MesaLlena({ codigo }: { codigo: string }) {
  return (
    <main className="pantalla pantalla--entrada">
      <h1 className="marca__logo aparece">La Timba</h1>
      <section className="panel aparece" aria-labelledby="mesa-llena">
        <h2 className="panel__titulo" id="mesa-llena">
          La mesa está llena
        </h2>
        <p className="panel__texto">Ya hay {BJ.MAX_JUGADORES} jugadores en el blackjack. Prueba en un rato o echa una carrera mientras tanto.</p>
        <Link href={`~/p/${codigo}`} className="boton boton--principal boton--ancho">
          Volver a la sala
        </Link>
      </section>
    </main>
  );
}
