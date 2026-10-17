import { type FormEvent, useRef, useState } from "react";
import { useLocation } from "wouter";
import { retardo } from "../animacion";
import { Aviso } from "../componentes/Aviso";
import { Avatar } from "../componentes/Avatar";
import { Boton } from "../componentes/Boton";
import { Campo } from "../componentes/Campo";
import { Saludo } from "../componentes/Saludo";
import { api, mensajeError } from "../red/api";
import { useSesion } from "../red/sesion";

const LONGITUD_CODIGO = 4;

/**
 * Lo que se escribe en el campo del código: mayúsculas, solo letras y números, como mucho 4. El límite está aquí y no en
 * `maxLength`, que cortaría antes de limpiar: un código pegado con un espacio delante perdería su última letra.
 */
const limpiarCodigo = (texto: string): string => texto.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, LONGITUD_CODIGO);

/** Pantalla de inicio: abrir una partida nueva o unirse a una con su código. */
export function Inicio() {
  const { jugador, salir } = useSesion();
  const [, navegar] = useLocation();
  const [codigo, setCodigo] = useState("");
  const [incompleto, setIncompleto] = useState(false);
  const [creando, setCreando] = useState(false);
  const [uniendo, setUniendo] = useState(false);
  const [avisoCrear, setAvisoCrear] = useState<string | null>(null);
  const [avisoUnirse, setAvisoUnirse] = useState<string | null>(null);
  const campoCodigo = useRef<HTMLInputElement>(null);

  async function crear() {
    setCreando(true);
    setAvisoCrear(null);
    try {
      const { codigo: nuevo } = await api.crearPartida();
      navegar(`/p/${nuevo}`);
    } catch (e) {
      setAvisoCrear(mensajeError(e));
      setCreando(false);
    }
  }

  async function unirse(evento: FormEvent) {
    evento.preventDefault();
    if (uniendo) return;
    setAvisoUnirse(null);
    if (codigo.length < LONGITUD_CODIGO) {
      setIncompleto(true);
      campoCodigo.current?.focus();
      return;
    }
    setUniendo(true);
    try {
      const { existe } = await api.existePartida(codigo);
      if (existe) navegar(`/p/${codigo}`);
      else {
        setAvisoUnirse("Esa partida no existe");
        setUniendo(false);
      }
    } catch (e) {
      setAvisoUnirse(mensajeError(e));
      setUniendo(false);
    }
  }

  return (
    <main className="pantalla pantalla--entrada">
      <div className="inicio__barra aparece">
        <span className="jugador">
          <Avatar apodo={jugador?.apodo ?? ""} />
          {jugador?.apodo}
        </span>
        <Boton variante="secundario" onClick={salir}>
          Salir
        </Boton>
      </div>

      <header className="marca aparece" style={retardo(60)}>
        <div className="marca__palos" aria-hidden="true">
          <span>♠&#xFE0E;</span>
          <span>♥&#xFE0E;</span>
          <span>♣&#xFE0E;</span>
          <span>♦&#xFE0E;</span>
        </div>
        <h1 className="marca__logo">La Timba</h1>
        <Saludo />
      </header>

      <section className="panel aparece" style={retardo(140)} aria-labelledby="crear-titulo">
        <h2 className="panel__titulo" id="crear-titulo">
          Abre tu mesa
        </h2>
        <p className="panel__texto">Crea una partida y comparte el código o el QR: tus amigos se sientan en un momento.</p>
        {avisoCrear !== null && <Aviso>{avisoCrear}</Aviso>}
        <Boton ancho cargando={creando} onClick={crear}>
          Crear partida
        </Boton>
      </section>

      <p className="separador aparece" style={retardo(200)} aria-hidden="true">
        o
      </p>

      <form className="panel aparece" style={retardo(240)} onSubmit={unirse} noValidate>
        <h2 className="panel__titulo">Únete con un código</h2>
        <Campo
          ref={campoCodigo}
          etiqueta="Código"
          ayuda={incompleto && codigo.length < LONGITUD_CODIGO ? "El código tiene 4 caracteres" : "Te lo da quien creó la partida"}
          invalido={incompleto && codigo.length < LONGITUD_CODIGO}
          className="campo__codigo"
          placeholder="ABCD"
          value={codigo}
          onChange={(e) => {
            setCodigo(limpiarCodigo(e.target.value));
            setAvisoUnirse(null);
          }}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
        />
        {avisoUnirse !== null && <Aviso>{avisoUnirse}</Aviso>}
        <Boton type="submit" ancho variante={codigo.length === LONGITUD_CODIGO ? "principal" : "secundario"} cargando={uniendo}>
          Unirse
        </Boton>
      </form>

      <p className="nota aparece" style={retardo(300)}>
        Juego gratuito: las fichas no tienen valor real.
      </p>
    </main>
  );
}
