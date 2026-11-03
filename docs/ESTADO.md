# Estado del desarrollo

Notas para retomar el trabajo en local. Última actualización: 31/10/2026.

## Dónde está todo

- **`main`** tiene la v1 (PR #1) y el blackjack completo con la carrera de seis tramos (PR #2).
- **`feat/poker`** tiene la mesa de póker: revisión final hecha; pendiente de fusionar. Aún no tiene PR. Spec: `docs/superpowers/specs/2026-10-31-poker-design.md`; plan: `docs/superpowers/plans/2026-10-31-poker.md`.
- **Lo siguiente:** el chat de partida (ver «Después de este plan»).
- **Plan terminado:** `docs/superpowers/plans/2026-10-29-blackjack-completo.md`, con su spec `docs/superpowers/specs/2026-10-29-blackjack-completo-design.md`.

| Tarea | Qué | Estado |
|---|---|---|
| 1 | Carrera con 6 tramos | hecha y revisada |
| 2 | La carta de cada paso sale del mazo | hecha y revisada |
| 3 | Blackjack: 7 casillas, dos manos, una liquidación por jugador | hecha y revisada |
| 4 | Seguro, la banca mira, rendirse | hecha y revisada |
| 5 | Dividir | hecha y revisada |
| 6 | Mesa y presupuesto (más la optimización en memoria) | hecha y revisada |
| 7 | Pantalla: apostar con dos manos | hecha y revisada |
| 8 | Pantalla: varias manos, dividir y rendirse | hecha y revisada |
| 9 | Pantalla: seguro y la banca mira | hecha y revisada |
| 10 | README, CLAUDE.md y capturas | hecha |
| — | Revisión final de toda la rama | hecha |
| — | PR a `main` | hecho (#2) |

Plan del póker (`feat/poker`):

| Tarea | Qué | Estado |
|---|---|---|
| 1 | Jugadas: reconocer y comparar las diez | hecha y revisada |
| 2 | Botes: niveles de all-in, empates y ficha impar | hecha y revisada |
| 3 | Reductor: asientos, ciegas y apuestas | hecha y revisada |
| 4 | Reductor: final de mano, faltas y prueba aleatoria | hecha y revisada |
| 5 | La mesa en el servidor (`MesaPoker`, migración `v2`, sesión en el libro) | hecha y revisada |
| 6 | Presupuesto | hecha y revisada |
| 7 | Pantalla: tapete, asientos y sentarse | hecha y revisada |
| 8 | Pantalla: decidir, subir, tapar y enseñar | hecha y revisada |
| 9 | Pantalla: tabla de jugadas | hecha y revisada |
| 10 | Pantalla: guion, animaciones y sonido | hecha y revisada |
| 11 | Mano de verdad, documentación y capturas | hecha |
| — | Revisión final de toda la rama | hecha |
| — | PR a `main` | pendiente |

## Datos para seguir

- **Presupuesto:** `test/server/presupuesto.test.ts` exige que la noche típica quede en el 30 % o menos de cada límite diario. Con la medida pesimista (1 de cada 3 rondas con dos casillas, seguro y división) da 27,2 % de filas escritas, 14,7 % de peticiones a Durable Objects, 7,7 % de peticiones al Worker y 0,4 % de filas leídas. El 53 % de las escrituras son del libro de `Jugadores`.
- **Presupuesto con póker:** con 330 rondas de blackjack y 150 manos de póker en 3 horas da 19,7 % de filas escritas (19.700), 9 % de peticiones a Durable Objects (9.000), 4,3 % de peticiones al Worker (4.300) y 0,2 % de filas leídas (12.400). Una mano son unas 25 filas escritas (24,8 medidas), y sentarse y levantarse se reparten entre las manos.
- **Despliegue:** lo haces tú con `npm run deploy`. Las mesas guardadas por la versión anterior se ponen al día solas al cargar (`Juego.normalizar`). El póker añade la migración `v2` (`MesaPoker`) y las columnas `partidas_poker` y `victorias_poker` de `jugadores`, que se crean al arrancar.

## Decisiones que tomé por mi cuenta (revísalas)

Cada una lleva lo que costaría si me equivoqué.

- `opciones` del blackjack son solo reglas. La pantalla oculta Dividir, Doblar y Seguro si no te llegan las fichas, y `Jugadores` rechaza con `sin_fichas`. *Si está mal: se verían botones sin fichas.*
- No hay campo `rendida`: se usa el estado `"rendido"`. `opciones.seguro` es el coste. Los seguros se crean al abrir la fase. `mano_dividida = {jugadorId, casilla, indice}`.
- Una mano abandonada ocupa su casilla hasta el fin de la ronda, y su jugador no vuelve a apostar en esa ronda.
- **La ronda queda decidida al cerrar las decisiones.** Quien sale durante la animación de la banca cobra su resultado, en vez de perderlo (está anotado en el spec §2.3). *Si está mal: quien sale en ese segundo cobra en vez de perder. Cambiarlo obliga a rehacer una liquidación ya guardada.*
- «+ Segunda mano» antes de apostar exige 2 casillas libres, porque con 1 la segunda daría `sin_casilla` seguro. *Si está mal: nada, es más estricto que el texto literal.*
- La segunda mano solo se ofrece **antes** de apostar la primera, aunque el servidor admitiría añadirla después. *Si está mal: es una mejora de producto pendiente.*
- En la Tarea 8 se arreglaron también los solapes en ventanas grandes (1440×900 y 1920×1080). Cuando tus manos no caben entre los vecinos, se colocan al fondo del tapete.
- Con blackjack de la banca tras un 10 visible, el resultado dura lo que tarda la pantalla en enseñar el reparto y la mirada (`esperaDeLaMirada`).

Decisiones tuyas en esta sesión:

- El objetivo de presupuesto sigue en el 30 %, sin más optimizaciones.
- Tras un `sin_fichas`, la mesa rechaza en memoria durante 2 s las jugadas de pago de ese jugador. Así se evita que un cliente trucado agote las escrituras del día. *Coste: un jugador real con el saldo desfasado puede ver «No tienes fichas» otra vez durante esos 2 s.*

Decisiones de la Tarea 10, ya en local:

- También se rehicieron las capturas de la carrera, aunque el plan solo pedía las del blackjack: aún enseñaban 7 tramos.
- El spec nuevo se alineó con lo construido donde las decisiones de arriba lo cambiaban: sin campo `rendida`, `opciones.seguro` es el coste, la pantalla comprueba las fichas y «+ Segunda mano» pide 2 casillas libres.

## Decisiones del póker (revísalas)

Cada una lleva lo que costaría si me equivoqué.

- **Tapete móvil de 300×363** (no 300×392, el boceto aprobado). Hace falta para que tus cartas y los botones de decidir quepan en 360×640 sin desplazar la página; la disposición de los asientos no cambia. *Si está mal: reajustar `asientos.ts` y la altura de `.pk-tapete`.*
- **«Póker» se oculta en la barra por debajo de 480 px** (queda solo para los lectores de pantalla). Con «Jugadas» no cabían «← Sala», el título, el sonido y las fichas, y el contador se cortaba. *Si está mal: un cambio pequeño en `barra-mesa.css`.* Entre 480 y 600 px el título sí se ve y se midió en la Task 11 (con 940 y con 1.234.567 fichas): no hay desplazamiento horizontal, nada se pisa y entre «Póker» y «Jugadas» quedan 8 px como mínimo, en 480 px con 1.234.567 fichas.
- **`Juego.aplicar` recibe `apodo?`** como sexto parámetro: el asiento necesita el apodo y no puede venir del cliente. *Si está mal: un parámetro más en la interfaz.*
- **`calcularBotes` ya no pierde fichas** si ningún jugador vivo aportó y hay retirados con aportes (pasa de verdad: la ciega grande se levanta antes del flop). Esas fichas forman un bote de los vivos. *Si está mal: el bote se vería distinto un instante; el reparto final no cambia.*
- **All-in en el river:** sin cartas por salir se aplica el orden normal al enseñar, y quien pierde no enseña (el spec solo destapa antes de sacar las de la mesa). *Si está mal: quitar una condición en `cerrarMano`.*
- **All-in cortos acumulados no reabren las apuestas.** Coincide con el spec §2.4, pero las reglas TDA sí reabrirían si varios all-in cortos suman una subida completa. *Decides tú.*
- **La sesión es la ronda del libro** (`${codigo}:poker:${sesion}`) y el rescate se bloquea con `apuestas_pendientes` mientras estás sentado. Cada sesión cuenta como una partida.
- **La mano real destapó:** nada. El e2e de verdad (dos navegadores, una mano a igualar y pasar hasta el showdown y levantarse) pasó a la primera en los dos proyectos.
- **El e2e de verdad lee las fichas del servidor** (`GET /api/fichas`), no con `fichasDeApi`, que es una maqueta de la API para las mesas simuladas.
- **Límite de 10 sesiones por hora y jugador** (`POKER.SESIONES_POR_HORA`, error `demasiadas_sesiones`), añadido en la revisión final. Sentarse y levantarse en bucle no cuesta fichas, pero cada ciclo son unas 13 filas escritas y un script podría agotar las 100.000 diarias y dejar toda La Timba «descansando». Los instantes de las sesiones van en el estado de la mesa, en la misma escritura de `sentarse`, así que no cuestan ninguna fila extra. *Si está mal: 10 puede quedarse corto para una noche de mucho entrar y salir; es un número en `POKER`.*
- **La mesa de póker ya no pide `/api/fichas` en cada mano:** el saldo no cambia entre manos y los efectos de sentarse, levantarse y añadir ya lo ponen al día. El spec §4.4 se corrigió a 25 filas por mano y 3.700 por noche.
- **Capturas rehechas** (`poker-*` y `sala-*`): la del póker enseñaba a Pablo all-in con 220 y el botón «Igualar 40»; ahora `opciones.igualar`, las apuestas delante de cada asiento y el bote cuadran. La sala enseña las tres mesas. Mismas medidas que antes y menos de 400 KB.
- **El texto del rescate** dice ahora «Tienes fichas en juego: espera a que acabe tu ronda o levántate de la mesa de póker», porque sentado en el póker esa ronda no acaba hasta levantarte.

## Detalles menores del póker que la revisión deja para después

Ninguno bloquea la fusión.

**Reglas y servidor**

- Jugadas: rama muerta en `altaDeEscalera` (`poker-jugadas.ts:75`); faltan tests de escalera de color al 5 y de seis seguidas; `?? 0` innecesario en `FUERZA`.
- Botes: la fusión de botes seguidos es inalcanzable (`poker-botes.ts:33,63-65`); sombreado de `vivo` en el test (`:200`); la prueba aleatoria no comprueba la regla de la ficha impar (falta 5 entre 3 → 2, 2, 1).
- Reductor:
  - faltan tests de recuperar `puedeSubir` tras una subida completa, y `cerrarCalle` repite `cerrarUno` en el test;
  - `apodo?` es opcional en `aplicar`;
  - `porIgualar` podría ser negativo fuera del flujo normal (`poker.ts:200-202`);
  - si el único agresor se levanta con varios rivales con fichas, los demás deben igualar su apuesta.
- Prueba aleatoria: el detector de filtraciones exige palo antes que valor y no comprueba que reconozca cartas; hay puntos ciegos (levantados, añadir, apuesta en liquidación) que cubre `poker-final`; aserción vacía en `poker-final.test.ts:316`.
- Mesa: sin test de `anunciado` con liquidaciones (`mesa-base.ts:386`); test de base con una sola columna de póker; la pausa `sin_fichas` rechaza 2 s una compra válida tras pedir de más; el comentario de `confirmar` se queda corto (`mesa-base.ts:435`).
- Presupuesto: el techo va justo (25 frente a 24,8); `DESPERTARES_DE_SALA_POR_MANO` es supuesta; «ronda a ronda» no incluye despertar ni sentarse; la fórmula está repetida (`:184`, `:413`, `:444`); `4 * 1000` fijo (`:427`). Al cobrar a quien está solo hay dos `setAlarm` más y una petición más al despertar `Partida`.

**Pantalla**

- Mesa y asientos: helper de 44 px duplicado en `e2e/poker.spec.ts` (`:375-401`); `textoEstado` sin test unitario; falta el flujo mirando → sentarse a mitad de mano; `fuera` sin texto para lectores en `Asiento.tsx:835`; `refrescarFichas` de más al reconectar; comentario largo en `asientos.ts`.
- Decidir y subir:
  - `useEnvioUnico` quedaría mejor con forma funcional y un test A→B→A; hay dos instancias del hook (`MesaPoker.tsx:561`) y su firma es larga;
  - el «Levantarme» de confirmar sigue abierto si acaba la mano (`MesaPoker.tsx:660`);
  - Enter no confirma en `PanelSubir` y «1.000» se rechaza;
  - `localStorage` dentro de `setState` (`MisCartas.tsx:707`);
  - sonidos desiguales en Decidir;
  - la hoja va al final del `main` por portal, lejos del botón en el orden de tabulación.
- Tabla de jugadas: `desbordaLista` se calcula y no se comprueba (`e2e/poker.spec.ts:183`); `waitForTimeout(400)` (`:182`); `useMemo` para la jugada; los estilos del póker están en `barra-mesa.css`; un clic en el fondo al arrastrar una selección cierra la tabla.
- Guion:
  - «Se reparte la mano» sale también en barrido y flop (`guion.ts:256`);
  - «Enseñar mis cartas» sale antes de que se enseñen las manos y adelanta que no ganas (`controles.tsx:113`);
  - el reparto se come unos 4,6 s del primer turno con 8 jugadores;
  - «¡Ganas +N!» enseña lo cobrado, no el neto (`useGuion.ts:92`);
  - no hay e2e de un lote encolado con el guion en marcha;
  - la comparación alto ≤ reposo es frágil en `e2e/poker.spec.ts:1311`, y solo se prueban 3 de los 7 destinos de bote.

## Detalles menores que la revisión final del blackjack dejó para después

Ninguno bloquea la fusión.

**Reglas y servidor**

- `dividir` fuera de decisiones responde `fase_incorrecta`, pero `rendirse` responde `accion_invalida`. Habría que unificar en `fase_incorrecta`.
- El bucle «jugando → plantado» está repetido en 5 sitios de `blackjack.ts`.
- Tests:
  - el test «dos manos que doblan» está mal nombrado;
  - falta un test de seguro perdido más división en una sola fila;
  - el comentario de `ManoBJ.dividida` es inexacto;
  - el test del reparto por casillas asume `BJ.CASILLAS === 7` escrito a mano;
  - `normalizar` trata de forma distinta una casilla ausente y un índice ausente;
  - no hay test de un estado viejo en banca o resultado;
  - el servidor no prueba importes impares ni un 21 tras dividir de principio a fin.
- La ronda especial del presupuesto no comprueba que de verdad hubo seguro y división. Si cambia el orden del reparto, mediría de menos sin avisar.
- El coste de despertar la sala (hasta 2 peticiones a las mesas) no se mide, y `resumenSala` no tiene tiempo límite.
- El evento `barajado` se pierde tras un desalojo cuando `tick(resultado)` cierra unas apuestas vencidas.
- El texto «Juega la banca» de `TarjetaMesa` está casi muerto.
- Si se pierde de verdad la instancia, los conectados se saltan la revelación.
- Tras el despliegue, una mesa guardada en la fase banca antigua sigue haciendo perder al que sale, y el cliente ya no avisa.
- `ESPERA_MS` (8 s) en los tests de servidor tiene un JSDoc que culpa a los Durable Objects fríos, cuando la causa era el zapato. `partida.test.ts:55` mantiene su propio límite de 2000 ms.

**Pantalla**

- Apostar con dos manos:
  - hay una rama muerta en `MesaBlackjack.tsx` (`misManos.length === 0 ? 1 : 0`);
  - el efecto que limpia la segunda casilla vacía no tiene test;
  - puede quedar una segunda «preparada» huérfana tras una reconexión perdida;
  - «¡Todo!» en una de las dos casillas puede confundir.
- Varias manos:
  - el modo «al fondo» no tiene histéresis, así que puede saltar a mitad de un reparto;
  - no hay test del modo al fondo con dividir y el vuelo de las cartas;
  - la fila al fondo roza el borde de madera;
  - en mesas llenas de 900 a 1440 px los vecinos se solapan entre sí (ya pasaba antes);
  - las salidas de `FilaManos` y `Mano` están anidadas;
  - `--solape` cambia de golpe al pedir carta.
- Seguro:
  - estaría bien avisar «Te desconectaste: sin seguro» al reconectar;
  - los botones de decisión están activos durante la mirada de 0,7 s;
  - una anotación del e2e de 3 navegadores es engañosa;
  - `useEnvioUnico` solo se quedaría esperando si llegaran dos errores iguales a un mismo envío: un segundo toque no lo bloquea, porque `enviar` limpia el error (se comprobó con tres `sin_fichas` seguidos).
- Carrera:
  - `PASO_COMPRIMIDO_MS` está sin uso;
  - un título de e2e es exagerado;
  - falta un test de reconexión con la carta en el aire;
  - hay un test vacío «no hay séptimo».

- Seguro (de la última revisión):
  - si al repartir con un as todos los que tienen mano están desconectados, la mirada sigue durando solo 700 ms (`esperaDeLaMirada(0, false)` en `abrirSeguro`);
  - `Naipe.tsx` mantiene su propio `VUELO_S = 0.48` en vez de usar `BJ.VUELO_MS`;
  - el aviso de salir dice «tus apuestas» en plural aunque tengas una sola mano.

## E2E en la nube de Claude Code

La Playwright del proyecto (1.64.1) pide chromium 1248, y allí solo hay la 1243. Se usó una copia de `playwright.config.ts` con `use.launchOptions.executablePath = "/opt/pw-browsers/chromium"`. En tu Mac no hace falta.

## Después de este plan

1. **Póker** (hecho en `feat/poker`, con la revisión final hecha; pendiente de fusionar): Texas Hold'em sin límite con todas sus reglas, tabla de jugadas y botón para tapar o enseñar tus cartas. Ver su spec.
2. **Chat de partida** (decidido, lo siguiente): un chat por código de partida, visible en la sala y en todas sus mesas, solo para quien tiene el código.
   - Va por el socket de la sala, que ya está abierto en todas las pantallas.
   - Guarda los últimos 30 mensajes en una sola fila de `Partida`, con una escritura por mensaje. En memoria no bastaría: `Partida` hiberna y lo perdería. Con unos 300 mensajes por noche, sube unos 0,3 puntos las filas escritas.
   - Quien entra tarde o recarga ve esos mensajes.
   - Lleva límite de longitud y de mensajes por segundo.
   - Pendiente de diseñar: cómo se ve en un móvil de 360 px sin tapar la mesa, seguramente con un botón y un contador de no leídos.
   - Necesita su propio spec antes de implementarse.
3. **La Bomba** (juego de palabras).
