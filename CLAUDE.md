# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

La Timba es una web gratuita para jugar a las cartas con amigos. Alguien crea una **partida** con un código de 4 caracteres, QR o enlace. Dentro hay una **mesa por juego** (ahora Blackjack y Carrera de caballos). Las fichas y el ranking son globales.

- **Despliegue:** un único Cloudflare Worker con Durable Objects (SQLite) en el **plan gratuito**.
- **Producción:** https://la-timba.franteleco1278.workers.dev. Despliega el usuario con su cuenta; no despliegues tú.
- **Documentos:**
  - Spec (manda sobre el plan y sobre el código): `docs/superpowers/specs/2026-10-17-la-timba-design.md`
  - Plan original: `docs/superpowers/plans/2026-10-17-la-timba.md`
  - README de portfolio: `README.md`

## Comandos

```bash
npm run dev                      # Vite + @cloudflare/vite-plugin: web, Worker y Durable Objects en local (http://localhost:5173)
npx tsc --noEmit -p .            # comprobación de tipos (no hay script de lint)
npm test                         # Vitest dentro de workerd (@cloudflare/vitest-plugin): server, shared y client
npx vitest run test/server/api.test.ts            # un archivo
npx vitest run test/server/api.test.ts -t "texto" # un test por nombre
npm run e2e                      # Playwright, proyectos `desktop` y `movil` (Pixel 7); arranca `npm run dev` en :5173
npx playwright test e2e/carrera.spec.ts --project=desktop -g "texto"   # uno
npm run build                    # vite build (cliente + Worker)
npm run deploy                   # build + wrangler deploy (lo hace el usuario)
```

### Entorno local y tests

- **Variables locales:** `.dev.vars` (ignorado por Git) se copia de `.dev.vars.example` y lleva `TOKEN_SECRET`. En los tests de Vitest el secreto lo pone `vitest.config.ts`.
- **Secreto en producción:** `openssl rand -base64 32 | npx wrangler secret put TOKEN_SECRET`. Si falta o está vacío, toda la API responde 503 «descansando».
- **Servidor de los e2e:** reutilizan cualquier servidor que ya escuche en :5173. El estado local de los Durable Objects vive en `.wrangler/state`, compartido por todos los `npm run dev`, así que no mantengas otro servidor de desarrollo abierto mientras corren los e2e.
- **Concurrencia de los e2e:** van con `workers: "40%"`. Con más trabajadores el servidor de desarrollo se satura y salen fallos falsos.
- **Formato:** no hay Prettier en el proyecto (`npx prettier` lo descargaría y reformatearía a 80 columnas). El estilo es de líneas largas (~160) como el código que ya hay.

## Convenciones

- **Todo en español:** identificadores, comentarios, textos de la interfaz, nombres de tests y mensajes de commit (`feat: …`, `fix: …`, `test: …`, `docs: …`, `perf: …`). Los comentarios explican el porqué y son frases completas.
- **Movimiento:**
  - Se anima solo `transform` y `opacity`; se permiten transiciones cortas (≤ 200 ms) de color, borde o sombra en controles.
  - Todo respeta `prefers-reduced-motion`: en el JS con `useMovimientoReducido()` y en cada CSS con su propio bloque.
  - Las animaciones con Motion se escriben como `transform: "translate(...) scale(...)"`.
- **CSS:** un archivo por pantalla o componente en `src/client/tema/`, importado en orden desde `src/client/main.tsx` (los posteriores ganan a los anteriores). Colores y fuentes salen de los tokens de `base.css`: `--oro`, `--crema`, `--tapete-*`, `--fuente-titulo` (Playfair Display) y `--fuente-ui` (Inter).
- **Interfaz:** botones de 44 px como mínimo. En móvil, la mesa en vertical; desde `ORDENADOR_PX` (900 px), la mesa de ordenador. En móviles apaisados bajos, las mesas muestran «Gira el móvil para jugar» (`GirarMovil`).
- **Cartas:** se dibujan con `Naipe`, que usa las cartas CC0 de `@letele/playing-cards`. Los sonidos se sintetizan con Web Audio en `efectos/sonidos.ts`, sin archivos de audio.

## Arquitectura

### Servidor (`src/server/`)

- **`index.ts` (el Worker):**
  - Atiende `/api/*` con el mapa `RUTAS`.
  - Atiende `/parties/*` solo para las salas permitidas en `RUTA_PARTY` (`partida`, `mesa-blackjack`, `mesa-carrera`), mediante `routePartykitRequest`. Antes, `onBeforeConnect` valida el token HMAC.
  - La identidad llega a los Durable Objects **solo** en las cabeceras `x-jugador-id` y `x-apodo` que pone el Worker. Las cabeceras `x-partykit-*` del cliente, `_pk` y `token` se eliminan.
  - El resto de rutas son la SPA, servida como estáticos.
- **`Jugadores` (`jugadores.ts`):** una instancia global y la **única que toca las fichas**. Guarda perfiles, PIN (PBKDF2 con 10.000 iteraciones, por el límite de 10 ms de CPU del plan gratuito), bloqueos, el libro de apuestas, estadísticas en columnas de `jugadores` y rankings. Además aplica límites anti-abuso en memoria: registros por IP y partidas por jugador.
- **`Partida` (`partida.ts`):** un objeto por código. Es la sala: quién está conectado, el resumen de cada mesa y el ranking de la noche (que se va sumando con lo que mandan las mesas). Se cierra tras 30 min sin nadie.
- **`Mesa` (`mesa-base.ts`):** la clase genérica de las mesas. `MesaBlackjack` y `MesaCarrera` solo le dan su `juego`. Se encarga de:
  - una cola por mesa y aplicar `tick` antes de cada acción;
  - el **cobro en dos fases**: guarda la intención (`cobroId`), llama a `Jugadores.apostar(…, rondaId, cobroId)` y confirma en la misma escritura que la jugada; los cobros a medias se anulan con `anular`;
  - las liquidaciones idempotentes por `rondaId` (`${codigo}:${juego}:${ronda}`), que quedan pendientes y se reintentan si falla;
  - las alarmas, el límite de mensajes, los avisos a la sala y las tramas de error.

### Reglas de los juegos (`src/shared/juegos/`)

- Son reductores puros que implementan `Juego<E, A>` de `tipos.ts`: `crear`, `sentar`, `costo`, `aplicar`, `desconectar`, `tick`, `proximaAlarma`, `vista` y `resumen`, más los opcionales `proximoAviso` y `eventosEntre`.
- El tiempo y el azar entran como parámetros.
- `vista(estado, jugador, ahora)` es lo único que sale del servidor. Nunca incluye información oculta: la baraja, la carta tapada de la banca o los pasos futuros de la carrera.
- La carrera se sortea entera al cerrar las apuestas. Sus pasos los anuncia un temporizador en memoria (`proximoAviso`/`eventosEntre`), sin escrituras.

### Cliente (`src/client/`)

- React 18 + wouter + Motion.
- **`red/`:**
  - `api.ts`: HTTP y textos de error; un 5xx o una respuesta que no es JSON se muestra como «descansando».
  - `sesion.tsx`: el token, guardado en `localStorage` con la clave `timba.token`, además de `refrescar` y `refrescarFichas`.
  - `useMesa` y `usePartida`: los sockets con partysocket. Cada mensaje trae `ahora` del servidor y `reloj.ts` corrige el desfase para las cuentas atrás.
  - `useEnvioUnico`: evita el doble envío, atado a la respuesta a *tu* acción.
- **Pantallas de mesa:** convierten «vista + eventos» en un guion animado. Siempre acaban en la última vista, y al reconectar saltan a ella sin animar ni sonar.
  - Blackjack: `pantallas/blackjack/guion.ts` y `useGuion` (repartos desde el `Mazo`).
  - Carrera: `pantallas/carrera/escena.ts` (`planDeLote`, puro), `cola.ts` (una cola ordenada con un solo temporizador) y `useEscena`.
- **Piezas de mesa compartidas** en `componentes/` y `efectos/`:
  - `FichasApuesta` (bandeja con «Todo») y `CasillaApuesta` (la pila en el tapete);
  - `CartelPremio`, `EstadoMesa`, `AvisoMesa`, `FichasVolando`, `BarraMesa` y `SinMesa`;
  - los hooks `usePremio`, `useSalirDeMesa`, `useFichasAlDia`, `useBarajando` y `useSentado`.
  
  Reutilízalas: no copies lógica de una mesa a otra.

### Añadir un juego

1. Escribe el reductor en `src/shared/juegos/<juego>.ts` y amplía `IdJuego` y `CodigoError` si hace falta.
2. Crea `class MesaX extends Mesa` en `src/server/`.
3. Añade el binding en `wrangler.jsonc`, con una **migración nueva** (`v2`, `new_sqlite_classes`). La `v1` ya está desplegada: no la edites.
4. Añade el juego a `RUTA_PARTY` y a los resúmenes de `Partida`.
5. Crea la pantalla en `src/client/pantallas/` y su ruta en `App.tsx`.

## Restricciones que no hay que romper

- **Plan gratuito:** una noche típica (8 jugadores, 3 h) no puede pasar del **30 % de ningún límite diario** (filas escritas, peticiones, filas leídas). Lo vigila `test/server/presupuesto.test.ts`.
  - Por eso la mesa guarda una sola clave por cambio, reprograma la alarma solo si cambia su hora y solo avisa a la sala cuando cambia lo que la sala enseña.
  - Las lecturas de fichas, perfil y ranking son de coste constante, no recorren el historial.
- **El libro de fichas tiene que cuadrar siempre**, también con reconexiones, desalojos, reintentos de alarmas y varias pestañas. No muevas fichas fuera de `Jugadores` ni te saltes el cobro en dos fases.
- **El servidor manda:** el cliente solo envía intenciones. La reconexión a mitad de una ronda tiene que funcionar.
- **Apuestas:** sin tope; desde 10 fichas hasta todas las tuyas.

## E2E: mesas simuladas

`e2e/ayudas.ts` tiene `entrarSimulada`, `simularMesa` y `mensajeEstado`. Con ellas una prueba sustituye el socket de la mesa por uno simulado (`routeWebSocket`) y manda vistas y eventos exactos. Así se prueban animaciones, errores y reconexiones de forma determinista.

Los demás helpers son `registrar`, `apodoUnico`, `conSesion`, `abrirPartida` y `fichasDeApi`. Las pruebas «de verdad» (`registrar` y una partida real) se reservan para el flujo completo.
