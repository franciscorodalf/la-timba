import { type Connection, type ConnectionContext, Server } from "partyserver";
import type { FilaRankingPartida, MensajeSala } from "../shared/api";
import type { IdJuego, ResumenMesa } from "../shared/juegos/tipos";
import type { Env } from "./index";

const CLAVE_PARTIDA = "partida";
/** Lo que enseña la sala (`RegistroSala`), en una sola clave: cada aviso de una mesa es una sola fila escrita. */
const CLAVE_SALA = "sala";
/** Rondas liquidadas que se recuerdan para no sumarlas dos veces si una mesa repite el aviso. */
const RONDAS_RECORDADAS = 50;
/** Sin conexiones durante este tiempo, la sala se cierra. */
const INACTIVIDAD_MS = 30 * 60 * 1000;
/** Cierre de una conexión que llega sin la identidad que inyecta el Worker. */
const CIERRE_NO_AUTENTICADO = 4401;

interface EstadoPartida {
  creadaEn: number;
  creadorId: number;
  cerrada: boolean;
}

/**
 * Guardado en la conexión (sobrevive a la hibernación). `orden` es el turno de llegada entre las conexiones abiertas:
 * el runtime no devuelve las conexiones en orden de llegada, así que hay que llevarlo aparte.
 */
interface EstadoConexion {
  jugadorId: number;
  apodo: string;
  orden: number;
}

type Mesas = Record<IdJuego, ResumenMesa>;

/** Una ronda que una mesa acaba de liquidar: su id y el neto de cada jugador, para el ranking de la noche. */
export interface RondaLiquidada {
  rondaId: string;
  netos: FilaRankingPartida[];
}

interface RegistroSala {
  mesas: Mesas;
  /** El ranking de la noche, ordenado: neto acumulado por apodo. */
  ranking: FilaRankingPartida[];
  /** Las últimas rondas sumadas al ranking. */
  rondas: string[];
}

const mesasVacias = (): Mesas => ({
  blackjack: { jugadores: [], fase: "esperando", finFase: null },
  carrera: { jugadores: [], fase: "esperando", finFase: null },
});

/** Neto DESC y, a igualdad, apodo sin distinguir mayúsculas (los apodos son ASCII). */
const ordenRanking = (a: FilaRankingPartida, b: FilaRankingPartida) => {
  if (a.neto !== b.neto) return b.neto - a.neto;
  const x = a.apodo.toLowerCase();
  const y = b.apodo.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * La sala de una partida: un WebSocket por pestaña abierto mientras dura la partida. Muestra quién está conectado,
 * el estado de cada mesa y el ranking de la noche, y se cierra tras 30 min sin conexiones.
 *
 * Hiberna: nada de lo que necesita la sala puede vivir en campos de la instancia. Lo persistente está en el
 * almacenamiento (`partida` y el registro `sala`: mesas, ranking de la noche y rondas ya sumadas) y quién es cada
 * conexión, en su estado. El ranking de la noche lo van sumando las mesas al liquidar: la sala no pregunta a Jugadores.
 */
export class Partida extends Server<Env> {
  static options = { hibernate: true };

  /** Reloj de la sala. Los tests lo sustituyen; al hibernar vuelve a `Date.now`, sin consecuencias. */
  ahora: () => number = () => Date.now();

  /**
   * Abre la sala y programa su cierre a los 30 min por si nadie llega. Devuelve `false`, sin tocar nada, si ya hay
   * una sala abierta con este código. Una sala cerrada puede reabrirse y empieza de cero.
   */
  async iniciar(creadorId: number, ahora: number): Promise<boolean> {
    // Solo hay esperas de almacenamiento entre la lectura y la escritura, así que ninguna otra llamada se cuela entre ambas.
    const actual = await this.ctx.storage.get<EstadoPartida>(CLAVE_PARTIDA);
    if (actual !== undefined && !actual.cerrada) return false;

    const estado: EstadoPartida = { creadaEn: ahora, creadorId, cerrada: false };
    await this.ctx.storage.delete(CLAVE_SALA);
    await this.ctx.storage.put(CLAVE_PARTIDA, estado);
    await this.ctx.storage.setAlarm(ahora + INACTIVIDAD_MS);
    return true;
  }

  /** `true` si la sala se abrió y no está cerrada. */
  async existe(): Promise<boolean> {
    const estado = await this.ctx.storage.get<EstadoPartida>(CLAVE_PARTIDA);
    return estado !== undefined && !estado.cerrada;
  }

  /**
   * Las mesas avisan aquí de cada cambio de su estado visible, con las rondas que acaban de liquidar (sus netos se suman
   * al ranking de la noche; una ronda ya sumada no vuelve a contar). Una sola escritura.
   */
  async actualizarMesa(juego: IdJuego, resumen: ResumenMesa, liquidadas: RondaLiquidada[] = []): Promise<void> {
    const sala = await this.leerSala();
    sala.mesas[juego] = resumen;
    for (const { rondaId, netos } of liquidadas) {
      if (sala.rondas.includes(rondaId)) continue;
      sala.rondas = [...sala.rondas, rondaId].slice(-RONDAS_RECORDADAS);
      for (const { apodo, neto } of netos) {
        const fila = sala.ranking.find((f) => f.apodo === apodo);
        if (fila === undefined) sala.ranking.push({ apodo, neto });
        else fila.neto += neto;
      }
    }
    sala.ranking.sort(ordenRanking);
    await this.ctx.storage.put(CLAVE_SALA, sala);
    this.difundir(sala);
  }

  async onConnect(conn: Connection<EstadoConexion>, { request }: ConnectionContext): Promise<void> {
    // Estas cabeceras las pone el Worker tras validar el token; sin ellas la conexión no pasó por el Worker.
    const id = request.headers.get("x-jugador-id");
    const apodo = request.headers.get("x-apodo");
    if (id === null || apodo === null || !/^\d+$/.test(id)) {
      conn.close(CIERRE_NO_AUTENTICADO, "no_autenticado");
      return;
    }
    // Sin esperas hasta aquí: dos conexiones simultáneas no pueden coger el mismo turno.
    const turnos = Array.from(this.getConnections<EstadoConexion>(), (c) => c.state?.orden ?? 0);
    conn.setState({ jugadorId: Number(id), apodo, orden: Math.max(0, ...turnos) + 1 });

    this.difundir(await this.leerSala());
  }

  async onClose(): Promise<void> {
    if (this.conectados().length === 0) await this.ctx.storage.setAlarm(this.ahora() + INACTIVIDAD_MS);
    this.difundir(await this.leerSala());
  }

  /** Los clientes no mandan nada a la sala: todo lo que cambia viene de las mesas. */
  onMessage(): void {}

  async onAlarm(): Promise<void> {
    if (this.conectados().length > 0) {
      // Hay gente: la sala sigue abierta. Se vuelve a armar por si se perdió algún evento de cierre y se quedara abierta para siempre.
      await this.ctx.storage.setAlarm(this.ahora() + INACTIVIDAD_MS);
      return;
    }
    const estado = await this.ctx.storage.get<EstadoPartida>(CLAVE_PARTIDA);
    if (estado !== undefined && !estado.cerrada) await this.ctx.storage.put(CLAVE_PARTIDA, { ...estado, cerrada: true });
  }

  /**
   * Apodos de los jugadores conectados, sin repetir (varias pestañas de uno cuentan una vez), en el orden de su
   * primera conexión. Durante `onClose` la conexión que se cierra ya no figura como abierta.
   */
  private conectados(): string[] {
    const abiertas: EstadoConexion[] = [];
    for (const conn of this.getConnections<EstadoConexion>()) {
      if (conn.state !== null) abiertas.push(conn.state);
    }
    abiertas.sort((a, b) => a.orden - b.orden);
    return [...new Set(abiertas.map((estado) => estado.apodo))];
  }

  private async leerSala(): Promise<RegistroSala> {
    const guardada = await this.ctx.storage.get<RegistroSala>(CLAVE_SALA);
    return { ranking: [], rondas: [], ...guardada, mesas: { ...mesasVacias(), ...guardada?.mesas } };
  }

  /** Envía a todas las conexiones el estado actual de la sala. */
  private difundir({ mesas, ranking }: RegistroSala): void {
    const mensaje: MensajeSala = { t: "sala", codigo: this.name, ahora: this.ahora(), conectados: this.conectados(), mesas, rankingNoche: ranking };
    this.broadcast(JSON.stringify(mensaje));
  }
}
