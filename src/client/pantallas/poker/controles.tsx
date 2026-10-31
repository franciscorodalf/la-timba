import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type AccionPoker, type OpcionesPoker, POKER, type VistaPoker } from "../../../shared/juegos/poker";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton";
import { FichasApuesta } from "../../componentes/FichasApuesta";
import { sonidos } from "../../efectos/sonidos";
import { miles } from "../../formato";
import { leerCantidad, type LimitesSubida, pasoDeSubida } from "./subir";

// Lo de debajo del tapete: sentarse, decidir y subir, añadir fichas y el texto de la línea de estado. Tus cartas, en `MisCartas`.

interface PropsSentarse {
  /** Tus fichas: lo máximo con lo que te puedes sentar. La mesa rechaza sin preguntar lo que pasa de ahí. */
  fichas: number;
  activo: boolean;
  /** Esperando a que la mesa confirme que te ha sentado. */
  esperando: boolean;
  onSentarse(fichas: number): void;
}

/** Las fichas con las que te sientas (desde `COMPRA_MIN`, sin pasar de las que tienes) y «Sentarme con N». */
export function Sentarse({ fichas, activo, esperando, onSentarse }: PropsSentarse) {
  const [montante, setMontante] = useState(0);
  // Si tienes menos fichas que lo preparado (acabas de gastarlas en otra mesa), lo preparado no vale.
  const cantidad = montante <= fichas ? montante : 0;
  // Las fichas vuelan hasta el botón: es lo que vas a pagar.
  const destino = useRef<HTMLDivElement>(null);
  return (
    <div className="panel-apuesta pk-sentarse">
      <FichasApuesta montante={cantidad} tope={fichas} minimo={POKER.COMPRA_MIN} activo={activo} onCambiar={setMontante} destino={destino} />
      <div className="panel-apuesta__fila" ref={destino}>
        <Boton variante="secundario" className="panel-apuesta__borrar" aria-label="Borrar fichas" disabled={cantidad === 0} onClick={() => setMontante(0)}>
          Borrar
        </Boton>
        <Boton disabled={!activo || cantidad < POKER.COMPRA_MIN} cargando={esperando} onClick={() => onSentarse(cantidad)}>
          {cantidad > 0 ? `Sentarme con ${miles(cantidad)}` : "Sentarme"}
        </Boton>
      </div>
    </div>
  );
}

/** Quien mira: sentarse, o que la mesa está completa. */
export function Mirando({ libres, ...resto }: PropsSentarse & { libres: number }) {
  if (libres <= 0) return <Aviso tipo="info">Podrás sentarte en cuanto se libere un asiento.</Aviso>;
  return <Sentarse {...resto} />;
}

/** El texto de la fase para la línea de estado. */
export function textoEstado(vista: VistaPoker | null): string {
  if (vista === null) return "Entrando en la mesa…";
  const mio = vista.asientos.find((a) => a.jugadorId === vista.yo);
  if (mio === undefined) return vista.asientosLibres <= 0 ? "La mesa está completa. Estás mirando" : "Estás mirando. Siéntate para jugar";
  if (vista.fase === "esperando") return "Esperando rivales";
  if (vista.fase === "resultado") return "Nueva mano en";
  if (mio.estado === "fuera") return "Juegas en la mano siguiente";
  if (vista.turno === vista.yo) return "Tu turno";
  const habla = vista.asientos.find((a) => a.jugadorId === vista.turno);
  if (mio.estado === "retirado") return "Te has retirado de esta mano";
  return habla === undefined ? "Se reparte la mano" : `Habla ${habla.apodo}`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Decidir y subir
// ---------------------------------------------------------------------------------------------------------------------

interface PropsDecidir {
  /** Lo que permiten las reglas ahora. Solo se usa si te toca: los botones dependen también de que el turno sea tuyo. */
  opciones: OpcionesPoker | null;
  /** La vista dice que habla `yo`. */
  tuTurno: boolean;
  /** La mesa está conectada y no estás esperando la respuesta a tu última acción. */
  activo: boolean;
  /** La cuenta atrás que enseña `EstadoMesa` (`0:13`): la hoja de subir tapa esa línea y la repite. */
  cuenta: string | null;
  /** Donde se abre la hoja de subir (el `main` de la mesa). */
  hoja: HTMLElement | null;
  onActuar(accion: AccionPoker): void;
}

/**
 * Una hoja que se queda pegada al borde de abajo de la pantalla. Va en `hoja` (el `main` de la mesa) y no donde se abre: la hoja
 * pegajosa solo sube hasta lo alto de quien la contiene, y en el panel de debajo del tapete no le cabría en un móvil bajo.
 */
function Hoja({ hoja, clase, children }: { hoja: HTMLElement | null; clase?: string; children: ReactNode }) {
  if (hoja === null) return null;
  return createPortal(<div className={`pk-hoja${clase ? ` ${clase}` : ""}`}>{children}</div>, hoja);
}

/** «Tu turno 0:13» dentro de las hojas que tapan la línea de estado: mientras decides, el tiempo sigue a la vista. */
function CuentaTurno({ cuenta }: { cuenta: string | null }) {
  if (cuenta === null) return null;
  return (
    <p className="pk-cuenta">
      <span>Tu turno</span> <b>{cuenta}</b>
    </p>
  );
}

/**
 * La fila de decidir: Retirarse · Pasar o Igualar N · Apostar o Subir. Si tus fichas no llegan a la subida mínima, el tercero es
 * solo «All-in N». En el resultado, aquí está «Enseñar mis cartas». La fila reserva su alto aunque no haya nada que decidir.
 */
export function Decidir({ opciones, tuTurno, activo, cuenta, hoja, onActuar }: PropsDecidir) {
  const subir = tuTurno && opciones?.retirarse === true ? opciones.subir : null;
  const [abierto, setAbierto] = useState<LimitesSubida | null>(null);
  // El panel vale mientras te toque y no cambie el rango: con otro rango la cantidad que tenías ya no significa lo mismo.
  const panel = abierto !== null && subir !== null && subir.min === abierto.min && subir.max === abierto.max ? subir : null;
  useEffect(() => {
    if (abierto !== null && panel === null) setAbierto(null);
  }, [abierto, panel]);

  const actuar = (accion: AccionPoker) => {
    sonidos.reproducir("fichas");
    onActuar(accion);
  };

  if (opciones?.ensenar) {
    return (
      <div className="pk-acciones">
        <Boton className="pk-acciones__ensenar" disabled={!activo} onClick={() => onActuar({ t: "ensenar" })}>
          Enseñar mis cartas
        </Boton>
      </div>
    );
  }
  if (!tuTurno || opciones === null || !opciones.retirarse) return <div className="pk-acciones" />;

  if (panel !== null) {
    return (
      // La fila sigue ahí, vacía: la mesa no salta al abrir la hoja.
      <div className="pk-acciones">
        <Hoja hoja={hoja}>
          <PanelSubir limites={panel} activo={activo} cuenta={cuenta} onSubir={(hasta) => actuar({ t: "subir", hasta })} onCancelar={() => setAbierto(null)} />
        </Hoja>
      </div>
    );
  }

  const todoSolo = subir !== null && subir.min === subir.max;
  return (
    <div className="pk-acciones">
      <div className="pk-decidir">
        <Boton variante="secundario" disabled={!activo} onClick={() => onActuar({ t: "retirarse" })}>
          Retirarse
        </Boton>
        {opciones.igualar !== null ? (
          <Boton disabled={!activo} onClick={() => actuar({ t: "igualar" })}>
            Igualar {miles(opciones.igualar)}
          </Boton>
        ) : (
          <Boton disabled={!activo || !opciones.pasar} onClick={() => onActuar({ t: "pasar" })}>
            Pasar
          </Boton>
        )}
        {subir === null ? (
          <span aria-hidden="true" />
        ) : todoSolo ? (
          <Boton variante="secundario" disabled={!activo} onClick={() => actuar({ t: "subir", hasta: subir.max })}>
            All-in {miles(subir.max)}
          </Boton>
        ) : (
          <Boton variante="secundario" disabled={!activo} onClick={() => setAbierto(subir)}>
            {opciones.igualar === null ? "Apostar" : "Subir"}
          </Boton>
        )}
      </div>
    </div>
  );
}

interface PropsPanelSubir {
  limites: LimitesSubida;
  activo: boolean;
  cuenta: string | null;
  onSubir(hasta: number): void;
  onCancelar(): void;
}

/**
 * Subir a la cantidad que quieras: el número en grande (se puede escribir), un deslizador de `min` a `max`, − y + de una ciega
 * grande, All-in y Cancelar. El deslizador y el campo son la misma cantidad; lo escrito que no vale deja apagado «Subir a N».
 */
export function PanelSubir({ limites, activo, cuenta, onSubir, onCancelar }: PropsPanelSubir) {
  const { min, max } = limites;
  const paso = pasoDeSubida(limites);
  const [texto, setTexto] = useState(String(min));
  // La última cantidad válida: el deslizador se queda ahí mientras lo escrito no valga.
  const [valida, setValida] = useState(min);
  const escrita = leerCantidad(texto, limites);

  const poner = (cantidad: number) => {
    setValida(cantidad);
    setTexto(String(cantidad));
  };
  const actual = escrita ?? valida;

  const deslizador = useRef<HTMLInputElement>(null);
  useEffect(() => deslizador.current?.focus({ preventScroll: true }), []);

  return (
    <div className="pk-subir" role="group" aria-label="Subir la apuesta">
      <div className="pk-subir__cabeza">
        <CuentaTurno cuenta={cuenta} />
        <p className={`pk-subir__ayuda${escrita === null ? " pk-subir__ayuda--mal" : ""}`} id="pk-subir-ayuda">
          De {miles(min)} a {miles(max)}
        </p>
      </div>
      <div className="pk-subir__cantidad">
        <button type="button" className="pk-subir__paso" aria-label={`Quitar ${paso}`} disabled={!activo || actual <= min} onClick={() => poner(Math.max(min, actual - paso))}>
          −
        </button>
        <input
          className="pk-subir__campo"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label="Cantidad a subir"
          aria-invalid={escrita === null}
          aria-describedby="pk-subir-ayuda"
          value={texto}
          onChange={(evento) => {
            setTexto(evento.target.value);
            const cantidad = leerCantidad(evento.target.value, limites);
            if (cantidad !== null) setValida(cantidad);
          }}
        />
        <button type="button" className="pk-subir__paso" aria-label={`Poner ${paso} más`} disabled={!activo || actual >= max} onClick={() => poner(Math.min(max, actual + paso))}>
          +
        </button>
      </div>
      <input
        ref={deslizador}
        className="pk-subir__deslizador"
        type="range"
        min={min}
        max={max}
        step={1}
        aria-label="Deslizador de la subida"
        value={actual}
        onChange={(evento) => poner(Number(evento.target.value))}
      />
      <div className="pk-subir__fila">
        <Boton variante="secundario" disabled={!activo} onClick={() => onSubir(max)}>
          All-in {miles(max)}
        </Boton>
        <Boton variante="secundario" onClick={onCancelar}>
          Cancelar
        </Boton>
        <Boton disabled={!activo || escrita === null} onClick={() => escrita !== null && onSubir(escrita)}>
          Subir a {escrita === null ? "…" : miles(escrita)}
        </Boton>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Añadir fichas y levantarse
// ---------------------------------------------------------------------------------------------------------------------

interface PropsAnadir {
  /** Tu saldo: lo máximo que puedes poner en la mesa. */
  fichas: number;
  activo: boolean;
  /** La cuenta de tu turno, si te toca: la hoja tapa la línea de estado. `null` si no te toca. */
  cuenta: string | null;
  /** Donde se abre la hoja (el `main` de la mesa). */
  hoja: HTMLElement | null;
  onAnadir(fichas: number): void;
  onCancelar(): void;
}

/** Las fichas que añades a tu pila (desde `COMPRA_MIN`, sin pasar de tu saldo). Entran al empezar la mano siguiente. */
export function AnadirFichas({ fichas, activo, cuenta, hoja, onAnadir, onCancelar }: PropsAnadir) {
  const [montante, setMontante] = useState(0);
  const cantidad = montante <= fichas ? montante : 0;
  const destino = useRef<HTMLDivElement>(null);
  return (
    <Hoja hoja={hoja} clase="panel-apuesta pk-anadir">
      <CuentaTurno cuenta={cuenta} />
      <FichasApuesta montante={cantidad} tope={fichas} minimo={POKER.COMPRA_MIN} activo={activo} onCambiar={setMontante} destino={destino} />
      <div className="pk-anadir__fila" ref={destino}>
        <Boton variante="secundario" onClick={onCancelar}>
          Cancelar
        </Boton>
        <Boton disabled={!activo || cantidad < POKER.COMPRA_MIN} onClick={() => onAnadir(cantidad)}>
          {cantidad > 0 ? `Poner ${miles(cantidad)} en la mesa` : "Poner en la mesa"}
        </Boton>
      </div>
    </Hoja>
  );
}
