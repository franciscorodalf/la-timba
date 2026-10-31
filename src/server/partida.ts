import { type Connection, type ConnectionContext, Server } from "partyserver";
import type { FilaRankingPartida, MensajeSala } from "../shared/api";
import type { IdJuego, ResumenMesa } from "../shared/juegos/tipos";
import type { Env } from "./index";
import type { Mesa } from "./mesa-base";

const CLAVE_PARTIDA = "partida";
/** Lo que tiene que sobrevivir de la noche (`RegistroSala`), en una sola clave: solo se escribe cuando cambia el ranking. */
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
/**
 * El espacio de nombres de la mesa de cada juego: un juego nuevo que falte aquí no compila, y `JUEGOS` sale de aquí. Sin
 * el tipo de cada mesa: el de su stub RPC es demasiado profundo para TypeScript, y la sala solo le pregunta `resumenSala`.
 */
const MESA_DE: Record<IdJuego, (env: Env) => unknown> = {
  blackjack: (env) => env.MesaBlackjack,
  carrera: (env) => env.MesaCarrera,
};
const JUEGOS = Object.keys(MESA_DE) as IdJuego[];
/**
 * Lo que enseña la sala de una mesa que no contesta: «En juego», sin jugadores (la sala sabe quién está en la sala, no
 * quién se sienta en cada mesa: eso es justo lo que ha perdido), hasta que la mesa avise o la sala vuelva a preguntar.
 */
const MESA_DESCONOCIDA: ResumenMesa = { jugadores: [], fase: "desconocida", finFase: null };

/** Una ronda que una mesa acaba de liquidar: su id y el neto de cada jugador, para el ranking de la noche. */
export interface RondaLiquidada {
  rondaId: string;
  netos: FilaRankingPartida[];
}

interface RegistroSala {
  /** El ranking de la noche, ordenado: neto acumulado por apodo. */
  ranking: FilaRankingPartida[];
  /** Las últimas rondas sumadas al ranking. */
  rondas: string[];
}

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
 * Hiberna: lo que tiene que sobrevivir está en el almacenamiento (`partida` y el registro `sala`: el ranking de la noche y
 * las rondas ya sumadas) y quién es cada conexión, en su estado. El ranking de la noche lo van sumando las mesas al
 * liquidar: la sala no pregunta a Jugadores.
 *
 * El resumen de cada mesa vive solo en memoria: cambia varias veces por ronda y guardarlo costaría una escritura cada vez.
 * Si la sala sale de memoria lo pierde, aunque las mesas crean que ya se lo mandaron; por eso, antes de enseñar la sala,
 * le pregunta su resumen a cada mesa que no sepa (`mesasAlDia`).
 */
export class Partida extends Server<Env> {
  static options = { hibernate: true };

  /** Reloj de la sala. Los tests lo sustituyen; al hibernar vuelve a `Date.now`, sin consecuencias. */
  ahora: () => number = () => Date.now();
  /** El último resumen de cada mesa. Solo en memoria: al despertar no se sabe ninguno y se pregunta. */
  private mesas: Partial<Mesas> = {};
  /** Copia en memoria del registro `sala`; `null` hasta que hace falta leerlo. */
  private noche: RegistroSala | null = null;

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
    this.noche = null;
    this.mesas = {};
    return true;
  }

  /** `true` si la sala se abrió y no está cerrada. */
  async existe(): Promise<boolean> {
    const estado = await this.ctx.storage.get<EstadoPartida>(CLAVE_PARTIDA);
    return estado !== undefined && !estado.cerrada;
  }

  /**
   * Las mesas avisan aquí de cada cambio de su estado visible (se queda en memoria), con las rondas que acaban de liquidar:
   * sus netos se suman al ranking de la noche (una ronda ya sumada no vuelve a contar). Solo escribe, una vez, si cambia
   * el ranking.
   */
  async actualizarMesa(juego: IdJuego, resumen: ResumenMesa, liquidadas: RondaLiquidada[] = []): Promise<void> {
    this.mesas[juego] = resumen;
    const antes = await this.leerNoche();
    const noche: RegistroSala = { ranking: antes.ranking.map((f) => ({ ...f })), rondas: antes.rondas };
    for (const { rondaId, netos } of liquidadas) {
      if (noche.rondas.includes(rondaId)) continue;
      noche.rondas = [...noche.rondas, rondaId].slice(-RONDAS_RECORDADAS);
      for (const { apodo, neto } of netos) {
        const fila = noche.ranking.find((f) => f.apodo === apodo);
        if (fila === undefined) noche.ranking.push({ apodo, neto });
        else fila.neto += neto;
      }
    }
    if (noche.rondas !== antes.rondas) {
      noche.ranking.sort(ordenRanking);
      await this.ctx.storage.put(CLAVE_SALA, noche);
      this.noche = noche;
    }
    await this.difundir();
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

    await this.difundir();
  }

  async onClose(): Promise<void> {
    if (this.conectados().length === 0) await this.ctx.storage.setAlarm(this.ahora() + INACTIVIDAD_MS);
    await this.difundir();
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

  /** El ranking de la noche y las rondas ya sumadas (leídos una vez por cada vez que la sala despierta). */
  private async leerNoche(): Promise<RegistroSala> {
    if (this.noche === null) {
      // Una sala guardada por una versión anterior trae también `mesas`: ya no se usan, se pregunta a cada mesa.
      const guardada = await this.ctx.storage.get<RegistroSala>(CLAVE_SALA);
      this.noche = { ranking: guardada?.ranking ?? [], rondas: guardada?.rondas ?? [] };
    }
    return this.noche;
  }

  /**
   * El resumen de cada mesa. Si la sala no sabe el de alguna (acaba de despertar), se lo pregunta a esa mesa; si la mesa no
   * contesta, se enseña como desconocida y se vuelve a preguntar la próxima vez.
   */
  private async mesasAlDia(): Promise<Mesas> {
    const faltan = JUEGOS.filter((juego) => this.mesas[juego] === undefined);
    await Promise.all(
      faltan.map(async (juego) => {
        try {
          const resumen = await this.mesa(juego).resumenSala();
          // Si mientras tanto ha llegado un aviso de la propia mesa, ese es más nuevo: no se pisa.
          if (resumen !== null && this.mesas[juego] === undefined) this.mesas[juego] = resumen;
        } catch (e) {
          console.error(e);
        }
      }),
    );
    return Object.fromEntries(JUEGOS.map((juego) => [juego, this.mesas[juego] ?? MESA_DESCONOCIDA])) as Mesas;
  }

  /** La mesa de `juego` de esta partida (mismo código), con lo único que le pregunta la sala. */
  private mesa(juego: IdJuego): Pick<Mesa<any, any>, "resumenSala"> {
    const espacio = MESA_DE[juego](this.env) as DurableObjectNamespace;
    return espacio.get(espacio.idFromName(this.name)) as unknown as Pick<Mesa<any, any>, "resumenSala">;
  }

  /**
   * Envía a todas las conexiones el estado actual de la sala. El ranking se lee después de preguntar a las mesas: si
   * entretanto ha cambiado, este mensaje (que puede salir después que otro) ya lleva el nuevo.
   */
  private async difundir(): Promise<void> {
    const mesas = await this.mesasAlDia();
    const { ranking } = await this.leerNoche();
    const mensaje: MensajeSala = { t: "sala", codigo: this.name, ahora: this.ahora(), conectados: this.conectados(), mesas, rankingNoche: ranking };
    this.broadcast(JSON.stringify(mensaje));
  }
}
