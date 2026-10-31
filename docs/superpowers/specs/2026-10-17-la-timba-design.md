# La Timba — Diseño (v1)

> Nombre provisional. Fecha: 2026-10-17. Estado: pendiente de revisión.

## 1. Objetivo

Una web para jugar a juegos de cartas con amigos. Cualquiera crea una **partida** (una sala virtual con un código), los demás se unen desde el navegador del móvil o del ordenador, y dentro hay **una mesa por juego** entre las que se puede ir y venir. Un **ranking con estadísticas** alimenta el pique entre amigos.

Tiene dos propósitos a la vez:
- **Jugar de verdad** con amigos en quedadas.
- **Pieza de portfolio**: debe verse cuidada, tener código limpio y una demo pública que se pueda probar en solitario.

### Criterios de éxito

| Criterio | Cómo se comprueba |
|---|---|
| Unirse es rápido | Crear partida y que 2 amigos entren por QR en menos de 30 s |
| Se siente bien jugar | Animaciones a 60 fps en un móvil de gama media (sin tareas largas durante animaciones en el perfilador de Chrome) |
| Las fichas siempre cuadran | Tests de integración: tras cualquier secuencia de rondas, fichas finales = iniciales + suma de netos |
| Coste 0 € | Una noche típica (8 jugadores, 3 h) usa como mucho el 30 % de cada límite diario gratuito. Medido con `test/server/presupuesto.test.ts`: filas escritas 27 %, peticiones a Durable Objects 15 %, peticiones al Worker 7 %, filas leídas 0,5 %. Antes decía «menos del 5 %», imposible con un libro de fichas duradero: ≈ 2.800 apuestas por noche necesitan al menos una escritura cada una |
| Demo de portfolio | Un visitante solo puede registrarse y jugar ambos juegos sin nadie más |
| Reconexión | Cerrar y reabrir la pestaña te devuelve a tu mesa, con tu mano, en menos de 3 s |

## 2. Alcance

### Dentro de v1
- Identidad global con **apodo + PIN de 4 cifras**.
- **Crear partida** → código de 4 caracteres + QR + enlace. Unirse con cualquiera de los tres.
- **Sala de la partida**: mesas disponibles, quién está en cada una, ranking de esta partida.
- Juegos: **Blackjack** y **Carrera de caballos**.
- **Fichas globales**: 1.000 al empezar; **rescate** de 200 al quedarse a cero (cuenta como quiebra).
- **Ranking global** y **ranking de esta partida**.
- Sonido (con silencio) y vibración en Android.
- Diseño adaptado a móvil y ordenador.

### Fuera de v1 (diseño preparado para añadirlo)
- Más juegos: póker Texas Hold'em, Mayor o menor, Ocho loco…
- Dividir pareja y seguro en blackjack.
- Chat, avatares, logros, modo espectador.
- Modo sin internet (red local).

## 3. Decisiones tomadas y por qué

| Decisión | Alternativas descartadas | Motivo |
|---|---|---|
| **Servidor central en internet** (cualquiera crea la partida) | Anfitrión en el PC de cada uno | Con anfitrión local el ranking se fragmenta y alojar exige instalar algo |
| **Cloudflare Workers + Durable Objects (plan gratis)** | Render, Koyeb, Oracle Cloud | Render duerme y corta los WebSockets; Koyeb y Oracle piden tarjeta. Cloudflare es gratis, no se duerme cortando conexiones y tiene un objeto con estado por sala |
| **PartyServer** (+ `partysocket` en el cliente) | Colyseus, Socket.IO | Colyseus necesita un servidor Node siempre encendido; PartyServer está hecho para Durable Objects |
| **TypeScript** en servidor y cliente | — | Un solo lenguaje; las reglas se comparten |
| **React + Vite + Motion** | Godot web | Interfaz nítida, carga rápida en móvil, animaciones fluidas |
| **Baraja francesa** | Baraja española | Petición del usuario |
| **Cartas vectoriales de Adrian Kennard (CC0)** vía `@letele/playing-cards` | PNG/SVG de Deck of Cards API, diseño propio | Las PNG de la API son de 226 px (borrosas en pantallas densas); sus SVG vienen sin recortar. Las de Kennard son vectoriales y de dominio público |
| **Baraja y reparto propios en el servidor** | Usar Deck of Cards API en tiempo real | Evita trampas, latencia y dependencia externa; la lógica es trivial |
| **Estilo casino clásico** | Neón, arcade | Elegido por el usuario en los bocetos |

## 4. Arquitectura

Un único proyecto de Cloudflare Worker: una URL y un único despliegue.

```
Navegador (React + Motion)
   │  HTTP  → /api/*        (entrar, crear partida, ranking, perfil, rescate)
   │  WS    → /parties/*    (sala y mesas, con reconexión automática)
   ▼
Worker (src/server/index.ts)
   ├─ /api/*      → manejadores HTTP
   ├─ /parties/*  → valida token y código → routePartykitRequest
   └─ resto       → recursos estáticos de la web (SPA)

Durable Objects (cada uno con su propio SQLite)
   ├─ Partida        nombre = código ("KXP4")
   ├─ MesaBlackjack  nombre = código
   ├─ MesaCarrera    nombre = código
   └─ Jugadores      nombre = "global" (una sola instancia)
```

### 4.1 Unidades y responsabilidades

| Unidad | Qué hace | Depende de |
|---|---|---|
| `shared/cartas.ts` | Tipos de carta, creación de barajas (n barajas), barajado Fisher-Yates con `crypto.getRandomValues` | — |
| `shared/juegos/blackjack.ts` | Reglas puras: `(estado, accion) → estado`, puntuación, pagos, vista por jugador | `cartas.ts` |
| `shared/juegos/carrera.ts` | Reglas puras de la carrera, pagos, vista por jugador | `cartas.ts` |
| `shared/protocolo.ts` | Tipos de todos los mensajes cliente↔servidor | — |
| `server/mesa-base.ts` | Clase base `Mesa` (extiende `Server` de PartyServer): conexiones, persistencia del estado tras cada cambio, temporizadores con alarmas, envío de la vista a cada jugador, cobro y pago vía Jugadores, aviso de ocupación a la Partida | PartyServer, Jugadores, Partida |
| `server/mesa-blackjack.ts`, `server/mesa-carrera.ts` | Conectan las reglas puras con la clase base | `mesa-base.ts`, reglas |
| `server/partida.ts` | Quién está en la partida y en qué mesa, resumen de mesas, ranking de la partida, cierre por inactividad | Jugadores |
| `server/jugadores.ts` | Perfiles, PIN, bloqueo por intentos, fichas, apuestas, liquidaciones, estadísticas, ranking global | SQLite del DO |
| `server/auth.ts` | Hash de PIN (PBKDF2, WebCrypto) y token firmado (HMAC-SHA256) | — |
| `client/` | Pantallas (Entrada, Sala, Mesa Blackjack, Mesa Carrera, Ranking, Perfil), componentes (Carta, Fichas, Temporizador…), hooks de red | `shared/` |

**Añadir un juego nuevo** = un archivo de reglas en `shared/juegos/`, una clase pequeña que extienda `Mesa`, su pantalla en `client/` y registrar el binding en `wrangler.jsonc`.

### 4.2 Estructura de carpetas

```
src/
  shared/     cartas.ts, protocolo.ts, juegos/{blackjack,carrera}.ts
  server/     index.ts, auth.ts, jugadores.ts, partida.ts, mesa-base.ts, mesa-blackjack.ts, mesa-carrera.ts
  client/     main.tsx, pantallas/, componentes/, red/, sonidos/
public/       fuentes, sonidos, reverso de carta
wrangler.jsonc   bindings de los 4 Durable Objects (new_sqlite_classes) + secreto TOKEN_SECRET
vite.config.ts   React + @cloudflare/vite-plugin
```

## 5. Flujos

### 5.1 Entrar
1. El usuario escribe apodo y PIN → `POST /api/entrar`.
2. Si el apodo existe y el PIN es correcto → `{ token, jugador }`.
3. Si el apodo **no existe** → `{ existe: false }`; el cliente pregunta «¿Crear el perfil "X"?» y, si confirma, `POST /api/registro`. (Evita crear perfiles por una errata.)
4. Si el PIN falla → `{ error: "pin", intentosRestantes }`. Tras 5 fallos, bloqueo de 15 min para ese apodo.
5. El token se guarda en `localStorage` y dura 30 días.

Apodo: 3–16 caracteres, letras, números y `_`; único sin distinguir mayúsculas.

### 5.2 Crear y unirse a una partida
1. `POST /api/partidas` (con token) → genera un código de 4 caracteres del alfabeto `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (sin I, L, O, 0, 1), comprueba que no esté activo y llama a `Partida.iniciar(creador)`.
2. Respuesta: `{ codigo }`. El cliente muestra código, QR y enlace `https://<dominio>/p/KXP4`.
3. Unirse: abrir el enlace, escanear el QR o escribir el código. El cliente abre un WebSocket a `/parties/partida/KXP4?token=…`.
4. El Worker valida token y que la partida exista antes de enrutar; si no, responde con error.
5. La partida se marca como cerrada tras **30 min sin conexiones** (alarma).

### 5.3 Moverse entre mesas
- Entrar en una mesa = abrir WebSocket a `/parties/mesa-blackjack/KXP4` o `/parties/mesa-carrera/KXP4`.
- La mesa informa a la Partida de su ocupación (`Partida.actualizarMesa(juego, resumen)`), que lo difunde a la sala.
- Salir voluntariamente con apuesta en juego = **apuesta perdida**.

### 5.4 Protocolo de mesa
Cliente → mesa:
```ts
{ t: "apostar", cantidad }              // blackjack
{ t: "apostar", caballo: "H"|"D"|"C"|"S", cantidad }  // carrera (se puede repetir para varios caballos)
{ t: "pedir" } | { t: "plantarse" } | { t: "doblar" }
{ t: "salir" }
```
Mesa → cliente:
```ts
{ t: "estado", version, vista, eventos }   // vista = lo que ESTE jugador puede ver
{ t: "error", codigo, mensaje }
```
- `eventos` lista lo ocurrido desde el estado anterior (`carta_repartida`, `carta_girada`, `caballo_avanza`, `pago`…) para que el cliente lo anime en orden y luego se asiente en `vista`.
- Al conectar o reconectar se envía `eventos: []` y la vista completa.
- La vista nunca incluye la baraja ni la carta tapada de la banca antes de girarla.

### 5.5 Fichas (siempre a través de Jugadores)
- `Jugadores.apostar(jugadorId, cantidad, rondaId)` → `ok` | `sin_fichas`. Se descuenta al apostar.
- `Jugadores.liquidar(rondaId, resultados[])` → idempotente: si `rondaId` ya está en `rondas_liquidadas`, no hace nada.
- Rescate: `POST /api/rescate`, solo si fichas = 0 y sin filas en `apuestas_pendientes` → +200 y `quiebras + 1`.

## 6. Reglas de los juegos

### 6.1 Blackjack
- 6 barajas; se rebaraja cuando queda menos del 25 %.
- Hasta 6 jugadores por mesa.
- **Apuestas**: 15 s; mínimo 10 y sin máximo: hasta todas tus fichas («Todo»). Quien no apuesta mira esa ronda.
- **Reparto**: 2 cartas a cada jugador; banca 1 visible + 1 tapada.
- **Decisiones simultáneas** durante 15 s: Pedir, Plantarse, Doblar (solo con 2 cartas; dobla la apuesta y recibe exactamente 1 carta).
- Tiempo agotado o desconexión → plantarse automáticamente.
- **Banca**: pide hasta 17 y se planta en cualquier 17 o más.
- **Pagos**: blackjack natural 3:2; ganar 1:1; empate devuelve la apuesta; pasarse pierde.
- As vale 11 o 1 (el mayor valor que no te pase de 21).

### 6.2 Carrera de caballos
- Hasta 12 jugadores por mesa.
- Caballos: los 4 ases. Pista: 6 tramos, cada uno con una carta boca abajo sacada al inicio (en las líneas 1 a 6; la línea 7 no lleva carta).
- **Apuestas**: 20 s; a uno o varios caballos; mínimo 10 y sin máximo por caballo: hasta todas tus fichas («Todo»).
- **Carrera**: se levanta una carta del mazo cada ~0,8 s; avanza 1 casilla el caballo de su palo.
- Cuando todos los caballos han superado un tramo, se gira la carta de ese tramo y el caballo de su palo retrocede 1 casilla.
- Si el mazo se agota, se rebaraja el descarte.
- Gana el primero en llegar a la meta (la casilla 8, pasada la línea 7). Pago fijo ×4 (apuesta incluida).

### 6.3 Común
- Salir a propósito con apuesta en juego → se pierde.
- La desconexión **no** se considera salir a propósito: la mano se resuelve con normalidad.

## 7. Datos (SQLite del objeto Jugadores)

```sql
jugadores (
  id INTEGER PRIMARY KEY,
  apodo TEXT UNIQUE COLLATE NOCASE,
  pin_hash TEXT, pin_sal TEXT,
  fichas INTEGER DEFAULT 1000,
  quiebras INTEGER DEFAULT 0,
  racha_actual INTEGER DEFAULT 0,
  mejor_racha INTEGER DEFAULT 0,
  partidas, victorias, ganancias, mayor_premio INTEGER DEFAULT 0,          -- estadísticas, al día al liquidar
  partidas_blackjack, victorias_blackjack, partidas_carrera, victorias_carrera INTEGER DEFAULT 0,
  creado_en INTEGER
)
resultados (
  id INTEGER PRIMARY KEY,
  jugador_id INTEGER, juego TEXT, codigo_partida TEXT, ronda_id TEXT,
  apuesta INTEGER, neto INTEGER,          -- neto: + ganado / − perdido
  resultado TEXT,                          -- 'gana' | 'pierde' | 'empata'
  momento INTEGER
)
apuestas_pendientes ( cobro_id TEXT PRIMARY KEY, ronda_id TEXT, jugador_id INTEGER, cantidad INTEGER ) WITHOUT ROWID  -- se borran al liquidar
rondas_liquidadas ( ronda_id TEXT PRIMARY KEY ) WITHOUT ROWID
cobros_anulados ( cobro_id TEXT PRIMARY KEY ) WITHOUT ROWID
intentos ( apodo TEXT PRIMARY KEY COLLATE NOCASE, fallos INTEGER, bloqueado_hasta INTEGER )
```

- **Una fila de `resultados` por jugador y ronda**: `apuesta` = total apostado en la ronda (incluye doblar o varios caballos); `resultado` sale del signo de `neto` (> 0 gana, < 0 pierde, = 0 empata).
- **Racha**: se incrementa con cada `gana`, se pone a 0 con `pierde`; `empata` no la cambia.
- **Estadísticas**: partidas jugadas, % de victorias por juego, ganancias totales (suma de `neto`) y mayor premio (mayor `neto` positivo) van en columnas de `jugadores`, que `liquidar` pone al día en la misma actualización por jugador. `resultados` se guarda como historial, sin índices: nada lo lee durante el juego.
- **Ranking global**: por fichas por defecto; pestañas por ganancias totales, % de victorias (con al menos 10 rondas), mayor premio, mejor racha y quiebras. Top 50 + la posición propia. Solo lee `jugadores`.
- **Ranking de la partida**: lo lleva la Partida. Cada mesa le pasa, con su resumen, el neto de cada jugador en las rondas que liquida, y la sala los suma por apodo (una ronda repetida no cuenta dos veces). Empieza de cero al reabrir la partida.
- Las mesas y la partida guardan su propio estado en el almacenamiento de su DO (no en estas tablas).

## 8. Seguridad
- PIN con PBKDF2 + sal (WebCrypto); nunca en texto plano. 5 fallos → 15 min de bloqueo.
- Token HMAC-SHA256 con secreto `TOKEN_SECRET` (variable secreta de Cloudflare). 30 días.
- El servidor valida cada acción (fase, turno, fichas, límites). El cliente nunca decide resultados.
- Barajado con `crypto.getRandomValues`.
- Límite de 20 mensajes por segundo por conexión; el exceso se descarta y, si persiste, se cierra la conexión.

## 9. Aspecto y sensación
Bocetos aprobados en `.superpowers/brainstorm/` (`look-and-feel-v3.html`).

- **Estilo casino clásico**: tapete verde con degradado radial, marco de madera, detalles en dorado `#d4af37`, texto crema `#f3e7c4`, rojo `#b3122e`.
- **Cartas**: `@letele/playing-cards` (CC0, diseño de Adrian Kennard). El paquete pesa ~550 KB sin comprimir: se carga en diferido al entrar en la primera mesa.
- **Reverso propio**: granate con celosía dorada y ♠ central.
- **Tipografía**: Playfair Display (títulos, cifras) e Inter (interfaz).
- **Animaciones** con Motion, solo `transform` y `opacity`: repartir desde el mazo, giro 3D de cartas, pulsación de botones, total que aparece con rebote, destellos y fichas volando al ganar, contador de fichas que sube, transiciones sala ↔ mesa. Con `prefers-reduced-motion` se reducen a fundidos.
- **Sonido**: carta, fichas, victoria; packs CC0 (p. ej. Kenney; verificar licencia al elegirlos). Botón de silencio recordado en el navegador.
- **Vibración**: corta al ganar o pasarse, solo donde exista `navigator.vibrate` (Android).
- **Diseño adaptable**: en móvil, tu mano grande abajo, banca arriba y el resto en píldoras; en ordenador, la mesa completa con asientos alrededor. Botones de al menos 44 px de alto.

## 10. Errores y reconexión
- `partysocket` reconecta solo; al reconectar la mesa envía la vista completa.
- El estado de cada mesa se persiste tras cada cambio (en una sola clave) y los temporizadores usan **alarmas** del DO, así que hibernar o reiniciar no rompe la ronda.
- La carrera se sortea entera al cerrarse las apuestas y se guarda una vez. Sus pasos los anuncia un temporizador en memoria, sin escribir nada; la alarma guardada es la de la meta y hace de respaldo: si la mesa cae a mitad de carrera, sigue desde la hora y la meta liquida igual.
- Liquidaciones idempotentes por `rondaId`.
- Mensajes de error para el usuario: partida inexistente, PIN incorrecto con intentos restantes, apodo bloqueado, reconectando, fichas insuficientes, mesa llena, y «La Timba está descansando, vuelve mañana» si se supera el límite gratuito diario.

## 11. Pruebas
- **Unitarias (Vitest)** de `shared/`: puntuación con ases, blackjack natural, banca hasta 17, doblar, pagos, rebarajado; carrera (avance, retroceso por tramo, ganador, pago); barajas sin cartas repetidas; vistas que no filtran información oculta.
- **Integración** con `@cloudflare/vitest-pool-workers` (DOs reales en local): ronda completa apostar → jugar → liquidar; fichas siempre cuadran; liquidación repetida no paga dos veces; reconexión a mitad de ronda; bloqueo por PIN.
- **Extremo a extremo (Playwright)**: 3 contextos de navegador; crear partida, unirse por código, jugar una ronda de cada juego; también en viewport de móvil.

## 12. Riesgos y temas abiertos
- **Cuota gratuita de Cloudflare**: hay un reporte en la comunidad (10-10-2026) de rechazos por debajo del límite publicado en el plan gratis. Mitigación: mensaje de error controlado y vigilar el panel de uso.
- **`@letele/playing-cards` es v0.1.0** y de un solo autor. Mitigación: es CC0, así que se pueden copiar los SVG al proyecto si el paquete da problemas.
- **Nombre definitivo** y dominio: por decidir (el subdominio `*.workers.dev` es gratis).
