import { type Connection, type ConnectionContext, Server, type WSMessage } from "partyserver";
import type { FilaRankingPartida, MensajeMesa } from "../shared/api";
import { rngCripto, type Rng } from "../shared/cartas";
import type { CodigoError, Evento, FilaLiquidacion, Juego, JugadorId, Paso } from "../shared/juegos/tipos";
import type { Env } from "./index";
import { type Jugadores, jugadoresGlobal } from "./jugadores";
import type { RondaLiquidada } from "./partida";

/** La única clave del almacenamiento: el registro de la mesa (`Registro`), que se escribe entero en cada cambio. */
const CLAVE_MESA = "mesa";

/** Mensajes por conexión en un mismo segundo: los que pasen de aquí se descartan con error… */
const MENSAJES_POR_SEGUNDO = 20;
/** …y si pasan de este otro, se cierra la conexión. */
const MENSAJES_HASTA_CIERRE = 60;
/** Intentos seguidos de pagar una ronda en Jugadores antes de dejarla pendiente para más tarde. */
const INTENTOS_LIQUIDAR = 3;
/** Con una ronda sin pagar o un cobro a medias, la mesa se despierta para reintentarlo aunque el juego no tenga nada que hacer. */
const REINTENTO_MS = 60_000;
/** Fallos inesperados seguidos (no se puede guardar, Jugadores no responde) a partir de los cuales se avisa de que La Timba descansa. */
const FALLOS_PARA_DESCANSAR = 3;

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

/**
 * Cobro pedido a Jugadores cuya jugada aún no se ha guardado. Se guarda antes de pedirlo y se borra en la misma escritura
 * que guarda la jugada; si queda alguno (la instancia cayó o Jugadores no contestó), se anula con su `cobroId`.
 */
interface Cobro {
  cobroId: string;
  jugadorId: JugadorId;
  cantidad: number;
  rondaId: string;
}

/** Lo que la mesa guarda, en una sola clave: así cada cambio es una sola fila escrita. */
interface Registro<E> {
  estado: E;
  pendientes: Liquidacion[];
  cobro: Cobro | null;
}

type PasoOk<E> = Extract<Paso<E>, { ok: true }>;

/** Para los manejadores de WebSocket: la cola ya registró el fallo y partyserver no debe ver un rechazo. */
const ignorar = (): void => {};

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
 * - Las fichas se cobran en dos fases (`cobrar`): primero se guarda la intención, luego se cobra en Jugadores y la
 *   intención se borra al guardar la jugada. Un cobro que quede a medias se anula, así que nunca se pierden fichas.
 * - Cada cambio se confirma (`confirmar`): se guarda, se paga en Jugadores si cerró una ronda, se envía a cada conexión
 *   su vista, se programa la alarma y se avisa a la sala.
 *
 * Hiberna: lo necesario vive en el almacenamiento (el registro `{ estado, pendientes, cobro }` en una sola clave) o en el
 * estado de cada conexión; los campos de la instancia son copias que `onStart` vuelve a cargar. Lo demás (la versión, la
 * hora de la alarma, el último resumen de la sala, los avisos) vive en memoria y se rehace al despertar.
 */
export abstract class Mesa<E extends { ronda: number }, A extends { t: string }> extends Server<Env> {
  static options = { hibernate: true };

  protected abstract juego: Juego<E, A>;
  /** Persistido en el registro de la mesa. */
  estado!: E;
  /** Reloj de la mesa. Los tests lo sustituyen; al hibernar vuelve a `Date.now`. */
  ahora: () => number = () => Date.now();
  rng: Rng = rngCripto();
  /** Pone un temporizador en memoria (los avisos del reloj) y devuelve cómo quitarlo. Los tests lo sustituyen. */
  temporizar: (tarea: () => void, ms: number) => () => void = (tarea, ms) => {
    const id = setTimeout(tarea, ms);
    return () => clearTimeout(id);
  };

  /** Crece con cada mensaje de estado. Solo en memoria: los clientes no la usan para nada más que validar el mensaje. */
  private version = 0;
  /** Rondas cerradas aún sin pagar; persistidas en el registro y reintentadas en cada cambio. */
  private pendientes: Liquidacion[] = [];
  /** Cobro en curso o a medias; persistido en el registro. Como mucho uno: la cola atiende las acciones de una en una. */
  private cobro: Cobro | null = null;
  /** La hora de la alarma programada (`null` si no hay): solo se vuelve a programar si cambia. Se lee en `onStart`. */
  private alarmaEn: number | null = null;
  /** El último resumen que aceptó la sala (en JSON): no se le vuelve a mandar si no cambia. `null` al despertar. */
  private resumenEnSala: string | null = null;
  /** Rondas pagadas cuyos netos aún no ha recibido la sala (ranking de la noche). Solo en memoria. */
  private rondasPorAvisar: RondaLiquidada[] = [];
  /** Tareas de una conexión seguidas que han fallado de forma inesperada. Solo en memoria. */
  private fallosSeguidos = 0;
  private cola: Promise<void> = Promise.resolve();
  /** Mensajes de cada conexión (por id) en el segundo en curso del reloj de la mesa. Solo en memoria: hibernar lo reinicia. */
  private mensajes = new Map<string, { segundo: number; cuenta: number }>();
  /**
   * Jugadores cuyo cierre ya se atendió y que no han vuelto a conectar: si dos pestañas se cierran a la vez, la segunda
   * no repite `desconectar`. Solo en memoria: tras hibernar, como mucho se repetiría un `desconectar` sin efecto.
   */
  private desconectados = new Set<JugadorId>();
  /**
   * Hasta qué instante se han enseñado ya los cambios que trae el reloj (`Juego.proximoAviso`). Solo en memoria: al
   * despertar se sigue desde la hora (quien vuelva a conectar recibe la vista de ese momento).
   */
  private avisadoHasta = 0;
  /** El temporizador del siguiente aviso: su instante y cómo quitarlo. */
  private aviso: { cuando: number; quitar: () => void } | null = null;

  async onStart(): Promise<void> {
    const [guardado, alarma] = await Promise.all([this.ctx.storage.get<Registro<E>>(CLAVE_MESA), this.ctx.storage.getAlarm()]);
    this.alarmaEn = alarma;
    if (guardado !== undefined) {
      ({ estado: this.estado, pendientes: this.pendientes, cobro: this.cobro } = guardado);
      // Una mesa guardada por una versión anterior de las reglas se pone al día solo en memoria, sin escribir: la siguiente
      // jugada, que ya escribe el registro, lo guarda normalizado.
      if (this.juego.normalizar !== undefined) this.estado = this.juego.normalizar(this.estado);
    } else {
      this.estado = this.juego.crear(this.ahora(), this.rng);
      await this.guardar();
    }
    this.avisadoHasta = this.ahora();
    this.programarAviso(this.avisadoHasta);
    // Un cobro guardado al arrancar es de una instancia que cayó antes de guardar su jugada: se anula lo primero, antes
    // que el evento que nos ha despertado (va delante en la cola y no hace esperar a `onStart`).
    if (this.cobro !== null) {
      this.encolar(async () => {
        await this.anularCobro();
      }).catch(ignorar);
    }
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

    return this.encolar(() => this.atenderA(conn, () => this.recibir(conn, yo))).catch(ignorar);
  }

  /** Quien llega: se pone al día la mesa, se le sienta (o se le cierra si no cabe) y recibe la vista completa. */
  private async recibir(conn: Connection<EstadoConexion>, yo: EstadoConexion): Promise<void> {
    const ahora = this.ahora();
    this.desconectados.delete(yo.jugadorId);
    // Quien llega recibe la vista completa al final, sin los eventos de lo que pasó antes de llegar.
    await this.alDia(ahora, conn.id);
    const p = this.juego.sentar(this.estado, yo.jugadorId, yo.apodo, ahora);
    if (!p.ok) {
      this.enviar(conn, { t: "error", codigo: p.error });
      conn.close(CIERRE_SIN_ASIENTO, p.error);
      return;
    }
    if (p.estado !== this.estado) await this.confirmar(p, ahora, { excluir: conn.id });
    this.enviar(conn, this.mensajeEstado(yo.jugadorId, []));
  }

  onMessage(conn: Connection<EstadoConexion>, mensaje: WSMessage): Promise<void> | void {
    if (!this.dentroDelLimite(conn)) return;
    return this.encolar(() => this.atenderA(conn, () => this.atender(conn, mensaje))).catch(ignorar);
  }

  /**
   * Hace la tarea de una conexión. Si falla de forma inesperada (no se puede guardar porque se agotó la cuota, Jugadores
   * no responde…), se lo dice a esa conexión en vez de dejarla esperando: `no_disponible` y, si los fallos siguen,
   * `descansando`. La tarea sigue rechazando para que la cola lo registre.
   */
  private async atenderA(conn: Connection, tarea: () => Promise<void>): Promise<void> {
    try {
      await tarea();
      this.fallosSeguidos = 0;
    } catch (e) {
      this.fallosSeguidos += 1;
      this.enviarError(conn, this.fallosSeguidos >= FALLOS_PARA_DESCANSAR ? "descansando" : "no_disponible");
      throw e;
    }
  }

  onClose(conn: Connection<EstadoConexion>): Promise<void> | void {
    this.mensajes.delete(conn.id);
    const yo = conn.state;
    if (yo === null) return;

    return this.encolar(async () => {
      // Con otra pestaña abierta el jugador sigue en la mesa: cerrar una no lo desconecta. Y si ya se atendió el cierre
      // de otra pestaña suya (se cerraron a la vez), no se repite.
      if (this.tieneOtraConexion(yo.jugadorId, conn.id) || this.desconectados.has(yo.jugadorId)) return;
      const ahora = this.ahora();
      await this.alDia(ahora);
      const p = this.juego.desconectar(this.estado, yo.jugadorId, ahora, this.rng);
      this.desconectados.add(yo.jugadorId);
      if (p.ok && p.estado !== this.estado) await this.confirmar(p, ahora);
    }).catch(ignorar);
  }

  /** Si la tarea falla, la promesa rechaza para que el runtime reintente la alarma (la cola sigue atendiendo). */
  onAlarm(): Promise<void> {
    // La alarma que salta ya no está programada.
    this.alarmaEn = null;
    return this.encolar(async () => {
      const ahora = this.ahora();
      await this.anularCobro();
      if (await this.alDia(ahora)) return;
      // Nada que hacer en el juego (alarma adelantada, o solo para reintentar): reintentar pagos y volver a programar.
      await this.liquidarPendientes();
      await this.avisarSala();
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
    // Una acción sin efecto no se guarda ni se cobra.
    if (p.estado === estado) return;
    // El coste se mide sobre el estado anterior a la acción (al doblar cuesta la apuesta original).
    const costo = this.juego.costo(estado, yo.jugadorId, accion);
    if (costo === 0) return this.confirmar(p, ahora);

    const cobro = await this.cobrar(yo.jugadorId, costo, estado.ronda, ahora);
    if (cobro !== "ok") return this.enviarError(conn, cobro);
    await this.confirmar(p, ahora, { cerrarCobro: true });
  }

  /**
   * Primera fase del cobro: guarda la intención y cobra en Jugadores con su `cobroId`. Si devuelve "ok", la intención
   * sigue guardada y la borra `confirmar` al guardar la jugada. Si Jugadores no contesta, se anula (devuelve las fichas
   * si llegó a cobrar) y la acción se descarta.
   */
  private async cobrar(jugadorId: JugadorId, cantidad: number, ronda: number, ahora: number): Promise<"ok" | CodigoError> {
    // Solo cabe un cobro: si quedó uno a medias, se anula antes de pedir otro.
    if (!(await this.anularCobro())) return "no_disponible";

    const cobro: Cobro = { cobroId: crypto.randomUUID(), jugadorId, cantidad, rondaId: this.rondaId(ronda) };
    await this.guardar({ cobro });
    // Si la instancia cae a partir de aquí, una alarma (como tarde en `REINTENTO_MS`) anula el cobro.
    await this.programarAlarma(ahora);

    let respuesta: Awaited<ReturnType<Jugadores["apostar"]>>;
    try {
      respuesta = await jugadoresGlobal(this.env).apostar(jugadorId, cantidad, cobro.rondaId, cobro.cobroId);
    } catch (e) {
      console.error(e);
      await this.anularCobro();
      return "no_disponible";
    }
    if (respuesta === "ok") return "ok";
    await this.olvidarCobro(ahora);
    if (respuesta === "sin_fichas") return "sin_fichas";
    return respuesta === "anulado" ? "no_disponible" : "apuesta_invalida";
  }

  /**
   * Anula en Jugadores el cobro a medias, si lo hay (idempotente: devuelve las fichas solo si llegó a cobrarlas).
   * `true` si ya no queda ninguno; si Jugadores no responde, se conserva y la alarma lo reintenta.
   */
  private async anularCobro(): Promise<boolean> {
    const cobro = this.cobro;
    if (cobro === null) return true;
    try {
      await jugadoresGlobal(this.env).anular(cobro.cobroId);
    } catch (e) {
      console.error(`No se pudo anular el cobro ${cobro.cobroId}:`, e);
      await this.programarAlarma(this.ahora());
      return false;
    }
    await this.olvidarCobro(this.ahora());
    return true;
  }

  /** Borra el cobro en curso (ya resuelto) y quita su alarma de reintento si no hace falta. */
  private async olvidarCobro(ahora: number): Promise<void> {
    await this.guardar({ cobro: null });
    await this.programarAlarma(ahora);
  }

  /**
   * Aplica lo que el reloj ya ha decidido: primero anuncia lo que ha vencido sin cambiar el estado (`avisar`) y después
   * el `tick`, que se confirma si cambió algo. Devuelve si cambió.
   */
  private async alDia(ahora: number, excluir?: string): Promise<boolean> {
    this.avisar(ahora, excluir);
    const p = this.juego.tick(this.estado, ahora, this.rng);
    if (!p.ok || p.estado === this.estado) {
      this.programarAviso(ahora);
      return false;
    }
    await this.confirmar(p, ahora, { excluir });
    return true;
  }

  /**
   * Envía, un mensaje por cada uno y en orden, los cambios que el reloj ha traído hasta `ahora` sin cambiar el estado
   * (los pasos de la carrera): cada conexión recibe la vista de ese instante con sus eventos. No guarda nada.
   */
  private avisar(ahora: number, excluir?: string): void {
    for (;;) {
      const momento = this.juego.proximoAviso?.(this.estado, this.avisadoHasta) ?? null;
      if (momento === null || momento > ahora) return;
      const eventos = this.juego.eventosEntre?.(this.estado, this.avisadoHasta, momento) ?? [];
      this.avisadoHasta = momento;
      this.difundir(eventos, momento, excluir);
    }
  }

  /**
   * Deja programado el temporizador del siguiente aviso (o ninguno). Vive en memoria: si la instancia cae, la alarma
   * del juego sigue en pie y, al despertar, se vuelve a programar desde la hora.
   */
  private programarAviso(ahora: number): void {
    const cuando = this.juego.proximoAviso?.(this.estado, this.avisadoHasta) ?? null;
    if (this.aviso?.cuando === cuando) return;
    this.aviso?.quitar();
    this.aviso = null;
    if (cuando === null) return;
    const quitar = this.temporizar(() => {
      this.aviso = null;
      this.encolar(async () => {
        // Si el temporizador se adelanta al reloj de la mesa, no hay nada que anunciar y se vuelve a programar.
        const ahora = this.ahora();
        this.avisar(ahora);
        this.programarAviso(ahora);
      }).catch(ignorar);
    }, Math.max(0, cuando - ahora));
    this.aviso = { cuando, quitar };
  }

  /**
   * Hace efectivo un cambio: lo guarda (con la ronda a pagar, si cerró una, y borrando el cobro de la jugada si
   * `cerrarCobro`, todo en una sola escritura), paga lo pendiente, programa la alarma, envía a cada conexión su vista con
   * los eventos (salvo a `excluir`, que la recibe aparte) y avisa a la sala.
   */
  private async confirmar(
    p: PasoOk<E>,
    ahora: number,
    { excluir, cerrarCobro = false }: { excluir?: string; cerrarCobro?: boolean } = {},
  ): Promise<void> {
    const cambios: Partial<Registro<E>> = { estado: p.estado };
    if (p.liquidacion !== undefined) {
      const { ronda, filas } = p.liquidacion;
      cambios.pendientes = [...this.pendientes, { rondaId: this.rondaId(ronda), filas, momento: ahora }];
    }
    if (cerrarCobro) cambios.cobro = null;
    await this.guardar(cambios);
    await this.liquidarPendientes();
    await this.programarAlarma(ahora);

    // La vista nueva enseña todo lo vencido hasta `ahora`: los avisos siguen desde aquí.
    this.avisadoHasta = Math.max(this.avisadoHasta, ahora);
    this.difundir(p.eventos, ahora, excluir);
    this.programarAviso(ahora);
    await this.avisarSala();
  }

  /** Envía a cada conexión (salvo a `excluir`) su vista en el instante `momento` con `eventos`. */
  private difundir(eventos: Evento[], momento: number, excluir?: string): void {
    this.version += 1;
    for (const conn of this.getConnections<EstadoConexion>()) {
      if (conn.id !== excluir && conn.state !== null) this.enviar(conn, this.mensajeEstado(conn.state.jugadorId, eventos, momento));
    }
  }

  /**
   * Paga en Jugadores las rondas pendientes (idempotente por `rondaId`); las que fallen quedan para el siguiente cambio.
   * Los netos de las que se pagan quedan para el siguiente aviso a la sala (el ranking de la noche).
   */
  private async liquidarPendientes(): Promise<void> {
    if (this.pendientes.length === 0) return;
    // Liquidar borra todas las apuestas pendientes de la ronda: un cobro a medias se anula antes, o sus fichas se
    // perderían. (El cobro de una jugada recién guardada ya no cuenta: `confirmar` lo cierra antes de llegar aquí.)
    if (this.cobro !== null && !(await this.anularCobro())) return;
    const restantes: Liquidacion[] = [];
    for (const liquidacion of this.pendientes) {
      const netos = await this.liquidar(liquidacion);
      if (netos === null) restantes.push(liquidacion);
      else this.rondasPorAvisar.push({ rondaId: liquidacion.rondaId, netos });
    }
    if (restantes.length < this.pendientes.length) await this.guardar({ pendientes: restantes });
  }

  /** Paga una ronda en Jugadores (con reintentos) y devuelve el neto de cada jugador; `null` si no se pudo. */
  private async liquidar({ rondaId, filas, momento }: Liquidacion): Promise<FilaRankingPartida[] | null> {
    let ultimoError: unknown;
    for (let intento = 0; intento < INTENTOS_LIQUIDAR; intento++) {
      try {
        const netos = await jugadoresGlobal(this.env).liquidar({ rondaId, juego: this.juego.id, codigoPartida: this.name, filas }, momento);
        if (netos !== "filas_invalidas") return netos;
        ultimoError = new TypeError(`Jugadores rechaza las filas de la liquidación: ${JSON.stringify(filas)}`);
        break;
      } catch (e) {
        ultimoError = e;
      }
    }
    console.error(`No se pudo liquidar ${rondaId}:`, ultimoError);
    return null;
  }

  /** La alarma del juego; con pagos pendientes o un cobro a medias, como tarde un reintento. Sin nada que esperar, ninguna. */
  private async programarAlarma(ahora: number): Promise<void> {
    const delJuego = this.juego.proximaAlarma(this.estado);
    const reintento = this.pendientes.length > 0 || this.cobro !== null ? ahora + REINTENTO_MS : null;
    const cuando = delJuego === null ? reintento : reintento === null ? delJuego : Math.min(delJuego, reintento);
    // Cada `setAlarm`/`deleteAlarm` es una fila escrita: si la hora no cambia, no se toca.
    if (cuando === this.alarmaEn) return;
    if (cuando === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(cuando);
    this.alarmaEn = cuando;
  }

  /**
   * Avisa a la sala del estado visible de la mesa y de las rondas pagadas desde el último aviso, solo si hay algo nuevo
   * desde lo último que aceptó: cada aviso es una petición y una escritura en la sala. Si la sala falla se registra, la
   * mesa sigue y el siguiente cambio lo vuelve a intentar (las rondas también: la sala no suma dos veces la misma).
   */
  private async avisarSala(): Promise<void> {
    const resumen = this.juego.resumen(this.estado);
    const clave = JSON.stringify(resumen);
    const rondas = this.rondasPorAvisar;
    if (clave === this.resumenEnSala && rondas.length === 0) return;
    try {
      // Stub directo: `getServerByName` escribiría en el almacenamiento de la sala en cada aviso.
      const sala = this.env.Partida.get(this.env.Partida.idFromName(this.name));
      await sala.actualizarMesa(this.juego.id, resumen, rondas);
      this.resumenEnSala = clave;
      this.rondasPorAvisar = this.rondasPorAvisar.filter((r) => !rondas.includes(r));
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

  /**
   * Pone la tarea en la cola: empieza cuando acaben las anteriores, en orden de llegada. Un fallo se registra y no
   * detiene la cola; la promesa devuelta sí rechaza con él.
   */
  private encolar(tarea: () => Promise<void>): Promise<void> {
    const turno = this.cola.then(tarea);
    this.cola = turno.catch((e) => console.error(e));
    return turno;
  }

  /**
   * Guarda el registro de la mesa (una sola clave, una fila escrita) con `cambios` sobre lo que hay en memoria y, ya
   * guardado, lo aplica en memoria: si la escritura falla, la memoria sigue igual que el almacenamiento.
   */
  private async guardar(cambios: Partial<Registro<E>> = {}): Promise<void> {
    const registro: Registro<E> = { estado: this.estado, pendientes: this.pendientes, cobro: this.cobro, ...cambios };
    await this.ctx.storage.put(CLAVE_MESA, registro);
    ({ estado: this.estado, pendientes: this.pendientes, cobro: this.cobro } = registro);
  }

  private rondaId(ronda: number): string {
    return `${this.name}:${this.juego.id}:${ronda}`;
  }

  /** El mensaje de estado para `jugadorId`: su vista en el instante `momento` (por defecto, ahora) y `eventos`. */
  private mensajeEstado(jugadorId: JugadorId, eventos: Evento[], momento = this.ahora()): MensajeMesa<unknown> {
    return { t: "estado", version: this.version, ahora: this.ahora(), vista: this.juego.vista(this.estado, jugadorId, momento), eventos };
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
