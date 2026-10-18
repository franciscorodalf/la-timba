import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Un `localStorage` en memoria; `roto` hace que leer y escribir fallen (ventana privada, datos de sitio bloqueados). */
function almacen(inicial: Record<string, string> = {}, roto = false) {
  const datos = new Map(Object.entries(inicial));
  const fallar = () => {
    throw new Error("SecurityError");
  };
  return {
    datos,
    getItem: (clave: string) => (roto ? fallar() : (datos.get(clave) ?? null)),
    setItem: (clave: string, valor: string) => (roto ? fallar() : void datos.set(clave, valor)),
    removeItem: (clave: string) => (roto ? fallar() : void datos.delete(clave)),
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sonidos", () => {
  it("el silencio se recuerda en localStorage («timba.silencio») y alternar lo cambia", async () => {
    const local = almacen({ "timba.silencio": "1" });
    vi.stubGlobal("localStorage", local);
    const { sonidos } = await import("../../src/client/efectos/sonidos");
    expect(sonidos.silenciado).toBe(true);

    sonidos.alternar();
    expect(sonidos.silenciado).toBe(false);
    expect(local.datos.get("timba.silencio")).toBe("0");
    sonidos.alternar();
    expect(sonidos.silenciado).toBe(true);
    expect(local.datos.get("timba.silencio")).toBe("1");
  });

  it("sin nada guardado suena; sin almacenamiento el silencio dura lo que la pestaña", async () => {
    vi.stubGlobal("localStorage", almacen());
    expect((await import("../../src/client/efectos/sonidos")).sonidos.silenciado).toBe(false);

    vi.resetModules();
    vi.stubGlobal("localStorage", almacen({}, true));
    const { sonidos } = await import("../../src/client/efectos/sonidos");
    expect(sonidos.silenciado).toBe(false);
    expect(() => sonidos.alternar()).not.toThrow();
    expect(sonidos.silenciado).toBe(true);
  });

  it("sin Web Audio (o antes de que el usuario toque la página) reproducir no hace nada y no falla", async () => {
    vi.stubGlobal("localStorage", almacen());
    vi.stubGlobal("AudioContext", undefined);
    const { sonidos } = await import("../../src/client/efectos/sonidos");
    expect(() => {
      sonidos.reproducir("carta");
      sonidos.reproducir("fichas");
      sonidos.reproducir("victoria");
    }).not.toThrow();
  });

  it("reproducir nunca crea el audio (cuesta decenas de ms): eso solo lo hace un toque del jugador", async () => {
    vi.stubGlobal("localStorage", almacen());
    const creado = vi.fn();
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          creado();
        }
      },
    );
    const { sonidos } = await import("../../src/client/efectos/sonidos");
    sonidos.reproducir("carta");
    sonidos.reproducir("victoria");
    expect(creado).not.toHaveBeenCalled();
  });
});

describe("sonidos: desbloqueo del audio con un toque", () => {
  /** Si hay un gesto del jugador en curso (lo marca `tocar`). */
  const gesto = { activo: false };

  /**
   * Un AudioContext de mentira con lo que usa sonidos.ts; `estadoInicial` simula Safari creándolo suspendido. Como en
   * Safari, `resume()` solo arranca el audio si se llama durante un gesto, y lo hace de forma asíncrona.
   */
  function audioFalso(estadoInicial: "running" | "suspended") {
    const creados: { state: string; resume: ReturnType<typeof vi.fn>; fuentes: number }[] = [];
    const nodo = () => ({ connect: (otro: unknown) => otro ?? nodo(), disconnect() {}, gain: { value: 0 } });
    class Falso {
      state = estadoInicial;
      sampleRate = 8_000;
      currentTime = 0;
      destination = nodo();
      fuentes = 0;
      resume = vi.fn(() => {
        const permitido = gesto.activo;
        return Promise.resolve().then(() => {
          if (permitido) this.state = "running";
        });
      });
      constructor() {
        creados.push(this);
      }
      createDynamicsCompressor = () => ({ ...nodo(), threshold: { value: 0 }, ratio: { value: 0 }, attack: { value: 0 }, release: { value: 0 } });
      createGain = () => nodo();
      createBuffer = (_canales: number, muestras: number) => ({ getChannelData: () => new Float32Array(muestras) });
      createBufferSource = () => {
        this.fuentes++;
        return { ...nodo(), buffer: null, start() {} };
      };
    }
    return { Falso, creados };
  }

  /** Una ventana mínima con oyentes (la de workerd no admite `capture`). `tocar` lanza un evento a sus oyentes. */
  function ventana() {
    const oyentes = new Map<string, Set<(evento: { type: string }) => void>>();
    return {
      addEventListener(tipo: string, oyente: (evento: { type: string }) => void) {
        if (!oyentes.has(tipo)) oyentes.set(tipo, new Set());
        oyentes.get(tipo)!.add(oyente);
      },
      removeEventListener(tipo: string, oyente: (evento: { type: string }) => void) {
        oyentes.get(tipo)?.delete(oyente);
      },
      tocar(tipo: string) {
        for (const oyente of [...(oyentes.get(tipo) ?? [])]) oyente({ type: tipo });
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("localStorage", almacen());
    vi.stubGlobal("window", ventana());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const tocar = (tipo: string) => {
    gesto.activo = true;
    (window as unknown as ReturnType<typeof ventana>).tocar(tipo);
    gesto.activo = false;
  };

  it("un pointerdown que no cuenta como gesto (iOS) no crea el audio; touchend, pointerup o click, sí, en un rato libre", async () => {
    const activacion = { hasBeenActive: false };
    vi.stubGlobal("navigator", { userActivation: activacion });
    const { Falso, creados } = audioFalso("running");
    vi.stubGlobal("AudioContext", Falso);
    await import("../../src/client/efectos/sonidos");

    tocar("pointerdown");
    vi.runAllTimers();
    expect(creados).toHaveLength(0);

    for (const tipo of ["touchend", "pointerup", "click"]) {
      vi.resetModules();
      creados.length = 0;
      vi.stubGlobal("window", ventana());
      activacion.hasBeenActive = true;
      await import("../../src/client/efectos/sonidos");
      tocar(tipo);
      expect(creados).toHaveLength(0); // no dentro del toque…
      vi.runAllTimers();
      expect(creados, tipo).toHaveLength(1); // …sino justo después
    }
  });

  it("si nace suspendido (Safari), el toque siguiente lo reanuda y lo desbloquea dentro del propio toque", async () => {
    vi.stubGlobal("navigator", { userActivation: { hasBeenActive: true } });
    const { Falso, creados } = audioFalso("suspended");
    vi.stubGlobal("AudioContext", Falso);
    const { sonidos } = await import("../../src/client/efectos/sonidos");

    tocar("touchend");
    vi.runAllTimers();
    expect(creados).toHaveLength(1);
    const [contexto] = creados;
    sonidos.reproducir("carta");
    await Promise.resolve();
    expect(contexto.state).toBe("suspended"); // fuera de un gesto no arranca…
    expect(contexto.fuentes).toBe(0); // …ni suena (ni se acumula para luego)

    tocar("click");
    expect(contexto.fuentes).toBe(1); // el búfer mudo que desbloquea iOS, dentro del gesto
    await Promise.resolve();
    expect(contexto.state).toBe("running");
    sonidos.reproducir("carta");
    expect(contexto.fuentes).toBeGreaterThan(1);
  });
});

describe("vibrar", () => {
  it("vibra con navigator.vibrate cuando existe y la página ya ha recibido un toque", async () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate, userActivation: { hasBeenActive: true } });
    const { vibrar } = await import("../../src/client/efectos/vibrar");
    vibrar(80);
    expect(vibrate).toHaveBeenCalledWith(80);
  });

  it("no hace nada sin navigator.vibrate ni antes del primer toque (el navegador lo bloquearía con un aviso)", async () => {
    const { vibrar } = await import("../../src/client/efectos/vibrar");
    vi.stubGlobal("navigator", {});
    expect(() => vibrar(200)).not.toThrow();

    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate, userActivation: { hasBeenActive: false } });
    vibrar(200);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("si vibrate lanza, se traga el error", async () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("no");
      },
    });
    const { vibrar } = await import("../../src/client/efectos/vibrar");
    expect(() => vibrar(80)).not.toThrow();
  });
});
