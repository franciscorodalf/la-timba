import { type Connection, type ConnectionContext, Server, type WSMessage } from "partyserver";
import type { MensajeMesa } from "../shared/api";
import { rngCripto, type Rng } from "../shared/cartas";
import type { CodigoError, Evento, FilaLiquidacion, Juego, JugadorId, Paso } from "../shared/juegos/tipos";
import type { Env } from "./index";
import { jugadoresGlobal } from "./jugadores";

const CLAVE_ESTADO = "estado";
const CLAVE_VERSION = "version";
const CLAVE_PENDIENTES = "pendientes";

/** Mensajes por conexión en un mismo segundo: los que pasen de aquí se descartan con error… */
const MENSAJES_POR_SEGUNDO = 20;
/** …y si pasan de este otro, se cierra la conexión. */
const MENSAJES_HASTA_CIERRE = 60;
/** Intentos seguidos de pagar una ronda en Jugadores antes de dejarla pendiente para más tarde. */
const INTENTOS_LIQUIDAR = 3;
/** Con una ronda sin pagar, la mesa se despierta para reintentarlo aunque el juego no tenga nada que hacer. */
const REINTENTO_LIQUIDAR_MS = 60_000;

/** Cierre de una conexión que llega sin la identidad que inyecta el Worker. */
const CIERRE_NO_AUTENTICADO = 4401;
/** Cierre de quien no consigue asiento (mesa llena). */
const CIERRE_SIN_ASIENTO = 4003;
const CIERRE_DEMASIADOS_MENSAJES = 4008;

/** Guardado en la conexión (sobrevive a la hibernación): quién es, según las cabeceras que puso el Worker. */
interface EstadoConexion {
  jugadorId: JugadorId;
  apodo: string;
}

/** Ronda cerrada cuyo pago aún no ha confirmado Jugadores. */
interface Liquidacion {
  rondaId: string;
  filas: FilaLiquidacion[];
  momento: number;
}

type PasoOk<E> = Extract<Paso<E>, { ok: true }>;

/** La acción de un mensaje de texto JSON con `t` de texto; `null` si no lo es. La validan después las reglas del juego. */
function leerAccion<A extends { t: string }>(mensaje: WSMessage): A | null {
  if (typeof mensaje !== "string") return null;
  let valor: unknown;
  try {
    valor = JSON.parse(mensaje);
  } catch {
    return null;
  }
  return typeof valor === "object" && valor !== null && typeof (valor as { t?: unknown }).t === "string" ? (valor as A) : null;
}

/**
 * Mesa genérica de una partida (nombre = código): ejecuta las reglas puras de un `Juego` y las sirve por WebSocket.
 *
 * - Todo cambio pasa por una cola (`encolar`): un `await` a Jugadores o a la sala no deja que otro mensaje, cierre o
 *   alarma trabaje sobre un estado viejo.
 * - Antes de cada acción se aplica lo que el reloj ya decidió (`tick`): una alarma retrasada no deja entrar una apuesta
 *   con la ventana cerrada.
 * - Cada cambio se confirma (`confirmar`): se guarda, se paga en Jugadores si cerró una ronda, se envía a cada conexión
 *   su vista, se programa la alarma y se avisa a la sala.
 *
 * Hiberna: lo necesario vive en el almacenamiento (`estado`, `version`, `pendientes`) o en el estado de cada conexión;
 * los campos de la instancia son copias que `onStart` vuelve a cargar.
 */
export abstract class Mesa<E extends { ronda: number }, A extends { t: string }> extends Server<Env> {
  static options = { hibernate: true };

  protected abstract juego: Juego<E, A>;
  /** Persistido en el almacenamiento con la clave "estado". */
  estado!: E;
  /** Reloj de la mesa. Los tests lo sustituyen; al hibernar vuelve a `Date.now`. */
  ahora: () => number = () => Date.now();
  rng: Rng = rngCripto();

  /** Crece con cada cambio confirmado; persistido en "version". */
  private version = 0;
  /** Rondas cerradas aún sin pagar; persistidas en "pendientes" y reintentadas en cada cambio. */
  private pendientes: Liquidacion[] = [];
  private cola: Promise<void> = Promise.resolve();
  /** Mensajes de cada conexión (por id) en el segundo en curso del reloj de la mesa. Solo en memoria: hibernar lo reinicia. */
  private mensajes = new Map<string, { segundo: number; cuenta: number }>();

  async onStart(): Promise<void> {
    const guardado = await this.ctx.storage.get([CLAVE_ESTADO, CLAVE_VERSION, CLAVE_PENDIENTES]);
    const estado = guardado.get(CLAVE_ESTADO) as E | undefined;
    this.version = (guardado.get(CLAVE_VERSION) as number | undefined) ?? 0;
    this.pendientes = (guardado.get(CLAVE_PENDIENTES) as Liquidacion[] | undefined) ?? [];
    if (estado !== undefined) {
      this.estado = estado;
      return;
    }
    this.estado = this.juego.crear(this.ahora(), this.rng);
    await this.ctx.storage.put(CLAVE_ESTADO, this.estado);
  }

  onConnect(conn: Connection<EstadoConexion>, { request }: ConnectionContext): Promise<void> | void {
    // Estas cabeceras las pone el Worker tras validar el token; sin ellas la conexión no pasó por el Worker.
    const id = request.headers.get("x-jugador-id");
    const apodo = request.headers.get("x-apodo");
    if (id === null || apodo === null || !/^\d+$/.test(id)) {
      conn.close(CIERRE_NO_AUTENTICADO, "no_autenticado");
      return;
    }
    const yo: EstadoConexion = { jugadorId: Number(id), apodo };
    conn.setState(yo);

    return this.encolar(async () => {
      const ahora = this.ahora();
      // Quien llega recibe la vista completa al final, sin los eventos de lo que pasó antes de llegar.
      await this.alDia(ahora, conn.id);
      const p = this.juego.sentar(this.estado, yo.jugadorId, yo.apodo, ahora);
      if (!p.ok) {
        this.enviar(conn, { t: "error", codigo: p.error });
        conn.close(CIERRE_SIN_ASIENTO, p.error);
        return;
      }
      if (p.estado !== this.estado) await this.confirmar(p, ahora, conn.id);
      this.enviar(conn, this.mensajeEstado(yo.jugadorId, []));
    });
  }

  onMessage(conn: Connection<EstadoConexion>, mensaje: WSMessage): Promise<void> | void {
    if (!this.dentroDelLimite(conn)) return;
    return this.encolar(() => this.atender(conn, mensaje));
  }

  onClose(conn: Connection<EstadoConexion>): Promise<void> | void {
    this.mensajes.delete(conn.id);
    const yo = conn.state;
    if (yo === null) return;

    return this.encolar(async () => {
      // Con otra pestaña abierta el jugador sigue en la mesa: cerrar una no lo desconecta.
      if (this.tieneOtraConexion(yo.jugadorId, conn.id)) return;
      const ahora = this.ahora();
      await this.alDia(ahora);
      const p = this.juego.desconectar(this.estado, yo.jugadorId, ahora, this.rng);
      if (p.ok && p.estado !== this.estado) await this.confirmar(p, ahora);
    });
  }

  onAlarm(): Promise<void> {
    return this.encolar(async () => {
      const ahora = this.ahora();
      if (await this.alDia(ahora)) return;
      // Nada que hacer en el juego (alarma adelantada, o solo para reintentar un pago): reintentar y volver a programar.
      await this.liquidarPendientes();
      await this.programarAlarma(ahora);
    });
  }

  /** Una acción de un jugador: `tick` → reglas (puras) → cobro en Jugadores si cuesta fichas → confirmar. */
  private async atender(conn: Connection<EstadoConexion>, mensaje: WSMessage): Promise<void> {
    const yo = conn.state;
    if (yo === null) return;
    const accion = leerAccion<A>(mensaje);
    if (accion === null) return this.enviarError(conn, "mensaje_invalido");

    const ahora = this.ahora();
    await this.alDia(ahora);
    const estado = this.estado;
    const p = this.juego.aplicar(estado, yo.jugadorId, accion, ahora, this.rng);
    if (!p.ok) return this.enviarError(conn, p.error);
    // El coste se mide sobre el estado anterior a la acción (al doblar cuesta la apuesta original).
    const costo = this.juego.costo(estado, yo.jugadorId, accion);
    if (costo > 0) {
      const cobro = await this.cobrar(yo.jugadorId, costo, estado.ronda);
      if (cobro !== "ok") return this.enviarError(conn, cobro);
    }
    if (p.estado !== estado) await this.confirmar(p, ahora);
  }

  /** Descuenta las fichas en Jugadores. Si Jugadores no responde, la acción se descarta. */
  private async cobrar(jugadorId: JugadorId, cantidad: number, ronda: number): Promise<"ok" | CodigoError> {
    try {
      const r = await jugadoresGlobal(this.env).apostar(jugadorId, cantidad, this.rondaId(ronda));
      return r === "cantidad_invalida" ? "apuesta_invalida" : r;
    } catch (e) {
      console.error(e);
      return "no_disponible";
    }
  }

  /** Aplica lo que el reloj ya ha decidido (`tick`) y lo confirma si cambió algo. Devuelve si cambió. */
  private async alDia(ahora: number, excluir?: string): Promise<boolean> {
    const p = this.juego.tick(this.estado, ahora, this.rng);
    if (!p.ok || p.estado === this.estado) return false;
    await this.confirmar(p, ahora, excluir);
    return true;
  }

  /**
   * Hace efectivo un cambio: lo guarda (con la ronda a pagar, si cerró una), la paga, programa la alarma, envía a cada
   * conexión su vista con los eventos (salvo a `excluir`, que la recibe aparte) y avisa a la sala.
   */
  private async confirmar(p: PasoOk<E>, ahora: number, excluir?: string): Promise<void> {
    this.estado = p.estado;
    this.version += 1;
    const guardar: Record<string, unknown> = { [CLAVE_ESTADO]: this.estado, [CLAVE_VERSION]: this.version };
    if (p.liquidacion !== undefined) {
      const { ronda, filas } = p.liquidacion;
      this.pendientes = [...this.pendientes, { rondaId: this.rondaId(ronda), filas, momento: ahora }];
      guardar[CLAVE_PENDIENTES] = this.pendientes;
    }
    await this.ctx.storage.put(guardar);
    await this.liquidarPendientes();
    await this.programarAlarma(ahora);

    for (const conn of this.getConnections<EstadoConexion>()) {
      if (conn.id !== excluir && conn.state !== null) this.enviar(conn, this.mensajeEstado(conn.state.jugadorId, p.eventos));
    }
    await this.avisarSala(p.liquidacion !== undefined);
  }

  /** Paga en Jugadores las rondas pendientes (idempotente por `rondaId`); las que fallen quedan para el siguiente cambio. */
  private async liquidarPendientes(): Promise<void> {
    if (this.pendientes.length === 0) return;
    const restantes: Liquidacion[] = [];
    for (const liquidacion of this.pendientes) {
      if (!(await this.liquidar(liquidacion))) restantes.push(liquidacion);
    }
    if (restantes.length === this.pendientes.length) return;
    this.pendientes = restantes;
    await this.ctx.storage.put(CLAVE_PENDIENTES, restantes);
  }

  private async liquidar({ rondaId, filas, momento }: Liquidacion): Promise<boolean> {
    let ultimoError: unknown;
    for (let intento = 0; intento < INTENTOS_LIQUIDAR; intento++) {
      try {
        await jugadoresGlobal(this.env).liquidar({ rondaId, juego: this.juego.id, codigoPartida: this.name, filas }, momento);
        return true;
      } catch (e) {
        ultimoError = e;
      }
    }
    console.error(`No se pudo liquidar ${rondaId}:`, ultimoError);
    return false;
  }

  /** La alarma del juego; con pagos pendientes, como tarde un reintento. Sin nada que esperar, ninguna alarma. */
  private async programarAlarma(ahora: number): Promise<void> {
    const delJuego = this.juego.proximaAlarma(this.estado);
    const reintento = this.pendientes.length > 0 ? ahora + REINTENTO_LIQUIDAR_MS : null;
    const cuando = delJuego === null ? reintento : reintento === null ? delJuego : Math.min(delJuego, reintento);
    if (cuando === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(cuando);
  }

  /** Avisa a la sala del estado visible de la mesa. Si la sala falla se registra y la mesa sigue. */
  private async avisarSala(refrescarRanking: boolean): Promise<void> {
    try {
      // Stub directo: `getServerByName` escribiría en el almacenamiento de la sala en cada aviso.
      const sala = this.env.Partida.get(this.env.Partida.idFromName(this.name));
      await sala.actualizarMesa(this.juego.id, this.juego.resumen(this.estado), refrescarRanking);
    } catch (e) {
      console.error(e);
    }
  }

  /** Límite de mensajes por conexión y segundo. `false` si el mensaje se descarta. */
  private dentroDelLimite(conn: Connection): boolean {
    const segundo = Math.floor(this.ahora() / 1000);
    const previo = this.mensajes.get(conn.id);
    const cuenta = previo !== undefined && previo.segundo === segundo ? previo.cuenta + 1 : 1;
    this.mensajes.set(conn.id, { segundo, cuenta });
    if (cuenta <= MENSAJES_POR_SEGUNDO) return true;
    if (cuenta <= MENSAJES_HASTA_CIERRE) this.enviarError(conn, "demasiados_mensajes");
    else if (cuenta === MENSAJES_HASTA_CIERRE + 1) conn.close(CIERRE_DEMASIADOS_MENSAJES, "demasiados_mensajes");
    return false;
  }

  private tieneOtraConexion(jugadorId: JugadorId, excepto: string): boolean {
    for (const conn of this.getConnections<EstadoConexion>()) {
      if (conn.id !== excepto && conn.state?.jugadorId === jugadorId) return true;
    }
    return false;
  }

  /** Las tareas se ejecutan de una en una, en orden de llegada; un fallo se registra y no detiene a las siguientes. */
  private encolar(tarea: () => Promise<void>): Promise<void> {
    this.cola = this.cola.then(tarea).catch((e) => console.error(e));
    return this.cola;
  }

  private rondaId(ronda: number): string {
    return `${this.name}:${this.juego.id}:${ronda}`;
  }

  private mensajeEstado(jugadorId: JugadorId, eventos: Evento[]): MensajeMesa<unknown> {
    return { t: "estado", version: this.version, vista: this.juego.vista(this.estado, jugadorId), eventos };
  }

  private enviar(conn: Connection, mensaje: MensajeMesa<unknown>): void {
    try {
      conn.send(JSON.stringify(mensaje));
    } catch {
      // La conexión ya se cerró: al volver recibirá la vista completa.
    }
  }

  private enviarError(conn: Connection, codigo: CodigoError): void {
    this.enviar(conn, { t: "error", codigo });
  }
}
