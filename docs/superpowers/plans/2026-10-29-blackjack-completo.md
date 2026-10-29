# Blackjack completo y pulido de la carrera — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el blackjack tenga seguro, la banca que mira su carta, dividir, rendirse y dos manos por jugador (7 casillas), y que la carrera tenga 6 tramos y una carta de paso que se vea salir del mazo.

**Architecture:**
- **Reglas:** todo lo nuevo vive en el reductor puro `src/shared/juegos/blackjack.ts` (opción A del spec: una lista plana de manos con `casilla` e `indice`).
- **Mesa:** `Mesa` cobra cada jugada extra con su cobro en dos fases de siempre.
- **Pantalla:** convierte los eventos nuevos en guion animado y usa `opciones` de la vista para saber qué botones enseñar.
- **Carrera:** solo cambia la constante `TRAMOS` en las reglas y la animación de la carta en el cliente.

**Tech Stack:** TypeScript, Cloudflare Workers + Durable Objects (PartyServer), React 18 + Motion, Vitest (`@cloudflare/vitest-plugin`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-blackjack-completo-design.md`, que amplía `docs/superpowers/specs/2026-10-17-la-timba-design.md`. Lee también `CLAUDE.md` (arquitectura, comandos y restricciones).

## Global Constraints

- **Español en todo:** identificadores, comentarios, textos, nombres de tests y commits (`feat:`, `fix:`, `test:`, `docs:`, `perf:`). Cada commit termina con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Movimiento:**
  - Solo se anima `transform` y `opacity`; se permiten transiciones de ≤ 200 ms de color, borde o sombra en controles.
  - Todo respeta `prefers-reduced-motion`: en el JS con `useMovimientoReducido()` y en cada CSS con su propio bloque.
  - Botones de 44 px como mínimo.
- **CSS:** un archivo por pantalla o componente en `src/client/tema/`, importado en `src/client/main.tsx`.
- **Formato:** no uses Prettier (no es dependencia del proyecto). Sigue el estilo de líneas largas que ya hay.
- **Fichas:**
  - No se mueven fichas fuera de `Jugadores`.
  - Cada cobro extra (segunda casilla, dividir, doblar, seguro) pasa por el cobro en dos fases de `Mesa` (`juego.costo` → `Jugadores.apostar(…, cobroId)`).
  - Una sola fila de liquidación por jugador y ronda.
- **Presupuesto:** la noche típica del test de presupuesto debe quedar ≤ 30 % de cada límite diario gratuito.
- **Información oculta:** `vista` nunca incluye la carta tapada de la banca antes de `carta_girada`, ni el zapato.
- **Valores del spec:**
  - `BJ.CASILLAS = 7`, `BJ.MAX_MANOS_JUGADOR = 4`, `BJ.SEGURO_MS = 10_000`, `BJ.DIVIDIR_EXTRA_MS = 10_000`;
  - `BJ.MAX_JUGADORES` sigue en 6;
  - `CARRERA.TRAMOS = 6`;
  - el seguro cuesta `floor(suma de apuestas del jugador / 2)` y paga 2:1;
  - rendirse devuelve `floor(apuesta / 2)`;
  - un 21 tras dividir paga 1:1.
- **Comandos:**
  - tipos: `npx tsc --noEmit -p .`
  - unit: `npm test` (o `npx vitest run <archivo> -t "<nombre>"`)
  - e2e: `npm run e2e` (o `npx playwright test <archivo> --project=desktop -g "<nombre>"`). No tengas otro `npm run dev` abierto mientras corren.

## Review Focus

1. **Reconexión a mitad de ronda** con manos divididas o durante el seguro: al volver se ven las mismas manos, la activa marcada y el panel correcto, sin repetir animaciones ni sonidos. *Lo prueba la Task 8, «al reconectar con manos divididas…».*
2. **Sin fichas suficientes** para dividir, doblar o el seguro: el botón no se ofrece. Si el servidor responde `sin_fichas`, se ve el texto de error y el botón deja de esperar. *Tasks 6, 8 y 9.*
3. **Doble toque en «Apostar 100 + 50»**, o dos jugadores a por la última casilla: nunca hay doble cobro, y `sin_casilla` se explica con un texto claro. *Tasks 6 y 7.*
4. **Salir de la mesa** con dos manos, manos divididas o seguro cogido: se pide confirmación, se pierde todo y las fichas cuadran. *Tasks 6 y 9.*
5. **Móvil de 360×640** con 4 manos tuyas y 5 jugadores más: sin desplazamiento horizontal, botones ≥ 44 px y cartas legibles. *Task 8.*

---

### Task 1: Carrera con seis tramos

**Files:**
- Modify: `src/shared/juegos/carrera.ts` (`CARRERA.TRAMOS: 6`).
- Modify: `src/client/pantallas/carrera/pista.tsx`. Las líneas de casilla se dibujan desde `CARRERA.META - 1` (7 líneas), no desde `TRAMOS`. Solo las `TRAMOS` primeras pueden tener la clase `--encendida`.
- Test: `test/shared/carrera.test.ts`, `e2e/carrera.spec.ts` (helper `tramos()` y aserciones de 7 cartas → 6), `test/server/*.test.ts` si alguno cuenta 7 tramos.

**Interfaces:**
- Produces: `CARRERA.TRAMOS === 6`. La vista trae `tramos` con longitud 6.

- [ ] **Step 1: Tests que fallan**

```ts
// test/shared/carrera.test.ts
it("hay 6 tramos, en las líneas 1 a 6: la línea 7 no tiene carta", () => {
  expect(CARRERA.TRAMOS).toBe(6);
  const e = carrera.crear(T0, rng);
  expect(e.tramos).toHaveLength(6);
  expect(carrera.vista(e, null, T0).tramos).toHaveLength(6);
});
it("con todos los caballos en la casilla 6 o más se gira el tramo 6 y no hay séptimo", () => { /* estado con posiciones ≥ 6, un paso: tramosGirados === 6 y ninguno más */ });
```

```ts
// e2e/carrera.spec.ts (mesa simulada)
await expect(tramosDeLaPista(page)).toHaveCount(6);
await expect(page.locator(".carrera-linea:not(.carrera-linea--salida)")).toHaveCount(7);
```

- [ ] **Step 2:** Ejecuta `npx vitest run test/shared/carrera.test.ts`. Debe fallar con `expected 7 to be 6`.
- [ ] **Step 3:** Implementa el cambio de constante y las 7 líneas de la pista. Revisa también `MesaCarrera.tsx` (`SIN_TRAMOS`), que ya usa la constante.
- [ ] **Step 4:** Ejecuta `npm test` y `npx playwright test e2e/carrera.spec.ts`. Todo debe pasar.
- [ ] **Step 5:** Commit `feat: la carrera tiene seis tramos (el séptimo casi nunca podía girarse)`.

---

### Task 2: La carta de cada paso sale del mazo y se gira en el centro de la pista

**Files:**
- Modify: `src/client/pantallas/carrera/escena.ts`. `planDeLote` adelanta la carta y retrasa el avance `REVELADO_MS`.
- Modify: `src/client/pantallas/carrera/pista.tsx`. Componente nuevo `CartaDelPaso`, en una capa sobre la pista que no recorta (como `carrera-festejos`). La `Esquina` sigue siendo la pila de descartes.
- Create: `src/client/tema/mesa-carrera-carta.css`, con su bloque de movimiento reducido, importado en `main.tsx` después de `mesa-carrera-caballos.css`.
- Test: `test/client/escena-carrera.test.ts`, `e2e/carrera.spec.ts`.

**Interfaces:**
- Produces: `export const REVELADO_MS = 300` en `escena.ts`. El avance del caballo es un marco a `REVELADO_MS` y los marcos siguientes del paso se desplazan lo mismo: giro a 550, retroceso a 780, ganador a 820 y pagos después. La pantalla pinta `CartaDelPaso` con `className="carrera-carta-paso"` y `data-carta="<valor><palo>"`.
- **Ruta de la carta:**
  1. Sale del `Mazo` boca abajo.
  2. Se agranda hacia el centro de la pista y se gira con `Naipe` (cara y dorso).
  3. Se queda visible hasta que el caballo empieza a moverse.
  4. Baja a la pila de descartes.
  
  Con movimiento reducido no hay vuelo: aparece y desaparece con un fundido.

- [ ] **Step 1: Tests que fallan**

```ts
// test/client/escena-carrera.test.ts
it("la carta del paso se enseña antes de que avance el caballo", () => {
  const plan = planDeLote(/* un paso normal */);
  expect(plan.marcos.find((m) => m.tipo === "carta")!.en).toBe(0);
  expect(plan.marcos.find((m) => m.tipo === "avance")!.en).toBe(REVELADO_MS);
});
it("en un paso que no es el último, ningún marco pasa de PASO_MS", () => {
  for (const plan of [/* paso sin giro, paso con giro y retroceso */]) expect(Math.max(...plan.marcos.map((m) => m.en))).toBeLessThan(CARRERA.PASO_MS);
});
```

Usa los nombres reales de los marcos de `escena.ts` y adapta el primer test a ellos, manteniendo lo que comprueba.

```ts
// e2e/carrera.spec.ts, muestreo de fotogramas como en «cada paso se desliza…»
// Llega un paso: hay fotogramas con .carrera-carta-paso visible (opacidad > 0.5, centro dentro del rectángulo de la pista)
// ANTES del primer fotograma en que el caballo de ese palo se ha movido ≥ 1 px. Al terminar, la última carta de
// .carrera-ultima es esa carta (data-carta igual).
// Con reducedMotion "reduce": la carta del paso no tiene animaciones de transform en marcha (getAnimations()).
```

- [ ] **Step 2:** Ejecuta los tests. Deben fallar porque la carta y el avance van hoy a la vez (0 ms) y no existe `.carrera-carta-paso`.
- [ ] **Step 3:** Implementa los tiempos en `planDeLote` y `CartaDelPaso`. Lo que suena sigue igual: `carta` al salir la carta.
- [ ] **Step 4:** Ejecuta `npm test` y `npx playwright test e2e/carrera.spec.ts --repeat-each=2`. Todo debe pasar, también los tests de orden avance → giro → retroceso y de ganador en la meta.
- [ ] **Step 5:** Revisión visual. Haz capturas en 412×915 y 1280×720 a mitad de paso, míralas y corrige lo que se vea mal.
- [ ] **Step 6:** Commit `feat: la carta de cada paso sale del mazo y se gira en el centro de la pista`.

---

### Task 3: Blackjack — casillas, dos manos, mano activa y una liquidación por jugador

**Files:**
- Modify: `src/shared/juegos/blackjack.ts`, `src/shared/juegos/tipos.ts` (`CodigoError` añade `"sin_casilla"`).
- Create: `test/shared/blackjack-manos.test.ts`.
- Modify: los tests de `test/shared/blackjack-*.test.ts` que construyen manos o vistas. Las manos añaden los campos nuevos.

**Interfaces (Produces, exactas):**

```ts
export const BJ = { /* lo de ahora */ CASILLAS: 7, MAX_MANOS_JUGADOR: 4, SEGURO_MS: 10_000, DIVIDIR_EXTRA_MS: 10_000 } as const;
export type AccionBJ =
  | { t: "apostar"; cantidad: number; segunda?: boolean }
  | { t: "pedir" } | { t: "plantarse" } | { t: "doblar" }
  | { t: "dividir" } | { t: "rendirse" } | { t: "seguro"; tomar: boolean }
  | { t: "salir" };
export type FaseBJ = "esperando" | "apuestas" | "seguro" | "decisiones" | "banca" | "resultado";
export interface ManoBJ {
  jugadorId: JugadorId; apodo: string;
  casilla: number;   // 0..6, la casilla de apuesta
  indice: number;    // orden de la mano dentro del jugador (0..3), por casilla y luego por división
  apuesta: number; cartas: Carta[];
  estado: "jugando" | "plantado" | "pasado" | "blackjack" | "rendido";
  doblada: boolean; dividida: boolean; abandonada: boolean;
}
export interface SeguroBJ { jugadorId: JugadorId; cantidad: number; respondido: boolean }
// EstadoBJ añade: seguros: SeguroBJ[]; bancaMirada: boolean
export interface OpcionesBJ { pedir: boolean; plantarse: boolean; doblar: boolean; dividir: boolean; rendirse: boolean; seguro: number | null }
// VistaBJ añade: opciones: OpcionesBJ | null; miSeguro: number | null; casillasLibres: number
//   y cada mano de `manos` lleva casilla, indice, dividida (sin `abandonada`), ordenadas por (casilla, indice).
export function manoActiva(e: EstadoBJ, jugadorId: JugadorId): ManoBJ | undefined; // la primera "jugando" por (casilla, indice)
export function opcionesDe(e: EstadoBJ, jugadorId: JugadorId): OpcionesBJ;          // reglas puras, sin saber las fichas
export function casillasLibres(e: EstadoBJ): number;                                // BJ.CASILLAS − casillas ocupadas
// Evento carta_repartida para un jugador añade `mano: number` (el `indice` de la mano). Para la banca no lleva `mano`.
```

En esta task, `dividir`, `rendirse` y `seguro` responden `accion_invalida`, y `opciones` los da por `false`/`null`. Las Tasks 4 y 5 los implementan. Antes de seguir, el plan de las Tasks 4 y 5 lee esta interfaz.

**Comportamiento:**
- **`apostar` sin `segunda`:**
  - Ocupa la casilla libre de número más bajo.
  - Si ya tienes casilla → `accion_invalida`.
  - Si no queda ninguna libre → `sin_casilla`.
- **`apostar` con `segunda: true`:**
  - Exige que ya tengas exactamente una casilla (si no → `accion_invalida`).
  - Si no hay casilla libre → `sin_casilla`.
  - Despierta la mesa dormida como una apuesta normal.
- **Reparto:** por casillas en orden ascendente; cada `carta_repartida` de jugador lleva `mano`.
- **Acciones sobre la mano activa:** `pedir`, `plantarse` y `doblar` actúan sobre `manoActiva`. Al terminar una mano, la activa pasa sola a la siguiente.
- **Costos:** `costo` de `doblar` es la apuesta de la mano activa; el de `apostar`, la cantidad.
- **Liquidación:** una fila por jugador (`apuesta` = suma, `pago` = suma) y un evento `pago` por jugador con el neto total.
- **`salir`:** abandona todas las manos del jugador.
- **`desconectar` en `decisiones`:** planta todas sus manos `jugando`.

- [ ] **Step 1: Tests que fallan** (`test/shared/blackjack-manos.test.ts`)
  - `«las casillas se ocupan por orden de llegada; con las 7 ocupadas, apostar da sin_casilla y no cambia el estado»`: 6 jugadores apuestan, uno pide segunda y la mesa queda llena; otra segunda → `sin_casilla`; `casillasLibres` es 0.
  - `«segunda sin casilla propia, tercera casilla o una apuesta normal teniendo ya casilla → accion_invalida»`.
  - `«se reparte por casillas en orden y cada carta dice su mano»`: el jugador 1 tiene las casillas 0 y 2 y el jugador 2 la 1. Los eventos de la primera vuelta son `mano` 0 de J1, `mano` 0 de J2, `mano` 1 de J1 y luego la banca.
  - `«pedir y plantarse actúan sobre la mano activa; al plantarse, la activa es la siguiente»`.
  - `«doblar cuesta la apuesta de la mano activa»`: `costo(e, 1, { t: "doblar" })` es la apuesta de esa mano, no la de la otra.
  - `«una fila de liquidación por jugador con la suma de sus manos»`: una mano de 100 gana (pago 200) y otra de 50 pierde, así que la fila es `{ jugadorId: 1, apuesta: 150, pago: 200 }` y el evento `pago` trae `neto: 50`.
  - `«salir con dos manos las pierde las dos»`: fila `{ apuesta: 150, pago: 0 }`.
  - `«la vista lleva casilla, indice, casillasLibres y opciones solo para quien la recibe»`: un espectador recibe `opciones: null`; en `decisiones`, el jugador con mano activa recibe `opciones.pedir === true`.
- [ ] **Step 2:** Ejecuta `npx vitest run test/shared/blackjack-manos.test.ts`. Debe fallar.
- [ ] **Step 3:** Implementa los tipos, `manoActiva`, `opcionesDe`, `casillasLibres`, las casillas, el reparto por casillas, la liquidación agregada y la vista. `pago()` no cambia en esta task.
- [ ] **Step 4:** Ejecuta `npm test`. Todo en verde: actualiza los tests que construyen `ManoBJ` y `VistaBJ` con los campos nuevos, sin cambiar lo que comprueban.
- [ ] **Step 5:** Commit `feat: blackjack con 7 casillas, dos manos por jugador y una liquidación por jugador`.

---

### Task 4: Blackjack — seguro, la banca mira y rendirse

**Files:** `src/shared/juegos/blackjack.ts`; Create `test/shared/blackjack-seguro.test.ts`.

**Interfaces:**
- Consumes: los tipos de la Task 3.
- Produces:
  - **Fase `seguro`:** `finFase = ahora + BJ.SEGURO_MS`.
  - **Eventos:**
    - `{ tipo: "banca_mira", blackjack: boolean }`;
    - `{ tipo: "seguro_pagado", jugadorId, cantidad }`, donde `cantidad` es lo que cobra (3 × lo asegurado);
    - `{ tipo: "rendido", jugadorId, indice }`.
  - **Opciones:** `opciones.seguro` (el coste mientras no has contestado) y `opciones.rendirse`.
  - **Vista:** `miSeguro` (lo asegurado o `null`).

**Comportamiento (spec §2.2 pasos 3–5):**
- **Después de repartir:**
  - Con un **as** visible, la fase pasa a `seguro` para los jugadores con manos no abandonadas.
  - Con un 10 o una figura visible, la banca mira al momento.
  - Con otra carta, se sigue como ahora.
- **`seguro {tomar}`:**
  - Solo vale en `seguro` y una vez por jugador.
  - `costo` con `tomar: true` es `floor(suma de apuestas / 2)`; con `false`, 0.
  - Cuando todos han contestado, se resuelve en el acto. En el `tick` al vencer, quien no contestó (o se desconectó) cuenta como «no».
- **Resolver (`bancaMira`):**
  - Emite `banca_mira`.
  - **Con blackjack:** `carta_girada`, liquidación y fase `resultado`. Los seguros cobran `3 × cantidad` (con su evento) y las manos pierden salvo los blackjacks, que empatan.
  - **Sin blackjack:** los seguros se pierden y la fase es `decisiones`, o `banca` si nadie juega.
  - `bancaMirada = true`.
- **Liquidación:** cada fila suma lo asegurado en `apuesta` y lo cobrado del seguro en `pago`.
- **`rendirse`:**
  - Solo en `decisiones`, sobre la mano activa, con 2 cartas, sin dividir ni doblar.
  - Pasa a `estado: "rendido"`; en la liquidación paga `floor(apuesta / 2)`.
  - La activa pasa a la siguiente mano.

- [ ] **Step 1: Tests que fallan**
  - `«con un as visible se abre el seguro de 10 s; con una figura la banca mira sin seguro; con un 6 no mira»`.
  - `«coger seguro cuesta la mitad redondeada hacia abajo de tus apuestas»`: apuestas 25 + 50 → `costo` 37.
  - `«si todos contestan, la banca mira sin esperar al reloj»`.
  - `«banca con blackjack: el seguro paga 2:1, tu blackjack empata y el resto pierde; la ronda acaba»`: apuesta 100 con seguro 50 → fila `{ apuesta: 150, pago: 150 }` y `seguro_pagado` con `cantidad: 150`.
  - `«banca sin blackjack: el seguro se pierde y empiezan las decisiones»`: fila final con el seguro en `apuesta` y 0 por él en `pago`.
  - `«quien no contesta o se desconecta en el seguro no lo coge»`.
  - `«la carta tapada no sale en la vista durante el seguro ni cuando la banca mira sin blackjack»`.
  - `«rendirse devuelve la mitad hacia abajo: 25 → 12»`.
  - `«rendirse después de pedir, en una mano doblada o fuera de decisiones → accion_invalida»`.
- [ ] **Step 2:** Ejecuta los tests. Deben fallar.
- [ ] **Step 3:** Implementa.
- [ ] **Step 4:** Ejecuta `npm test`. Todo debe pasar.
- [ ] **Step 5:** Commit `feat: seguro con el as, la banca mira su carta y rendirse`.

---

### Task 5: Blackjack — dividir

**Files:** `src/shared/juegos/blackjack.ts` (incluido `pago()`); Create `test/shared/blackjack-dividir.test.ts`.

**Interfaces:**
- Produces:
  - **Evento:** `{ tipo: "mano_dividida", jugadorId, indice }`. `indice` es la mano que se dividió; la nueva queda en `indice + 1` y las siguientes del jugador suben un número.
  - **Opciones:** `opciones.dividir`.
  - **`pago()`:** acepta `dividida` y no cuenta como natural una mano dividida.

**Comportamiento (spec §2.2 paso 5):**
- **Cuándo se puede:** solo en `decisiones`, sobre la mano activa, con 2 cartas del mismo valor (`valorCarta` igual: 10, J, Q y K valen 10).
- **Topes:**
  - Total del jugador menor que `MAX_MANOS_JUGADOR`.
  - Manos de esa casilla menores que `MAX_MANOS_JUGADOR / casillas del jugador` (4 con una casilla, 2 con dos).
  - Unos ases ya divididos no se vuelven a dividir.
- **Efecto:**
  1. La segunda carta pasa a una mano nueva con la misma casilla y apuesta, y las dos quedan `dividida: true`.
  2. Se renumeran los `indice` del jugador.
  3. Se emite `mano_dividida`.
  4. Se reparte una carta a cada una, primero la original (con `mano`).
  5. Con ases, las dos se plantan.
  6. `finFase += BJ.DIVIDIR_EXTRA_MS`.
- **Costo y pago:** `costo` de `dividir` es la apuesta de la mano activa. Un 21 con 2 cartas en una mano dividida paga 1:1. Doblar tras dividir se puede (2 cartas).

- [ ] **Step 1: Tests que fallan**
  - `«se divide un par del mismo valor, también 10 con K, pero no 9 con 10»`.
  - `«cada mano recibe al momento su segunda carta, primero la original, y se juegan en orden»`: los eventos son `mano_dividida` y luego dos `carta_repartida` con `mano` 0 y 1, y `manoActiva` es la 0.
  - `«los ases se dividen una sola vez, reciben una carta cada uno y se plantan»`.
  - `«un 21 tras dividir paga 1:1, no 3:2»`: con apuesta 100, `pago` es 200.
  - `«con una casilla se llega a 4 manos; con dos, cada casilla se divide una vez»`.
  - `«cada división alarga la ventana 10 s»`: `finFase` antes + 10 000.
  - `«dividir cuesta la apuesta de la mano y se puede doblar después»`.
  - `«la liquidación suma las manos divididas en una fila»`.
- [ ] **Step 2:** Ejecuta los tests. Deben fallar.
- [ ] **Step 3:** Implementa.
- [ ] **Step 4:** Ejecuta `npm test`. Todo debe pasar.
- [ ] **Step 5:** Commit `feat: dividir pares en el blackjack, con ases y tope de cuatro manos`.

---

### Task 6: Mesa y presupuesto con las jugadas nuevas

**Files:**
- Test: `test/server/mesa-blackjack.test.ts` (un `describe` nuevo) y `test/server/presupuesto.test.ts`.
- Modify: `src/server/mesa-base.ts` solo si un test lo exige.

**Interfaces:**
- Consumes: las acciones y eventos de las Tasks 3–5.
- `Mesa` no cambia de API.

- [ ] **Step 1: Tests que fallan** (con Durable Objects reales, como el resto de `mesa-blackjack.test.ts`; los estados se preparan sembrando el zapato)
  - `«segunda casilla, dividir, doblar y seguro cobran cada uno con su cobro en dos fases»`: después de cada jugada, `fichas(id)` baja lo que toca y `pendientesDe(codigo)` sube en uno.
  - `«sin fichas para dividir → sin_fichas, sin cobro y sin cambios en la mesa»`.
  - `«dos jugadores a por la última casilla: uno sin_casilla y una sola apuesta cobrada»`, y `«un doble envío de la segunda apuesta cobra una vez»`.
  - `«la liquidación con manos divididas y seguro deja las fichas exactas»`: comprueba números concretos de principio a fin.
  - `«desalojo con manos divididas: al reconectar, la vista trae las mismas manos y la ronda sigue»` (`evictDurableObject`).
  - `«salir con dos manos y seguro: se pierde todo y la liquidación cuadra»`.
- [ ] **Step 2:** Ejecuta `npx vitest run test/server/mesa-blackjack.test.ts`. Debe fallar donde aún no haya soporte.
- [ ] **Step 3:** Corrige lo que pidan los tests.
- [ ] **Step 4: Presupuesto.** En `medirBlackjack`, una de las rondas medidas tiene un jugador con dos casillas, seguro (as de la banca sembrado) y una división. Los techos por ronda suben a lo medido. La noche extrapolada tiene que seguir **≤ 30 %** en todo (la constante `OBJETIVO` no cambia). Si se pasa, para y avisa: no subas el objetivo.
- [ ] **Step 5:** Ejecuta `npm test`. Todo debe pasar.
- [ ] **Step 6:** Commit `test: la mesa cobra y liquida bien las jugadas nuevas, y la noche sigue dentro del presupuesto`.

---

### Task 7: Pantalla — apostar con dos manos

**Files:**
- Modify: `src/client/pantallas/MesaBlackjack.tsx`, `src/client/pantallas/blackjack/controles.tsx` (`Apostar`), `src/client/tema/mesa-blackjack.css` y `src/client/componentes/AvisoMesa.tsx` (texto de `sin_casilla`).
- Test: `e2e/blackjack.spec.ts`; actualiza el helper `vista()` con los campos nuevos.

**Interfaces:**
- Consumes: `VistaBJ.casillasLibres`, `ManoVista.casilla`, `{ t: "apostar"; cantidad; segunda: true }` y el error `sin_casilla`.
- Produces:
  - **Texto de `sin_casilla`:** «Ya no quedan casillas libres».
  - **Etiqueta del botón:** «Apostar A + B» cuando hay dos preparadas; si no, «Apostar A».
  - **Botón «+ Segunda mano»:** su nombre accesible es exactamente ese.

**Comportamiento (spec §5.1):**
- **Lo preparado:** se guarda por casilla (`[primera, segunda]`).
- **«+ Segunda mano»:** se ve si `casillasLibres > 0` y aún no tienes segunda casilla preparada ni jugada.
- **Elegir casilla:** tocar una casilla la elige (aro dorado, `aria-pressed`). Las fichas, «Todo» y el vuelo van a la elegida; «Todo» pone ahí lo que te queda.
- **Apostar:** manda la primera. Cuando llega la vista con tu mano, manda la segunda con `segunda: true`.
- **Si la segunda da `sin_casilla`:** se ve el aviso y la segunda casilla desaparece.
- **Reutilizar:** usa `CasillaApuesta`, `FichasApuesta` y `useEnvioUnico`; no copies.

- [ ] **Step 1: Tests que fallan** (mesa simulada)
  - `«con casillas libres se juega una segunda mano: «Apostar 100 + 50» manda la primera y, confirmada, la segunda»`: `mesa.recibidas` incluye `{ t: "apostar", cantidad: 100 }` y después `{ t: "apostar", cantidad: 50, segunda: true }`.
  - `«sin casillas libres no aparece «+ Segunda mano»»`.
  - `«la segunda recibe sin_casilla: aviso «Ya no quedan casillas libres» y te quedas con una mano»`.
  - `«un doble toque en «Apostar 100 + 50» manda cada apuesta una sola vez»`.
- [ ] **Step 2:** Ejecuta `npx playwright test e2e/blackjack.spec.ts --project=desktop`. Deben fallar los nuevos.
- [ ] **Step 3:** Implementa.
- [ ] **Step 4:** Ejecuta `npx playwright test e2e/blackjack.spec.ts`, en los dos proyectos. Todo debe pasar. Haz capturas en 412×915 y 1280×720 apostando con dos casillas, míralas y corrige.
- [ ] **Step 5:** Commit `feat: apostar con dos manos en el blackjack`.

---

### Task 8: Pantalla — varias manos, dividir y rendirse

**Files:**
- Modify: `src/client/pantallas/blackjack/guion.ts`, `useGuion.ts`, `piezas.tsx`, `controles.tsx` (`Decidir`) y `src/client/pantallas/MesaBlackjack.tsx`.
- Modify: `src/client/tema/mesa-blackjack.css`.
- Test: `test/client/guion-blackjack.test.ts` y `e2e/blackjack.spec.ts`.

**Interfaces:**
- Produces:
  - **Clave de carta:** `claveCarta(ronda: number, de: JugadorId | "banca", mano: number, indice: number): string`. La banca usa `mano` 0. `guionDelLote` usa `evento.mano` y `mano_dividida`.
  - **Etiqueta de la mano activa:** «Mano N de M», visible solo con más de una mano.
  - **Botones:** «Dividir» y «Rendirse» con esos nombres exactos.

**Comportamiento (spec §5.2, §5.3, §5.5):**
- **Tus manos:**
  - En fila. El ancho de carta escala: 1 mano 100 %, 2 manos ~75 %, 3–4 manos ~58 %, con más solape.
  - Cada mano con su total y su apuesta.
  - La activa con subrayado dorado y «Mano N de M»; las demás con opacidad ~0.6.
- **Animación de dividir:** con `mano_dividida`, la segunda carta se desliza de su sitio al primer hueco de la mano nueva (sin desaparecer en ningún fotograma) y las cartas nuevas vuelan desde el mazo.
- **`Decidir`:**
  - Fila principal Plantarse · Pedir · Doblar.
  - Debajo, Dividir y Rendirse, solo si `opciones` lo permite y, para dividir y doblar, si tus fichas cubren la apuesta de la mano activa.
  - El panel reserva el alto de dos filas.
- **Los demás:** en móvil, las pastillas dicen «Ana · 15 / 19 ✓»; en ordenador, el asiento muestra hasta dos manos pequeñas.
- **Reconexión:** salta a la vista sin animar.

- [ ] **Step 1: Tests que fallan**
  - `test/client/guion-blackjack.test.ts`:
    - `«las cartas de manos distintas del mismo jugador tienen claves distintas»`;
    - `«tras mano_dividida, las cartas nuevas van a las manos 0 y 1»`.
  - `e2e/blackjack.spec.ts` (mesa simulada):
    - `«al dividir se ven dos manos: la segunda carta se desliza a la nueva y llegan las cartas nuevas»` (muestreo de fotogramas; la carta movida existe en todos los fotogramas);
    - `«la mano activa va subrayada con «Mano 2 de 3» y Pedir actúa sobre ella»`;
    - `«Dividir y Rendirse solo aparecen cuando se pueden usar y si tienes fichas»`;
    - `«rendirse: la mano se ve rendida y al final cobra la mitad»`;
    - `«al reconectar con manos divididas se ven tal cual, sin animación ni sonido»`;
    - `«cuatro manos tuyas y cinco jugadores más caben en 360×640: sin desplazamiento horizontal y botones de 44 px o más»` (`sinDesplazamientoHorizontal`);
    - `«las pastillas de los demás enseñan cada mano»`.
- [ ] **Step 2:** Ejecuta los tests. Deben fallar.
- [ ] **Step 3:** Implementa.
- [ ] **Step 4:** Ejecuta `npm test` y `npx playwright test e2e/blackjack.spec.ts e2e/movimiento.spec.ts`. Todo debe pasar. Haz capturas con 1, 2 y 4 manos en 360×640, 412×915 y 1280×720, míralas y corrige.
- [ ] **Step 5:** Commit `feat: varias manos en la mesa, dividir con animación y rendirse`.

---

### Task 9: Pantalla — seguro y la banca mira

**Files:**
- Modify: `src/client/pantallas/blackjack/controles.tsx` (`PanelSeguro` y `textoEstado` para la fase `seguro`) y `guion.ts` (un tramo `mira` en el guion).
- Modify: `src/client/pantallas/MesaBlackjack.tsx` y `src/client/tema/mesa-blackjack.css`.
- Test: `test/client/textos-blackjack.test.ts` y `e2e/blackjack.spec.ts`.

**Interfaces:**
- Produces:
  - **Textos del panel:** «La banca enseña un as. ¿Seguro por N?», con los botones «No» y «Sí, seguro (N)». Al contestar, «Esperando a los demás…».
  - **Texto de estado mientras mira:** «La banca mira su carta…».
  - **Guion:** `MIRA_MS = 700`. La tapada sube unos píxeles (`transform`) y baja. Si hay blackjack, después va `carta_girada`, como ahora.

- [ ] **Step 1: Tests que fallan**
  - `textos-blackjack`: `«en la fase de seguro el estado pide decidir el seguro, y al contestar dice que esperas a los demás»`.
  - e2e:
    - `«con un as visible sale el panel del seguro: «Sí, seguro (50)» manda { t: "seguro", tomar: true } y pasa a «Esperando a los demás…»»`;
    - `«la banca mira: sin blackjack la tapada se levanta y vuelve a bajar; con blackjack se gira y se cobra el seguro»`;
    - `«sin fichas para el seguro, «Sí, seguro» no se puede pulsar»`;
    - `«salir con dos manos y seguro pide confirmación y manda salir»`;
    - `«con movimiento reducido la banca mira sin moverse: solo se lee el texto»`.
- [ ] **Step 2:** Ejecuta los tests. Deben fallar.
- [ ] **Step 3:** Implementa.
- [ ] **Step 4:** Ejecuta `npm test` y `npm run e2e`. Todo debe pasar.
- [ ] **Step 5:** Commit `feat: el seguro y la banca que mira su carta, en la pantalla`.

---

### Task 10: README, CLAUDE.md y capturas

**Files:**
- Modify: `README.md`, en «Cómo se juega» y «Características»: seguro, la banca mira, dividir, rendirse, dos manos y la carrera con 6 tramos.
- Modify: `CLAUDE.md`, en la línea de apuestas y los añadidos de las reglas del blackjack (casillas y `opciones`).
- Modify: `docs/capturas/blackjack-movil.png` y `blackjack-escritorio.png`, que pasan a enseñar dos manos o una división.

- [ ] **Step 1:** Actualiza los textos. Comprueba cada afirmación contra el código (constantes de `BJ` y `CARRERA`).
- [ ] **Step 2:** Rehaz las capturas con mesa simulada, con PNG de menos de 400 KB. Míralas.
- [ ] **Step 3:** Ejecuta `npx tsc --noEmit -p .`, `npm test` y `npm run e2e`. Todo debe pasar.
- [ ] **Step 4:** Commit `docs: el README y CLAUDE.md cuentan el blackjack completo y la carrera de seis tramos`.
