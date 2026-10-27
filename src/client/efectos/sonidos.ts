// Los sonidos de las mesas, sintetizados con Web Audio en el momento: no hay archivos que descargar ni licencias que
// vigilar, y cada vez suenan un poco distintos (como una carta de verdad). Nada de aquí lanza: sin Web Audio, antes del
// primer toque en la página (los navegadores no dejan sonar antes) o con el sonido silenciado, simplemente no suena.
// El audio se despierta con el primer toque o tecla en cualquier sitio de la página (ver el final del archivo).

import { mesaTapada } from "./ventana";

export type NombreSonido = "carta" | "fichas" | "victoria";

const CLAVE = "timba.silencio";

function leerSilencio(): boolean {
  try {
    return localStorage.getItem(CLAVE) === "1";
  } catch {
    return false;
  }
}

let silenciado = leerSilencio();
let contexto: AudioContext | null = null;
let salida: AudioNode | null = null;
let ruido: AudioBuffer | null = null;

/**
 * El contexto de audio listo para sonar, o `null` si aún no puede (o nunca podrá). Solo lo crea con `crear`, que pasa
 * únicamente el despertar tras un toque del jugador: crearlo cuesta decenas de milisegundos (cientos en un móvil lento) y
 * no debe pasar en mitad de un reparto; además, antes de un toque el navegador lo dejaría mudo.
 */
function audio(crear: boolean): AudioContext | null {
  try {
    if (contexto === null) {
      const Contexto: typeof AudioContext | undefined = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!crear || typeof Contexto !== "function") return null;
      contexto = new Contexto({ latencyHint: "interactive" });
      salida = cadenaDeSalida(contexto);
      ruido = ruidoBlanco(contexto);
    }
    if (contexto.state === "suspended") void contexto.resume().catch(() => {});
    // Si sigue suspendido no se programa nada: al reanudarse sonaría todo lo pendiente de golpe.
    return contexto.state === "running" ? contexto : null;
  } catch {
    return null;
  }
}

/** Volumen general con un compresor suave: varias fichas o cartas a la vez no saturan. */
function cadenaDeSalida(ctx: AudioContext): AudioNode {
  const compresor = ctx.createDynamicsCompressor();
  compresor.threshold.value = -9;
  compresor.ratio.value = 3;
  compresor.attack.value = 0.003;
  compresor.release.value = 0.12;
  const volumen = ctx.createGain();
  volumen.gain.value = 0.9;
  volumen.connect(compresor).connect(ctx.destination);
  return volumen;
}

function ruidoBlanco(ctx: AudioContext): AudioBuffer {
  const muestras = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, muestras, ctx.sampleRate);
  const datos = buffer.getChannelData(0);
  for (let i = 0; i < muestras; i++) datos[i] = Math.random() * 2 - 1;
  return buffer;
}

const azar = (centro: number, margen: number): number => centro * (1 + (Math.random() * 2 - 1) * margen);

/** Un golpe de envolvente: sube en `ataque` segundos hasta `pico` y cae exponencialmente hasta casi nada en `caida`. */
function envolvente(ctx: AudioContext, inicio: number, pico: number, ataque: number, caida: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, inicio);
  g.gain.exponentialRampToValueAtTime(pico, inicio + ataque);
  g.gain.exponentialRampToValueAtTime(0.0001, inicio + ataque + caida);
  return g;
}

/** Ruido filtrado con su envolvente: el roce de una carta o el chasquido de una ficha. */
function soplo(ctx: AudioContext, destino: AudioNode, inicio: number, filtro: { desde: number; hasta: number; q: number }, pico: number, ataque: number, caida: number): void {
  const fuente = ctx.createBufferSource();
  fuente.buffer = ruido;
  const banda = ctx.createBiquadFilter();
  banda.type = "bandpass";
  banda.Q.value = filtro.q;
  banda.frequency.setValueAtTime(filtro.desde, inicio);
  banda.frequency.exponentialRampToValueAtTime(filtro.hasta, inicio + ataque + caida);
  fuente.connect(banda).connect(envolvente(ctx, inicio, pico, ataque, caida)).connect(destino);
  const fin = inicio + ataque + caida + 0.02;
  fuente.start(inicio, Math.random() * 0.8, fin - inicio);
}

/** Un tono con su envolvente. */
function tono(ctx: AudioContext, destino: AudioNode, inicio: number, tipo: OscillatorType, frecuencia: number, pico: number, ataque: number, caida: number): void {
  const osc = ctx.createOscillator();
  osc.type = tipo;
  osc.frequency.setValueAtTime(frecuencia, inicio);
  osc.connect(envolvente(ctx, inicio, pico, ataque, caida)).connect(destino);
  osc.start(inicio);
  osc.stop(inicio + ataque + caida + 0.02);
}

/** Una carta que sale del mazo: un roce que se apaga y un golpecito sordo al caer en el tapete. */
function carta(ctx: AudioContext, destino: AudioNode, t: number): void {
  soplo(ctx, destino, t, { desde: azar(4200, 0.15), hasta: azar(1500, 0.15), q: 0.8 }, azar(1.9, 0.1), 0.006, 0.11);
  tono(ctx, destino, t + 0.035, "sine", azar(150, 0.1), 0.5, 0.004, 0.06);
}

/** Fichas de arcilla que chocan: tres o cuatro chasquidos agudos con una pizca de resonancia. */
function fichas(ctx: AudioContext, destino: AudioNode, t: number): void {
  const golpes = 3 + Math.round(Math.random());
  let cuando = t;
  for (let i = 0; i < golpes; i++) {
    const f = azar(3400, 0.2);
    soplo(ctx, destino, cuando, { desde: f, hasta: f * 0.8, q: 5 }, azar(2.6, 0.15), 0.0015, azar(0.035, 0.25));
    tono(ctx, destino, cuando, "sine", f * azar(1.3, 0.05), 0.12, 0.001, 0.045);
    cuando += azar(0.042, 0.35);
  }
}

/** Un arpegio brillante que acaba en acorde, con un eco corto: se ha ganado la mano. */
function victoria(ctx: AudioContext, destino: AudioNode, t: number): void {
  const eco = ctx.createDelay(0.5);
  eco.delayTime.value = 0.12;
  const realimentacion = ctx.createGain();
  realimentacion.gain.value = 0.28;
  const mezcla = ctx.createGain();
  mezcla.gain.value = 0.22;
  eco.connect(realimentacion).connect(eco);
  eco.connect(mezcla).connect(destino);
  const nota = (inicio: number, frecuencia: number, pico: number, caida: number) => {
    for (const salidaNota of [destino, eco]) {
      tono(ctx, salidaNota, inicio, "triangle", frecuencia, pico, 0.006, caida);
      tono(ctx, salidaNota, inicio, "sine", frecuencia * 2, pico * 0.25, 0.006, caida * 0.6);
    }
  };
  // Sol5, Do6, Mi6, Sol6 y el acorde de Do mayor arriba.
  [784, 1047, 1319, 1568].forEach((f, i) => nota(t + i * 0.085, f, 0.2, 0.32));
  for (const f of [1047, 1319, 1568, 2093]) nota(t + 0.36, f, 0.11, 0.75);
  // El bucle del eco no se apaga solo: se desconecta cuando ya no suena, para no dejar nodos vivos.
  setTimeout(() => {
    eco.disconnect();
    realimentacion.disconnect();
    mezcla.disconnect();
  }, 2_500);
}

const INSTRUMENTOS: Record<NombreSonido, (ctx: AudioContext, destino: AudioNode, t: number) => void> = { carta, fichas, victoria };

// El audio se despierta con el primer gesto del jugador en cualquier sitio de la página. Se escuchan todos los que pueden
// contar como gesto: en iOS un `pointerdown` de un dedo no cuenta (sí `touchend`, `pointerup` y `click`). Crearlo no se
// hace dentro del gesto (el botón tardaría en responder) sino en el siguiente rato libre, y solo cuando el navegador ya
// considera que ha habido un gesto. Si aun así nace suspendido (Safari solo lo arranca dentro de uno), el gesto siguiente
// lo reanuda y toca un búfer mudo para desbloquearlo; los oyentes siguen puestos hasta que suena.
const GESTOS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;

type ConActivacion = Navigator & { userActivation?: { hasBeenActive: boolean } };

/** Dentro de un gesto: reanuda el audio suspendido y toca un instante de silencio (lo que desbloquea iOS). */
function desbloquear(ctx: AudioContext): void {
  try {
    void ctx.resume().catch(() => {});
    const silencio = ctx.createBufferSource();
    silencio.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    silencio.connect(ctx.destination);
    silencio.start(0);
  } catch {
    // Sin desbloqueo: se intentará en el gesto siguiente.
  }
}

if (typeof window !== "undefined") {
  let creando = false;
  const crearEnReposo = () => {
    if (creando) return;
    creando = true;
    const crear = () => void audio(true);
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(crear, { timeout: 300 });
    else setTimeout(crear, 0);
  };
  const dejarDeEscuchar = () => {
    for (const gesto of GESTOS) window.removeEventListener(gesto, despertar, true);
  };
  function despertar() {
    if (contexto === null) {
      // Un evento que el navegador aún no cuenta como gesto (el `pointerdown` de iOS): se espera al siguiente.
      if ((navigator as ConActivacion).userActivation?.hasBeenActive === false) return;
      return crearEnReposo();
    }
    if (contexto.state === "running") return dejarDeEscuchar();
    desbloquear(contexto);
  }
  for (const gesto of GESTOS) window.addEventListener(gesto, despertar, { capture: true, passive: true });
}

export const sonidos = {
  /**
   * Toca un sonido ya. Silenciado, sin Web Audio, antes del primer toque en la página o mientras el aviso de girar el móvil tapa
   * la mesa (no se vería nada y el botón de silencio también está tapado), no hace nada (y no crea el audio).
   */
  reproducir(nombre: NombreSonido): void {
    if (silenciado || mesaTapada()) return;
    const ctx = audio(false);
    if (ctx === null || salida === null) return;
    try {
      INSTRUMENTOS[nombre](ctx, salida, ctx.currentTime + 0.005);
    } catch {
      // Un nodo que el navegador no admite: ese sonido no suena.
    }
  },
  /** Si el jugador ha quitado el sonido. Se recuerda en el navegador. */
  get silenciado(): boolean {
    return silenciado;
  },
  /** Quita o pone el sonido y lo recuerda («timba.silencio»). Si no se puede guardar, dura lo que la pestaña. */
  alternar(): void {
    silenciado = !silenciado;
    try {
      localStorage.setItem(CLAVE, silenciado ? "1" : "0");
    } catch {
      // Sin almacenamiento: queda en memoria.
    }
  },
};
