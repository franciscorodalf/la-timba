# Blackjack completo y pulido de la carrera: diseño

Fecha: 2026-10-29. Este documento amplía el spec principal (`2026-10-17-la-timba-design.md`); donde los dos chocan, manda este.

## 1. Objetivo

Que el blackjack de La Timba tenga las jugadas de un casino de verdad: seguro, dividir, rendirse y jugar dos manos. Todo sin llenar la mesa de cartas en el móvil, sin romper el libro de fichas y sin pasar del presupuesto del plan gratuito.

De paso se pulen dos cosas de la carrera que el usuario vio al jugar:

- la carta que se levanta en cada paso apenas se ve salir del mazo;
- el último tramo casi nunca puede girarse.

Fuera de alcance: el póker y la Bomba (cada uno tendrá su propio diseño), las apuestas laterales y un botón aparte de «cobrar 1:1» (con blackjack propio, el seguro ya equivale a eso).

## 2. Reglas del blackjack

### 2.1 Casillas y dos manos

- La mesa tiene **7 casillas** de apuesta y sigue admitiendo **6 jugadores**.
- **Casillas:**
  - Cada jugador que apuesta ocupa una casilla.
  - En `apuestas` (o al despertar la mesa en `esperando`) puede ocupar una **segunda** si queda alguna libre.
  - Las casillas se ocupan al apostar, por orden de llegada.
  - Si dos jugadores van a por la última, el segundo recibe `sin_casilla` y no se le cobra nada.
- **Tope de manos:** cada jugador tiene como mucho **4 manos** en una ronda, contando las que salen de dividir.
  - Con dos casillas, cada una puede dividirse una vez.
  - Con una casilla, se puede volver a dividir hasta llegar a 4.

### 2.2 Desarrollo de una ronda

1. **Apuestas:** 15 s; desde 10 fichas y sin tope, como ahora. Cada casilla lleva su propia apuesta.
2. **Reparto:** dos cartas a cada mano y dos a la banca; la segunda de la banca va tapada.
3. **Seguro**, solo si la carta visible de la banca es un **as**:
   - Hay una fase `seguro` de **10 s**. Cada jugador con manos contesta una vez («sí» o «no») por todas sus manos.
   - Si todos contestan, la fase acaba antes. Quien no contesta (o se desconecta) cuenta como «no».
   - **Coste:** la mitad de la suma de las apuestas de sus manos, redondeada hacia abajo, que se cobra al decir «sí». Si esa mitad es 0, no se ofrece.
   - **Pago:** si la banca tiene blackjack, el seguro paga **2:1** (se devuelve el seguro más el doble).
4. **La banca mira su carta** si la visible es un as o vale 10:
   - **Si tiene blackjack:** la gira y la ronda pasa a `resultado`. Las manos con blackjack empatan y las demás pierden (rendirse ya no es posible). Los seguros cobran.
   - **Si no:** los seguros se pierden y empiezan las decisiones.
5. **Decisiones**, a la vez para todos, en una ventana de 15 s:
   - **Mano activa:** cada jugador juega sus manos en orden (casilla, luego índice). La activa es la primera que sigue en juego, y las acciones se aplican a ella.
   - **Pedir y plantarse:** como ahora.
   - **Doblar:** solo con dos cartas; también tras dividir, salvo los ases divididos.
   - **Dividir:**
     - Se puede con dos cartas **del mismo valor**: 10, J, Q y K valen 10, así que se pueden dividir entre sí.
     - Cuesta otra apuesta igual a la de esa mano.
     - Cada mano resultante recibe al momento su segunda carta.
     - Respeta el tope de 4 manos (§2.1).
     - Cada división alarga la ventana de decisiones **10 s**.
   - **Ases divididos:** se dividen una sola vez; cada uno recibe una carta y se planta solo.
   - **Tras dividir,** un 21 con dos cartas no es blackjack: paga 1:1.
   - **Rendirse:** solo como primera decisión de una mano original (sin dividir, con dos cartas) y después de que la banca haya mirado. Recuperas la mitad de esa apuesta, redondeada hacia abajo.
   - **Fin de la ventana:** las manos que siguen en juego se plantan solas, como ahora.
6. **Banca:** juega como ahora (pide hasta 17 y se planta en cualquier 17).
7. **Liquidación:**
   - Cada mano se paga contra la banca: blackjack natural 3:2, ganar 1:1, empate devuelve la apuesta. Se suma el seguro y lo devuelto al rendirse.
   - Hay **una sola fila de liquidación por jugador** con el total apostado (incluidos dobles, divisiones y seguro) y el neto total.
   - En las estadísticas cuenta como una ronda por jugador, ganada, perdida o empatada según el signo del neto.

### 2.3 Salir y desconectarse

- **Salir con la ronda en curso:** se pierden todas tus manos y tu seguro, como ahora con una mano. La ronda cuenta como en curso hasta que se cierran las decisiones: entonces la banca juega y la ronda queda decidida, así que salir durante la banca (lo que tarda en verse su jugada) ya no cambia lo que se cobra, y la pantalla no avisa.
- **Desconectarse en `seguro`:** cuenta como «no».
- **Desconectarse en `decisiones`:** tus manos se plantan, como ahora.

## 3. Carrera

- **Tramos:** `CARRERA.TRAMOS` pasa de 7 a **6**, en las líneas 1 a 6.
  - La línea 7 se dibuja como una casilla normal, sin carta.
  - Motivo: un tramo se gira cuando todos los caballos han pasado su línea, y llegar a la casilla 8 termina la carrera. Por eso el tramo 7 solo se giraría con los cuatro caballos en la casilla 7 a la vez, que casi nunca pasa.
- **La carta de cada paso**, solo en pantalla y dentro de los 800 ms del paso:
  1. Sale del mazo boca abajo, se agranda hacia el centro de la pista y se gira para enseñar el palo (0–300 ms).
  2. Avanza el caballo de ese palo (desde ~300 ms).
  3. La carta baja a la pila de descartes junto al mazo.
  
  Los giros de tramo y los retrocesos van detrás, como ahora. Con movimiento reducido: fundidos y sin vuelo.
- El servidor no cambia, salvo la constante.

## 4. Datos y protocolo (opción A: lista plana de manos)

### 4.1 Estado (`src/shared/juegos/blackjack.ts`)

- `ManoBJ` añade:
  - `casilla: number` (0–6);
  - `indice: number` (orden dentro del jugador);
  - `dividida: boolean`;
  - `rendida: boolean`;
  - `estado` gana `"rendido"`.
- Al dividir, la mano nueva se inserta justo después de la que se divide.
- `EstadoBJ` añade:
  - `fase: "seguro"`;
  - `seguros: { jugadorId; cantidad; respondido }[]`;
  - lo necesario para no volver a ofrecer el seguro y para que la banca mire una sola vez.
- `BJ` añade `CASILLAS: 7`, `MAX_MANOS_JUGADOR: 4`, `SEGURO_MS: 10_000` y `DIVIDIR_EXTRA_MS: 10_000`.

### 4.2 Acciones y errores

- `apostar` pasa a `{ t: "apostar"; cantidad; segunda?: boolean }`: `segunda: true` pide una segunda casilla.
  - Sin `segunda`, solo vale si aún no tienes casilla.
  - Con `segunda`, solo vale si ya tienes una.
  - En cualquier otro caso → `accion_invalida`, sin cobro.
  - La pantalla manda la segunda apuesta cuando la mesa ha confirmado la primera.
- Acciones nuevas: `{ t: "seguro"; tomar: boolean }`, `{ t: "dividir" }` y `{ t: "rendirse" }`.
- `pedir`, `plantarse` y `doblar` siguen sin parámetros y actúan sobre la mano activa.
- `costo`:
  - `seguro` con `tomar: true` → la mitad redondeada hacia abajo;
  - `dividir` → la apuesta de la mano activa;
  - `doblar` y `apostar` → como ahora.
- `CodigoError` añade `sin_casilla`.

### 4.3 Vista y eventos

- La vista de cada mano añade `casilla`, `indice`, `dividida` y `rendida`.
- La vista añade, solo para quien la recibe:
  - `opciones: { pedir; plantarse; doblar; dividir; rendirse; seguro }` (booleanos que calcula el servidor; el cliente no repite reglas);
  - `miSeguro`;
  - `casillasLibres`.
- La carta tapada de la banca sigue sin salir del servidor hasta que se gira.
- Eventos nuevos:
  - `mano_dividida { jugadorId, casilla, indice }`;
  - `banca_mira { blackjack: boolean }`;
  - `seguro_pagado { jugadorId, cantidad }`;
  - `rendido { jugadorId, indice }`.

### 4.4 Fichas

- Cada cobro extra (segunda casilla, dividir, doblar y seguro) usa el **cobro en dos fases** de `Mesa`, con su `cobroId`.
- No hay caminos nuevos para mover fichas: todo pasa por `Jugadores.apostar`, `anular` y `liquidar`.

## 5. Pantalla

### 5.1 Apuestas

- **Segunda mano:**
  - Junto a tu casilla aparece «+ Segunda mano» si `casillasLibres > 0`.
  - Al tocarla aparece otra casilla.
  - Tocando una casilla la eliges (aro dorado). Las fichas y «Todo» van a la elegida; «Todo» reparte lo que te queda en ella.
- **Botón de apostar:** «Apostar 100 + 50». Manda las dos apuestas, cada una con su `cobroId` y su respuesta.

### 5.2 Tus manos

- **En fila.** El tamaño de las cartas baja con el número de manos:
  - 1 mano: el de ahora;
  - 2 manos: ~75 %;
  - 3 o 4 manos: ~58 %, con más solape.
- Cada mano lleva su total y su apuesta.
- La mano activa va subrayada en dorado con «Mano 2 de 3»; las demás, algo atenuadas.
- **Al dividir,** la segunda carta se separa deslizándose a su hueco y cada mano recibe su carta desde el mazo.

### 5.3 Botones de decisión

- Fila principal **Plantarse · Pedir · Doblar**, como ahora.
- Debajo, **Dividir** y **Rendirse**, solo cuando `opciones` los permite.
- El panel reserva siempre el alto de dos filas, para que la mesa no salte.

### 5.4 Seguro

- **Panel:** «La banca enseña un as. ¿Seguro por N?», con **No** / **Sí, seguro (N)**, su cuenta atrás y luego «Esperando a los demás…».
- **La banca mira:** un instante de «La banca mira su carta…» con la tapada levantándose un poco.
  - Con blackjack, se gira y se cobra con la animación de pagos de siempre.
  - Sin blackjack, vuelve a bajar.

### 5.5 Los demás jugadores

- **Móvil:** las pastillas enseñan cada mano («Ana · 15 / 19 ✓»).
- **Ordenador:** cada asiento muestra sus manos con cartas pequeñas, con hueco para dos.

### 5.6 Común

- Siguen valiendo las reglas de movimiento: solo `transform`/`opacity`, movimiento reducido y botones de 44 px como mínimo.
- La reconexión a mitad de ronda salta a la vista sin animar.

## 6. Casos límite

- **Fichas insuficientes:** no se ofrece dividir, doblar ni seguro (el servidor lo calcula en `opciones` y `Jugadores` lo vuelve a comprobar al cobrar).
- **Concurrencia:**
  - Dos pestañas del mismo jugador: la cola de la mesa ordena y la segunda acción recibe error sin cobro.
  - La última casilla pedida a la vez por dos jugadores: `sin_casilla` para el segundo, sin cobro.
- **Ventana:** que acabe la ventana con una mano dividida a medias planta las que queden.
- **Pagos con decimales:** el blackjack 3:2 con importes impares, el seguro y rendirse redondean hacia abajo, siempre en enteros.
- **Mesa dormida (`esperando`):** apostar con `segunda: true` la despierta igual que una apuesta normal.

## 7. Pruebas

- **Reglas, en tests unitarios puros:**
  - una tabla de casos de dividir (mismo valor, figuras entre sí, ases, re-división hasta 4, tope con dos casillas, doblar tras dividir y 21 tras dividir que paga 1:1);
  - seguro (cobro, pago 2:1, banca sin blackjack, quien no contesta);
  - la banca mira con as y con figura;
  - rendirse (cuándo sí y cuándo no, y lo devuelto);
  - casillas (7 libres, segunda casilla, `sin_casilla`);
  - la liquidación agregada por jugador;
  - que la vista no filtre la carta tapada.
- **Mesa con Durable Objects reales:**
  - cada cobro extra en dos fases;
  - liquidación con divisiones y seguro;
  - desalojo y reconexión con manos divididas;
  - fichas insuficientes;
  - dos pestañas a la vez.
- **Presupuesto:** `test/server/presupuesto.test.ts` incluye rondas con dos manos, divisiones y seguros, y la noche típica sigue **≤ 30 %** de cada límite diario.
- **E2E con mesa simulada:** dos manos (apostar en cada casilla), seguro (panel, «Esperando a los demás…», la banca mira con y sin blackjack), dividir (la carta se separa y llegan las nuevas), rendirse, la fila de 4 manos en el móvil y movimiento reducido.
- **Carrera:**
  - e2e de 6 tramos y la línea 7 sin carta;
  - la carta del paso se ve primero en el centro y después avanza el caballo, comprobado con muestreo de fotogramas como los e2e de movimiento que ya hay.
- **Revisión visual:** capturas en 412×915, 360×640 y 1280×720 de cada estado nuevo.
