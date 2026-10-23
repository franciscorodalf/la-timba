import { DurableObject } from "cloudflare:workers";
import { type FilaRanking, type FilaRankingPartida, type JugadorPublico, type OrdenRanking, PARTIDAS_MINIMAS_VICTORIAS, type Perfil } from "../shared/api";
import type { FilaLiquidacion, IdJuego } from "../shared/juegos/tipos";
import { apodoValido, hashPin, pinValido, verificarPin } from "./auth";
import type { Env } from "./index";

const FICHAS_INICIALES = 1000;
const FICHAS_RESCATE = 200;
const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const TAMANO_TOP = 50;

const ESQUEMA = [
  // Las estadísticas van en la fila de cada jugador y se ponen al día al liquidar: el perfil y los rankings leen una fila
  // por jugador, nunca el historial de `resultados`.
  `CREATE TABLE IF NOT EXISTS jugadores (
    id INTEGER PRIMARY KEY,
    apodo TEXT UNIQUE COLLATE NOCASE,
    pin_hash TEXT, pin_sal TEXT,
    fichas INTEGER DEFAULT ${FICHAS_INICIALES},
    quiebras INTEGER DEFAULT 0,
    racha_actual INTEGER DEFAULT 0,
    mejor_racha INTEGER DEFAULT 0,
    partidas INTEGER DEFAULT 0,
    victorias INTEGER DEFAULT 0,
    ganancias INTEGER DEFAULT 0,
    mayor_premio INTEGER DEFAULT 0,
    partidas_blackjack INTEGER DEFAULT 0,
    victorias_blackjack INTEGER DEFAULT 0,
    partidas_carrera INTEGER DEFAULT 0,
    victorias_carrera INTEGER DEFAULT 0,
    creado_en INTEGER
  )`,
  // El historial: una fila por jugador y ronda. Nada lo lee durante el juego, así que no lleva índices.
  `CREATE TABLE IF NOT EXISTS resultados (
    id INTEGER PRIMARY KEY,
    jugador_id INTEGER, juego TEXT, codigo_partida TEXT, ronda_id TEXT,
    apuesta INTEGER, neto INTEGER,
    resultado TEXT,
    momento INTEGER
  )`,
  // Varias filas por (ronda, jugador): la carrera cobra varias apuestas del mismo jugador en la misma ronda. Cada cobro
  // lleva su clave de idempotencia (`cobro_id`), con la que se puede repetir o anular. Las tablas que se buscan por su
  // clave van `WITHOUT ROWID`: cada fila es una sola fila escrita, sin un índice aparte.
  "CREATE TABLE IF NOT EXISTS apuestas_pendientes (cobro_id TEXT PRIMARY KEY, ronda_id TEXT, jugador_id INTEGER, cantidad INTEGER) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS rondas_liquidadas (ronda_id TEXT PRIMARY KEY) WITHOUT ROWID",
  // Cobros anulados: un `apostar` que llegue después con esa clave ya no cobra.
  "CREATE TABLE IF NOT EXISTS cobros_anulados (cobro_id TEXT PRIMARY KEY) WITHOUT ROWID",
  "CREATE TABLE IF NOT EXISTS intentos (apodo TEXT PRIMARY KEY COLLATE NOCASE, fallos INTEGER, bloqueado_hasta INTEGER)",
];

/** Una consulta por orden que devuelve (id, apodo, valor) solo de los jugadores que clasifican en él. Todas leen solo `jugadores`. */
const ORIGEN_RANKING: Record<OrdenRanking, string> = {
  fichas: "SELECT id, apodo, fichas AS valor FROM jugadores",
  ganancias: "SELECT id, apodo, ganancias AS valor FROM jugadores",
  victorias: `SELECT id, apodo, CAST(ROUND(100.0 * victorias / partidas) AS INTEGER) AS valor FROM jugadores WHERE partidas >= ${PARTIDAS_MINIMAS_VICTORIAS}`,
  // Solo quien ha ganado alguna ronda: el mayor premio es el mayor neto positivo.
  premio: "SELECT id, apodo, mayor_premio AS valor FROM jugadores WHERE mayor_premio > 0",
  racha: "SELECT id, apodo, mejor_racha AS valor FROM jugadores",
  quiebras: "SELECT id, apodo, quiebras AS valor FROM jugadores",
};

type FilaJugador = { id: number; apodo: string; fichas: number };

type FilaPerfil = FilaJugador & {
  quiebras: number;
  racha_actual: number;
  mejor_racha: number;
  partidas: number;
  victorias: number;
  ganancias: number;
  mayor_premio: number;
  partidas_blackjack: number;
  victorias_blackjack: number;
  partidas_carrera: number;
  victorias_carrera: number;
};

type ResultadoEntrar =
  | { ok: true; jugador: JugadorPublico }
  | { ok: false; error: "no_existe" }
  | { ok: false; error: "pin"; intentosRestantes: number }
  | { ok: false; error: "bloqueado"; hasta: number };

function leerIntentos(sql: SqlStorage, apodo: string): { fallos: number; bloqueadoHasta: number } {
  const fila = sql.exec<{ fallos: number; bloqueado_hasta: number }>("SELECT fallos, bloqueado_hasta FROM intentos WHERE apodo = ?", apodo).toArray()[0];
  return { fallos: fila?.fallos ?? 0, bloqueadoHasta: fila?.bloqueado_hasta ?? 0 };
}

function guardarIntentos(sql: SqlStorage, apodo: string, fallos: number, bloqueadoHasta: number): void {
  sql.exec(
    `INSERT INTO intentos (apodo, fallos, bloqueado_hasta) VALUES (?, ?, ?)
     ON CONFLICT(apodo) DO UPDATE SET fallos = excluded.fallos, bloqueado_hasta = excluded.bloqueado_hasta`,
    apodo,
    fallos,
    bloqueadoHasta,
  );
}

/**
 * Anota un PIN incorrecto. Solo se llama desde `intentarEntrar`, que `entrar` serializa: nadie ha tocado los
 * intentos desde la comprobación del bloqueo. Al llegar al 5º fallo se bloquea y el contador vuelve a 0, de modo
 * que al vencer el bloqueo no hay que limpiar nada.
 */
function registrarFallo(sql: SqlStorage, apodo: string, ahora: number) {
  const previo = leerIntentos(sql, apodo);
  const fallos = previo.fallos + 1;
  if (fallos >= MAX_FALLOS) {
    const hasta = ahora + BLOQUEO_MS;
    guardarIntentos(sql, apodo, 0, hasta);
    return { ok: false, error: "bloqueado", hasta } as const;
  }
  guardarIntentos(sql, apodo, fallos, previo.bloqueadoHasta);
  return { ok: false, error: "pin", intentosRestantes: MAX_FALLOS - fallos } as const;
}

/**
 * Una entrada completa: bloqueo, verificación del PIN y registro del resultado. Con un `await` en medio (PBKDF2),
 * solo es correcta si no se solapa con otra entrada: ver `Jugadores.entrar`.
 */
async function intentarEntrar(sql: SqlStorage, apodo: string, pin: string, ahora: number): Promise<ResultadoEntrar> {
  const fila = sql
    .exec<FilaJugador & { pin_hash: string; pin_sal: string }>("SELECT id, apodo, fichas, pin_hash, pin_sal FROM jugadores WHERE apodo = ?", apodo)
    .toArray()[0];
  if (fila === undefined) return { ok: false, error: "no_existe" };

  // El bloqueo se comprueba antes de derivar el PIN: PBKDF2 es CPU pura y no debe poder forzarse durante el bloqueo.
  const { bloqueadoHasta } = leerIntentos(sql, fila.apodo);
  if (ahora < bloqueadoHasta) return { ok: false, error: "bloqueado", hasta: bloqueadoHasta };

  if (await verificarPin(pin, fila.pin_hash, fila.pin_sal)) {
    sql.exec("UPDATE intentos SET fallos = 0 WHERE apodo = ?", fila.apodo);
    return { ok: true, jugador: { id: fila.id, apodo: fila.apodo, fichas: fila.fichas } };
  }
  return registrarFallo(sql, fila.apodo, ahora);
}

/** El Durable Object `Jugadores`: una única instancia global. */
export const jugadoresGlobal = (env: Env) => env.Jugadores.get(env.Jugadores.idFromName("global"));

/** Jugadores, fichas, estadísticas y rankings. Una única instancia global (`jugadoresGlobal`). */
export class Jugadores extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  /**
   * Cola en memoria de `entrar`. Los RPC de un Durable Object se entrelazan en los `await` que no son de
   * almacenamiento (PBKDF2): sin cola, una ráfaga de PIN distintos pasaría todos el chequeo del bloqueo antes de
   * que ningún fallo lo activara, y un acierto dentro de la ráfaga entraría pese al bloqueo. Nunca rechaza (ver `entrar`).
   */
  private colaEntrar: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    void ctx.blockConcurrencyWhile(async () => {
      for (const sentencia of ESQUEMA) this.sql.exec(sentencia);
    });
  }

  async registrar(
    apodo: string,
    pin: string,
    ahora: number,
  ): Promise<{ ok: true; jugador: JugadorPublico } | { ok: false; error: "apodo_invalido" | "pin_invalido" | "apodo_ocupado" }> {
    if (!apodoValido(apodo)) return { ok: false, error: "apodo_invalido" };
    if (!pinValido(pin)) return { ok: false, error: "pin_invalido" };

    const { hash, sal } = await hashPin(pin);
    // Tras el `await` no hay más esperas: el INSERT decide de forma atómica quién se queda con el apodo (único sin mayúsculas).
    const fila = this.sql
      .exec<FilaJugador>(
        "INSERT INTO jugadores (apodo, pin_hash, pin_sal, creado_en) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id, apodo, fichas",
        apodo,
        hash,
        sal,
        ahora,
      )
      .toArray()[0];
    return fila === undefined ? { ok: false, error: "apodo_ocupado" } : { ok: true, jugador: fila };
  }

  /** Las entradas se ejecutan de una en una, en orden de llegada; un fallo inesperado de una no detiene a las siguientes. */
  async entrar(apodo: string, pin: string, ahora: number): Promise<ResultadoEntrar> {
    const turno = this.colaEntrar.then(() => intentarEntrar(this.sql, apodo, pin, ahora));
    this.colaEntrar = turno.catch(() => undefined);
    return turno;
  }

  /** Las fichas del jugador (una sola fila leída), o `null` si no existe. */
  async fichas(jugadorId: number): Promise<number | null> {
    return this.sql.exec<{ fichas: number }>("SELECT fichas FROM jugadores WHERE id = ?", jugadorId).toArray()[0]?.fichas ?? null;
  }

  /** El perfil con sus estadísticas: una sola fila leída, la del jugador. */
  async perfil(jugadorId: number): Promise<Perfil | null> {
    const j = this.sql.exec<FilaPerfil>("SELECT * FROM jugadores WHERE id = ?", jugadorId).toArray()[0];
    if (j === undefined) return null;
    return {
      id: j.id,
      apodo: j.apodo,
      fichas: j.fichas,
      quiebras: j.quiebras,
      rachaActual: j.racha_actual,
      mejorRacha: j.mejor_racha,
      partidas: j.partidas,
      gananciasTotales: j.ganancias,
      mayorPremio: j.mayor_premio,
      porJuego: {
        blackjack: { partidas: j.partidas_blackjack, victorias: j.victorias_blackjack },
        carrera: { partidas: j.partidas_carrera, victorias: j.victorias_carrera },
      },
    };
  }

  /**
   * Cobra `cantidad` y la deja pendiente hasta `liquidar`. Los límites de cada mesa los aplican las reglas del juego, no aquí.
   * `cobroId` hace el cobro idempotente: repetirlo devuelve "ok" sin cobrar otra vez, y si ya se anuló devuelve "anulado".
   * También devuelve "anulado", sin cobrar, si la ronda ya se liquidó: ese cobro no se pagaría nunca.
   */
  async apostar(
    jugadorId: number,
    cantidad: number,
    rondaId: string,
    cobroId: string,
  ): Promise<"ok" | "sin_fichas" | "cantidad_invalida" | "anulado"> {
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) return "cantidad_invalida";

    return this.ctx.storage.transactionSync(() => {
      if (this.sql.exec("SELECT 1 FROM apuestas_pendientes WHERE cobro_id = ?", cobroId).toArray().length > 0) return "ok";
      if (this.sql.exec("SELECT 1 FROM cobros_anulados WHERE cobro_id = ?", cobroId).toArray().length > 0) return "anulado";
      if (this.sql.exec("SELECT 1 FROM rondas_liquidadas WHERE ronda_id = ?", rondaId).toArray().length > 0) return "anulado";
      const fila = this.sql.exec<{ fichas: number }>("SELECT fichas FROM jugadores WHERE id = ?", jugadorId).toArray()[0];
      if (fila === undefined || fila.fichas < cantidad) return "sin_fichas";
      this.sql.exec("UPDATE jugadores SET fichas = fichas - ? WHERE id = ?", cantidad, jugadorId);
      this.sql.exec("INSERT INTO apuestas_pendientes (cobro_id, ronda_id, jugador_id, cantidad) VALUES (?, ?, ?, ?)", cobroId, rondaId, jugadorId, cantidad);
      return "ok";
    });
  }

  /**
   * Deshace un cobro que la mesa no llegó a anotar: si sigue pendiente, devuelve las fichas y borra la fila. Siempre lo
   * marca como anulado, para que un `apostar` con esa clave que llegue tarde no cobre. Idempotente; tras `liquidar` la
   * fila ya no existe y no devuelve nada.
   */
  async anular(cobroId: string): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      const fila = this.sql
        .exec<{ jugador_id: number; cantidad: number }>("SELECT jugador_id, cantidad FROM apuestas_pendientes WHERE cobro_id = ?", cobroId)
        .toArray()[0];
      if (fila !== undefined) {
        this.sql.exec("UPDATE jugadores SET fichas = fichas + ? WHERE id = ?", fila.cantidad, fila.jugador_id);
        this.sql.exec("DELETE FROM apuestas_pendientes WHERE cobro_id = ?", cobroId);
      }
      this.sql.exec("INSERT INTO cobros_anulados (cobro_id) VALUES (?) ON CONFLICT DO NOTHING", cobroId);
    });
  }

  /**
   * Cierra una ronda: paga, anota resultados, rachas y estadísticas, y borra todas las apuestas pendientes de `rondaId`.
   * Idempotente por `rondaId` (y un `apostar` que llegue tarde para esa ronda devuelve "anulado"). Por jugador, una sola
   * actualización y su fila de resultados. Devuelve el neto de cada jugador con su apodo (para el ranking de la noche),
   * también al repetirla. Lanza, sin tocar nada, si alguna fila no son enteros seguros (apuesta y pago ≥ 0).
   */
  async liquidar(
    l: { rondaId: string; juego: IdJuego; codigoPartida: string; filas: FilaLiquidacion[] },
    ahora: number,
  ): Promise<FilaRankingPartida[]> {
    for (const fila of l.filas) {
      const { jugadorId, apuesta, pago } = fila;
      if (![jugadorId, apuesta, pago].every(Number.isSafeInteger) || apuesta < 0 || pago < 0) {
        throw new TypeError(`Fila de liquidación no válida en ${l.rondaId}: ${JSON.stringify(fila)}`);
      }
    }
    return this.ctx.storage.transactionSync(() => {
      const nueva = this.sql.exec("INSERT INTO rondas_liquidadas (ronda_id) VALUES (?) ON CONFLICT DO NOTHING RETURNING ronda_id", l.rondaId).toArray();
      if (nueva.length === 0) {
        // Ya estaba liquidada: no se toca nada, pero se devuelven los netos, por si la respuesta anterior se perdió.
        return l.filas.flatMap(({ jugadorId, apuesta, pago }) => {
          const fila = this.sql.exec<{ apodo: string }>("SELECT apodo FROM jugadores WHERE id = ?", jugadorId).toArray()[0];
          return fila === undefined ? [] : [{ apodo: fila.apodo, neto: pago - apuesta }];
        });
      }

      const netos: FilaRankingPartida[] = [];
      for (const { jugadorId, apuesta, pago } of l.filas) {
        const neto = pago - apuesta;
        const resultado = neto > 0 ? "gana" : neto < 0 ? "pierde" : "empata";
        const gana = resultado === "gana" ? 1 : 0;
        const blackjack = l.juego === "blackjack" ? 1 : 0;
        // En un UPDATE de SQLite todas las expresiones ven los valores anteriores de la fila. Empatar no toca la racha.
        const fila = this.sql
          .exec<{ apodo: string }>(
            `UPDATE jugadores SET
               fichas = fichas + ?,
               racha_actual = CASE ? WHEN 'gana' THEN racha_actual + 1 WHEN 'pierde' THEN 0 ELSE racha_actual END,
               mejor_racha = CASE ? WHEN 'gana' THEN MAX(mejor_racha, racha_actual + 1) ELSE mejor_racha END,
               partidas = partidas + 1,
               victorias = victorias + ?,
               ganancias = ganancias + ?,
               mayor_premio = MAX(mayor_premio, ?),
               partidas_blackjack = partidas_blackjack + ?,
               victorias_blackjack = victorias_blackjack + ?,
               partidas_carrera = partidas_carrera + ?,
               victorias_carrera = victorias_carrera + ?
             WHERE id = ? RETURNING apodo`,
            pago,
            resultado,
            resultado,
            gana,
            neto,
            Math.max(neto, 0),
            blackjack,
            blackjack * gana,
            1 - blackjack,
            (1 - blackjack) * gana,
            jugadorId,
          )
          .toArray()[0];
        if (fila !== undefined) netos.push({ apodo: fila.apodo, neto });
        this.sql.exec(
          "INSERT INTO resultados (jugador_id, juego, codigo_partida, ronda_id, apuesta, neto, resultado, momento) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          jugadorId,
          l.juego,
          l.codigoPartida,
          l.rondaId,
          apuesta,
          neto,
          resultado,
          ahora,
        );
      }
      this.sql.exec("DELETE FROM apuestas_pendientes WHERE ronda_id = ?", l.rondaId);
      return netos;
    });
  }

  async rescate(jugadorId: number): Promise<{ ok: true; fichas: number } | { ok: false; error: "tiene_fichas" | "apuestas_pendientes" }> {
    return this.ctx.storage.transactionSync(() => {
      const fila = this.sql.exec<{ fichas: number }>("SELECT fichas FROM jugadores WHERE id = ?", jugadorId).toArray()[0];
      // Un jugador que no existe tampoco es rescatable: no se toca nada.
      if (fila === undefined || fila.fichas > 0) return { ok: false, error: "tiene_fichas" } as const;

      const pendientes = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM apuestas_pendientes WHERE jugador_id = ?", jugadorId).one().n;
      if (pendientes > 0) return { ok: false, error: "apuestas_pendientes" } as const;

      this.sql.exec("UPDATE jugadores SET fichas = ?, quiebras = quiebras + 1 WHERE id = ?", FICHAS_RESCATE, jugadorId);
      return { ok: true, fichas: FICHAS_RESCATE } as const;
    });
  }

  /** Top 50 del orden pedido (valor DESC, apodo ASC) y la fila del jugador (si clasifica), esté o no en el top. */
  async ranking(orden: OrdenRanking, jugadorId: number | null): Promise<{ top: FilaRanking[]; yo: FilaRanking | null }> {
    const filas = this.sql
      .exec<{ id: number; posicion: number; apodo: string; valor: number }>(
        `WITH base AS (${ORIGEN_RANKING[orden]}),
         ordenado AS (
           SELECT id, apodo, valor, ROW_NUMBER() OVER (ORDER BY valor DESC, apodo COLLATE NOCASE ASC) AS posicion FROM base
         )
         SELECT id, posicion, apodo, valor FROM ordenado WHERE posicion <= ? OR id = ? ORDER BY posicion`,
        TAMANO_TOP,
        jugadorId,
      )
      .toArray();

    const aFila = ({ posicion, apodo, valor }: FilaRanking): FilaRanking => ({ posicion, apodo, valor });
    const mia = jugadorId === null ? undefined : filas.find((f) => f.id === jugadorId);
    return { top: filas.filter((f) => f.posicion <= TAMANO_TOP).map(aFila), yo: mia === undefined ? null : aFila(mia) };
  }
}
