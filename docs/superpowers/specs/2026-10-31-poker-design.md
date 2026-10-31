# Mesa de póker: diseño

Fecha: 2026-10-31. Este documento amplía el spec principal (`2026-10-17-la-timba-design.md`); donde los dos chocan, manda este.

## 1. Objetivo

Añadir a cada partida una tercera mesa: **Texas Hold'em sin límite** entre los jugadores, con todas sus reglas, en la que se sientan de 2 a 8 personas alrededor de un tapete, también en el móvil.

Saldrá bien si:

- una mano se juega con fluidez a partir de 2 personas, en un móvil de 360 px y en el ordenador;
- el libro de fichas cuadra siempre, también con varios all-in a la vez, reconexiones y desalojos;
- quien no sabe jugar puede consultar en la mesa qué jugadas hay y cuál tiene;
- una noche típica con póker sigue en el 30 % o menos de cada límite diario.

Fuera de alcance: torneos, otras variantes (Omaha, Stud), ciegas configurables o crecientes, un límite de compra, el ranking en vivo durante una sesión y el chat, que tendrá su propio spec.

## 2. Reglas

### 2.1 La mesa

- Baraja de 52 cartas, barajada de nuevo en cada mano.
- De **2 a 8 jugadores**, con 8 asientos numerados del 0 al 7.
- Ciegas fijas de **5/10**.
- Es **sin límite**: cualquiera puede apostar en cualquier momento hasta todas las fichas que tenga en la mesa.
- Todas las constantes viven en `POKER`:

```ts
export const POKER = {
  MAX_JUGADORES: 8,
  MIN_JUGADORES: 2,
  CIEGA_PEQUENA: 5,
  CIEGA_GRANDE: 10,
  COMPRA_MIN: 10,
  TURNO_MS: 20_000,
  RESULTADO_MS: 6_000,
  /** Lo que tarda la pantalla en enseñar cada carta o grupo de cartas de la mesa que sale sin apuestas de por medio. */
  CALLE_MS: 900,
  SOLO_MS: 600_000,
  FALTAS_MAX: 2,
} as const;
```

### 2.2 Sentarse, añadir y levantarse

- **Mirar:** entrar en la mesa no te sienta. Ves la partida sin cartas ni fichas en juego, sin límite de personas.
- **Sentarte:** eliges con cuántas fichas, desde `COMPRA_MIN` hasta todas las tuyas. No hay máximo. Ocupas el asiento libre de número más bajo. Si no queda ninguno, el error es `sin_asiento`.
- **Entrar a mitad de mano:** esperas a la siguiente, sin poner ninguna ciega de más.
- **Añadir fichas:** se puede en cualquier momento. Si estás en una mano, las fichas añadidas entran en tu montón al empezar la siguiente: nunca cuentan en la mano en curso.
- **Levantarte:**
  - Vuelve a tu saldo todo lo que tengas en la mesa.
  - Si estás en una mano, te retiras: lo ya apostado se queda en el bote.
  - La pantalla pide confirmación solo si estás en una mano.
- **Quedarte a cero:** si acabas la mano sin fichas ni nada añadido pendiente, te levantas solo, y así puedes pedir el rescate.

### 2.3 Una mano

1. **Empieza** sola cuando hay al menos `MIN_JUGADORES` sentados y conectados con fichas. Juegan esa mano quienes cumplen eso en ese momento.
2. **Botón:** la primera mano lo lleva el primer asiento ocupado. Después pasa al siguiente asiento que juegue la mano.
3. **Ciegas:** la pequeña la pone el siguiente al botón y la grande, el siguiente a la pequeña. Con 2 jugadores, el botón pone la pequeña.
4. **Cartas:** dos para cada jugador, una a una desde el siguiente al botón.
5. **Rondas de apuestas:** antes del flop, en el flop (3 cartas), en el turn (1) y en el river (1). Antes de cada carta o grupo de cartas de la mesa se quema una, como en una mesa real.
6. **Quién habla:**
   - Antes del flop, el siguiente a la ciega grande.
   - En las demás rondas, el primero que siga en juego después del botón.
   - Con 2 jugadores, el botón habla primero antes del flop y último después.
7. **Una ronda acaba** cuando todos los que pueden actuar han actuado y han igualado la apuesta. La ciega grande puede subir aunque nadie haya subido.
8. **La mano acaba** cuando solo queda uno sin retirarse o al terminar el river.

### 2.4 Apuestas

- **Acciones:** retirarse, pasar (si no hay nada que igualar), igualar, apostar o subir.
- **Cantidad:** subir indica el total al que llega tu apuesta en esa ronda (`hasta`).
- **Subida mínima:** al menos lo que subió el anterior. Si nadie ha subido en la ronda, al menos la ciega grande.
- **All-in:** se puede igualar o subir con todas tus fichas aunque no lleguen a lo necesario.
- **All-in corto:** un all-in que no llega a una subida completa no reabre las apuestas: quien ya había actuado solo puede igualar o retirarse.
- **Ciega corta:** quien no llega a una ciega la pone con lo que tenga y va all-in.
- **Tiempo:** `TURNO_MS` por turno. Si se acaba, pasas si puedes y si no, te retiras. Cuenta como una falta.

### 2.5 El final de la mano

- **Si solo queda uno,** gana sin enseñar nada.
- **Si queda más de uno,** se destapan las cartas de la mesa que falten y se comparan las manos.
- **La mejor jugada** son las cinco mejores cartas de las siete disponibles (tus dos y las cinco de la mesa). De mayor a menor:

| Jugada | Qué es |
|---|---|
| Escalera real | 10, J, Q, K y A del mismo palo |
| Escalera de color | Cinco seguidas del mismo palo |
| Póquer | Cuatro cartas iguales |
| Full | Un trío y una pareja |
| Color | Cinco del mismo palo |
| Escalera | Cinco seguidas |
| Trío | Tres cartas iguales |
| Doble pareja | Dos parejas |
| Pareja | Dos cartas iguales |
| Carta alta | Ninguna de las anteriores |

- **Desempates:** se comparan las cartas que forman la jugada y después las que la acompañan. Los palos nunca desempatan.
- **El as** vale alto y también bajo en A-2-3-4-5. No se dobla: Q-K-A-2-3 no es escalera.
- **Botes paralelos:** cada jugador compite solo por lo que pudo igualar de cada rival. Hay un bote por cada nivel de all-in.
- **Lo que nadie iguala** vuelve a quien lo apostó antes de comparar manos.
- **Empates:** el bote se reparte a partes iguales. La ficha impar de cada bote va al primer ganador a la izquierda del botón.
- **Orden al enseñar:** primero quien hizo la última apuesta o subida. Si no hubo ninguna, el primero a la izquierda del botón. Una mano se enseña si gana algún bote o si gana o empata con la mejor enseñada hasta entonces. Las demás no se enseñan.
- **Todos all-in:** si ya no pueden apostar más, las cartas de quienes siguen en la mano se destapan antes de sacar las de la mesa. `resultado` se alarga `CALLE_MS` por cada carta o grupo de cartas que falte, para que dé tiempo a verlas.
- **Enseñar por tu cuenta:** en `resultado`, cualquiera que no haya enseñado puede hacerlo, también quien se retiró.

### 2.6 Desconexión y fichas atrapadas

- **Te desconectas:** tu turno se resuelve por tiempo. Al acabar la mano, si sigues desconectado, te levantas con tus fichas. Entre manos, te levantas en el acto.
- **Dos faltas seguidas** (`FALTAS_MAX`) te levantan al acabar la mano, aunque el servidor crea que sigues conectado. Cualquier acción tuya pone las faltas a cero.
- **Solo en la mesa:** si no hay rivales durante `SOLO_MS`, te levantas con tus fichas. La mesa queda dormida, sin alarmas.

Así unas fichas no se quedan nunca en una mesa abandonada.

## 3. Fichas

Las fichas de la mesa se cobran al sentarte y vuelven al levantarte. Durante las manos solo se mueven dentro del reductor, sin tocar `Jugadores`.

- **Sesión:** cada vez que te sientas abres una sesión con su número (`sesion`). Es la ronda que ve el libro de fichas: `${codigo}:poker:${sesion}`.
- **Sentarte y añadir** son cobros en dos fases de `Mesa`, a cuenta de esa sesión.
- **Levantarte** liquida la sesión con una fila: `apuesta` es todo lo comprado y `pago`, lo que te queda en la mesa más lo añadido que aún no había entrado.
- **Rescate:** cobrar y liquidar funcionan como siempre. Las filas de `apuestas_pendientes` siguen vivas mientras estás sentado, así que el rescate responde `apuestas_pendientes` y nadie puede sentarse con todo y pedir 200 gratis.
- **Estadísticas:** cada sesión cuenta como una partida, ganada, perdida o empatada según el signo del neto. Hacen falta las columnas `partidas_poker` y `victorias_poker`: hoy lo que no es blackjack se cuenta como carrera.
- **Rankings:** el global, tus estadísticas y el de la noche se actualizan al levantarte, no en cada mano.
- **Invariante:** en todo momento, las fichas de los asientos, lo añadido pendiente y lo aportado a la mano en curso suman todo lo comprado menos todo lo pagado al levantarse. Quien se levanta a mitad de mano deja lo aportado en el bote.

## 4. Servidor

### 4.1 Cambios en `Mesa` y en el Worker

- **Cobro a cuenta de otra ronda:** `Juego.rondaDelCobro?(e, jugadorId, accion): number`, opcional. Sin él, sigue siendo `e.ronda`.
- **Varias liquidaciones en un cambio:** `Paso.liquidacion` admite una lista, porque varios jugadores pueden levantarse al acabar una mano.
- **Migración:** `v2` con `new_sqlite_classes: ["MesaPoker"]`. La `v1` no se toca.
- **Rutas:** `mesa-poker` en `RUTA_PARTY`, `poker` en `IdJuego`, `MESA_DE` y los resúmenes de `Partida`.
- **Sala:** la tarjeta «Próximamente» pasa a `TarjetaMesa juego="poker"`, con sus textos de fase.

### 4.2 Reglas (`src/shared/juegos/`)

Tres archivos puros:

- `poker.ts`: el reductor, que implementa `Juego<EstadoPoker, AccionPoker>`.
- `poker-jugadas.ts`: `mejorJugada(cartas)`, `compararJugadas(a, b)` y `nombreJugada(jugada)`. Lo usan también la pantalla y la tabla de jugadas.
- `poker-botes.ts`: calcula los botes y los reparte, a partir de lo que aportó cada jugador en la mano.

```ts
export type AccionPoker =
  | { t: "sentarse"; fichas: number }
  | { t: "anadir"; fichas: number }
  | { t: "levantarse" }
  | { t: "salir" }
  | { t: "retirarse" }
  | { t: "pasar" }
  | { t: "igualar" }
  | { t: "subir"; hasta: number }
  | { t: "ensenar" };

export interface OpcionesPoker {
  retirarse: boolean;
  pasar: boolean;
  /** Lo que cuesta igualar (con all-in, lo que te quede), o `null` si no toca. */
  igualar: number | null;
  /** Entre qué totales puedes subir, o `null` si no puedes. */
  subir: { min: number; max: number } | null;
  ensenar: boolean;
}
```

- `sentar` no ocupa asiento: solo devuelve la conexión a quien ya estaba sentado.
- `salir` es lo que manda `useSalirDeMesa`: hace lo mismo que `levantarse`.
- `CodigoError` añade `sin_asiento`, con el texto «La mesa está completa». Una subida que no cumple las reglas responde `apuesta_invalida`.

### 4.3 Vista e información oculta

`vista` es lo único que sale del servidor:

- **Para todos:** la mano (`ronda`), la fase, `calle`, `finFase`, las cartas de la mesa ya abiertas, los botes, quién tiene el turno y cada asiento (apodo, fichas, lo apostado en la ronda, estado, conectado, botón, si tiene cartas y las que haya enseñado).
- **Solo para quien la recibe:** `misCartas`, `opciones` y lo añadido que aún no ha entrado.
- **Nunca:** la baraja, las cartas quemadas, las cartas futuras de la mesa ni las cartas de otro jugador antes de enseñarse.

Fases: `esperando`, `mano` y `resultado`. `calle` es `preflop`, `flop`, `turn` o `river`.

Eventos: `mano_empezada`, `ciega`, `carta_repartida`, `accion`, `calle_abierta`, `cartas_ensenadas` y `bote_ganado`. Los eventos son los mismos para todas las conexiones, así que `carta_repartida` nunca lleva la carta: cada uno ve las suyas en `misCartas`.

### 4.4 Coste

- Cada jugada es una escritura de la mesa más su alarma de turno, que Cloudflare factura como otra fila: unas 28 filas por mano con 4 jugadores.
- Unas 150 manos en 3 horas son unas 4.200 filas. Quien juega al póker deja de jugar en otra mesa, que gasta más: 11.300 filas la carrera y 15.900 el blackjack.
- `test/server/presupuesto.test.ts` mide una mano con all-in y enseñar, añade `poker` a `TECHO` y comprueba una noche con blackjack y póker (330 rondas y 150 manos). El objetivo sigue en el 30 %.

## 5. Pantalla

### 5.1 La mesa

- **Tapete** ovalado con madera y paño, como en las otras mesas, también en el móvil: en vertical en el móvil y en horizontal desde `ORDENADOR_PX`.
- **Tú** siempre abajo. Los demás se colocan alrededor, en el orden de sus asientos.
- **Cada asiento:** placa con el nombre, dos cartas boca abajo si sigue en la mano y, delante, sobre el tapete, su pila de fichas con la cantidad. Nunca la cantidad junto al nombre.
- **Lo apostado** va hacia el centro, delante de cada asiento. El botón es una ficha con una D.
- **Centro:** las cinco cartas de la mesa, con huecos para las que faltan, y el bote.
- **Quien mira** ve la mesa completa y «Sentarme».
- Reutiliza `Naipe`, `Mazo`, `BarraMesa`, `EstadoMesa`, `AvisoMesa`, `CartelPremio`, `FichasVolando`, `FichasApuesta`, `Reconectando`, `GirarMovil`, `useEnvioUnico`, `useSalirDeMesa` y `useFichasAlDia`.

### 5.2 Tus cartas

- Se ven grandes abajo, con tu pila y el texto de tu jugada actual («Pareja de reyes»), calculado con `poker-jugadas.ts`.
- **Tapar:** un botón da la vuelta a tus cartas solo en tu pantalla y oculta también el texto. No cambia nada para los demás. Se recuerda en el navegador, como el silencio.
- **Enseñar mis cartas:** aparece en `resultado` si `opciones.ensenar` lo permite.

### 5.3 Decidir y subir

- **Fila principal:** Retirarse · Pasar o Igualar N · Apostar o Subir, según `opciones`.
- **Subir** abre un panel con la cantidad en grande, un deslizador desde `opciones.subir.min` hasta `max`, − y + para afinar, la cantidad escribible y un botón All-in.
- Si tus fichas no llegan a la subida mínima, solo se ofrece All-in.
- Mientras no sea tu turno, los botones no se muestran y el panel reserva su alto, para que la mesa no salte.

### 5.4 Tabla de jugadas

- El botón «Jugadas» de la barra la abre en cualquier momento, también sin estar sentado.
- Muestra las diez jugadas de §2.5, de mayor a menor, y **resalta la que tienes ahora**.
- Si te toca con la tabla abierta, un aviso con el tiempo te lo dice.
- Se cierra con su botón y con Escape, y es un diálogo accesible.

### 5.5 Movimiento y sonido

- Las cartas salen del mazo, las de la mesa se giran, y las fichas vuelan al bote y a quien gana.
- Siguen valiendo las reglas de siempre: solo `transform` y `opacity`, movimiento reducido, botones de 44 px como mínimo y móvil apaisado con «Gira el móvil para jugar».
- Al reconectar se salta a la vista sin animar ni sonar.

## 6. Casos límite

- **Se levanta quien tiene el turno:** cuenta como retirarse y el turno pasa al siguiente.
- **Se levantan todos menos uno a mitad de mano:** ese uno gana el bote.
- **Dos pestañas:** la cola de la mesa ordena y la segunda acción recibe error sin efecto.
- **Doble toque en «Sentarme»:** la segunda acción responde `accion_invalida`, sin cobrar dos veces.
- **Dos personas a por el último asiento:** la segunda recibe `sin_asiento`, sin cobro.
- **Fichas insuficientes al sentarte o añadir:** `Jugadores` responde `sin_fichas` y no cambia nada.
- **Un solo jugador con fichas y los demás all-in:** no hay más apuestas: se destapan las manos y salen las cartas que falten.

## 7. Pruebas

- **Jugadas, en tests puros:** cada categoría, todos los desempates, escalera con as bajo, y escalera de color frente a color con siete cartas.
- **Botes, en tests puros:** all-in a tres y cuatro niveles, empates con ficha impar, retirados que aportaron y lo que nadie iguala.
- **Reductor:** ciegas y orden de palabra con 2, 3 y 8 jugadores, subida mínima, all-in corto que no reabre, ciega corta, faltas y levantarse a mitad de mano.
- **Prueba aleatoria:** miles de manos con un generador determinista y acciones al azar; tras cada paso se comprueba el invariante de §3 y que la vista no filtra cartas.
- **Mesa con Durable Objects reales:** sentarse, añadir, levantarse con liquidación exacta, varios levantados a la vez, desalojo y reconexión a mitad de mano, y rescate bloqueado mientras estás sentado.
- **Presupuesto:** §4.4.
- **E2E con mesa simulada:** 8 jugadores en 360×640 sin desplazamiento horizontal y con botones de 44 px, tapar, enseñar, subir con el deslizador y escribiendo, tabla de jugadas con su jugada resaltada, reconexión sin animar y movimiento reducido.
- **E2E de verdad:** una mano completa con dos navegadores, desde sentarse hasta levantarse, con las fichas cuadradas.
- **Revisión visual:** capturas en 360×640, 412×915 y 1280×720 de cada estado nuevo.
