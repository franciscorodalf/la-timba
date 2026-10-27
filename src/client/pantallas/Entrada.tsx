import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { RespuestaSesion } from "../../shared/api";
import { retardo } from "../animacion";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { Campo } from "../componentes/Campo";
import { horaLocal } from "../formato";
import { api, ErrorApi, mensajeError } from "../red/api";
import { useSesion } from "../red/sesion";

// Las mismas reglas que el servidor (`apodoValido` y `pinValido` en server/auth.ts): aquí solo avisan antes de enviar.
const APODO = /^[A-Za-z0-9_]{3,16}$/;
const PIN = /^\d{4}$/;

function iconoOjo(tachado: boolean) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
      {tachado && <path d="M4 4l16 16" />}
    </svg>
  );
}

function textoIntentos(restantes: unknown): string {
  if (typeof restantes !== "number") return "PIN incorrecto";
  return restantes === 1 ? "PIN incorrecto, te queda 1 intento" : `PIN incorrecto, te quedan ${restantes} intentos`;
}

export function Entrada() {
  const { entrar } = useSesion();
  const [apodo, setApodo] = useState("");
  const [pin, setPin] = useState("");
  const [verPin, setVerPin] = useState(false);
  const [fase, setFase] = useState<"datos" | "confirmar">("datos");
  const [tocados, setTocados] = useState({ apodo: false, pin: false });
  const [intentado, setIntentado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const campoApodo = useRef<HTMLInputElement>(null);
  const campoPin = useRef<HTMLInputElement>(null);
  const pregunta = useRef<HTMLHeadingElement>(null);

  const apodoLimpio = apodo.trim();
  const apodoValido = APODO.test(apodoLimpio);
  const pinValido = PIN.test(pin);

  useEffect(() => {
    if (fase === "confirmar") pregunta.current?.focus();
  }, [fase]);

  function volverADatos(foco: RefObject<HTMLInputElement>) {
    flushSync(() => setFase("datos"));
    foco.current?.focus();
  }

  function tratarError(e: unknown) {
    if (e instanceof ErrorApi) {
      switch (e.error) {
        case "no_existe":
          setFase("confirmar");
          return;
        case "pin":
          setAviso(textoIntentos(e.datos?.intentosRestantes));
          // El campo vacío vuelve a empezar: la regla de «4 dígitos» no debe verse como un fallo más.
          setPin("");
          setIntentado(false);
          setTocados((t) => ({ ...t, pin: false }));
          campoPin.current?.focus();
          return;
        case "bloqueado":
          setAviso(typeof e.datos?.hasta === "number" ? `Demasiados intentos. Prueba de nuevo a las ${horaLocal(e.datos.hasta)}` : "Demasiados intentos. Prueba de nuevo más tarde");
          return;
        case "apodo_ocupado":
          setAviso("Ese apodo ya está en uso. Elige otro");
          volverADatos(campoApodo);
          return;
        case "apodo_invalido":
        case "pin_invalido":
          setIntentado(true);
          volverADatos(e.error === "apodo_invalido" ? campoApodo : campoPin);
          return;
      }
    }
    setAviso(mensajeError(e));
  }

  async function probar(llamada: () => Promise<RespuestaSesion>) {
    setEnviando(true);
    setAviso(null);
    try {
      const { token, jugador } = await llamada();
      entrar(token, jugador); // La pantalla se sustituye por la que toque.
    } catch (e) {
      tratarError(e);
    } finally {
      setEnviando(false);
    }
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviando) return;
    setAviso(null);
    setIntentado(true);
    if (!apodoValido) return campoApodo.current?.focus();
    if (!pinValido) return campoPin.current?.focus();
    await probar(() => api.entrar(apodoLimpio, pin));
  }

  return (
    <main className="pantalla pantalla--entrada">
      <header className="marca aparece">
        <div className="marca__palos" aria-hidden="true">
          <span>♠&#xFE0E;</span>
          <span>♥&#xFE0E;</span>
          <span>♣&#xFE0E;</span>
          <span>♦&#xFE0E;</span>
        </div>
        <h1 className="marca__logo">La Timba</h1>
        <p className="marca__lema">Blackjack y carreras de caballos con tus amigos</p>
      </header>

      {fase === "datos" ? (
        <form className="panel aparece" style={retardo(120)} onSubmit={enviar} noValidate aria-labelledby="entrada-titulo">
          <h2 className="panel__titulo" id="entrada-titulo">
            Siéntate a la mesa
          </h2>
          <p className="panel__texto">Escribe tu apodo y tu PIN. Si es tu primera vez, te creamos el perfil.</p>
          <Campo
            ref={campoApodo}
            etiqueta="Apodo"
            ayuda="De 3 a 16 caracteres: letras, números y _"
            invalido={(tocados.apodo || intentado) && !apodoValido}
            value={apodo}
            onChange={(e) => setApodo(e.target.value)}
            onBlur={() => setTocados((t) => ({ ...t, apodo: true }))}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={16}
            enterKeyHint="next"
          />
          <Campo
            ref={campoPin}
            etiqueta="PIN"
            ayuda="4 dígitos"
            invalido={(tocados.pin || intentado) && !pinValido}
            type={verPin ? "text" : "password"}
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            onBlur={() => setTocados((t) => ({ ...t, pin: true }))}
            autoComplete="current-password"
            maxLength={4}
            enterKeyHint="go"
            accion={
              <button type="button" className="campo__accion" aria-label="Mostrar dígitos" aria-pressed={verPin} onClick={() => setVerPin((v) => !v)}>
                {iconoOjo(verPin)}
              </button>
            }
          />
          {aviso !== null && <Aviso>{aviso}</Aviso>}
          <Boton type="submit" ancho cargando={enviando}>
            Entrar
          </Boton>
        </form>
      ) : (
        <section className="panel aparece" aria-labelledby="confirmar-titulo">
          <h2 className="panel__titulo" id="confirmar-titulo" ref={pregunta} tabIndex={-1}>
            {`¿Crear el perfil "${apodoLimpio}"?`}
          </h2>
          <p className="panel__texto">No hay ningún jugador con ese apodo. Se creará con el PIN que acabas de escribir.</p>
          {aviso !== null && <Aviso>{aviso}</Aviso>}
          <div className="acciones">
            <Boton cargando={enviando} onClick={() => probar(() => api.registro(apodoLimpio, pin))}>
              Sí
            </Boton>
            <Boton variante="secundario" disabled={enviando} onClick={() => volverADatos(campoApodo)}>
              No
            </Boton>
          </div>
        </section>
      )}

      <p className="nota aparece" style={retardo(240)}>
        Juego gratuito: las fichas no tienen valor real.
      </p>
    </main>
  );
}
