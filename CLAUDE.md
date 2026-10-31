# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

La Timba es una web gratuita para jugar a las cartas con amigos. Alguien crea una **partida** con un código de 4 caracteres, QR o enlace. Dentro hay una **mesa por juego** (ahora Blackjack, Carrera de caballos y Póker). Las fichas y el ranking son globales.

- **Despliegue:** un único Cloudflare Worker con Durable Objects (SQLite) en el **plan gratuito**.
- **Producción:** https://la-timba.franteleco1278.workers.dev. Despliega el usuario con su cuenta; no despliegues tú.
- **Documentos:**
  - Spec (manda sobre el plan y sobre el código): `docs/superpowers/specs/2026-10-17-la-timba-design.md`
  - Plan original: `docs/superpowers/plans/2026-10-17-la-timba.md`
  - Spec del blackjack completo y de la carrera de seis tramos (amplía el anterior y, si chocan, manda): `docs/superpowers/specs/2026-10-29-blackjack-completo-design.md`, con su plan en `docs/superpowers/plans/2026-10-29-blackjack-completo.md`
  - Estado del desarrollo (qué queda y qué viene después): `docs/ESTADO.md`
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
  - Atiende `/parties/*` solo para las salas permitidas en `RUTA_PARTY` (`partida`, `mesa-blackjack`, `mesa-carrera`, `mesa-poker`), mediante `routePartykitRequest`. Antes, `onBeforeConnect` valida el token HMAC.
  - La identidad llega a los Durable Objects **solo** en las cabeceras `x-jugador-id` y `x-apodo` que pone el Worker. Las cabeceras `x-partykit-*` del cliente, `_pk` y `token` se eliminan.
  - El resto de rutas son la SPA, servida como estáticos.
- **`Jugadores` (`jugadores.ts`):** una instancia global y la **única que toca las fichas**. Guarda perfiles, PIN (PBKDF2 con 10.000 iteraciones, por el límite de 10 ms de CPU del plan gratuito), bloqueos, el libro de apuestas, estadísticas en columnas de `jugadores` y rankings. Además aplica límites anti-abuso en memoria: registros por IP y partidas por jugador.
- **`Partida` (`partida.ts`):** un objeto por código. Es la sala: quién está conectado, el resumen de cada mesa y el ranking de la noche (que se va sumando con lo que mandan las mesas). Se cierra tras 30 min sin nadie.
  - Los resúmenes viven solo en memoria y solo se escribe al cambiar el ranking. Si la sala sale de memoria, antes de enseñar nada le pregunta su resumen a cada mesa que no sepa (`Mesa.resumenSala`).
- **`Mesa` (`mesa-base.ts`):** la clase genérica de las mesas. `MesaBlackjack`, `MesaCarrera` y `MesaPoker` solo le dan su `juego`. Se encarga de:
  - una cola por mesa y aplicar `tick` antes de cada acción;
  - el **cobro en dos fases**: guarda la intención (`cobroId`), llama a `Jugadores.apostar(…, rondaId, cobroId)` y confirma en la misma escritura que la jugada; los cobros a medias se anulan con `anular`. La ronda a la que se cobra es `e.ronda`, salvo que el juego defina `rondaDelCobro` (el póker cobra a cuenta de la sesión);
  - las liquidaciones idempotentes por `rondaId` (`${codigo}:${juego}:${ronda}`), que quedan pendientes y se reintentan si falla. Un `Paso` lleva una `liquidacion` o, si varios jugadores cierran a la vez (los que se levantan al acabar una mano), una lista en `liquidaciones`; una con `visibleEn` se guarda ya, pero se paga cuando se ve (o ya, si el juego no tiene más avisos por delante);
  - lo que trae el reloj sin decisiones de nadie, desde memoria y sin escribir: los avisos (`proximoAviso`/`eventosEntre`) y los `tick` marcados `anunciado`, que guarda la siguiente escritura. La memoria puede ir por delante del almacenamiento, pero solo con lo que se puede rehacer igual;
  - las alarmas, el límite de mensajes, la pausa tras un `sin_fichas` (`PAUSA_SIN_FICHAS_MS`: las jugadas con coste de ese jugador se rechazan sin escribir ni preguntar), los avisos a la sala y las tramas de error.

### Reglas de los juegos (`src/shared/juegos/`)

- Son reductores puros que implementan `Juego<E, A>` de `tipos.ts`: `crear`, `sentar`, `costo`, `aplicar`, `desconectar`, `tick`, `proximaAlarma`, `vista` y `resumen`, más los opcionales `proximoAviso`, `eventosEntre` y `normalizar` (rellena en memoria lo que falte a un estado guardado por una versión anterior de las reglas; la mesa lo llama al cargar).
- El tiempo y el azar entran como parámetros.
- `vista(estado, jugador, ahora)` es lo único que sale del servidor. Nunca incluye información oculta: la baraja, la carta tapada de la banca, los pasos futuros de la carrera, las cartas quemadas y futuras del póker ni las de un jugador hasta que las enseña. Los eventos son iguales para todos: `carta_repartida` del póker no lleva la carta y cada uno ve las suyas en `misCartas`.
- **Póker**, en tres módulos puros:
  - `poker.ts` (`POKER` y el reductor): asientos, ciegas, rondas de apuestas, opciones, `tick`, faltas y desalojos, y la vista;
  - `poker-jugadas.ts`: `mejorJugada`, `compararJugadas` y `nombreJugada`, que usan también la pantalla y la tabla de jugadas;
  - `poker-botes.ts`: `calcularBotes` y `repartirBote` a partir de lo que aportó cada jugador (botes por nivel de all-in, lo que nadie iguala y la ficha impar).
- **Fichas del póker:** las de la mesa se cobran al sentarte y vuelven al levantarte; durante las manos solo se mueven dentro del reductor, nunca en `Jugadores`.
  - Cada vez que te sientas abres una **sesión**, y esa sesión es la ronda del libro (`${codigo}:poker:${sesion}`). Sentarse y `anadir` son cobros a cuenta de ella; levantarse la liquida con una fila (`apuesta` = todo lo comprado; `pago` = lo que queda en la mesa más lo añadido que aún no había entrado).
  - Sus `apuestas_pendientes` siguen vivas mientras estás sentado, así que el rescate responde `apuestas_pendientes`.
  - Cada sesión cuenta como una partida (`partidas_poker`, `victorias_poker`) y los rankings se actualizan al levantarte.
  - Invariante: montones, `porEntrar`, lo aportado a la mano y `abandonos` suman lo comprado menos lo pagado.
- La carrera se sortea entera al cerrar las apuestas. Sus pasos los anuncia un temporizador en memoria (`proximoAviso`/`eventosEntre`), sin escrituras.
- La carrera tiene 6 tramos (`CARRERA.TRAMOS`), en las líneas 1 a 6. La línea 7 se dibuja sin carta: un tramo se gira cuando todos lo han pasado y llegar a la casilla 8 termina la carrera, así que un séptimo casi nunca podría girarse.
- En el blackjack, la banca juega al cerrarse las decisiones y la ronda queda liquidada en esa escritura (fase `resultado`). La vista enseña la banca durante `BANCA_MS`, después el resultado y, al acabar, la ronda siguiente, todo desde memoria. En la banca, `resumen` devuelve `null` y la sala no se entera.
- **Casillas y manos del blackjack:**
  - Hay `BJ.CASILLAS` (7) casillas para `BJ.MAX_JUGADORES` (6) jugadores. Cada jugador ocupa una y puede pedir una segunda (`{ t: "apostar", segunda: true }`); si no queda ninguna, `sin_casilla`. Una mano abandonada ocupa su casilla hasta el fin de la ronda.
  - `manos` es una lista plana con `casilla` e `indice`, en ese orden. Cada jugador llega como mucho a `BJ.MAX_MANOS_JUGADOR` (4) contando las divisiones.
  - `pedir`, `plantarse`, `doblar`, `dividir` y `rendirse` actúan sobre `manoActiva(e, jugadorId)`, la primera que sigue jugando.
  - La liquidación es de una fila por jugador: `apuesta` y `pago` suman sus manos y su seguro.
  - `opciones` (de `opcionesDe`) dice a quien recibe la vista qué le permiten las reglas, y el cliente no las repite. El reductor no conoce las fichas: la pantalla oculta lo que no te llega y `Jugadores` lo rechaza con `sin_fichas`. `opciones.seguro` es el coste (`null` si no toca), no un booleano.
  - El ritmo del reparto y de la mirada de la banca (`BJ.ESCALONADO_MS`, `BJ.VUELO_MS`, `BJ.MIRA_MS`) vive en las reglas y el cliente lo lee de ahí, porque el servidor retrasa la banca lo que la pantalla tarda en enseñarlo (`esperaDeLaMirada`). Si cambias esos tiempos, cambian los dos lados.

### Cliente (`src/client/`)

- React 18 + wouter + Motion.
- **`red/`:**
  - `api.ts`: HTTP y textos de error; un 5xx o una respuesta que no es JSON se muestra como «descansando».
  - `sesion.tsx`: el token, guardado en `localStorage` con la clave `timba.token`, además de `refrescar` y `refrescarFichas`.
  - `useMesa` y `usePartida`: los sockets con partysocket. Cada mensaje trae `ahora` del servidor y `reloj.ts` corrige el desfase para las cuentas atrás.
  - `useEnvioUnico`: evita el doble envío, atado a la respuesta a *tu* acción.
- **Pantallas de mesa:** convierten «vista + eventos» en un guion animado. Siempre acaban en la última vista, y al reconectar saltan a ella sin animar ni sonar.
  - Blackjack (en `pantallas/blackjack/`):
    - `guion.ts` y `useGuion`: repartos desde el `Mazo`, la mirada de la banca y las divisiones. Cada carta se identifica con `claveCarta(ronda, de, mano, indice)`.
    - `manos.ts` (puro): la mano activa, el tamaño de las cartas para que tus manos quepan en fila, su sitio en el arco del ordenador y la agrupación de los demás jugadores.
    - `asientos.tsx`: tus manos (`MisManos`), los asientos de los demás en el ordenador (`AsientoOtro`) y sus pastillas en el móvil (`PastillaOtro`).
    - `useDeslizar.ts`: al dividir, las cartas se deslizan a su sitio nuevo sin desaparecer en ningún fotograma.
    - `useEspacio.ts`: mide el hueco real entre los vecinos. Si tus manos no caben ahí, se colocan al fondo del tapete.
    - `controles.tsx`: los paneles `Apostar`, `Decidir` y `PanelSeguro`, y `textoEstado`.
  - Carrera: `pantallas/carrera/escena.ts` (`planDeLote`, puro; la carta de cada paso sale `REVELADO_MS` antes de que avance el caballo), `cola.ts` (una cola ordenada con un solo temporizador) y `useEscena`.
  - Póker: `pantallas/poker/`.
    - `guion.ts` (`guionDelLote`, puro: en qué momento sale cada carta y vuela cada ficha) y `useGuion` (lo anima y retiene de la vista lo que aún no se ha visto).
    - `Tapete` y `Asiento`, con las posiciones de `asientos.ts` (en porcentaje del tapete).
    - `MisCartas` (tus cartas, tu jugada y Tapar), `controles.tsx` (`Sentarse`, `Decidir`, `PanelSubir`, `AnadirFichas` y `textoEstado`) y `subir.ts` (los límites y la cantidad escrita).
    - `TablaJugadas`: el diálogo con las diez jugadas y la tuya resaltada.
- **Piezas de mesa compartidas** en `componentes/` y `efectos/`:
  - `FichasApuesta` (bandeja con «Todo») y `CasillaApuesta` (la pila en el tapete);
  - `CartelPremio`, `EstadoMesa`, `AvisoMesa`, `FichasVolando`, `BarraMesa` y `SinMesa`;
  - los hooks `usePremio`, `useSalirDeMesa`, `useFichasAlDia`, `useBarajando` y `useSentado`.
  
  Reutilízalas: no copies lógica de una mesa a otra.

### Añadir un juego

1. Escribe el reductor en `src/shared/juegos/<juego>.ts` y amplía `IdJuego` y `CodigoError` si hace falta.
2. Crea `class MesaX extends Mesa` en `src/server/`.
3. Añade el binding en `wrangler.jsonc`, con una **migración nueva** (`new_sqlite_classes`): la siguiente será `v3`. La `v1` y la `v2` (`MesaPoker`) no se editan.
4. Añade el juego a `RUTA_PARTY` y a los resúmenes de `Partida`.
5. Crea la pantalla en `src/client/pantallas/` y su ruta en `App.tsx`.

## Restricciones que no hay que romper

- **Plan gratuito:** una noche típica (8 jugadores, 3 h) no puede pasar del **30 % de ningún límite diario** (filas escritas, peticiones, filas leídas). Lo vigila `test/server/presupuesto.test.ts`: con blackjack y carrera da el 27,2 % de las filas escritas y con blackjack y póker (330 rondas y 150 manos, unas 25 filas por mano), el 19,7 %.
  - Por eso la mesa guarda una sola clave por cambio, reprograma la alarma solo si cambia su hora y solo avisa a la sala cuando cambia lo que la sala enseña. Lo que trae el reloj sin decisiones no escribe.
  - Las lecturas de fichas, perfil y ranking son de coste constante, no recorren el historial.
- **El libro de fichas tiene que cuadrar siempre**, también con reconexiones, desalojos, reintentos de alarmas y varias pestañas. No muevas fichas fuera de `Jugadores` ni te saltes el cobro en dos fases.
- **El servidor manda:** el cliente solo envía intenciones. La reconexión a mitad de una ronda tiene que funcionar.
- **Apuestas:** sin tope; desde 10 fichas hasta todas las tuyas. En el póker, lo mismo al sentarte (`COMPRA_MIN`) y al añadir. En el blackjack, cada casilla lleva su apuesta, y la segunda casilla, doblar, dividir y el seguro se cobran cada uno con su cobro en dos fases.

## E2E: mesas simuladas

`e2e/ayudas.ts` tiene `entrarSimulada`, `simularMesa` y `mensajeEstado`. Con ellas una prueba sustituye el socket de la mesa por uno simulado (`routeWebSocket`) y manda vistas y eventos exactos. Así se prueban animaciones, errores y reconexiones de forma determinista.

Los demás helpers son `registrar`, `apodoUnico`, `conSesion`, `abrirPartida` y `fichasDeApi`. Las pruebas «de verdad» (`registrar` y una partida real) se reservan para el flujo completo; la del póker abre dos contextos de navegador, juega una mano y comprueba contra `/api/fichas` que las dos cuentas siguen sumando lo mismo.
