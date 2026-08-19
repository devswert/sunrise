# sunrise — Roadmap de lo que falta

Base: commit `1175035`. Lo que ya existe y sus reglas están en [SPECS.md](SPECS.md).
Este documento es la **fuente de verdad de lo que falta**; el plan inicial vivía
fuera de git y quedó reemplazado por él.

## Estado de los milestones

| | Milestone | Estado |
|---|---|---|
| M0 | Scaffold (Tauri + React/TS + SQLite + tokens + tests) | ✅ `3832ebd` |
| M1 | Core de planificación (semana con DnD, tareas, objetivos, backlog) | ✅ `703fbbe` |
| M2 | Timer + Focus (taxímetro, `time_entries`, campana, Focus Mode) | ✅ `1175035` |
| M3 | Calendar + review + resúmenes | ✅ 3.1 a 3.6 hechos |
| M4 | Durabilidad, branding, empaque | ✅ 4.1 a 4.3 hechos |
| M5 | Compartir con el equipo | ✅ 5.1 a 5.8 hechos; `v0.1.0`, `v0.1.1` y `v0.2.0` publicadas |

---

## Fase 0 — Arreglos antes de seguir

Son bugs en código ya commiteado. Conviene cerrarlos antes de abrir M3: dos de
ellos están justo en la maquinaria que M3 va a usar de forma intensiva.

### 0.1 ✅ Sincronización entre ventanas — hecho

Completar una tarea desde el taxímetro no actualizaba ninguna vista de la
ventana principal. Resuelto con `useDataSync()` en `src/lib/store.ts`, montado
por `Shell`: escucha el `storage` de `sunrise-data` e invalida las vistas de
`main`. El store expone `markDataStale()` (solo local) además de `bumpData()`
(local + aviso) para que responder al aviso no genere un ping-pong entre
ventanas. Ver [SPECS.md §5.3](SPECS.md#53-el-cruce-de-ventanas-usedatasync).

Cubierto por `src/lib/store.test.tsx` y
`src/features/today/TodayView.sync.test.tsx`; ambos se ponen rojos si se
desactiva el listener.

Queda anotado para M3: cuando el poller de ICS mute datos desde Rust, conviene
que emita un evento de Tauri que entre por la misma puerta (`markDataStale`), en
vez de depender de que alguna ventana escriba en `localStorage`.

### 0.2 ✅ `completeAndAdvance` reprogramaba a hoy — hecho

`timerStore.ts` llamaba `api.moveTask(taskId, today, lastPos + 1)` sin
condición: completar desde el taxímetro una tarea de otro día la movía a hoy, y
`carry_over` no la devolvía (solo arrastra las que siguen en `TODO`). Ahora lee
el `scheduledDate` de la tarea y la manda al final de **su propio día**; si no
tiene fecha (backlog), no la mueve. De paso, "hoy" pasó a calcularse con
`todayISO()` (fecha local) en vez de `toISOString()` (UTC), que adelantaba el día
varias horas antes de medianoche.

Cubierto por `src/features/timer/timerStore.test.ts`.

### 0.3 ✅ `carry_over` corría en cada refresh — hecho

El efecto de `useBoard` depende de `[reload, dataVersion]`, así que la mutación
se disparaba con cada cambio de datos en lugar de una vez al montar (y desde 0.1,
más seguido todavía). Ahora pasa por `carryOverOnce(today)`, que la corre **una
vez por día y por ventana** y deduplica las llamadas concurrentes de dos vistas
montadas a la vez. La condición es la fecha, no un booleano, para que una sesión
abierta cruzando la medianoche arrastre igual al día siguiente.

Cubierto por `src/features/tasks/useBoard.test.tsx`.

### 0.4 ✅ Conectar la tabla `settings` — hecho

Estaba poblada por la migración 2 y nadie la leía. Ahora hay `list_settings` y
`set_setting` (upsert) en `repo.rs`, su par en `ipc.ts`/`mockDb.ts`, y un store
`useSettingsStore` en `src/lib/settings.ts` que `Shell` carga al montar y relee
con cada invalidación —así un cambio hecho en una ventana llega a la otra por el
canal de 0.1.

La capacidad diaria y el umbral del semáforo salieron de `config.ts` y ahora se
leen de la DB. Se corrigió de paso que `CAPACITY_WARN_RATIO` estuviera exportado
pero **sin usar**: `DayColumn` llamaba a `computeCapacityLevel` con dos
argumentos, así que el umbral salía del default del parámetro. Hoy el umbral se
pasa explícito desde los ajustes; el default en la firma se mantiene porque es
lo que fijan los tests de `capacity.test.ts`.

Settings tiene un campo de capacidad diaria con autosave al salir del foco, que
acepta `8h`, `7h30` o `480` vía `parseDuration`.

Cubierto por `settings.test.ts` (parsers con clave ausente/vacía/basura, rango
del umbral, y round-trip por ipc/mockDb) y dos tests en `repo.rs`.

Los atajos de 0.6 persisten en esta misma tabla, con una fila por atajo
(`hotkey_<accion>`); ver el detalle allá.

### 0.5 ✅ Darle play a una tarea completada la reabre — hecho

Antes se podía tener una tarea `DONE` con el timer corriendo: el play no tocaba
el estado. Ahora `start_timer` la pone en `TODO` y limpia `completed_at`, y
`mockDb.startTimer` espeja lo mismo para que browser y tests no diverjan del
backend.

Quedó en `repo.rs` y no en las vistas por la misma razón que su regla simétrica
—completar detiene el timer— y forman juntas la invariante I5: hay cinco lugares
con botón de play y repetir la regla en cada uno garantiza que el sexto se
olvide.

Cubierto por tres tests en `repo.rs` (reabre una completada, la devuelve a la
cola de Focus, no toca una que ya estaba pendiente) y verificado en la app:
completar una tarjeta y darle play la deja pendiente con el timer corriendo.

### 0.6 ✅ Atajos de teclado configurables — hecho

Antes había un solo atajo, `⌘/Ctrl + A`, hardcodeado en `App.tsx`. Ahora hay un
registro central en `src/lib/shortcuts.ts` y un solo listener (`useShortcuts`),
con `⌘1/⌘2/⌘3` para Home, Today y Focus, y una sección en Settings para
reasignarlos pulsando la combinación.

Detalle de las reglas en [SPECS.md §4.9](SPECS.md#49-atajos-de-teclado). Lo
esencial: se guardan como `hotkey_<accion>` (una fila por atajo) con valor
normalizado y portable (`Mod+Shift+F`), la plataforma solo importa al mostrar,
Shift/Alt se comparan exactos, un valor ilegible cae al de fábrica, y la captura
avisa de colisiones en vez de dejar un atajo muerto.

Cubierto por `shortcuts.test.ts` (20 casos de lógica) y `useShortcuts.test.tsx`
(5 de cableado real). Verificado en la app: ⌘1/⌘2/⌘3 navegan, se ignoran con el
foco en un input, y reasignar Focus a ⌘⇧F deja de responder al ⌘3 de fábrica.

### 0.7 ✅ El hover de las opciones del taxímetro es inusable — hecho

Costaba llegar a los botones de completar y ocultar. La causa real estaba en
`src/features/timer/timer.css`: entre el disparador y `.tax__opts` había un
hueco muerto de 4px (`margin-right`) donde el puntero no estaba sobre ninguno de
los dos, se perdía el `:hover` y el panel se cerraba justo al cruzarlo. Se
evaluó también agrandar el disparador a la tarjeta completa y se descartó (ver
abajo).

El disparador **sigue siendo el botón de play/pausa**, por decisión de producto:
que las opciones no salten al pasar el mouse por el título. El hueco de 4px lo
cubre la zona sensible, que envuelve al botón y al panel, así que cruzar de uno
al otro ya no cierra nada. El panel entra deslizándose desde la derecha
(`translateX(8px)` → `0`, con transición de `transform` además de `opacity`) y
sigue en `position: absolute`, superpuesto al título y los tiempos, así que la
caja no cambia de tamaño. El recorrido es corto a propósito: `.tax` tiene
`overflow: hidden`. Se agregó `:focus-within` al selector, porque esos botones
eran alcanzables con Tab estando invisibles.

**Hover sin foco.** El taxímetro casi nunca es la ventana activa, y en macOS los
eventos de mouse van a la ventana *key* (tao registra el hover con el
`addTrackingRect` legado, que es solo para ella). El `:hover` de CSS **se quitó
del todo**: su modo de falla no era quedarse apagado sino al revés —encendía y
no apagaba, porque llegaba la entrada y no la salida— y el panel quedaba pegado
hasta volver a pasarle el mouse por encima.

Manda `useCursorHover`, que sondea `cursorPosition()` cada 120ms —posición
global del puntero, no depende del foco— y prende `is-hover-controls` haciendo
hit-test contra la **envolvente** de los rects del botón y del panel. Solo
sondea mientras hay algo que mostrar, porque el webview sigue vivo con la
ventana oculta. El **click** sin foco ya funcionaba: `acceptFirstMouse: true`
está puesto en `tauri.conf.json` desde el principio.

Dos cosas costaron caro y quedan documentadas en SPECS §5.4.5:

1. Faltaba `core:window:allow-cursor-position` en las capabilities. La promesa
   se rechazaba, el `catch` se comía el error y el síntoma era "no pasa nada"
   sin rastro en la consola. Ahora el fallo se reporta una vez.
2. `cursorPosition()` y `outerPosition()` **no vienen en la misma escala**: la
   primera usa la del monitor principal, la segunda la de su propia ventana.
   Con un solo monitor coinciden y restarlas en crudo parece correcto; con un
   externo 1x junto al Retina el puntero medía `(-2845, 1446)` contra una zona
   de `118..220`. Hay que pasar cada una a lógicas con su propia escala antes
   de restar.

Diagnosticar esto desde fuera era imposible —ventana sin consola alcanzable— y
se resolvió pintando temporalmente las mediciones en el propio taxímetro. El
andamio ya no está.

El otro cambio, menos obvio: `useDragOrClick` descartaba los eventos con
`closest("button")`, y el panel se superpone al título. Un click que empieza en
el título puede terminar soltándose sobre el panel —no sobre un `button`, sino
sobre su relleno— y eso abría Focus haciendo saltar la ventana principal. El
selector pasó a `button, .tax__opts`, en `onPointerDown` y en `onPointerUp`.
Cubierto por un caso nuevo en `useDragOrClick.test.tsx`, verificado en rojo
antes de arreglarlo.

Verificado en `pnpm tauri dev` con otra app en primer plano: las opciones
aparecen al llevar el mouse al botón de play y se ocultan al sacarlo.

### 0.8 ✅ La app no se entera de que cambió el día — hecho

Escenario real y cotidiano: el Mac se suspende a las 19:00 con la app abierta y
se despierta a las 9:00 del día siguiente. Nada le avisaba a la app que ya era
otro día: no había temporizador, ni detección de cambio de fecha, ni listener de
cuando la ventana vuelve a estar visible o enfocada. Today seguía mostrando
ayer, la semana se quedaba en la anterior si el salto cruzó un domingo, y el
carry-over no corría hasta el primer click que provocara una recarga.

Ahora el día es **estado observable**, en `src/lib/day.ts`. `useToday()` lo
expone y re-renderiza al cambiar; `useDayWatcher()`, montado en `Shell`, revisa
en `focus`, `visibilitychange` y un intervalo de 60s —los tres, porque si la
ventana nunca se ocultó ni perdió el foco, que es justo el caso de la
suspensión, los dos primeros no se disparan— y al detectar el salto llama
`markDataStale()`. Con eso `useBoard` recarga y el carry-over corre solo, porque
su guarda ya era por fecha. La comparación es de fechas de reloj, nunca de
tiempo transcurrido: macOS agrupa y suspende los temporizadores al dormir, así
que el intervalo puede disparar tarde o ninguna vez, y una comparación pura
acierta igual.

`WeekView` además mueve su `anchor`, pero solo si corresponde:
`anchorAfterDayChange` deja la vista quieta si el usuario había navegado a otra
semana a propósito, o si el día nuevo ya cae en la semana visible (dormir el
viernes y despertar el domingo no requiere mover nada).

Cubierto por `day.test.ts` (6 casos, incluido el del intervalo sin que nadie
toque la app) y `anchor.test.ts` (4). Detalle en [SPECS §5.3.1](SPECS.md).

**Con esto la Fase 0 queda cerrada.**

---

## M3 — Calendar + review + resúmenes

El milestone más grande, y contiene la feature declarada como más importante del
proyecto (Weekly review).

### 3.1 ✅ Feeds ICS (backend) — hecho

`src-tauri/src/calendar/` en tres capas, y la separación es lo que hace testeable
lo difícil: `fetch` (lo único que toca la red), `ics` (interpreta el texto, puro,
con fixtures) y `repo::import_events` (escribe, puro sobre `&Connection`).
`commands::sync_calendar_feed` es el pegamento y no decide nada. Deps:
`reqwest` (rustls, sin OpenSSL del sistema), `icalendar` con `chrono-tz` y
`recurrence`.

CRUD de feeds con su UI en Configs → Calendarios, poller en Rust que respeta
`poll_minutes`, e import como tareas normales (`source = 'CALENDAR'`) usando el
`UNIQUE(feed_id, calendar_uid)` para el upsert.

Cuatro decisiones de interpretación que no estaban en este plan y que cambian lo
que la feature hace:

1. **Las series se expanden** en una ventana de una semana atrás y cinco
   adelante, con **una clave por instancia** (`UID#<instante>`). Sin expandir, un
   standup semanal se importa una sola vez y la feature queda inútil para el
   contenido más común de un calendario de trabajo; sin clave por instancia, el
   `UNIQUE` colapsa el mes entero en una fila. Una instancia editada
   (`RECURRENCE-ID`) comparte clave con la generada, así el upsert deja una.
2. **Los eventos de día completo entran sin reloj**: sin hora, sin
   `event_start`/`event_end` y sin `estimated_minutes`. Un feriado no son 24
   horas trabajadas, y con la regla 3 del rollup (§3.5) lo serían.
3. **`STATUS:CANCELLED` se descarta** al interpretar. Pendiente y anotado:
   `PARTSTAT=DECLINED` necesita saber cuál de los invitados eres tú, o sea un
   ajuste con tu email; hoy una reunión rechazada se importa igual.
4. **`import_as_tasks = 0` baja el feed pero no escribe.** Así una URL revocada
   se sigue viendo como error en vez de quedar muda, y es lo que va a alimentar
   el rail de §3.3.

**Link de la reunión** (`tasks.meeting_url`, migración 4): se busca en
`X-GOOGLE-CONFERENCE`, `CONFERENCE`, `LOCATION` si es una URL, y por último la
primera URL de la `DESCRIPTION` con host de videollamada conocido — esa lista
existe porque la descripción de Google trae también links de ayuda y de
adjuntos, y sin filtrar el botón abriría cualquiera. Va en **columna propia y no
en `notes`**: las notas son del usuario y la sync las pisaría cada 15 minutos.
Se muestra en el modal y, más grande, en Focus.

Hizo falta **`tauri-plugin-opener`**: dentro del webview un `<a target="_blank">`
no navega a ninguna parte y el click se traga sin error. Los links detectados en
las notas tenían el mismo problema y ahora pasan por el mismo camino.

`last_error` es columna nueva (migración 3): sin ella, un feed con la URL
revocada se ve **idéntico** a uno sano, porque `last_synced_at` se sella también
cuando falla —es "cuándo lo intenté", que es lo que el poller necesita para no
reintentar en bucle—. El poller avisa con un evento de Tauri que entra por
`markDataStale()`, no por `bumpData()`: el evento ya llega a las dos ventanas, y
avisar de vuelta por `localStorage` sería el ping-pong que §0.1 vino a evitar.

Tests: 13 de interpretación de ICS (zona horaria, día completo, cancelados,
`EXDATE`, instancia editada, ventana), 10 de importación (upsert idempotente,
**la sync no pisa lo completado, ni el tiempo trackeado, ni la categoría puesta a
mano**, dos feeds con el mismo UID, borrar el feed no borra las tareas) y 4 del
intervalo del poller. En el front, 6 de la UI de feeds.

**Falta 3.2**: nada se borra todavía. Un evento que desaparece del feed deja su
tarea donde está — `import_events` ya devuelve los UIDs que vio, que es
exactamente lo que el reconciler necesita.

### 3.2 ✅ Reconciler — Regla 1 (borrado no destructivo) — hecho

Es la regla de diseño más delicada de M3:

> Una tarea de calendario se **borra** solo si es **futura e intacta**:
> `event_start >= hoy`, sin `time_entries` y no completada.
> Si tiene tiempo trackeado o está completada ⇒ `source_state = 'ORPHANED'`
> (sale de los listados, sobrevive en historial y review).

`repo::reconcile_feed` corre después de cada import, con los UIDs que el
import acaba de ver. Se agregó una condición que el plan no tenía y que resultó
crítica: **solo se borran las futuras**. La ventana de import arranca hoy, así
que cada mañana las reuniones de ayer dejan de venir en el feed — sin ese filtro,
la primera sincronización del día habría borrado toda la historia de reuniones.

Seis tests: borra la futura intacta, **no** borra la que tiene tiempo trackeado,
**no** borra la completada, **no** borra las pasadas, no toca las que siguen
viniendo, y no toca ni otros feeds ni las tareas escritas a mano.

### 3.3 ✅ Rail de calendario — hecho

Columna derecha con la agenda del día, en `TodayView`. `railLayout.ts` calcula
(puro y testeado) y `CalendarRail.tsx` dibuja; recibe todo por props para que
Daily planning (3.4) lo monte sin tocar nada. Detalle en SPECS §4.13.

Tres decisiones que el plan no tenía:

1. **La hora sale de `scheduled_time`, no de `event_start`.** Los timestamps del
   import están en UTC: sacarles la hora movería de bloque una reunión de la
   tarde. `scheduled_time` ya viene en hora local y `estimated_minutes` es la
   duración, así que el rail no necesita convertir nada.
2. **Los eventos de día completo van a una franja aparte.** Un feriado no tiene
   dónde caer en la escala de horas. Una tarea a mano sin hora **no** entra ahí:
   duplicaría la columna de al lado.
3. **La jornada define la grilla pero no recorta.** Una reunión a las 7:30 estira
   el rango en vez de desaparecer, y una jornada invertida cae a los defaults —
   si no, el rail queda de altura cero y se ve vacío sin explicar por qué.

Queda **fuera del `DndContext`** a propósito: es una columna de referencia, y
hacerla droppable significaría escribir `scheduled_time` al soltar y perturbar
`boardCollision`, que está afinada para el board.

**Segunda pasada** (mismo milestone, pedida al ver el rail andando): el rail
proyecta el día entero y no solo las reuniones. Las tareas sin hora se encadenan
en los huecos que dejan las fijas, en el orden del tablero, con borde punteado
para que no se lean como un compromiso, y **se parten alrededor de las
reuniones**: media hora libre antes de una meet y una tarea de una hora quedan
como media hora antes y media después. Saltar el hueco entero tiraría a la basura
tiempo real de trabajo. Un hueco menor a 15 minutos sí se deja vacío —astillar la
tarea ahí volvería ilegible el rail—, pero la regla es *saltar el hueco*, nunca
*achicar la tarea*: los tramos siempre suman el estimado. Cada bloque muestra
`1/2` porque, sin eso, una tarea partida son dos bloques con el mismo título a
distinta hora. La regla dura: **la proyección no escribe
`scheduled_time`**. Esa columna la escribe el import y ordena la cola de Focus;
si el rail metiera ahí una hora inventada, después no habría cómo distinguir la
que pusiste tú de la que adivinamos. Se calcula al dibujar y muere ahí. En el día
de hoy la proyección arranca en "ahora" (el reloj entra por parámetro, para no
ensuciar el módulo puro), lo completado no se proyecta, y si el día no cabe la
grilla se estira: ese desborde es justamente el aviso.

**Tercera pasada**: la agenda también en la semana, pero **superpuesta y detrás de
un icono**, porque con siete columnas el espacio es de las tareas. El icono vive en
una **tira permanente pegada al borde derecho** (`SideDock`), que es el lugar
natural para los paneles que se piden y se cierran: permanente para que se sepa que
están, angosta para no cobrar ancho cuando no se usan. Muestra hoy si la semana
visible lo contiene, y el lunes si no.
`CalendarRail` no cambió: recibía todo por props desde el principio, así que solo
sumó un modificador de clase y un botón de cerrar. Cuelga de `.week__body` y no
de `.board` (que tiene scroll horizontal y se lo llevaría de pantalla), y va
debajo de la barra o taparía el botón que lo cierra.

La tira recibe sus botones como lista porque va a tener **tres**, y los otros dos
quedan pedidos para cuando toque:

| Icono | Qué abre | Cuándo |
|---|---|---|
| Agenda | el rail de calendario | ✅ hecho |
| Objetivos | objetivos de la semana con su avance | pendiente — la review (M3.5) ya los muestra, falta el panel de la semana |
| Backlog | el backlog, **arrastrable a la semana** | ver Mej.11 |

Por ahora **solo se dibuja el primero**: un icono que no hace nada al apretarlo
enseña que la barra no responde.

Lo que **no** se hizo: un selector de día dentro del panel, con flechas para
navegar. El pedido era el interruptor; el día ya se elige desde la cabecera de la
columna, y dos formas de hacer lo mismo obligan a mantener las dos. Y abierta tapa
la última columna, que mientras tanto no recibe drops: la agenda se abre para
consultar, no para arrastrar.

**Cuarta pasada**, con la app ya en uso:

- El rail muestra **lo que pasó** y no solo lo planificado. Comando nuevo
  `day_work`: una fila por tarea con el primer inicio del día y los
  segundos cerrados. Una reunión que arrancó tarde y duró distinto se dibuja
  donde ocurrió — lo que pasó no se estima. Las completadas se quedan, con un
  punto verde.
- La grilla pasó a **24 h con dos líneas de jornada**: marcar que el tiempo se
  acaba sin bloquear nada. Antes la jornada definía el rango y se estiraba con
  los outliers; ahora solo pone las marcas.
- **Clickear el título de una columna** en la semana cambia el día del rail, para
  poder proyectar un día que todavía no llega.
- **Trabajar algo no lo agota**: una tarea de 45 minutos con 19 hechos deja su
  bloque real y proyecta los 26 que faltan, partidos alrededor de lo que venga.
  En la primera versión lo trabajado reemplazaba a la tarea entera, así que una
  tarea empezada desaparecía del resto del día justo cuando más importa saber si
  el tiempo alcanza.
- Cards de Today al ancho de una columna de la semana (eran 460px y se leían como
  otro componente), y las secciones de Configs reordenadas.

También se centró el contenido de Today —`flex: 1` en la columna se comía el
espacio libre y dejaba a `justify-content` sin nada que repartir— y la jornada
(`work_start`/`work_end`) por fin tiene UI en Configs → General, con validación
al escribir. Ver Mej.1.

De paso, `mockDb` ahora siembra dos reuniones y un evento de día completo: sin
eso ni el rail ni el detalle de evento se podían ver en el browser.

Lo del plan que **no** se hizo: el almuerzo como bloque propio. No hay ajuste de
almuerzo en `SettingKey`, y si está en el calendario ya aparece como cualquier
otro evento. Inventar un `lunch_start` sin pedirlo era de más.

### 3.4 ✅ Daily planning (ritual guiado) — hecho

> **El carry-over se retiró.** Con el ritual andando, arrastrar todo a hoy
> automáticamente dejó de tener sentido: decidía por el usuario antes de que
> viera nada, y el repaso del día anterior tuvo que reconstruirse desde el
> historial dos veces seguidas. Ahora `demote_pending` **preserva el último
> día con actividad** —el que repasa el ritual— y baja al backlog, en primera
> posición, lo anterior. Detalle en SPECS §4.2. Con eso se fueron `carry_over`,
> `arrastradas_a`, el tipo `Arrastre` y la sección "se movieron solas" del paso 1;
> entró `rescued_from_backlog` y el grupo **"venían de un día"**.

Dos pasos a la izquierda —cómo cerró ayer, qué hay para hoy— y el rail (§4.13,
sin tocarlo: recibe las mismas props que en Today) a la derecha. Detalle en
SPECS §4.14.

El paso 2 son tres columnas: **día · backlog · agenda**, y las dos primeras
intercambian cards arrastrando. Eso dejó **media Mej.11 hecha** (`BacklogColumn`):
falta montarla en la vista semana, donde el `DndContext` abarca siete columnas.
Los botones de "mañana" y "al backlog" que tenía la primera versión se fueron: el
arrastre ya lleva la acción y la intención, y dos caminos para lo mismo obligan a
mantener los dos.

Empezó con tres pasos (repaso → hoy → sacar tareas). "Armar el día" y "ver si
cabe" terminaron juntos porque son el mismo
gesto: se saca algo justamente porque no cabe, y separarlos obligaba a ir y
volver para tomar una sola decisión.

Seis decisiones que el plan no tenía:

1. **El ritual no corre el carry-over.** Ya corrió: `useBoard` lo dispara al
   montar cualquier vista, y para cuando abres `/daily-planning` la semana o
   Today ya lo hicieron. Querer que el ritual fuera dueño del arrastre habría
   sido pelear con la guarda de `carryOverOnce`. Lo que hace el paso 1 es
   **mostrarlo para triagearlo**, y —como Mej.3— **avisa y no actúa**.
   Eso necesitó `repo::arrastradas_a`: el arrastre no marca la fila, solo deja un
   `CARRIED_OVER` en `task_events`, así que sin ese agregado saber qué llegó
   arrastrado costaba una lectura de eventos por tarea. La racha **se corta en
   el último movimiento a mano**: reprogramar es una decisión, y sin ese corte
   una tarea que moviste a la semana siguiente resucitaba la cadena vieja y
   decía "4 arrastres" por haberse caído una vez.
2. **No hay botón "Guardar"**, porque no hay nada que guardar: autosave es la
   convención del proyecto y todo lo que se toca acá ya persiste. "Empezar el
   día" es un **terminador de ritual** —sella `planned_on`, confeti, vuelta a la
   semana— y está escrito así en SPECS para que nadie lo "arregle" a un save ni
   lo borre por inútil. Un test cubre justamente que **montar la vista no
   escriba nada**.
3. **Volver a entrar a un día ya planificado avisa** con un diálogo, en vez del
   sello en la cabecera que tenía antes: se leía como decoración, y el ritual
   está para hacerse una vez.
4. **El conteo del día anterior incluye lo que el carry-over ya se llevó.** Es
   la trampa del paso 1, y salió de una pregunta del dev: si `carry_over` corre
   al montar cualquier vista, a las 9 AM lo manual sin terminar ya está en hoy y
   esa fecha no lo tiene. Sin arreglarlo el día se veía más corto y más exitoso
   de lo que fue, y un día 100% manual quedaba **invisible** —sin filas con esa
   fecha, el ritual repasaba un día más viejo. Por eso `arrastradas_a` devuelve
   `ultimoDesde` además de `desde`.
5. **El paso 1 muestra lo que el carry-over NO toca**, y esa resultó ser su
   razón de más peso: `carry_over` filtra `source = 'MANUAL'`, así que una
   **reunión** sin cerrar se queda en su día para siempre y ninguna vista de hoy
   la vuelve a mostrar. Salió de un caso real —una tarea del sábado que no
   aparecía en el planner—. El botón "A hoy" es el único camino de rescate.
   Además repasa **el último día con tareas**, no "ayer" a secas: un lunes, ayer
   es domingo y lo que hay que cerrar es el viernes.
6. **El semáforo pesa el día entero, no solo lo pendiente.** Completar tareas no
   puede ir apagando la alarma de un día sobrecargado. Y las tareas sin estimar
   se **cuentan y se avisan** en vez de rellenarse con un número: misma regla que
   el rail con `DURACION_POR_DEFECTO`.

Lo de este plan que ya estaba hecho: la capacidad se lee de `settings` desde la
Fase 0.4 (`useCapacitySettings`), así que solo hubo que mostrarla.

El confeti se llama **imperativamente** desde `lib/confetti.ts` y no como
componente: `canvas-confetti` cuelga su canvas de `document.body` y así sobrevive
al `navigate`. Vive en un módulo propio también porque el canvas de jsdom no
implementa `getContext` y hay que poder mockearlo.

Lo que **no** se hizo: el objetivo semanal dentro del ritual —M3.5 lo resolvió a
medias: la weekly review muestra los objetivos y cuántos se cumplieron, pero el
panel de la tira de la semana sigue pendiente— y el paso de "elegir del backlog"
(es Mej.11, y el panel arrastrable sirve para la semana entera, no solo para hoy).

### 3.5 ✅ Weekly review — hecho

La semana hacia atrás en `/weekly-review`: cifras de cabecera, productividad
diaria, en qué se fue el tiempo y lo que se cerró día por día. Detalle en
[SPECS.md §4.15](SPECS.md#415-weekly-review-weeklyreviewview).

Lo que valía la pena decidir, decidido:

1. **Un solo comando, `weekly_rollup`.** Devuelve los 7 días, las celdas
   día × categoría y las completadas, ya agregado. La atribución por día es
   **local** y ahí están las tres reglas frágiles: van donde se prueban con
   SQLite en memoria, no en TS.
2. **Regla 2 en su lugar**: el tiempo se atribuye por `started_at`. Mover una
   tarea de semana cambia su barra de plan y **no** sus horas. La asimetría es
   correcta: son dos preguntas distintas.
3. **Regla 3 con dos límites que no estaban escritos**: una entrada real basta
   para que la reunión deje de contar su duración de evento (si no, contaría
   doble), y una reunión que todavía no empieza no cuenta como trabajada.
4. **La review es el único listado que no filtra `source_state`.** Las
   `ORPHANED` son historial; filtrarlas borraba horas reales de semanas pasadas.
   Quedó anotado como excepción explícita en la invariante I7.
5. **Gráficos a mano, sin `recharts`** —que sigue instalado, ahora sin uso—:
   los colores de los channels son tokens de la paleta, y pasarlos como prop a
   una librería obliga a resolverlos a hex y a re-resolverlos al cambiar de tema.
   Con CSS los dos temas salen gratis y los tests pueden mirar el DOM.
6. **El piso en 0 va por tarea y por día.** Más arriba, los segmentos de una
   barra dejan de sumar su total; sin él, un ajuste manual negativo dibuja un
   segmento hacia abajo.

Lo que ya estaba hecho de este plan: `stop_timer` parte las corridas en la
medianoche local desde el timer (I3), así que agrupar por día fue solo agrupar.

Se sumó el **objetivo semanal** (era carry de 3.4): la review muestra cuántos se
cumplieron y cuáles.

Quedó en pie **Mej.14** como salvedad —el ajuste manual de tiempo se acreditaba al
día en que lo escribías, no al de la tarea (D8)— y **ya está cerrada**: la fila
nace con el día de la tarea, así que la Regla 2 vale también en la escritura.

### 3.6 ✅ Daily highlights / shutdown — hecho

Dos rutas y una sola idea: **la bitácora se escribe sola, y el shutdown es el
gesto de cerrar el día con tus palabras.** Detalle en
[SPECS.md §4.16](SPECS.md#416-bitácora-y-cierre-del-día-dailyhighlightsview--dailyshutdownview).

Con esto **no queda ninguna ruta en `<Placeholder>`**, y el componente se borró.

Lo que valía la pena decidir:

1. **La bitácora no depende del ritual.** Sale del trabajo trackeado y de lo
   cerrado; `day_entries` solo aporta la nota y el sello. Un día que nunca
   cerraste aparece igual, como **borrador** — y los días anteriores a la
   migración también. Si dependiera de la tabla, la bitácora arrancaría vacía y
   parecería rota.
2. **Escribir no es cerrar.** El autosave usa `set_day_note`, que no toca
   `closed_at`; solo el botón sella. Si no, teclear una letra daría el día por
   terminado y no habría forma de dejar una nota a medias.
3. **La nota de una tarea lleva la fecha en la clave** (`day_task_notes`): la
   misma tarea puede tener una reflexión distinta cada día que la tocás. No es
   `tasks.notes`, que son las notas con las que trabajás.
   - Y **incluir es curar**: un día de ocho cerradas puede tener cinco que valga
     la pena mencionar, así que la bitácora muestra **solo las incluidas** (si no
     hay ninguna, todas) y **cuenta las que quedan afuera**. El día completo está
     a la derecha, en el timeline: esa es la diferencia entre las dos columnas.
   - **Incluir y escribir terminaron siendo dos gestos**, con `note` en tres
     estados (`null` / `""` / texto). Con dos estados, vaciar el resumen bajaba la
     tarea de los highlights: borrar una palabra la hacía desaparecer.
4. **`closed_at` no se re-sella**: "a qué hora cerré" es el dato. Idempotente,
   con `reopen_day` para volver a borrador sin perder nada.
5. **Una reunión no se mueve** desde "qué quedó pendiente": es el registro de algo
   que pasó ese día. Misma regla que la degradación diaria (§4.2).
6. **El rollup se extrajo a `work_by_day`**, compartido con la weekly review:
   la atribución local, las Reglas 2 y 3, el no-filtrar `ORPHANED` y el piso en 0
   viven en un solo lugar. Dos consultas se habrían separado con el primer cambio.

Dos bugs que salieron en revisión y ya están cerrados: `runTotal` se le sumaba a
**cualquier** día con una corrida abierta (se mide desde la medianoche local, así
que fuera de hoy no significa nada, y un timer abierto desde las 23:50 de ayer
marcaba la fila de ayer), y la recarga automática **pisaba el texto a medio
escribir** en los campos de nota — ahora los campos sucios no se tocan hasta que
se guardan.

El **mood** del día (un emoji junto al nombre) llegó con la migración 8, versión
nueva y no un cambio a la 7: las aplicadas son inmutables, y la 7 ya podía haber
corrido en la base del dev. El selector es una **grilla en popover** como las
reacciones de un chat, con una lista curada de caras: un picker completo son
cientos de KB de datos de emoji en una app que tiene que andar offline, y obliga a
buscar entre miles para elegir una cara. Antes de eso pasó por un `<input>` con el
selector del sistema (⌃⌘Espacio), que descartamos: escribir un emoji a mano no es
un gesto.

El donut va **plegado en la bitácora y abierto en el shutdown**: uno es archivo
que se hojea, el otro es el momento de mirar cómo se repartió el día. Y "qué quedó
pendiente" en el shutdown es **solo de lectura** — replanificar es del daily
planning, y el mismo gesto en dos vistas obliga a mantener la regla en dos lados.

Lo que ya estaba: `tasks.objective_id`, el plugin de notificaciones (instalado en
M2 justamente para esto), `work_end` en `settings`, y el patrón `planned_on` para
avisar una vez al día.

**El aviso nativo de `work_end` solo se puede verificar con `pnpm tauri dev`**: en
el browser y en jsdom no hay notificaciones. La decisión (`shouldRemindShutdown`) sí
está testeada.

---

## M4 — Durabilidad, branding, empaque

### 4.1 ✅ Respaldo y restauración — hecho

Un `.zip` por respaldo (la base vía `VACUUM INTO` + un `manifest.yml` con la
versión de la app y del esquema) en una carpeta que el usuario elige, automático
a la hora que fije en Configs → Respaldo, con retención y con restauración desde
la app. Detalle en [SPECS.md §4.17](SPECS.md#417-respaldo-y-restauración-backupcard).

**El `rsync` al VPS quedó fuera, a propósito.** Habría sido credenciales SSH,
`shell-out` a un binario del sistema y cero tests posibles, para hacer lo que el
sistema operativo ya hace: apuntando la carpeta a un Drive, un Dropbox o un iCloud,
el respaldo sale de la máquina sin que sunrise hable con ninguna nube. Y si el
destino es un VPS, un `scp` desde esa misma carpeta sigue estando a mano.

**El import quedó explícitamente fuera** (la restauración es completa o nada, no
mezcla). Para eso está el `manifest.yml`: es lo único que un import futuro va a
necesitar y que no se puede reconstruir después. La versión sale de
`env!("CARGO_PKG_VERSION")` —la misma con la que Tauri arma el `.dmg`— y hay un
test que exige que sea semver y que `Cargo.toml`, `tauri.conf.json` y
`package.json` no divergan.

**Lo que costó más no fue el respaldo, fue no borrar nada ajeno.** La carpeta
destino es la de sincronización del usuario, probablemente compartida con el resto
de su vida, y la retención tiene que borrar ahí. `purgar` solo toca archivos cuyo
nombre calza exactamente con `sunrise-YYYYMMDD-HHMMSS.zip`, lo comprueba dos veces
y nunca toca un directorio; hay un test que se pone rojo si el patrón se afloja a
`*.zip`.

Segundo, el orden de la restauración. La versión ingenua —copiar el archivo y
reabrir— deja la app sin base si el reabrir falla. La que quedó extrae, valida y
**migra en un temporal** antes de tocar nada, guarda una copia de la base viva y
solo entonces reemplaza; migrar antes es también lo que hace que un respaldo de un
build anterior sirva de verdad. La conexión se cambia en caliente dentro del
`Mutex` en vez de reiniciar la app, porque `app.restart()` dispararía el propio
diálogo de salida (§4.10).

Dos cosas se arreglaron de paso:

- **El taxímetro se quedaba ofreciendo darle play a una tarea inexistente.**
  `timerStore.refresh` releía la tarea pausada y, si ya no estaba, se quedaba con
  la foto vieja de `localStorage`. Aparecía con la restauración, pero pasaba igual
  con una tarea borrada desde la otra ventana.
- **Se validó la carpeta al escribirla** (prueba de escritura real), no a la hora
  del respaldo. Un volumen de solo lectura es perfectamente legible, y un ajuste
  que se acepta y falla nueve horas después no dice qué se escribió mal.

Y una que apareció al revisar y valía la pena atajar: **restaurar apagaba el
respaldo**. `settings` es parte de la base, así que un zip hecho antes de
configurar la carpeta dejaba `backup_dir` vacío al restaurarlo y el automático
dejaba de correr sin decir nada. Los tres ajustes de respaldo describen la máquina
y no los datos, así que ahora cruzan el reemplazo.

**El cierre de la restauración es un diálogo y no un aviso que se va solo.** Es la
única acción de la app que no se puede deshacer desde la app, así que el resultado
se queda en pantalla: de qué momento era el respaldo (del **manifest**, con zona,
que es más preciso que la fecha del nombre) y cuánto hace, con qué datos quedó
—tareas y último trabajo, que es lo que delata haber abierto el zip equivocado— y
dónde está la copia de seguridad. Del manifest se deja **fuera** el tamaño y el
número de esquema: no permiten decidir nada. La versión sale solo si difiere.

**Respaldar y podar quedaron como un solo paso** (`create_and_prune`). Ya corría en el
manual —es el mismo comando que el automático— pero era una propiedad del llamador
y no del módulo; ahora no hay forma de respaldar sin podar, y un test aprieta siete
veces para fijarlo.

`tauri-plugin-dialog` es la única dependencia nueva de plataforma, y solo para el
selector nativo de carpeta y de archivo (`open`). **Los diálogos de confirmación
son React**, como el de ⌘Q: el plugin no se usa para eso.

> **Verificado en la app**: el selector abre el Finder (el permiso
> `dialog:allow-open` alcanzaba) y **restaurar funciona de verdad**, que son las
> dos que podían salir mal en silencio. Siguen sin comprobar las dos que dependen
> de esperar: que el respaldo aparezca en un Drive real y que el automático se
> dispare a la hora.

### 4.2 ✅ Marca e inicio automático — hecho

Los iconos eran todavía los de plantilla de `create-tauri-app`. Ahora hay marca
propia: **un sol saliendo sobre el horizonte**, en un solo SVG
(`public/app-icon.svg`) del que salen el icon set completo
(`pnpm tauri icon`, que reescribe `src-tauri/icons/`) y el favicon de las dos
ventanas. Dentro de la app la misma figura es `SunriseMark.tsx`, sin el cielo y
con el horizonte en `currentColor`, y reemplazó al punto pastel del sidebar.

**Dos decisiones del dibujo, y las dos son por el tamaño chico.** Solo sol y
horizonte: rayos o nubes son trazos finos que a 32px se vuelven suciedad, y 32px
es el tamaño en que un icono se usa. Y el cielo es oscuro aunque la app sea
clara, porque el icono vive en el Dock sobre el fondo de pantalla de cualquiera y
un sol pastel sobre un cielo pastel desaparece; los colores siguen siendo los
tokens, lo que cambia es la relación. La primera versión tuvo que crecer dos
veces: a 32px el sol quedaba chico y la línea del horizonte casi no se veía.

**El tray se descartó.** Estaba en este ítem, y al explicarlo quedó claro que no
resolvía nada que la app necesitara: el acceso rápido ya lo dan el Dock y los
atajos, y la única variante interesante —esconder la ventana a la barra de menú—
dejaba sin sentido la confirmación de cierre de Mej.0. El icono monocromo del
tray era además la única razón por la que el diseño del logo tenía que aguantar
16px.

**Inicio automático** (§4.18 de SPECS): casilla en Configs → General, apagada de
fábrica, con `MacosLauncher::LaunchAgent`. Arranca con la ventana visible, no
escondida: sin tray, arrancar escondida sería arrancar invisible.

Lo que importa acá no es el switch: es que **el estado no vive en `settings`**. La
verdad la tiene el sistema operativo, que lo puede apagar desde Ajustes del
sistema sin pasar por la app, así que una copia en la tabla mentiría la primera
vez que eso pase. Y peor: el respaldo se lleva la tabla entera, así que restaurar
un zip de hace un mes prendería o apagaría el arranque de **esta** máquina. Es el
mismo problema que en 4.1 obligó a que las tres claves de respaldo cruzaran la
restauración, resuelto al revés: en vez de proteger la clave, no tenerla. Hay un
test que se pone rojo si alguien la mueve ahí "por consistencia".

De paso salieron dos cosas: un `Switch.tsx` neutro (el `ThemeToggle` no es
genérico, tiene un sol y una luna dibujados dentro) y el arreglo de §4.8 de
SPECS, que seguía diciendo "cuatro secciones" desde que Respaldo la hizo cinco.

Tests: `SunriseMark.test.tsx` (3) y dos en `SettingsView.test.tsx`. Total
**344 front (40 archivos) y 136 Rust**.

> **Verificado**: el icono aparece en el Dock y se ve bien al tamaño en que se usa.
> **Falta la casilla de inicio automático**: que registre el LaunchAgent y la app
> abra al reiniciar sesión —ojo que en dev registra `target/debug/sunrise`, así que
> hay que apagarla antes de salir—. El mock no tiene sistema operativo al que
> registrarse.

### 4.3 ✅ Empaque `.dmg` — hecho

`pnpm dmg` produce `sunrise_0.1.0_aarch64.dmg` (8,5 MB) y `sunrise.app` (24 MB).
**Es el primer build de release que se corre**: hasta acá el bundle nunca se había
ejercitado. Salió verde de una, en 2m38s.

Detalle en [SPECS §4.19](SPECS.md#419-empaque-dmg). Lo que vale contar:

- **La versión se queda en 0.1.0.** Decisión explícita: el 0.x avisa que las cosas
  todavía se mueven, y no hay nadie más a quien avisarle. Sube cuando quieras, pero
  son tres archivos y hay un test.
- **Firma ad-hoc, no de desarrollador.** No hay certificado en esta máquina. Un
  `.dmg` construido localmente no queda en cuarentena, así que instalarlo acá
  funciona; copiarlo a otra máquina muestra el aviso de desarrollador no verificado
  y hay que abrirlo con clic derecho la primera vez. Firmar y notarizar necesita
  cuenta de Apple Developer, y mientras la app no salga de acá no hace falta.
- **El `.app` de release comparte la base con `pnpm tauri dev`** (mismo identifier
  ⇒ mismo `app_data_dir`). Para una app personal es lo que se quiere —instalas y
  tus datos están— pero significa que probar el paquete toca tus datos de verdad.
  Quedó anotado como invariante en SPECS, porque es exactamente el tipo de cosa que
  se descubre tarde y mal.
- **El fondo del `.dmg` y la posición del icono son un par**: el resplandor está
  dibujado en (180, 170) porque ahí cae el icono de la app. El sol no está en el
  fondo — el sol *es* el icono, saliendo sobre el horizonte. Por eso las tres
  coordenadas están explícitas en `tauri.conf.json` aunque coincidan con los
  defaults de Tauri.
- Se agregaron `category`, `shortDescription`, `longDescription`, `copyright` y
  `minimumSystemVersion` (11.0), y `targets` pasó de `"all"` a `["app", "dmg"]`.

> **Instalado y abierto desde Aplicaciones**, y de ahí salieron dos cosas que solo
> se ven así: que el `.dmg` bajado del navegador se reportaba como dañado (5.6) y
> que dev y producción compartían base (5.1).

---

## M5 — Compartir con el equipo

La app deja de ser solo mía: el equipo la instala desde un Release y se actualiza
sola. Eso mueve dos cosas que hasta acá no importaban —que probar no toque mis
datos, y que exista una forma de repartir versiones— y una que sigue pendiente.

**Decisión tomada: no se firma con Apple Developer.** Es una herramienta interna y
no vale una cuenta de US$99/año. La consecuencia concreta, y es una sola: un `.dmg`
descargado del navegador queda en cuarentena, así que **la primera instalación pide
clic derecho → Abrir**. Está escrito en el cuerpo del Release. Las actualizaciones
automáticas no pasan por ahí: ahí el que descarga es la app, y la app no marca lo
que baja.

### 5.1 ✅ Dev y producción con bases separadas — hecho

`pnpm tauri dev` y el `.dmg` instalado ya no comparten la base: `sunrise-dev.sqlite`
contra `sunrise.sqlite`, mismo directorio. Detalle en
[SPECS §4.20](SPECS.md#420-dev-y-producción-conviviendo).

Hasta acá, abrir dev para probar un cambio escribía en los datos de verdad —sellar
un día, correr una migración a medio escribir— **sin ninguna señal**. El identifier
es el mismo en los dos perfiles, así que `app_data_dir()` resolvía al mismo lugar.

Tres cosas que no eran obvias antes de hacerlo:

- **Separar por archivo y no por directorio.** El directorio lo decide el
  identifier, y cambiarlo en dev se lleva a otro lado el permiso de notificaciones
  y la ruta del LaunchAgent del inicio automático. El nombre del archivo no arrastra
  nada.
- **El puente entre las dos bases ya existía: el respaldo.** Respaldas en producción,
  restauras el zip en dev, y trabajas con datos reales sin tocarlos. Funciona porque
  el nombre de la base **dentro** del zip no depende del perfil, y ahora hay un test
  que lo fija.
- **Pero ese puente traía un problema nuevo**: al restaurar, dev hereda `backup_dir`
  —que es una ruta en el disco, no un dato de la base— y su respaldo automático
  empezaría a escribir zips de prueba en la carpeta de verdad, con la **retención
  borrando los respaldos reales** para conservar los de prueba. Por eso el
  automático no corre en dev. El manual sí: eso lo pides tú.

Y el sidebar muestra un distintivo `dev`. No es decoración: dos ventanas idénticas
con datos distintos son indistinguibles, y el error natural es editar en la
equivocada.

### 5.2 ✅ El Release lo publica un GitHub Action — hecho

`.github/workflows/release.yml`: empujas un tag `v*` y CI compila, corre las dos
suites y publica el `.dmg` en un GitHub Release.

Dos detalles que valen: corre en un runner **fijo** y no en `macos-latest`, porque
el proyecto compila solo arm64 y en `macos-13` (Intel) saldría un `.dmg` que no
corre en ningún Mac del equipo. Y tiene un paso que **compara el tag con los tres
archivos de versión**, que es el único lugar donde eso se puede pillar: el test de
Rust los compara entre sí, pero no sabe nada del tag.

> **Actualizado después de la 0.2.0**: arrancó en `macos-14` y se subió a
> `macos-26`. Resultó que el runner elige algo más que la arquitectura: **el SDK
> contra el que se enlaza el binario decide la apariencia de la ventana**, así que
> lo publicado salía con los botones de macOS 14 mientras en desarrollo se veían los
> actuales. Se descubrió comparando la app instalada con una compilada localmente —
> mismo commit, misma config, distinto marco— y se confirma en el binario con
> `otool -l | grep -A5 LC_BUILD_VERSION`. Detalle en SPECS §4.18.

> **No está ejercitado**: cuando se escribió, el repo no tenía remoto. El YAML está
> validado y la lógica del paso de versión se probó en local, pero la primera
> corrida de verdad es la primera vez que se empuje un tag. Falta también crear el
> repo remoto y empujar.

### 5.3 ✅ Auto-update — hecho

La app se actualiza sola desde el mismo Release que publica 5.2. Detalle en
[SPECS §4.21](SPECS.md#421-actualizaciones-updater).

Las cuatro piezas del plan, y cómo quedaron:

- **El par de llaves**, generado con `pnpm tauri signer generate`. La pública está
  en `tauri.conf.json`; la privada **no está en el repo** y hay que pegarla en los
  secrets como `TAURI_SIGNING_PRIVATE_KEY`. Se generó sin contraseña: guardarla en
  el mismo almacén de secrets que la llave no protege de nada.
- **`createUpdaterArtifacts: true`**, que agrega el `.app.tar.gz` firmado. El `.dmg`
  queda solo para la primera instalación.
- **El `latest.json`** lo escribe `tauri-action` en el Release, y `endpoints` apunta
  a `releases/latest/download/latest.json`. Sus notas salen del cuerpo del Release,
  que al principio era un texto fijo: eso se arregló en 5.4.
- **El momento de avisar: cuando lo pidas.** No hay chequeo al arrancar, y por eso
  mismo **hoy nada avisa** de que salió una versión nueva: hay que entrar a
  preguntar. Ese hueco está en Mej.18.

  La app ya interrumpe dos veces a una hora fija —el aviso de cerrar el día y el
  respaldo— y una tercera que aparece sola al abrir es la que sobra; lo primero que
  uno mira en la mañana es el día. Queda un botón en Configs → General →
  Actualizaciones.

Dos cosas que salieron de hacerlo:

- **Todo el updater quedó en Rust**, sin el paquete npm ni permisos nuevos en
  `capabilities`. La API de JavaScript del plugin habría dejado a `ipc.ts` de ser
  la única puerta a la app, que es la regla del proyecto.
- **El fallo no es rojo.** Sin conexión, o antes de que exista el primer Release, no
  se puede preguntar. La vista distingue tres finales y no dos, porque "estás al
  día" y "no pude preguntar" se ven parecidos y significan lo contrario: el segundo
  disfrazado del primero deja a alguien tranquilo en una versión vieja.

Tests: uno en Rust (`la_config_del_updater_esta_completa`: sin `pubkey`, sin
`endpoints` o sin `createUpdaterArtifacts` el updater se apaga en silencio) y
cuatro en `SettingsView.test.tsx`. Total **350 front (40 archivos) y 139 Rust**.

> **El repo va a ser público**, y eso es una condición del updater, no un detalle:
> el `latest.json` se pide sin credenciales.
>
> **No está ejercitado, y no se puede estar hasta que haya dos versiones
> publicadas**: el camino completo es un Release firmado, una app instalada más
> vieja, y la descarga que la reemplaza. Falta crear el repo
> (`devswert/sunrise`, público), cargar el secret con la llave privada —que está en
> `~/.tauri/sunrise-updater.key`—, y recién ahí el
> primer tag. Ojo con el orden: **si el primer Release sale sin la llave en los
> secrets, los artefactos van sin firmar y la app los rechaza sin decir por qué.**

### 5.4 ✅ Changelog, notas de release y el aviso "Lo nuevo" — hecho

El updater de 5.3 quedó publicando **siempre el mismo texto**: el cuerpo del
Release estaba escrito fijo en el workflow, así que la 0.2.0 le habría mostrado al
equipo las instrucciones de instalación en el lugar donde uno espera leer qué
cambió. Ahora hay `docs/CHANGELOG.md` y de ahí salen los tres textos. Detalle en
[SPECS §4.22](SPECS.md#422-changelog-y-el-aviso-lo-nuevo).

- **Un texto, tres lectores**: el primer párrafo es el modal "Lo nuevo"; la sección
  entera es el cuerpo del Release y el aviso de Configs. Que el aviso previo y el
  modal digan lo mismo es la razón del diseño, no una coincidencia.
- **El aviso dispara con cualquier cambio de versión**, comparando contra
  `localStorage`. La primera ejecución no muestra nada y solo deja la marca. (El
  modal se abría solo en la primera versión de esto; Mej.18 lo movió detrás del
  aviso del sidebar.)
- **El workflow ya no se puede correr a mano.** Se quitó `workflow_dispatch`:
  disparado desde una rama, el `tagName` valía `main` y habría publicado un Release
  "sunrise main" con un tag `main`.
- **Las notas se extraen del archivo, no del mensaje del tag.** El checkout trae el
  archivo siempre; la anotación de un tag puede no estar según el `fetch-depth`, y
  ese paso es justo uno de los que no se pueden ensayar antes del primer tag. El
  `awk` sí se ensayó en local contra el changelog real.
- **Skill nueva `sunrise-release`** con el procedimiento completo, incluido qué
  hacer con un release fallido: un tag no se mueve, se saca otro.

Tests: cuatro en `changelog.test.ts` y tres en `WhatsNew.test.tsx`. El que más vale
es el que exige que la versión de `package.json` tenga su sección: es el modo de
falla que abre esta feature —subir la versión y olvidar la entrada— y sin él no se
pone rojo nada.

> **Visto en la app**, actualizando de una versión a la siguiente: el modal "Lo
> nuevo" aparece con el texto del changelog.

---

### 5.5 ✅ El primer tag encontró un bug de zona horaria — hecho

El primer `v0.1.0` **falló en CI**, en `pnpm test:all`, con un solo test rojo:
`una_instancia_editada_reemplaza_a_la_generada`. Verde en local, rojo en el runner.

La causa no tenía nada que ver con el release: **el `TZID` del `RECURRENCE-ID` se
estaba ignorando** desde el primer commit. El parámetro existía en la firma —
`_dtstart`, con guion bajo— y el doc comment describía un comportamiento que nunca
se implementó. El valor se leía en la zona del computador, así que una instancia
editada de una serie recibía una clave distinta a la repetición que reemplaza, y la
reunión movida habría aparecido **dos veces** en la semana de cualquiera cuyo Mac no
estuviera en la zona del calendario.

Pasó desapercibido porque la máquina de desarrollo está en Santiago y todas las
fixtures usan `America/Santiago`: leer la zona equivocada daba el mismo resultado por
casualidad. **CI corre en UTC, y por eso lo encontró.**

El arreglo lee el `TZID` de los parámetros de la propiedad y no del valor pelado. Se
agregó un test con una serie en `Europe/Madrid`, que es el que faltaba: se cae en
cualquier zona, incluida la tuya, si alguien vuelve a ignorar el `TZID`. Comprobado
en los dos sentidos —deshaciendo el arreglo se pone rojo en Santiago y en UTC— y la
suite completa corre verde con `TZ=UTC`.

Deja dos cosas escritas para la próxima: que **CI en UTC es una ventaja** y no un
estorbo, y que un test de zonas horarias con fixtures en tu propia zona no prueba
nada. Total **367 front y 140 Rust**.

### 5.7 ✅ Tres tests pasaban solo los martes — hecho

El primer tag de la `v0.2.0` **falló en CI**, en `pnpm test:all`, con tres casos
rojos —dos de `DailyPlanningView` y uno de `DailyShutdownView`— que en local
estaban verdes. Reproducido en un comando: `TZ=UTC pnpm test`.

La causa no tenía nada que ver con el cambio que se estaba publicando: **la semilla
del mock ancla varios de sus items a días de la semana** (`weekDates`), no a hoy.
Un item puesto "el martes" está en el futuro los lunes, es hoy los martes y es
pasado el resto de la semana. Los tres casos daban por sentado que el único día
pasado con tareas era el suyo, y eso solo es cierto los martes.

Lo peor era cómo fallaba. Uno de ellos comprobaba `1/2 cerradas` **y pasaba**: el
día de la semilla tenía justo una cerrada y una abierta, así que el conteo calzaba
de casualidad y solo se caía el título. Un test que verifica el número correcto del
día equivocado.

El arreglo es aislar, no rehacer la semilla: la semilla tiene otro consumidor —el
preview en el browser— y volverla determinista para los tests la empeora para eso.
Los casos que dependen de qué días están en el pasado ahora lo neutralizan
explícitamente (`limpiarDiasPasados`) o se crean su propia fixture. Verde en las
dos zonas, que es la comprobación que importa: pasar en una sola significa haber
movido la casualidad, no haberla sacado.

De paso salió un bug de la app y no de los tests: la semilla llamaba `yesterday` a
`wk[1]`, que es **el martes**, así que los lunes el "día anterior con algo cerrado"
caía en el futuro y el repaso del ritual se veía vacío justo el día en que más se
usa. Ahora se calcula desde hoy. Que arreglarlo no moviera ningún test es la señal
de que el aislamiento quedó bien.

**Es la segunda vez seguida que CI encuentra un bug de fecha que en Santiago pasa
por casualidad** (la otra es 5.5). La regla quedó escrita en la skill
`sunrise-tests`, con el comando: si tocas fechas, corre también `TZ=UTC pnpm test`.

### 5.6 ✅ La primera instalación decía que la app estaba dañada — hecho

La `v0.1.0` se publicó con sus cuatro artefactos y se instaló mal: al abrir el
`.dmg` bajado del navegador, macOS decía **`"sunrise" is damaged and can't be
opened. You should eject the disk image.`** El clic derecho → Abrir no servía,
porque ese camino existe para apps sin firmar y esta no era ese caso.

**Le faltaba firma al bundle, no al binario.** Sin
`bundle.macOS.signingIdentity`, Tauri no firma el `.app`; el único firmado queda
siendo el ejecutable Mach-O, porque el linker de Apple Silicon lo firma solo —un
binario sin firma no corre—. Esa firma a medias promete recursos sellados que
nadie selló (`Sealed Resources=none`, `Info.plist=not bound`), y ante la
contradicción Gatekeeper no reporta "desarrollador no verificado": reporta daño.
**Un estado a medias resultó peor que ninguno.**

El arreglo es `"signingIdentity": "-"` — firma ad-hoc, sin cuenta de Apple. Eso no
evita el bloqueo (ad-hoc no es notarizado, `spctl` sigue rechazando) pero lo deja
en el bloqueo que sí se levanta: la primera instalación pide
`xattr -cr /Applications/sunrise.app`, y eso ahora está en el README **como paso
numerado**, no como advertencia al margen. Detalle en
[SPECS §4.19](SPECS.md#419-empaque-dmg).

Dos cosas que dejó de regalo:

- **Los docs afirmaban el síntoma equivocado.** SPECS §4.19 y la skill de release
  decían que la primera instalación mostraría el aviso de desarrollador y se
  resolvería con clic derecho. Nadie lo había comprobado bajando el `.dmg`.
  Corregido en los dos lados.
- **Verificar el fix necesitaba un build, y un tag no se mueve.** Se corrió
  `pnpm dmg` local antes de taguear, para confirmar que las tres líneas rotas
  cambiaran (`Identifier`, `Info.plist`, `Sealed Resources`) y que
  `codesign --verify --deep --strict` pasara. El `.dmg` local no llegó a armarse
  —`bundle_dmg.sh` usa AppleScript y el shell no tenía permiso de Automatización—
  pero eso no toca la firma del `.app`, que era lo que había que comprobar. La
  misma verificación se repitió sobre el `.dmg` que publicó CI, bajándolo y
  montándolo: el runner no se da por supuesto.

---

### 5.8 ✅ Los tests corren en cada push, no solo al taguear — hecho

`.github/workflows/tests.yml`: `pnpm test:all` en cada push a `main` y en cada
pull request. Detalle en [SPECS §4.19](SPECS.md#419-empaque-dmg).

Hasta acá la suite en CI vivía dentro de `release.yml`, o sea que corría **al
empujar un tag**. Nunca se publicó un `.dmg` con tests rojos —ese paso hace su
trabajo—, pero el rojo aparecía en el peor momento: con el número de versión ya
commiteado y el changelog escrito. Pasó dos veces, y las dos por lo mismo, que
es justamente lo que hace que valga la pena: **CI corre en UTC y la máquina del
dev no** (5.5 y 5.7).

Dos decisiones:

- **Archivo aparte y no un job más.** `release.yml` necesita `contents: write`
  para crear el Release y recibe la llave privada del updater por env. Un
  workflow que se dispara con cada PR es el último lugar donde se quiere
  cualquiera de las dos, así que éste corre con `contents: read` y nada más.
- **`macos-26` también, pero por otra razón.** Copiar el runner sin copiar el
  motivo era la trampa: allá manda el SDK, que decide la apariencia de la
  ventana; acá es que `pnpm test:rust` compila el crate de Tauri entero y en
  Linux eso arrastra las dependencias de webkit2gtk. Está escrito así en el
  comentario del YAML.

De paso se corrigió un texto obsoleto que no tenía que ver con esto: el cuerpo
del Release seguía diciendo que macOS iba a avisar de un "desarrollador no
verificado" y que había que abrir con clic derecho. Eso quedó desmentido en 5.6
—lo que dice es que la app está **dañada**, y se arregla con `xattr -cr`— y se
había arreglado en el README, pero no en el workflow, que es donde lo lee el que
descarga.

## Mejoras (no bloqueantes)

Cosas que valen la pena pero que no bloquean ningún milestone. Se pueden tomar
en cualquier momento, idealmente cuando se esté trabajando cerca.

### Mej.0 ✅ Confirmación al cerrar la app — hecho

⌘Q, el menú Quit y el botón de la ventana piden confirmación, para que un ⌘Q
accidental no baje la app. No protege datos: todo se autoguarda. Tampoco detiene
el timer — dejar el taxímetro corriendo entre sesiones es el comportamiento
esperado; el diálogo solo lo avisa.

En macOS el Quit predefinido mapea a `NSApplication terminate:` y **no pasa por
el event loop**, así que hubo que reemplazar el ítem del menú por uno propio con
el mismo acelerador. Sin eso, `prevent_exit` nunca se ejecuta para ⌘Q.

Se quitó de paso la notificación nativa al llegar al estimado: bastan el sonido
y el cambio de color.

Detalle en [SPECS.md §4.10](SPECS.md#410-cierre-de-la-app). **El camino de ⌘Q
solo se puede verificar con `pnpm tauri dev`**: en el browser no hay eventos de
cierre.

### Mej.1 🔵 Más ajustes configurables desde Settings

La tabla `settings` ya se lee (Fase 0.4) y tiene tres claves sembradas **sin
consumidor**. Darles UI:

| Clave | Para qué | Estado |
|---|---|---|
| ~~`work_start` / `work_end`~~ | jornada; dibuja la grilla del rail | ✅ **hecho** en 3.3 (Configs → General) |
| `bell_sound` | qué campana suena al llegar al estimado | sembrada, sin uso |
| tipografía | clave nueva | no existe |

Notas de implementación:

- ~~**`work_start`/`work_end`**~~ — hecho junto con el rail (3.3), que es
  justamente el consumidor que les faltaba. Dos campos en Configs → General, con
  validación al escribir. Queda pendiente el resto de la tabla.
- **`bell_sound`** hoy no elige nada: `sound.rs` sintetiza una sola campana con
  `rodio`. Para que la clave sirva hay que ofrecer variantes ahí (y un botón de
  "probar" en Settings, o se elige a ciegas). Para el audio propio, `find_bell_file`
  ya lo busca en el directorio de datos y `bell_dir` ya expone la ruta, pero **no
  hace falta pedirle al usuario que copie el archivo a mano**: desde M4.1 está
  `tauri-plugin-dialog`, así que puede elegirlo con el Finder y la app lo copia
  (ver Mej.17).
- **Tipografía**: las fuentes van **auto-hospedadas** vía `@fontsource`, sin CDN,
  para que la app siga funcionando offline. Eso significa que el selector no
  puede ofrecer "cualquier fuente del sistema": es una lista corta de fuentes
  empaquetadas. Hoy son Sora (títulos) y Manrope/Inter (cuerpo), aplicadas por
  tokens en `src/styles/tokens.css`, así que el cambio se hace sobreescribiendo
  esos tokens y no tocando componentes.
- Todas siguen la regla de `settings`: parser con fallback al default, porque el
  valor puede faltar o venir con basura.

### Mej.2 🔵 Ver tres semanas con scroll horizontal en la vista semana

Hoy `WeekView` muestra 7 columnas —la semana ISO del ancla— y se navega de a una
semana con las flechas. El caso real que lo pide: **reprogramar un viernes**.
Al mover tareas a la semana siguiente hay que cambiar de semana, soltar la
tarea, y volver; no se puede arrastrar directo.

Propuesta: renderizar **semana anterior + actual + siguiente** (21 columnas) en
un contenedor con scroll horizontal, posicionado en la semana actual al montar.
Las flechas siguen sirviendo para desplazarse más lejos.

Dos cosas a resolver, que no son obvias:

- **Los objetivos son por semana ISO, y `useBoard` la deduce del inicio del
  rango** (`isoWeekId(parseISODate(start))`). Si el rango se ensancha hacia
  atrás, la barra de objetivos pasaría a mostrar en silencio los de la semana
  **anterior**. Hay que pasarle la semana "actual" aparte del rango, no
  derivarla del `start`.
- **DnD a través del scroll**: `@dnd-kit` tiene auto-scroll, pero conviene
  verificar que arrastrar hacia el borde desplace el contenedor y que la
  detección de colisión custom (`collision.ts`) siga acertando con el
  contenedor desplazado.

Lo demás sale gratis: `useBoard` ya recibe un rango `[start, end]` arbitrario, y
la capacidad por día se calcula por columna.

### Mej.3 ⬛ Avisar cuándo una tarea lleva días arrastrándose — retirada

Se cae con el carry-over (ver 3.4): ya no hay cadena de arrastres que contar. Una
tarea que no se termina baja al backlog al día siguiente, y ahí **sí** se ve de
dónde viene, con el grupo "venían de un día" y su fecha de origen. Lo que queda
del pedido original —que se note antes de abrir el detalle— está cubierto.

<details><summary>Texto original</summary>

Hoy el carry-over mueve la tarea al día siguiente y no dice nada. El historial
registra cada `CARRIED_OVER`, pero hay que abrir el modal para verlo: en la
tarjeta, una tarea que viene de cinco días se ve igual que una creada hoy.

Propuesta: un **chip con los días acumulados** ("3 días") en la tarjeta cuando
la cadena de arrastres pasa un umbral, que al hacer click abra el modal en el
historial. Los datos ya están: se cuentan los `CARRIED_OVER` consecutivos de
`task_events`, o se compara `created_at` con `scheduled_date`.

**El chip avisa y no actúa**, y eso es la decisión de producto, no una etapa
intermedia: la app no parte la tarea en dos, no la cierra ni la manda al
backlog sola. Quien planifica decide qué hacer —terminarla, achicarla, o
partirla a mano— y arrastrar tres días es a veces exactamente lo correcto. Una
app que "arregla" eso sola termina peleando con el usuario.

Nace de un caso real: una tarea de tres días con 2h40 encima, donde el timer
mostraba solo los 30 minutos de hoy. Esa parte ya está resuelta (ACTUAL es el
total y el modal muestra el reparto por día, ver
[SPECS.md §4.10](SPECS.md#410-cierre-de-la-app)); lo que falta es que se note
**antes** de abrir el detalle.

</details>

### Mej.4 🔵 Aviso nativo de "se viene tu próxima tarea"

Hoy la app sabe a qué hora empieza cada reunión (`event_start`) y no hace nada
con eso: hay que estar mirando la pantalla para no llegar tarde.

**Va como notificación nativa, no como toast in-app** (cambio de decisión, ver
abajo): **5 minutos antes** de una tarea con hora, un aviso del sistema que diga
cuál viene. Al hacer click debería entrar a **Focus con esa tarea**, donde ya está
el botón de play y el de entrar a la reunión.

> **Por qué nativa y no un toast.** Un toast solo sirve si estás mirando la app, y
> justo el caso que importa es el contrario: estás en otra ventana y se te viene
> el Meet encima. M3.6 ya montó el camino (`useShutdownReminder` + el plugin de
> notificaciones), así que el costo bajó a casi nada. La decisión de M2 de **no**
> notificar la campana del estimado sigue en pie y no se contradice: ahí el sonido
> alcanza y una notificación por tarea se apila (SPECS §4.6). Acá el aviso es uno
> por reunión y es justamente para cuando no estás mirando.

Cosas a resolver, que no son obvias:

- **Cuándo dispararlo.** El aviso depende del reloj, no de los datos, así que
  necesita su propio tick. El patrón ya está: `useShutdownReminder` mira el reloj
  cada minuto y `useDayWatcher` compara contra la hora local.
- **Una sola vez por tarea, y que reiniciar no vuelva a avisar todas.** La campana
  del estimado guarda `belledEntryId` en memoria; acá hace falta que sobreviva al
  reinicio. Ojo con la tentación de una fila por tarea en `settings`: el patrón de
  `planned_on` / `shutdown_notified_on` guarda **una** fecha, y para esto haría
  falta un conjunto de ids — probablemente una tabla o una columna en `tasks`.
- **Una sola ventana avisa** (I6). `useShutdownReminder` lo resuelve montándose en
  `Shell`, que solo existe en `main`; este puede hacer lo mismo.
- **El click tiene que llevar a Focus.** Eso no lo cubre M3.6: el aviso del cierre
  no navega a ninguna parte. Hace falta escuchar la acción de la notificación desde
  Rust y emitir un evento como el de `goto` del taxímetro.

### Mej.16 🔵 No hay forma de probar las notificaciones sin esperar la hora

Los avisos nativos son el único camino de la app que **no se puede verificar ni en
el browser ni en jsdom** (SPECS §4.16), y encima dependen del reloj: para ver el
aviso de cierre hay que esperar a que pase `work_end`, y para el de Mej.4 hay que
tener una reunión a cinco minutos. Eso deja dos features que solo se prueban a
ciegas o cambiando la hora del sistema.

Propuesta: una sección en **Configs → Notificaciones** con:

- **Un botón "Probar" por cada tipo de aviso** (cierre del día, próxima tarea), que
  lo dispare al toque con datos de ejemplo. Es el equivalente de lo que ya hace el
  botón de la campana con el sonido.
- **El estado del permiso**, visible. Hoy si el permiso está denegado el aviso
  simplemente no llega y no hay nada en pantalla que lo diga —y peor: la app marca
  `shutdown_notified_on` igual, a propósito, para no quedar pidiendo permiso toda
  la tarde—. Mostrar "permiso denegado" con el link a Ajustes del sistema convierte
  un silencio en un dato.
- **Un botón para reiniciar la marca del día** (`shutdown_notified_on`), para poder
  volver a probar el camino real sin esperar al día siguiente.

Chico y de alto retorno: sin esto, cada cambio en la maquinaria de avisos se
verifica esperando.

### Mej.17 🔵 ¿Usar `plugin-dialog` en otros lados?

M4.1 sumó `tauri-plugin-dialog`, y vale preguntarse dónde más sirve ahora que está
instalado. La respuesta corta: **en los diálogos de confirmación, no.**

**Por qué no convertir `QuitConfirm` ni el de restaurar.** El plugin trae `ask()` y
`message()` nativos, y a primera vista el de ⌘Q parece candidato. Pero un `ask()`
nativo es **un título y un texto plano con dos botones**: se perdería el nombre de
la tarea en negrita con su `hms` corriendo (§4.10), el resumen en `<dl>` de la
restauración (§4.17), y el Enter/Escape propio. Y sobre todo se perdería el estilo:
la app tiene un lenguaje visual propio y consistente, y un panel gris del sistema en
medio de eso se ve como un error, no como una decisión. **El plugin quedó solo para el selector nativo de
carpeta y archivo (`open`)**, que es lo único que no se puede hacer con HTML — un
`<input type="file">` en un webview entrega un `File` sin la ruta real del sistema,
y para elegir una *carpeta* no hay equivalente.

**Lo que sí hay que revisar** son dos casos donde lo nativo gana porque el webview
no está disponible:

- **⌘Q con la ventana principal no visible.** El diálogo de salida vive *dentro* de
  esa ventana. Si está minimizada —o si algún día se puede cerrar dejando solo el
  taxímetro— el usuario aprieta ⌘Q, no ve nada y la app parece colgada. Hay que
  reproducirlo primero: puede que macOS levante la ventana al llegar el `MenuEvent`,
  en cuyo caso no hay nada que arreglar. Si pasa, la salida no es convertir el
  diálogo sino **mostrar la ventana antes de pedir la confirmación**.
- **El fallo de reemplazo en la restauración.** Si `db::open` falla después de
  copiar (§4.17), el error se muestra en una app que quizá ya no puede leer su base.
  Un `message()` nativo llegaría igual. Es el peor caso de un camino que ya tiene
  vuelta atrás, así que es baja prioridad.

**Y una oportunidad concreta que el plugin habilita**: el audio propio de la
campana. Hoy `bell_sound` no tiene UI (ver Mej.1) y el diseño era mostrar la ruta
de `bell_dir` para que el usuario copie el archivo ahí a mano. Con el picker puede
**elegir el archivo y que la app lo copie**, que es lo que uno espera. Cuando se
tome Mej.1, hacerlo así.

### Mej.5 🔵 Quitar el corrector ortográfico de los campos que no son prosa

En macOS el webview corrige y subraya en rojo **todos** los `input`, y en los
campos de Configs eso es puro estorbo: nombres de contextos y canales, nombres de
calendarios, y los buscadores de los dropdowns (`SearchSelect`, `TimePicker`).
Ninguno es texto en prosa, y el autocorrector llega a **cambiar lo escrito** al
salir del campo.

Es `spellCheck={false}` más `autoCorrect="off"` y `autoCapitalize="off"` en esos
inputs. Conviene hacerlo de una vez en los cuatro lugares —`SettingsView`,
`FeedsCard`, `SearchSelect`, `TimePicker`— y dejar la regla escrita en la skill
`sunrise-ui`: el corrector se deja **solo** en el título y las notas de una
tarea, que sí son prosa.

### Mej.6 🔵 Más colores en la paleta

Hoy son ocho (`peach`, `apricot`, `lavender`, `mint`, `sky`, `butter`, `rose`,
`sage`) y con varios contextos y canales se repiten, así que el punto de color
deja de distinguir nada.

Cada color son **dos tokens** en `src/styles/tokens.css` —el pastel y su `-ink`
para el texto encima— y los dos tienen que existir en tema claro y oscuro. El
`-ink` no es el pastel oscurecido a ojo: tiene que dar contraste legible sobre el
pastel en los dos temas, que es lo que hace que agregar un color sea más que
sumar un hex. Después va en `PALETTE` en `SettingsView`.

Ojo con lo que ya está guardado: `categories.color` almacena el **nombre** del
token, no un hex, así que agregar colores es compatible hacia atrás, pero
**renombrar o quitar uno rompe las categorías existentes** (quedarían con un
`var(--loquesea)` que no existe).

### Mej.7 🔵 Crear un canal y elegirle el color en el mismo gesto

Al agregar un canal de segundo nivel: escribes el nombre, vas a elegirle el
color, y la fila **salta al final de la lista** perdiendo el color a medio
elegir.

La causa está en `AddRow` (`SettingsView.tsx`): el input guarda con `onBlur`, y
el `ColorDot` está *fuera* del input. Al hacer click en el punto de color, el
input pierde el foco, `submit()` crea la categoría y `onCancel()` desmonta la
fila; la categoría nueva reaparece al final de su grupo —correcto, ahí va la
posición nueva— pero el color quedó sin elegir.

Es el **mismo bug** que tenía la fila de feeds al pasar de Nombre a URL (ver
§3.1): guardar en el blur de un campo suelto, cuando la fila tiene varios
controles, la destruye a mitad de camino. La solución de allá sirve acá: que el
blur de un campo no cierre la fila, y que el alta se confirme con Enter o al
salir de la fila completa (mirando `relatedTarget`). Vale también revisar si el
color elegido antes de escribir el nombre sobrevive.

### Mej.8 🔵 Que el calendario se sienta más al día

Un feed ICS es **solo polling**: el formato no tiene push, ni webhooks, ni nada
que avise. La app pregunta cada `poll_minutes` y eso es todo lo que hay.

**Lo que se midió contra el endpoint de Google** (feed público de feriados,
`calendar.google.com/calendar/ical/…/public/basic.ics`), porque cambia lo que
vale la pena hacer:

| | |
|---|---|
| `ETag` | **no lo emite** |
| `Last-Modified` | **no lo emite** |
| `If-Modified-Since` | **se ignora** (con fecha futura responde 200, no 304) |
| `Cache-Control` | `no-cache, no-store, must-revalidate` |
| gzip | **sí**: 120 KB → 12 KB |
| cabeceras de rate limit | ninguna |

O sea que **las peticiones condicionales no son una opción**: sin validadores no
hay 304 que pedir. Eso descarta la idea de "polling barato" y con ella la de
bajar el mínimo de 5 minutos. Lo único que sí se podía hacer ya está hecho: el
cliente pide **gzip**, que es 10× menos bytes por pasada.

Queda entonces una sola mejora que valga la pena:

- **Sincronizar al arrancar la app y al volver a la ventana.** El momento en que
  a uno le importa que el calendario esté al día es cuando se sienta a mirarlo.
  Hoy el poller solo mira el reloj, así que volver después de dos horas muestra
  lo de hace dos horas hasta el siguiente pulso. El patrón ya existe:
  `useDayWatcher` escucha `focus` y `visibilitychange`. Ojo con no dispararlo en
  cada cambio de foco sin condición, o una sesión donde alternas ventanas
  golpearía el feed sin parar: debería respetar un mínimo propio (por ejemplo, no
  sincronizar si ya se hizo en el último minuto).

Sobre el **rate limit**: Google no publica ninguno para estos endpoints y no manda
cabeceras al respecto, así que no hay un número que respetar. Se reporta que el
polling agresivo puede terminar en 403 o en respuestas degradadas, pero no está
documentado y **no lo verificamos**. Los 15 minutos por defecto y el piso de 5
están dentro de lo que hacen los clientes de calendario normales, así que no hay
motivo para acercarse al borde.

Lo que **no** es una opción: tiempo real de verdad requeriría la API de Google con
`watch` (webhooks), y eso necesita un endpoint HTTPS público — un servidor, que
este proyecto no tiene ni quiere.

### Mej.9 🔵 Al entrar a la semana, centrar el día de hoy

Cuando la vista semana muestre más de una semana (Mej.2, tres semanas con scroll
horizontal), entrar tiene que dejar **el día de hoy al centro**, no el borde
izquierdo del rango: si no, se abre mirando la semana pasada y hay que
scrollear en cada visita.

Cosas a resolver:

- **Centrar, no solo hacer visible.** `scrollIntoView({ inline: "center" })` es
  lo directo, pero el scroll suave nativo no está disponible en todos los
  webviews —ya pasó con las tabs de Configs, que terminaron con animación
  propia—. Conviene calcular `scrollLeft` a mano contra el ancho del contenedor.
- **Al montar y al cambiar el día.** El día ya es estado observable
  (`useToday`), así que una sesión que cruza la medianoche debería recentrar
  igual que reancla la semana.
- **Sin pelear con el usuario.** Si ya scrolleó a propósito, recentrar en cada
  recarga de datos sería molesto: solo al montar y al cambiar el día, no con
  cada `dataVersion`.

### Mej.10 ✅ `ORPHANED` escondía las reuniones ya trabajadas — hecho

El síntoma se repitió dos veces: una reunión que trabajaste, trackeaste y
completaste desaparecía del tablero —y después del rail— al día siguiente. No
hace falta borrarla en Google: la ventana de import arranca **hoy**, así que basta
con que pase la medianoche para que deje de venir en el feed, y el reconciler la
marcaba `ORPHANED`, que todos los listados filtran.

De las tres opciones que estaban anotadas ganó la segunda, **reservar `ORPHANED`
para lo que nunca se trabajó**, porque deja el estado significando una sola cosa:

- con `time_entries` o `DONE` ⇒ **se libera del feed** (`feed_id = NULL`,
  `calendar_uid = NULL`) y sigue `ACTIVE`. Dejó de ser del calendario y pasó a ser
  tuya. Ya había precedente: borrar un feed entero deja sus tareas así.
- sin trabajar ⇒ sigue `ORPHANED`. Soltarla la haría reaparecer para siempre en su
  día sin nada que la saque de ahí, porque el carry-over no toca las de calendario.

Hizo falta además la **migración 6**: el cambio del reconciler solo vale para las
sincronizaciones futuras, y su propia consulta filtra `ACTIVE`, así que las que ya
estaban escondidas no las habría mirado nunca más.

Detalle en [SPECS.md §4.12](SPECS.md#412-feeds-de-calendario-ics).

### Mej.11 🔵 Panel de backlog en la semana, arrastrable al tablero

El tercer icono de la tira (`SideDock`, ver 3.3). Hoy el backlog es una vista
aparte (`BacklogView`), así que planificar la semana obliga a salir del tablero,
elegir, volver y buscar el día. Como panel al lado de las columnas, la tarea se
arrastra directo al día que le toca.

Lo que hay que resolver antes de escribirlo:

- **El drop tiene que entrar por el `DndContext` de la semana**, así que el panel
  —a diferencia de la agenda— **no** puede quedar fuera. Es el primer caso en que
  un panel de la tira participa del DnD, y `boardCollision` está afinada para
  columnas: hay que ver cómo se comporta con un origen que no es una de ellas.
- Arrastrar del backlog al día es `move_task` con fecha: ya existe y ya registra
  `START_DATE_SET`. No hace falta backend nuevo.
- **Agrupar por contexto (`parent_id`), no por horizonte temporal.** Es lo que ya
  hace `BacklogView`. Un "algún día esta semana / este mes" suena bien pero el
  modelo no tiene ese campo, y agregarlo obliga a mantener una segunda noción de
  fecha al lado de `scheduled_date`.

El segundo icono (objetivos de la semana con su avance) no lleva entrada propia:
sale junto con **M3.5**, que ya calcula ese avance para la review.

### Mej.12 ✅ El DnD de la semana reordena mal — hecho

Arrastrar una card **hacia abajo dentro de un mismo día** la dejaba un lugar
antes de donde se soltó, y al recargar parecía que había vuelto sola. Hacia
arriba andaba bien, que es lo que hacía difícil verlo: la mitad de los arrastres
funcionaba.

De los dos sospechosos anotados, **`boardCollision` quedó absuelto**: el índice
que manda la vista es correcto. El error estaba en la renumeración de
`repo::move_task`, que corría +1 todas las tareas `>= position` del día destino.
Ese atajo vale mientras la tarea venga de **otro** día; dentro del mismo, la
tarea que se mueve deja libre su lugar, así que las de abajo no tienen que
correrse todas. Con `a,b,c,d`, mover `b` al índice 3 daba `a,c,b,d`.

Ahora el destino se **renumera entero** —lista ordenada sin la tarea, inserción
en el índice, posiciones 0..n— y `position` significa **el índice final**,
contando que la tarea ya salió de la lista. Eso es exactamente lo que dnd-kit
dibuja mientras arrastras, que es con lo que el resultado tiene que coincidir.
De paso el día queda sin huecos ni empates: dos tareas con la misma `position`
ordenan por el desempate de `id` y el arrastre siguiente vuelve a salir corrido.
Un índice fuera de rango es "al final", porque la vista manda el largo de una
lista que filtra completadas y `ORPHANED`.

Eso último abrió un caso que el reporte no mencionaba y que estaba mal igual: el
índice llega contado contra la lista **visible**, así que una reunión `ORPHANED`
escondida en medio del día corría la card un lugar. La renumeración las incluye
—si no, dos filas terminan con la misma posición— pero las saltea al ubicar. Y
como ahora son N escrituras donde antes eran dos, van en una transacción: a la
mitad, el día quedaría con posiciones repetidas.

Detalle en [SPECS §4.1](SPECS.md) y §4.3.

Tests: `reordenar_dentro_del_mismo_dia_respeta_el_indice_final` en `repo.rs`
—escrito primero y visto rojo con el `a,b,d,c` exacto del reporte—,
`una_orphaned_en_el_medio_no_corre_el_indice` para lo de arriba, y el gemelo
`src/lib/mockDb.test.ts`, porque el mock tenía la misma aritmética y los tests
del front habrían seguido pasando contra el comportamiento viejo. Los tres se
verificaron mutando el código de vuelta.

**Verificado arrastrando de verdad**, en la app corriendo en el browser (`pnpm
dev`, o sea contra el mock): una card del índice 0 soltada sobre la del 2 queda
en el 2, y devuelta hacia arriba vuelve al 0. Contra la base real —el mismo
front, pero con `repo.rs` del otro lado— **falta mirarlo en `pnpm tauri dev`**;
esa mitad la cubre el test de Rust.

**Segunda pasada** (con el orden ya andando, probando el gesto): el arrastre
hacía tres cosas raras, las tres de presentación, y una de ellas tapaba un
movimiento inventado.

1. **El preview cambiaba de ancho al levantar la card.** `.task-card.is-overlay`
   tenía `width: 236px`, que es el **mínimo** de la columna: en una columna más
   ancha el preview salía más angosto que la card, el título se reacomodaba en
   otra cantidad de líneas y la caja cambiaba de alto justo al agarrarla. Se
   borró la regla: `<DragOverlay>` ya dimensiona su envoltorio con el rect medido
   de la card. La inclinación de 3° se queda, que es a propósito.
2. **La columna se iluminaba estando ya en ella.** La cascada de colisión
   resuelve a veces la columna en vez de una card —pasa sobre el header y los
   márgenes— y el marco damasco prendía y apagaba anunciando un cambio de día que
   no estaba pasando. Ahora se ilumina solo si la card viene de otro día (o de
   fuera del backlog, en su columna).
   **Y ahí abajo había un bug de verdad, no solo el parpadeo**: soltar sobre la
   columna significaba "al final del día", así que si soltabas en uno de esos
   momentos la tarea se iba al fondo. Cuando la card ya está en esa columna,
   ahora se mantiene su índice.
3. **Al soltar, la card volvía a su lugar viejo y entraba deslizándose desde
   arriba.** No era una animación de más: el overlay desaparece al instante
   (`dropAnimation={null}`), pero la lista solo se reordenaba cuando volvía la
   escritura, así que en el medio se veía el orden anterior y después la
   transición de `useSortable` movía la card. Ahora el reorden es **optimista**
   —`reorderLocal`, la misma aritmética que Rust— y pasa en el mismo frame en que
   sueltas.

Medido en la app, no mirado: el overlay mide lo mismo que la card de origen
(199px los dos, descontando que el rect de una caja rotada es 3px más ancho),
`.day-col.is-over` se queda en cero durante 15 muestras de un arrastre dentro del
mismo día y sigue apareciendo en uno entre columnas, y la `y` de la card movida es
la misma justo después de soltar y 800ms después — o sea, no entra desde ninguna
parte.

`collision.ts` no se tocó: esa cascada es la que hace que toda la columna acepte
el drop.

Tests nuevos: `reorder.test.ts` (6 casos, espejo del de Rust) y uno en
`useBoard.test.tsx` que deja la escritura colgada a propósito para comprobar que
la lista ya está reordenada antes de que responda — mutation-checked los dos.

### Mej.13 ✅ Ajustar el marco de la app: sidebar colapsable y sin barra de título — hecho

Dos cambios que van juntos porque tocan el mismo marco:

- **Sidebar colapsable**, para recuperar ancho en la semana (siete columnas más
  el panel de la derecha piden todo el espacio que haya).
- **Quitar la barra de título de la app** y dejar los botones nativos de macOS
  flotando a la izquierda sobre el contenido (`titleBarStyle: "Overlay"` en
  `tauri.conf.json`, más una zona `data-tauri-drag-region` para poder mover la
  ventana).

No es solo estético: sin barra de título, **los títulos de las vistas se corren**
para no quedar debajo de los botones nativos, y el panel de la derecha de la
semana (la tira de `SideDock` y el rail superpuesto) empieza en el borde
superior real de la ventana. Hay que revisar las tres vistas y el panel juntos, no
por separado.

Salió como estaba escrito, y el hueco de arriba resultó ser **un token y no un
ajuste por vista**: `--titlebar-h` lo reservan el padding del sidebar y el de
`.app-main`, así que las tres vistas y el rail se corrieron solos y no hubo que
tocar `rail.css`. Detalle en [SPECS §7](SPECS.md#7-convenciones-de-ui-pedidas-explícitamente).

Cuatro cosas que el plan no tenía y que salieron de mirarlo funcionando:

- **El rail colapsado mide 84px, no 56.** Hay un mínimo duro en 68px, que es hasta
  dónde llegan los botones nativos: más angosto y quedaban montados sobre el borde
  del sidebar. O sea que el ancho mínimo lo fija la ventana, no la legibilidad de
  los iconos. Los 16px por encima de ese mínimo son aire: quedaron cuando los
  botones del rail pasaron a ser cuadrados de 44px centrados en vez de cajas
  estiradas de borde a borde, que se veían pegadas a los dos lados.
- **La franja de arrastre no declara `z-index`.** Con uno propio le comía los
  clicks del borde superior a las tabs `sticky` de Configs y a los modales.
  Dejándolo sin declarar, cualquier elemento posicionado posterior le gana, que es
  exactamente lo que se quiere. Comprobado en el navegador: ningún interactivo
  queda tapado en los primeros 28px.
- **El colapso no se anima**, y no por falta de ganas: `transition` sobre
  `grid-template-columns` con el valor viniendo de una custom property **no
  interpola**. Medido — el ancho se queda en 232px casi un segundo y después salta
  a 72. La animación "suave" se sentía como un click que no respondió.
- **El aviso del updater se queda visible colapsado**, como icono. Esconderlo era
  lo cómodo y habría dejado muda la única señal de que hay versión nueva (Mej.18)
  justo para quien colapsa el sidebar para ganar ancho. Los contextos del backlog
  sí se dejan de renderizar: un punto de color sin su nombre no dice cuál es.

Tres ajustes más, ya mirándolo funcionando:

- **El botón de colapsar se fue al top**, al lado de la marca. Abajo quedaba entre
  los items de navegación y se leía como uno más, cuando es un ajuste del marco —y
  el marco se maneja arriba, donde uno ya está mirando por los botones de la
  ventana. Colapsado marca y botón se apilan centrados: en un rail angosto no
  caben lado a lado.
- **El tamaño de los iconos se movió al CSS** (19px expandido, 22px colapsado). Era
  un prop `size` de lucide, que es un atributo del `<svg>` y no sabe en qué estado
  está el sidebar; colapsado los iconos son lo único que queda y tienen que pesar
  más. La marca (`SunriseMark`) necesitó su propia regla —21/26px— porque tiene su
  propio prop `size` y no se enteraba del cambio: el primer intento dejó el logo
  chico al lado de iconos que habían crecido.
- **La fila de Tema quedó simétrica.** Tenía el padding derecho en 0 a propósito,
  para que el borde del switch calzara con el del recuadro activo de los items. Se
  cambió esa alineación por la otra: una fila con aire de un solo lado se lee
  torcida, y eso se nota más que un borde que calza con otro que casi nunca está
  encendido al mismo tiempo.

Tests: seis nuevos —cuatro del colapso en `Sidebar.test.tsx` y dos de
`color-scheme`—, total **373 front (44 archivos) y 140 Rust**.

> **La barra de título solo se puede ver con `pnpm tauri dev` o con el `.dmg`.**
> `titleBarStyle` es config de la ventana nativa: en el navegador no existe, así
> que ni los tests ni el preview web dicen nada sobre cómo quedaron los botones de
> macOS sobre el sidebar. Lo verificado en navegador es todo lo demás: el
> `color-scheme` de las tres ramas, los dos anchos del rail, que la franja no tape
> nada y que el aviso del updater sobreviva al colapso.

### Mej.14 ✅ El ajuste manual de tiempo se acredita al día en que lo escribes — hecho

`repo::set_actual_seconds` guardaba el delta como una entrada con
`started_at = now()`. Si el lunes corregías las horas de una reunión del sábado,
ese tiempo quedaba contado en **lunes**: el rail del sábado no lo veía y el rollup
lo atribuía a la semana equivocada si el ajuste cruzaba el domingo. Era la Regla 2
(§4.15) rota en la escritura — la review agrupaba bien, la fila nacía con la fecha
errada. Última salvedad conocida que había dejado M3.5 (D8).

Ahora la entrada se sella con el día de la tarea. Tres decisiones que el ítem no
tenía:

1. **Con la hora de la tarea si la tiene, mediodía si no.** Lo primero es por el
   caso que motiva todo esto —una reunión—: así el bloque del rail cae donde
   ocurrió en vez de a mediodía. Y **mediodía y no medianoche** porque Chile cambia
   la hora: en el salto de primavera la medianoche local **no existe** y la
   conversión se queda sin respuesta. El mediodía existe todos los días del año.
2. **Una tarea futura se acredita a hoy**, igual que una sin fecha. Mañana no se
   trabajó, y fechar ahí dejaría horas "trabajadas" adelante del reloj sumando en
   un rollup futuro.
3. **La consecuencia en `seconds_today` se aceptó, no se esquivó.** El ítem la
   anotaba como algo que había que decidir: un ajuste fechado en otro día **sale
   del contador del taxímetro**, que mide `started_at >= medianoche local`. Es lo
   correcto —ese contador es la sesión de hoy, y el total de la tarea sigue
   completo— pero antes sí aparecía ahí. Un test lo fija para que nadie lo
   "arregle" de vuelta.

Eso último puso rojo un test que existía (`ajuste_manual_del_tiempo_sobrevive_a_start_stop`):
usaba una tarea con fecha fija de agosto, o sea del pasado, y esperaba ver el
ajuste en `base_seconds`. Lo que ese caso protege —que el total no se recalcule
desde las entradas— sigue valiendo; lo que cambió es que ahora hay que pedirlo con
una tarea **de hoy**. Quedó anotado en el propio test.

**Lo que ya está mal en tu base sigue mal**, y es a propósito: no hay migración que
re-feche los ajustes viejos. Se podrían reconocer —una entrada de ajuste es la que
tiene `started_at = ended_at`— pero reescribir historial sobre esa deducción es
justo el tipo de cosa que se equivoca en silencio, y el dato correcto (a qué día
quisiste acreditarlo) no está en ninguna parte. Si algún rollup pasado se ve raro,
la causa es esta.

Tests: cinco en `repo.rs` (el día de la tarea y no hoy, la hora de la reunión, el
mediodía sin hora, backlog y futura a hoy, y el contador del taxímetro) y dos en
`mockDb.test.ts`, porque el mock estampaba `now()` igual y el browser habría
seguido contando en el día equivocado. Mutation-checked los dos lados, y las dos
suites corridas también con `TZ=UTC` — que en un cambio de fechas no es opcional.

### Mej.15 🔵 Los objetivos necesitan detalle, reparto de horas e histórico

`WeeklyPlanningView` ancla en `new Date()` y no se mueve de ahí: **no hay forma de
ver ni editar los objetivos de otra semana**. La weekly review (M3.5) los muestra
de cualquier semana, pero solo de lectura, y el título ni siquiera se puede
corregir.

Qué falta, de menos a más:

- **Navegación de semanas en `WeeklyPlanningView`**, igual que la de la review
  (`shiftWeeks` + "Esta semana"). Es lo que desbloquea todo lo demás y sale casi
  gratis: la vista ya calcula `isoWeek` desde su ancla.
- **Tildar y editar desde la review**: ahí es donde uno se acuerda de que cumplió
  algo. Hoy la lista es texto plano; `updateObjective` ya existe.
- **Modal de detalle del objetivo**, que es la pieza gorda: el objetivo con su
  channel, sus tareas asociadas con actual/planned,
  y **una fila de siete casillas Lun→Dom**. Al hacer click en un día se elige
  cuántos minutos dedicarle (5, 10, 15, 20, 25, 30, 45…), y **eso crea una tarea
  en ese día** ligada al objetivo. O sea: el reparto de horas es la forma de
  bajar un objetivo semanal a tareas diarias, en un solo gesto y sin escribir el
  título siete veces.
  - Ojo: `tasks.objective_id` ya existe, así que **no hace falta migración** para
    la parte de ligar. Lo que hay que decidir es de dónde sale el título de la
    tarea generada (¿el del objetivo? ¿el del objetivo + el día?) y qué pasa al
    bajarle los minutos a un día que ya tenía tarea con tiempo trackeado —
    borrarla no puede ser la respuesta por defecto (§4.12 tiene el precedente:
    borrar es barato de equivocarse y caro de deshacer).
- **Atajo en el detalle de tarea para colgarla de un objetivo activo.** El campo
  ya existe en `TaskPatch`, pero hoy solo se asigna desde Weekly planning; la
  tarea se crea en el tablero y ahí es donde uno se acuerda de a qué objetivo
  pertenece. Con `SearchSelect` (ya existe) sale barato.
- **Histórico**: cuántas semanas seguidas se cumplió, o al menos las últimas
  N con su avance. `objectives.iso_week` ya lo permite sin migración —
  `list_objectives` filtra por semana exacta, así que haría falta un listado por
  rango.

Ojo con una decisión que no está tomada: **qué pasa con un objetivo no cumplido
al terminar la semana**. Hoy simplemente queda ahí. Copiarlo a la semana
siguiente es tentador y es exactamente el error que se cometió con el carry-over
de tareas (§4.2) — decidir por el usuario antes de que mire. Si se hace, que sea
un gesto explícito desde el planning.

### Mej.19 ✅ Las barras de scroll del tema oscuro son las nativas, y desafinan — hecho

Detectado mirando la app instalada al lado de una en dev: en la app clara las
barras se ven finas y discretas, y en la oscura aparece una barra gruesa y clara
que no pertenece a la paleta.

**No es una diferencia entre dev y producción, es entre los dos temas.** El
proyecto no tiene **ninguna** regla de scrollbar (ni `::-webkit-scrollbar`, ni
`scrollbar-width`), así que las dos apps muestran la barra nativa del webview. Lo
que falta es que el webview sepa en qué tema está: el tema se estampa como
`data-theme` en `<html>` (`src/lib/theme.ts`), que es una convención **nuestra**,
y WebKit no la entiende. Sin la propiedad `color-scheme`, dibuja sus controles en
la variante clara siempre — sobre fondo oscuro eso es justamente la barra gruesa y
clara.

Es decir: la del tema claro "se ve bien" porque el default coincide con el tema por
casualidad, no porque esté resuelto.

Dos pasos, y el primero puede alcanzar solo:

- **Declarar `color-scheme`** junto a los tokens, en las tres ramas que ya existen
  en `src/styles/tokens.css` (`:root`, el `@media (prefers-color-scheme: dark)` y
  `:root[data-theme="dark"]`). Con eso la barra nativa se dibuja oscura sin
  escribir un solo estilo propio, y de paso se arreglan los otros controles
  nativos que hoy salen claros —los `<select>`, el caret de los inputs— aunque no
  se hayan reportado.
- **Recién si sigue desafinando, estilizarlas** con `::-webkit-scrollbar` sobre los
  tokens de la paleta (`--border` para el pulgar, transparente para la pista). Ojo
  con dos costos que esto tiene y `color-scheme` no: una barra estilizada deja de
  ser *overlay*, así que **ocupa ancho permanente** y puede correr el contenido de
  las columnas —que en este proyecto son slots de altura y ancho calzados (SPECS
  §7)—, y hay que cubrir los cinco contenedores con scroll de `global.css`, no solo
  el que se notó.

Verificar en la app instalada, no solo en el browser: el scrollbar nativo depende
del ajuste "Mostrar barras de desplazamiento" del sistema, y en el webview de
Tauri no siempre se comporta igual que en Chrome.

**Hubo que hacer los dos pasos, y el diagnóstico de arriba estaba a medias.**
`color-scheme` se hizo primero y sirve —arregla los `<select>` y el caret, que
salían claros y nadie había reportado, y pinta la barra nativa del color del
tema—, pero **no cambia su forma**, y probándolo en la app instalada en tema claro
la barra seguía siendo la nativa. Ahí estaba el error de lectura: no era un tema
mal aplicado. WebKit en macOS dibuja barras **overlay** —finas, superpuestas, que
se esconden solas— y el navegador dibuja las clásicas, anchas y siempre visibles.
Son dos implementaciones distintas, y no hay propiedad que cambie de una a la
otra: la que se quería había que dibujarla.

Así que se hizo el segundo paso: `::-webkit-scrollbar` sobre los tokens, pulgar de
6px con zona de agarre de 12 (`border` transparente más
`background-clip: content-box`), pista y esquina transparentes. **El costo previsto
se pagó**: la barra ocupa 12px permanentes en los contenedores que hacen scroll. Se
aceptó porque una barra que aparece y desaparece sobre las columnas de la semana
tapa el borde de las cards justo cuando estás mirándolas.

Y trajo una consecuencia que el plan no anticipaba: **el rail colapsado del sidebar
quedó torcido**, porque el ancho de la barra se reserva de un solo lado. El primer
arreglo fue `scrollbar-gutter: stable both-edges`, que reserva a los dos y **en el
navegador se midió simétrico** — pero en la app seguía corrido: el webview de macOS
no honra `both-edges`. Quedó escondiéndole la barra al sidebar, que es un contenedor
de diez items que rara vez pasa del alto de la ventana.

Es el caso de manual de por qué esto se mira en la app: dos arreglos seguidos se
veían bien en el browser y solo uno lo estaba.

Comprobado en el navegador que las tres ramas de `color-scheme` resuelven lo que
dicen (`light` con `data-theme="light"`, `dark` con `data-theme="dark"`, y `dark`
heredado del sistema sin atributo). El test (`src/styles/tokens.test.ts`) lee el
CSS como texto y no como estilo aplicado, a propósito: jsdom no dibuja controles
nativos, así que lo único vigilable desde ahí es que la declaración exista en las
tres ramas —que es justo el error que se comete, agregar una rama y olvidarla, con
el síntoma apareciendo recién en la app instalada.

> **La forma de la barra solo se comprueba en la app.** El navegador ya dibujaba la
> clásica antes del cambio, así que ahí no distingue nada: el punto era igualar el
> webview de Tauri, y eso se mira con `pnpm tauri dev` o con el `.dmg`.

### Mej.20 ✅ Borrar una tarea desde el daily planning no saca la card — hecho

Reportado desde la app: se abre una tarea en `/daily-planning`, se aprieta
Eliminar, se confirma, y no pasa nada visible. La tarea sí se borraba; la card se
quedaba en pantalla hasta recargar la vista, así que el gesto se sentía muerto y
el click siguiente abría el detalle de algo que ya no existía.

La sospecha del reporte era correcta pero apuntaba al lugar equivocado. No es que
`board.reload` no alcance: es que **`TaskModal.remove` era la única mutación del
modal que no avisaba**. Guardar un campo llama `bumpData()`, completar también;
borrar solo llamaba al `onChanged` de la vista. Y ese callback recarga lo que la
vista considera suyo —en el ritual, `useBoard` con el día de hoy— mientras el
repaso del día anterior, la columna del backlog y el mapa de rescates son estado
propio que depende de `dataVersion`.

Reproducido en la app antes de tocar nada: borrando una card del backlog en el
paso 2, la cabecera seguía diciendo "2 pendientes" con la card borrada ahí. Y
verificado después, con la página recién cargada: la columna queda en cero al
instante.

Se aprovechó de sacar `useBoard.removeTask`, que **no tenía ningún llamador**: era
un borrado que tampoco avisaba, esperando al lado de un `toggleTask` que sí lo
hace. Esa asimetría es justo la trampa que produjo este bug.

Test: `borrar una tarea del día anterior la saca de la vista` en
`DailyPlanningView.test.tsx` — el caso usa una tarea de un día pasado a propósito,
porque ahí la lista es `previas` y el callback de la vista no la toca. Visto rojo
con el `expected <div class="tc__title"></div> to be null` antes del arreglo.

### Mej.21 ✅ El "viene desde" de las tareas rescatadas se lee mal — hecho

En la columna del backlog, una tarea que bajó de un día llevaba **dos marcas**: un
rótulo de grupo "Venían de un día" arriba del primero, y debajo de cada card un
"desde el <fecha>". Con varias tareas de días distintos eran N fechas sueltas
colgando entre las cards, y la fecha —lo que uno quiere comparar— quedaba repetida
en vez de agrupada.

Ahora la fecha va **una sola vez, en el rótulo del grupo** ("Desde el 18 ago") y la
etiqueta por card no existe. "Guardadas" sigue separando lo que guardaste a
propósito.

**Lo que había que decidir era el orden, y se decidió no tocarlo.** La restricción
está en el comentario que ya estaba ahí: los rótulos van dentro del
`SortableContext` porque partirlo en uno por día rompería el arrastre entre grupos.
Así que el agrupado son separadores intercalados en **una sola lista**, y esa lista
sigue ordenada por `position`. La consecuencia asumida: si el orden intercala dos
días, el rótulo del primero se repite más abajo. Se eligió eso antes que reordenar
por fecha, porque reordenar significa mover por debajo lo que acabas de arrastrar a
mano — y como lo que baja al backlog entra en posición 0, en el caso normal cada
día sale una sola vez igual.

Tests: cuatro en `BacklogColumn.test.tsx` —un grupo para dos tareas del mismo día
y ninguna etiqueta suelta, dos días son dos grupos, el orden intercalado repite el
rótulo sin reordenar las cards, y la clave sin fecha de Mej.22— y el caso del
ritual que miraba el rótulo viejo ahora exige la fecha del día del que se cayó.
Verificado en la app: el grupo aparece con su fecha y no quedan etiquetas debajo de
las cards.

### Mej.22 ✅ El ritual se iba a pantalla en blanco — hecho

Reportado desde la app: entrar al paso 2 del daily planning dejaba la pantalla en
blanco. Apareció justo después de mandar una tarea de hoy al backlog, y por eso
parecía cosa del arrastre. No lo era.

**El nombre del campo no coincidía entre Rust y el front.** `models::Rescue`
tiene `from_date`, que con `rename_all = "camelCase"` viaja como `fromDate`, y
`src/lib/types.ts` declaraba `from`. Así que `r.from` era `undefined`, el mapa de
rescates quedaba con la clave puesta y la fecha vacía, `rescued.has(id)` decía que
sí, y el formateo de fecha recibía nada y tiraba. Una excepción al renderizar tumba
el árbol entero: de ahí el blanco.

**Estuvo así desde que la feature existe, y no se veía por dos razones que se
tapan entre sí.** Una: solo se rompe si hay una tarea en el backlog que *venga de
un día*, o sea con un `MOVED` hacia `NULL` en su historial — un backlog escrito a
mano no lo tiene. Dos, y es la que importa: **el mock devolvía `from`**, el nombre
equivocado, así que en el browser y en los tests se veía perfecto. Fallaba **solo
dentro de Tauri**, que es el único lado donde el nombre lo pone serde.

Lo mismo rompía la vista Backlog, por el mismo mapa.

Dos arreglos, y el segundo es el que importa a futuro:

1. El front lee `fromDate` (tipo, mock y los dos consumidores), y los rescates sin
   fecha se filtran al armar el mapa.
2. `vieneDeUnDia` mira el **valor** y no la clave, así que un mapa con la fecha
   vacía deja de mostrar el rótulo en vez de tumbar la vista. Un dato que falta
   puede degradar lo que se ve; no puede apagar la pantalla.

Tests: `los_nombres_de_rescue_son_los_que_lee_el_front` en `models.rs` —serializa
y compara las claves, que es lo único que puede pillar esta clase de bug, porque
el mock puede estar de acuerdo con el front y los dos equivocados— y dos en
`BacklogColumn.test.tsx`, uno de ellos con el mapa roto a propósito. Los dos
mutation-checked.

## Post-MVP (decidido: fuera de alcance)

- Recurrentes / rituales auto-generados.
- Sync multi-dispositivo (el modelo de datos queda listo, pero no se implementa).
- Email de resumen vía SMTP.
- Nada de IA ni integraciones.

---

### Mej.18 ✅ Que se sepa que hay una versión nueva sin ir a buscarla — hecho

El updater de 5.3 solo se encendía apretando el botón de Configs, así que una
versión nueva podía quedarse ahí sin que nadie se enterara. Ahora la app **sondea
al abrir y cada 4 horas**, y lo que encuentra aparece como una franja en el sidebar,
arriba del switch de tema. Detalle en [SPECS §4.23](SPECS.md#423-el-aviso-del-updater-en-el-sidebar).

Salió como se había anotado, con dos cosas que el plan no tenía:

- **La franja tiene dos estados, no uno.** Al volver de un update se convierte en
  "Estás al día", que dura 30 segundos y abre el modal "Lo nuevo" si lo aprietas.
  Eso **reemplazó al modal que se abría solo** (5.4): un modal encima de la app al
  arrancar es justo la interrupción que 5.3 había descartado, y esto deja el aviso
  esperando sin tapar nada.
- **Sondear al arrancar contradice a 5.3 solo en apariencia.** Ahí el argumento era
  no interrumpir, y una franja en el sidebar no interrumpe. Sin la consulta inicial,
  además, un intervalo de 4 horas no dispararía nunca para quien cierra la app todos
  los días.

Lo que **no** se hizo: el punto en el ítem de Configs que decía el plan. La franja
ya es la señal, y dos marcas para lo mismo obligan a mantener las dos sincronizadas.
Lo del diálogo antes de reiniciar tampoco: instalar es una decisión que ya tomaste
al apretar la franja, y un segundo "¿seguro?" encima no agrega nada. Si molesta al
usarlo, se agrega.

Tests: ocho en `UpdateBanner.test.tsx`, incluidos los dos que cuestan —los 30
segundos y las 4 horas— con timers falsos. Total **367 front (43 archivos) y 139
Rust**.

**Se pueden mirar sin publicar nada**: `sunriseDev.flujoCompleto()` en la consola
del webview finge el update, la instalación y la llegada. Verificado así, en los dos
temas, incluido el modal.

**Visto con un Release de verdad**, actualizando de `v0.1.0` a `v0.1.1`: la franja
de versión nueva apareció, la descarga y la verificación de firma pasaron, la app
se reinició sola y volvió mostrando "Estás al día · Mira lo nuevo en la 0.1.1".
Queda comprobado de paso lo que era un supuesto y no una observación: que
`sunrise-seen-version` en `localStorage` **sobrevive al reemplazo del `.app`**, que
es de lo que depende que el modal "Lo nuevo" aparezca. El banco de pruebas
(`sunriseDev.flujoCompleto()`) sigue sirviendo para mirar los componentes sin
publicar nada.

---

## Verificación end-to-end (del plan original)

Los pasos 1–5 ya deberían pasar; 6–10 son de M3/M4.

**Confirmado por el dev en la app instalada** (agosto 2026): el selector de carpeta
del respaldo, una restauración de verdad, el icono en el Dock, la instalación del
`.dmg` y el modal "Lo nuevo" al actualizar. Queda sin comprobar lo que exige
esperar o mirar otra máquina: el respaldo automático a su hora, el zip en un Drive
real, y la casilla de inicio automático registrando el LaunchAgent.

1. `pnpm tauri dev` levanta app + flotante; `pnpm test:all` en verde.
2. Categorías de 2 niveles con color pastel; planned/actual; DnD; anidar en
   objetivo; modal con historial.
3. Tarea incompleta ayer aparece hoy (carry-over).
4. Daily planning: arrastradas arriba, rail con las meets, capacidad
   gris→amarillo→rojo; "Empezar el día" → confetti + semana. (El almuerzo no es
   un bloque propio: si está en el calendario entra como cualquier evento, ver
   3.3.)
5. El timer sube; campana al pasar el estimado; Focus avanza al check y deja
   continuar; `time_entries` correctas.
6. Feed ICS de prueba: importa meets con categoría; borrar evento futuro lo saca
   del backlog; meet trackeada queda `ORPHANED`.
7. Weekly review: horas, barras y donut cuadran; mover una tarea a otra semana
   no cambia las horas pasadas.
8. Daily highlights: la bitácora trae los días solos, con WORKED/PLANNED y su
   timeline; el shutdown sella el día y el aviso llega a la hora de `work_end`.
9. Backup: snapshot en el VPS; restore en perfil limpio ok.
10. Tipografías cargan offline; logo presente en la app y en el `.dmg`. (El punto
    original decía "app, tray y dmg"; el tray se descartó en 4.2.) Y la casilla de
    inicio automático registra el LaunchAgent y la app se abre al reiniciar.
