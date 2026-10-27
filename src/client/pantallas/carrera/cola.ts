import { aplicarMarco, type Escena, type Marco } from "./escena";

// La cola de fotogramas de la pista. Cada paso de la carrera trae su guion (`planDeLote`): fotogramas con valores absolutos
// (el avance, el giro, el retroceso, el ganador…) que se aplican a su hora. Como cada uno pisa lo anterior, lo único que
// importa es el ORDEN: aquí hay una sola lista ordenada y un solo temporizador, de modo que ningún fotograma puede adelantar a
// otro aunque dos caigan en el mismo instante o un temporizador se retrase. Un paso que llega con otro en marcha se pone detrás.

export interface Reloj {
  /** El tiempo actual en milisegundos (monótono). */
  ahora(): number;
  /** Llama a `hacer` pasados `ms` milisegundos. */
  poner(hacer: () => void, ms: number): unknown;
  quitar(id: unknown): void;
}

interface Pendiente {
  marco: Marco;
  /** Cuándo toca aplicarlo, en el tiempo de `Reloj`. */
  vence: number;
}

export class ColaDeMarcos {
  private cola: Pendiente[] = [];
  private id: unknown = null;

  constructor(
    private readonly aplicar: (marco: Marco) => void,
    private readonly reloj: Reloj,
  ) {}

  /** Cuánto falta (≥ 0) para aplicar el último fotograma en cola: lo nuevo sale cuando eso acaba. */
  restante(): number {
    const ultimo = this.cola.at(-1);
    return ultimo === undefined ? 0 : Math.max(0, ultimo.vence - this.reloj.ahora());
  }

  /** La escena como quedará al aplicar todo lo que hay en cola, partiendo de `base`: sobre ella se planea el paso siguiente. */
  proyectar(base: Escena): Escena {
    return this.cola.reduce((escena, p) => aplicarMarco(escena, p.marco), base);
  }

  /**
   * Pone `marcos` detrás de lo que hay en cola, con sus `en` contados desde que acaba lo que está en marcha (o desde ahora, si
   * no hay nada). Los de tiempo cero con la cola vacía se aplican en el acto.
   */
  encolar(marcos: Marco[]): void {
    this.vencidos();
    const inicio = this.reloj.ahora() + this.restante();
    for (const marco of marcos) this.cola.push({ marco, vence: inicio + marco.en });
    this.vencidos();
  }

  /** Aplica, en orden, lo que ya tocaba (un temporizador retrasado, una pestaña dormida) y arma el temporizador del resto. */
  vencidos(): void {
    this.avanzar(false);
  }

  /** Da por visto ya, en orden, todo lo que queda en cola. */
  terminar(): void {
    this.reloj.quitar(this.id);
    this.id = null;
    const resto = this.cola;
    this.cola = [];
    for (const p of resto) this.aplicar(p.marco);
  }

  /** Para el temporizador y olvida lo pendiente (al salir de la pantalla). */
  cancelar(): void {
    this.reloj.quitar(this.id);
    this.id = null;
    this.cola = [];
  }

  /** Aplica los fotogramas que tocan y deja armado el temporizador del siguiente. `llamado`: dispara el temporizador, así que el primero toca aunque falte una fracción. */
  private avanzar(llamado: boolean): void {
    this.reloj.quitar(this.id);
    this.id = null;
    const ahora = this.reloj.ahora();
    let primero = llamado;
    while (this.cola.length > 0 && (primero || this.cola[0].vence <= ahora)) {
      primero = false;
      const { marco } = this.cola.shift()!;
      this.aplicar(marco);
    }
    if (this.cola.length > 0) this.id = this.reloj.poner(() => this.avanzar(true), Math.max(0, this.cola[0].vence - this.reloj.ahora()));
  }
}
