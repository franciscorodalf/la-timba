# Estado del desarrollo

Notas para retomar el trabajo en local. Última actualización: 30/10/2026.

## Dónde está todo

- **Rama de trabajo:** `feat/la-timba-v1-830fa7`, ya rebasada sobre `main`. `main` tiene la v1, que se fusionó con el PR #1.
  Todavía no hay PR para esta rama. Se abre uno solo, contra `main`, cuando el plan esté terminado.
- **Plan en curso:** `docs/superpowers/plans/2026-10-29-blackjack-completo.md`.
- **Spec que manda:** `docs/superpowers/specs/2026-10-29-blackjack-completo-design.md`, que amplía `docs/superpowers/specs/2026-10-17-la-timba-design.md`.

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
| 10 | README, CLAUDE.md y capturas | **pendiente** |
| — | Revisión final de toda la rama y PR a `main` | **pendiente** |

## Cómo seguir en local

```bash
git fetch origin && git checkout feat/la-timba-v1-830fa7 && git pull
npm ci
cp .dev.vars.example .dev.vars        # si no lo tienes
npx tsc --noEmit -p . && npm test     # ~690 tests
npm run e2e                           # sin otro `npm run dev` abierto
```

- Para seguir el plan con Claude Code: «Sigue el plan `docs/superpowers/plans/2026-10-29-blackjack-completo.md` desde la Tarea 10 con subagent-driven-development; lee `docs/ESTADO.md`». El registro de progreso de las sesiones (`.superpowers/`) no está en Git: este archivo lo sustituye.
- **Presupuesto:** `test/server/presupuesto.test.ts` exige que la noche típica quede en el 30 % o menos de cada límite diario. Con la medida pesimista (1 de cada 3 rondas con dos casillas, seguro y división) da 27,2 % de filas escritas, 14,7 % de peticiones a Durable Objects, 7,7 % de peticiones al Worker y 0,4 % de filas leídas. El 53 % de las escrituras son del libro de `Jugadores`.
- **Despliegue:** lo haces tú con `npm run deploy`. Las mesas guardadas por la versión anterior se ponen al día solas al cargar (`Juego.normalizar`).

## Lo que falta del plan

1. **Tarea 10** (ver el plan), y además:
   - el spec viejo (2026-10-17) dice «Pista: 7 tramos» y ahora son 6;
   - en el spec nuevo §5.1, «+ Segunda mano» aparece antes de apostar solo si hay **2 o más** casillas libres (ver decisiones);
   - `CLAUDE.md` debe mencionar `manos.ts`, `useDeslizar.ts`, `asientos.tsx`, `claveCarta(ronda, de, mano, indice)` y las constantes de tiempo compartidas en `BJ`;
   - capturas nuevas para el README.
2. **Revisión final de toda la rama** (`main..feat/la-timba-v1-830fa7`), que decide cuáles de los detalles menores de abajo hay que arreglar antes de fusionar.
3. Abrir el PR a `main`.

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

## Detalles menores apuntados para la revisión final

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
  - `useEnvioUnico` se queda esperando si llega el mismo error dos veces en menos de `ERROR_MS` (ya pasaba antes).
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

1. **Chat de partida** (decidido): un chat por código de partida, visible en la sala y en todas sus mesas, solo para quien tiene el código.
   - Va por el socket de la sala, que ya está abierto en todas las pantallas.
   - Guarda en la memoria de `Partida` los últimos 30–50 mensajes, sin escribir en la base de datos.
   - Lleva límite de longitud y de mensajes por segundo.
   - Pendiente de diseñar: cómo se ve en un móvil de 360 px sin tapar la mesa (seguramente un botón con contador de no leídos), y si quien entra tarde ve los últimos mensajes.
   - Necesita su propio spec antes de implementarse.
2. **La Bomba** (juego de palabras).
3. **Póker**, con un botón para enseñar u ocultar tus cartas.
