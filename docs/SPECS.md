# sunrise — Especificación funcional y reglas

Estado del código a partir del commit `1175035` (M0 + M1 + M2 completos).
**Este documento describe lo que YA existe y las reglas que no se deben romper.**
Lo que falta está en [ROADMAP.md](ROADMAP.md).

Si vas a modificar algo, lee primero la sección **Invariantes** — son decisiones
deliberadas, no accidentes. Varias tienen el comentario que las explica en el
propio código; si cambias una, actualiza este documento en el mismo commit.

---

## 1. Qué es sunrise

Planner diario personal y liviano, para una sola persona en una sola máquina.
Datos 100% locales en SQLite. Sin cuentas, sin servidor, sin IA.

Objetivo: **exactamente las features que se usan y ninguna más**, sin suscripción
y sin que el día de nadie viva en la nube de un tercero. Es lo que explica casi
todas las decisiones de este documento: cuando hay que elegir entre una función
más y algo que se entienda de una mirada, gana lo segundo.

**Stack:** Tauri v2 (Rust) + React 18 + TS + Vite, `pnpm`. SQLite vía `rusqlite`
(bundled). `rodio` para el sonido. `@dnd-kit`, `date-fns`, `zustand`,
`react-router-dom` (HashRouter), `react-markdown` + `remark-gfm`,
`react-day-picker`, `lucide-react`.

---

## 2. Arquitectura

### 2.1 Dos ventanas nativas

| Label | Entrypoint | Qué es |
|---|---|---|
| `main` | `index.html` → `src/main.tsx` | La app completa (sidebar + vistas) |
| `floating-timer` | `timer.html` → `src/timer.tsx` | Taxímetro flotante, 228×70, sin decoración, transparente, always-on-top, `skipTaskbar`, arranca invisible |

Declaradas en `src-tauri/tauri.conf.json`. Los permisos de ventana están en
`src-tauri/capabilities/default.json` — **si usas una API de ventana nueva,
hay que agregar su permiso ahí o falla en runtime, no en compilación.**

> **Consecuencia crítica:** son dos documentos, dos bundles de React y por lo
> tanto **dos instancias separadas de cada store de Zustand**. No comparten
> memoria. Ver §5 (sincronización).

### 2.2 Capas del backend

```
db/ (open, migrate)  →  repo.rs (todo el SQL, funciones puras sobre &Connection)
                     →  commands.rs (#[tauri::command], wrappers delgados)
                     →  lib.rs (registro del invoke_handler)
```

- `repo.rs` no conoce Tauri: recibe `&Connection`, por eso es testeable con
  SQLite en memoria. **La lógica de negocio va acá, no en `commands.rs`.**
- Una sola `Connection` envuelta en `Mutex`, manejada por Tauri
  (`app.manage(Db(...))`) y compartida por ambas ventanas. La DB vive en
  `app_data_dir()/sunrise.sqlite`.
- `models.rs` usa `#[serde(rename_all = "camelCase")]` para espejar
  `src/lib/types.ts`. **Si agregas un campo, tócalo en los dos lados.**
- **El puente tiene dos contratos que son strings a los dos lados**, así que no
  los revisa ningún compilador: los **nombres de campo** (serde ↔ `types.ts`) y
  las **claves de argumento** del `invoke`, que son el parámetro de Rust en
  camelCase (`to_date` → `toDate`). Los dos fallan **solo dentro de Tauri**: el
  mock recibe posicional, así que puede estar de acuerdo con el front y los dos
  equivocados, y el browser y las dos suites se ven perfectos. Un campo mal
  escrito llega `undefined`; una clave mal escrita hace que Tauri **rechace la
  llamada entera**, y la vista se queda cargando para siempre. Los dos ya
  pasaron: `Rescue.from_date` (§4.14) y `daily_log` (§4.16).
  `src/lib/ipcContract.test.ts` compara los archivos de los dos lados.

### 2.3 Capas del frontend

```
src/lib/ipc.ts        → cliente tipado único. TODO el acceso a datos pasa por acá.
src/lib/mockDb.ts     → implementación in-memory para browser/tests
src/lib/types.ts      → espejo de models.rs
src/lib/enums.ts      → espejo de los enums de migrations.rs
src/features/<area>/  → vistas + hooks de cada área
src/components/       → primitivas compartidas (Popover, SearchSelect, TimePicker…)
```

`api.*` en `ipc.ts` decide en cada llamada: dentro de Tauri hace `invoke`, fuera
delega en `mock`. Eso es lo que permite correr los tests en jsdom y ver la app
en el browser. **Todo comando nuevo de Rust necesita su entrada en `ipc.ts` Y su
implementación en `mockDb.ts`**, o los tests se caen.

---

## 3. Modelo de datos

Migraciones versionadas en `src-tauri/src/db/migrations.rs`: array
`(version, sql)`, se aplican en orden las mayores a la actual dentro de una
transacción, registradas en `_migrations`. **Nunca edites una migración ya
aplicada: agrega una nueva.**

Tablas: `categories`, `objectives`, `tasks`, `task_events`, `time_entries`,
`calendar_feeds`, `settings`.

### 3.1 Enums — SIEMPRE EN MAYÚSCULAS

Convención explícita del proyecto. Se guardan como TEXT en mayúsculas y se
espejan en `src/lib/enums.ts`:

| Campo | Valores |
|---|---|
| `tasks.status` | `TODO` · `DONE` |
| `tasks.source` | `MANUAL` · `CALENDAR` |
| `tasks.source_state` | `ACTIVE` · `ORPHANED` |
| `task_events.type` | `CREATED` · `MOVED` · `START_DATE_SET` · `CARRIED_OVER`¹ |
| (solo front) `CapacityLevel` | `OK` · `WARN` · `OVER` |

¹ `CARRIED_OVER` es **histórico**: lo escribía el carry-over, que ya no existe
(§4.2). Se mantiene porque hay tareas con ese evento en su historial.

### 3.2 Semántica de campos clave de `tasks`

- `scheduled_date` `NULL` ⇒ **está en el backlog**. No hay flag aparte.
- `scheduled_time` `NULL` ⇒ no tiene hora; ordena la cola de Focus y es **la
  única fuente de hora del rail de calendario** (§4.13).
- `position` ⇒ orden dentro de su día (o dentro del backlog).
- `estimated_minutes` = "planned". `NULL` es válido = sin estimado.
- `actual_seconds` = tiempo real **acumulado**. Ver Invariante I1.
- `source_state = 'ORPHANED'` ⇒ tarea de calendario que ya no está en el feed
  **y que nunca se trabajó**: sale de los listados sin borrarse.
  **Todos los listados filtran por `source_state = 'ACTIVE'`.**
  Si sí se trabajó (tiene `time_entries` o está `DONE`), el reconciler **no** la
  marca así: la suelta del feed y la deja `ACTIVE` (§4.12). Marcarla `ORPHANED`
  la hacía desaparecer del tablero y del rail al día siguiente, que es justo
  cuando uno quiere ver lo que hizo.

### 3.3 Categorías = "channels"

Dos niveles vía `parent_id`. `parent_id IS NULL` ⇒ **contexto** (carpeta del
backlog: Thinking, Tooling, Docs, Projects, Selfcare, Issues, Meetings).
Con `parent_id` ⇒ **channel** (el `#tag` de las cards). Una tarea puede
apuntar a cualquiera de los dos niveles.

`color` guarda un **token de la paleta**, no un hex, y se usa como
`var(--${color})` / `var(--${color}-ink)`. **Son veinticuatro**, listados en orden
de matiz en `src/lib/palette.ts` (`PALETTE`) — vive ahí y no en `SettingsView`
porque es dos cosas a la vez: las opciones del picker y el dominio de valores de
esta columna.

**Agregar un color es compatible hacia atrás; renombrar o quitar uno rompe las
categorías que ya lo usan** (quedan con un `var(--loquesea)` que no existe: un
punto transparente, sin error). Cada nombre necesita sus **dos** tokens en
`src/styles/tokens.css`, y eso lo vigila `tokens.test.ts` — el modo de falla es
silencioso, así que no alcanza con la regla escrita. Cómo se eligieron los
dieciséis últimos y por qué caben, en §7.

### 3.4 `objectives`

Objetivo/ritual semanal, agrupado por `iso_week` en formato `2026-W32`
(generado por `isoWeekId()` en `src/lib/date.ts`, ISO real vía `date-fns`).

---

## 4. Funcionalidades por área

### 4.1 Tareas (CRUD)

- **Crear** (`create_task`): posición al final del día destino. Registra
  `CREATED` y, si nace con fecha, además `START_DATE_SET`.
- **Editar** (`update_task` + `TaskPatch`): patch parcial. `None`/ausente =
  no tocar. Los campos anidados (`Option<Option<i64>>` en Rust,
  `number | null` en TS) distinguen "no tocar" de "poner a NULL".
- **Mover** (`move_task`): cambia día y posición y registra `MOVED` (o
  `START_DATE_SET` si venía del backlog). `date = null` ⇒ manda al backlog.
  **`position` es el índice final**, contando que la tarea ya salió de la lista,
  y el día destino se **renumera entero** (0..n, sin huecos ni empates). Un
  índice fuera de rango es "al final". Antes corría +1 las tareas
  `>= position`, que se equivoca en uno al reordenar dentro del mismo día: la
  tarea que se mueve deja libre su lugar. Lo mismo hace `mockDb.moveTask`.
  El índice se cuenta contra la lista **visible**: la renumeración incluye a las
  `ORPHANED` —si no, dos filas quedarían con la misma posición— pero las saltea
  al ubicar la tarea. La salvedad es el backlog, que `list_backlog` ordena por
  `category_id, position, id`: ahí el índice de la vista nunca coincidió con el
  orden de `position`, ni antes ni ahora.
- **Estado** (`set_task_status`): sella/limpia `completed_at`. Ver Invariante I5.
- **Borrar** (`delete_task`): borrado real. `ON DELETE CASCADE` limpia
  `task_events` y `time_entries`.

### 4.2 Degradación diaria al backlog

`demote_pending(today)` manda al backlog lo que quedó pendiente en días
**anteriores al último con actividad**, en `position = 0`. Devuelve cuántas
movió. Lo dispara `useBoard` vía `degradarUnaVez()`, **una vez por día y por
ventana**: es una mutación, así que no puede colgar del ciclo de recarga. La
condición es la fecha y no un booleano, para que una sesión abierta cruzando la
medianoche la vuelva a correr al día siguiente.

**Reemplazó al carry-over**, que arrastraba todo a hoy. El carry-over decidía por
el usuario antes de que viera nada: al abrir el ritual a las 9 AM lo pendiente ya
estaba en hoy, así que el repaso del día anterior no podía mostrarlo y hubo que
reconstruirlo desde el historial —dos parches seguidos (`arrastradas_a`, después
`ultimoDesde`) que hoy ya no existen.

Las dos reglas que la definen:

- **El último día con tareas se preserva intacto.** Es el que repasa el paso 1
  del ritual (§4.14), con sus botones de traer a hoy o mandar al backlog. Es "el
  último con tareas" y no "ayer" porque un lunes ayer es domingo y está vacío: lo
  que hay que repasar es el viernes. El front usa el mismo criterio
  (`lastDayWithTasks`), y **los dos tienen que coincidir**: si divergen, el
  ritual repasaría un día del que ya se llevaron tareas.
- **Lo anterior baja al backlog en primera posición.** Volver de vacaciones deja
  lo viejo ordenado en un solo lugar en vez de desperdigado por días muertos, y
  arriba queda lo que más tiempo lleva esperando. El ritual es la **oportunidad**
  de rescate, no un trámite obligatorio: si nunca entras, el backlog es la red.

**No toca las de calendario ni las completadas.** Una reunión pasada es el
registro de algo que ocurrió ese día; mandarla al backlog sería mentir sobre
cuándo fue. Consecuencia conocida: una reunión sin cerrar se queda en su día para
siempre, y el único camino para rescatarla es el paso 1 del ritual.

**No hace falta un evento nuevo**: bajar algo al backlog ya registra `MOVED` con
`to_date` nulo, tanto si lo hace la degradación como si lo mandas tú. Eso es
justamente lo que lee `rescued_from_backlog` para el grupo **"venían de un
día"**, que sale arriba de la columna de backlog (§4.14) y como línea de origen
en la vista Backlog. `CARRIED_OVER` sigue existiendo en `TaskEventType` por las
tareas que ya lo tienen en su historial, pero **nadie lo escribe más**.

Consecuencia que conviene tener presente: **mover una tarea pendiente a un día
pasado ya no es temporal**, mientras ese día sea el último con actividad. Si hay
días con tareas más recientes, la degradación se la lleva al backlog en la
siguiente corrida.

### 4.3 Vista semana (`WeekView`) y Today (`TodayView`)

- **21 columnas: la semana ISO del ancla, la anterior y la siguiente**
  (`threeWeekDates`), en un contenedor con scroll horizontal; navegación ±
  semana, que desliza la ventana entera. Existe para poder **reprogramar un
  viernes** sin cambiar de vista: se arrastra a la semana que viene y se suelta.
  `TodayView` reutiliza `DayColumn` con un solo día, y a su derecha monta el
  **rail de calendario** (§4.13), que en `WeekView` es un panel superpuesto que
  se abre con un botón.
- **Cada semana es un bloque con su propio rótulo**, no 21 columnas sueltas
  (`.board__wk` → `.board__wk-head` + `.board__wk-dias`). El rótulo lleva el rango
  y el número de esa semana, y va **`sticky left: 0` dentro de su bloque**: entra
  pegado al borde izquierdo mientras la semana esté en pantalla y lo empuja el de
  la siguiente cuando el bloque se termina. `align-self: flex-start` es lo que
  hace que pueda pegarse —un rótulo del ancho del bloque ya estaría en el borde y
  no tendría a dónde desplazarse— y el fondo opaco (`--surface`) es lo que hace
  que el que entra tape al que sale. Un solo rótulo fijo en la barra de arriba
  nombraría una semana que puede no estar en pantalla, y por eso el rango **salió
  de la barra**: arriba queda solo la navegación.
- **La semana del ancla y la ventana son dos cosas distintas, y confundirlas es
  el error fácil.** `WeekView` mantiene `semana` (7 fechas), `semanas` (3 × 7,
  para los bloques) y `dates` (las 21 planas). `dates[0]` es un lunes de **dos
  semanas atrás**, así que todo lo que signifique "la semana en que estoy" va
  contra `semana`: el día por defecto del rail, `anchorAfterDayChange` —si
  comparara contra las 21, despertar el lunes siguiente caería "dentro de lo
  visible" y el ancla no se movería— y sobre todo **la semana de los objetivos**:
  `useBoard` recibe la semana como tercer argumento (`weekOf`) en vez de deducirla
  del inicio del rango, que daría los de dos semanas atrás sin que nada se vea
  roto.
- **El scroll se posiciona en la semana del ancla**, al montar y con cada cambio
  de semana; si no, la vista se abre mirando la semana pasada. Se calcula
  `scrollLeft` a mano contra los rectángulos y **sin scroll suave** (el nativo no
  está en todos los webviews; ya pasó con las tabs de Configs). La columna se
  busca por `data-date` y no con un ref, porque la `<section>` ya tiene el del
  droppable de dnd-kit. El botón "Hoy" lleva además un contador: sin él, apretarlo
  estando ya en la semana de hoy no reposicionaba nada, porque el ancla no
  cambiaba.
- **El scroll deja hoy al centro**, y solo cuando hoy cae en la semana del ancla;
  si no, pega el lunes de esa semana al borde izquierdo. La condición va contra la
  **semana del ancla y no contra las 21 fechas**, y ahí está el detalle que se
  rompe fácil: al apretar "semana siguiente" hoy sigue estando en la ventana —pasa
  a ser la semana anterior—, así que centrarlo scrollearía de vuelta y la flecha no
  haría nada. La aritmética vive en `scrollDelta` (`anchor.ts`) porque es la única
  parte testeable: jsdom no implementa `scrollLeft` ni devuelve rectángulos, así
  que la medición y la asignación se quedan en el componente y se verifican en el
  browser. Corre **al montar, al cambiar de semana y al cambiar el día**, nunca con
  una invalidación de datos: recolocar la vista al guardar una tarea sería pelear
  con quien ya scrolleó a propósito.
- **Los días anteriores a hoy sí reciben cards**, y van con menos contraste
  (`.day-col.is-past`) solo como información: el pasado es pasado. Se evaluó
  bloquearlos y **se decidió no hacerlo**, porque bloquear costaba más de lo que
  evitaba. Lo que evita: una tarea pendiente con fecha anterior al último día con
  actividad la manda al backlog la degradación diaria (§4.2), así que soltarla muy
  atrás se ve aterrizar y al día siguiente se va sola de la columna. Lo que
  costaba: el gesto ya existía —antes de la ventana de tres semanas, navegar a la
  semana anterior con la flecha dejaba esas siete columnas recibiendo drops—, y el
  riesgo real es más angosto de lo que parece: una pendiente soltada en **ayer**
  (si ayer es el último día con actividad) sobrevive, y una **cerrada** no se toca
  nunca, porque la degradación solo mira `status = 'TODO'`. Mover una cerrada
  tampoco reescribe sus horas: el tiempo se atribuye por `started_at` (Regla 2,
  §4.15). Y cuando la degradación se la lleva, la tarea aparece en el backlog con
  su rótulo "Desde el X" (§4.14): es visible, no una desaparición.
- **El auto-scroll de dnd-kit funciona y los rects se ajustan al scroll**: se
  verificó arrastrando contra el borde derecho —el contenedor avanzó y la card
  cayó en la columna que quedó bajo el puntero **después** de desplazarse—, así
  que **no** hace falta `MeasuringStrategy.Always`. Con 21 columnas y todas sus
  cards, remedir en cada movimiento del puntero se paga en la fluidez del arrastre,
  que ya costó una tanda de arreglos (Mej.12).
- **El corte entre semanas es un canal con una línea punteada**
  (`.board__wk + .board__wk`): 21 columnas seguidas se leen como 21 días sueltos.
  Punteada y no sólida porque el board ya tiene una línea vertical por columna en
  `--border`, y otra igual se leería como una columna más en vez del domingo dando
  paso al lunes. El último día de cada semana entrega su borde derecho al canal.
- **Días plegados** (`collapsed_weekdays` en `settings`, §4.8; por defecto sábado y
  domingo). Se dibujan como una tira de 34px con el día en vertical
  (`writing-mode: vertical-rl`, no un `rotate`: el texto rotado a mano no reserva
  su alto y se salía de la tira). Con el fin de semana plegado una semana entera
  mide **1248px en vez de 1652**: dos días menos de scroll por semana. Tres
  reglas:
  - **No reciben drops** —no se les pone el ref del droppable— y `onDragEnd` lo
    verifica igual, por el fallback de la cascada de colisión.
  - **Hoy nunca se pliega**, aunque el ajuste lo marque: si es sábado y el sábado
    está plegado, la vista esconde el día en el que estás trabajando. El ajuste
    dice qué días suelen estar vacíos, no que hoy no importe.
  - **No se esconde trabajo**: si el día plegado tiene tareas se dibuja su cuenta,
    y un click lo abre **por la sesión** (no se guarda: es una ojeada, no un
    cambio de configuración). Sin esa salida, plegar un día con tres cosas adentro
    sería perderlas de vista sin manera de recuperarlas desde acá. Abierto lleva un
    botón para **volver a plegarlo**, y ese botón existe **solo ahí**: en un día
    normal no hay nada que plegar —plegar es del ajuste, no de la columna— y uno
    que apareciera en las siete prometería otra cosa. Va agrupado con la fecha a
    la derecha de la cabecera y no como un tercer hijo del `space-between`, que
    corría la fecha al centro al aparecer.
- **DnD** con `@dnd-kit`. La detección de colisión es custom
  (`src/features/week/collision.ts`): `pointerWithin` → `rectIntersection` →
  `closestCorners`. Esa cascada existe para que **toda la columna** acepte el
  drop (incluida la mitad superior con el header y "Agregar tarea") y para que la
  card nunca se pierda entre columnas. No la simplifiques a un solo detector.
  Encima de eso, el **panel de backlog** (§3.10) tiene dos reglas propias, y las
  dos salen de que se superpone a una columna:
  - **Si el puntero está dentro del panel, gana el panel.** dnd-kit **ignora el
    `z-index`**: la columna tapada conserva su rectángulo, así que un drop dentro
    del panel produce al menos dos colisiones y `pointerWithin` las ordena por
    distancia al centro — con 300px de panel contra 236px de columna, la columna
    escondida puede ganar y la tarea termina agendada en un día que no se ve.
  - **El panel no participa de los dos fallbacks, salvo que no haya puntero.**
    `closestCorners` nunca devuelve vacío, así que sin la exclusión una card
    soltada sobre espacio muerto podía desagendarse sola. La excepción no es
    decorativa: el `KeyboardSensor` no tiene coordenadas, `pointerWithin` devuelve
    `[]` y los fallbacks son el único camino que le queda.

  **La decisión de destino vive en `src/features/week/dropTarget.ts`** (`resolveDrop`),
  puro y testeado, y no inline en `WeekView`: jsdom no devuelve rectángulos, así
  que el gesto se verifica en el browser pero los guards se fijan con tests.
  El índice que se manda al soltar es **el de la card sobre la que se soltó, en
  la lista tal como está antes de mover** — que es justo lo que dnd-kit muestra
  como previsualización. Con la semántica de `move_task` de §4.1 eso cae donde
  se ve, en los dos sentidos. Soltar sobre la **columna** es "al final", salvo
  que la card ya esté en ella: la cascada resuelve la columna al pasar por el
  header o los márgenes, y ahí "al final" mandaba la tarea al fondo del día sin
  que nadie lo pidiera.
- **El reorden es optimista.** `useBoard.moveTask` reordena su estado con
  `reorderLocal` —la misma aritmética que `repo::move_task`— **antes** de
  escribir. No es una optimización: el overlay desaparece al instante, así que
  esperar la escritura deja ver el orden viejo y después la transición de
  `useSortable` mete la card deslizándose desde arriba. Si las dos aritméticas se
  separan, la recarga corrige la lista a la vista y se ve un salto; hay un test a
  cada lado.
- **El preview no lleva `width`.** `<DragOverlay>` dimensiona su envoltorio con el
  rect medido de la card. Un ancho fijo en `.task-card.is-overlay` (estuvo en
  236px, el mínimo de la columna) hace que el título se reacomode en otra cantidad
  de líneas al levantarla y la caja cambie de alto.
- **La columna no se ilumina si la card ya está en ella.** El `is-over` de
  `DayColumn` y de `BacklogColumn` compara el día de `active` con el propio: sin
  eso, reordenar dentro de un día prende y apaga el marco damasco anunciando un
  cambio que no está pasando.
- **Contador de capacidad** por día: suma de `estimatedMinutes` vs objetivo
  (de `settings`, default 480), semáforo por `computeCapacityLevel`:
  `> target` ⇒ `OVER` (rojo); `>= target * 0.85` ⇒ `WARN` (amarillo); resto
  `OK` (gris). `target <= 0` ⇒ siempre `OK`.
- **Barra de progreso** solo en la columna de hoy, pero dentro de un slot de
  altura fija en TODAS las columnas para que las listas queden alineadas
  (regla de UI, ver §7).
- La card (`TaskCardContent`) permite, sin abrir el modal: completar, cambiar
  channel, editar planned y actual, y play/pausa. El footer de tiempos se
  abre solo si la tarea está corriendo.

### 4.4 Modal de detalle (`TaskModal`)

- **Autosave, sin botón Guardar.** Selects/checks/fechas guardan de inmediato
  (`commit`); los campos de texto con debounce de 500 ms (`commitDebounced`).
  Feedback = el flash "Guardado". **No agregues un botón Guardar.**
- Channel, objetivo y fecha van en popovers; channel y objetivo usan
  `SearchSelect` (búsqueda local).
- **Todas las mutaciones del modal avisan** (`bumpData()`, §5.3), borrar incluido.
  El `onChanged` de la vista que lo monta recarga solo lo que esa vista considera
  suyo: en el ritual diario es `useBoard` con hoy, mientras el repaso del día
  anterior y la columna del backlog dependen de `dataVersion`. Borrar era la única
  que no avisaba, y la card se quedaba en pantalla después de borrarse (Mej.20).
- Notas en markdown (`react-markdown` + `remark-gfm`), click para editar.
  Los links se extraen del texto con `extractLinks` y se listan aparte.
- **El tiempo trabajado ("Real" en la UI, `actual_seconds` en la DB) es siempre
  el total de la tarea**, más lo que va de la corrida en
  curso si el timer está en ella (`task.actualSeconds + timer.runTotal`). Antes
  mostraba `timer.elapsed` mientras corría —o sea *lo de hoy*—, así que el mismo
  campo significaba dos cosas y darle play a una tarea arrastrada hacía **bajar**
  el número, como si se hubiera perdido el tiempo anterior. El "solo hoy" vive
  únicamente en el taxímetro, que es el contador de la sesión. Mismo criterio en
  la tarjeta de la semana y en Focus.
- **Tiempo por día** en el detalle (`timeByDay` en
  `src/features/tasks/timeByDay.ts`): una fila por fecha con lo trabajado. El
  dato estaba en `time_entries` desde M2 y ninguna vista lo leía, así que una
  tarea arrastrada tres días mostraba un total sin decir cómo se repartía. Es
  también lo que hace **visible** un ajuste manual de tiempo. Agrupa por la
  fecha **local** de `startedAt` (cortar el string daría el día UTC, que en Chile
  cambia a las 20:00), y un día que quede en negativo por un ajuste se muestra
  en 0 en vez de desaparecer, para que no se esconda que ahí pasó algo.
- Historial legible desde `task_events` vía `describeTaskEvent`/`taskEventLine`
  ("Moviste la fecha de inicio al 6 ago · hace 1 sem"). **Las líneas no llevan
  sujeto**: hubo un nombre propio hardcodeado, después un "Tú", y leído en fila
  sonaba a robot llenando un formulario. El español conjuga la persona en el
  verbo, y donde no importa quién fue la línea se vuelve impersonal ("Se creó la
  tarea"). La excepción es el arrastre automático, que **sí** nombra al sujeto
  porque no eres tú: "sunrise la arrastró sola desde el 12 ago". Sin fecha
  destino la línea cambia de forma ("Moviste la tarea al backlog") en vez de
  meter la palabra "backlog" donde iba una fecha.
- El play **cierra el modal y navega a `/focus`**: arrancar el timer desde el
  detalle significa "me pongo a trabajar".
- **⌘/Ctrl+Enter cierra el modal.** Ya no confirma nada —de eso se encarga el
  autosave—, pero el gesto se mantiene porque estaba en la memoria muscular.
  Antes de cerrar fuerza la escritura de lo que el debounce tuviera pendiente
  (`flush`): los campos de texto guardan a los 500ms y el cleanup **cancelaba**
  ese temporizador, así que escribir y cerrar en el mismo gesto perdía lo
  escrito. Sin botón "Guardar", eso es pérdida de datos silenciosa. El mismo
  `flush` corre al desmontar, así que Escape, el click afuera y la X quedan
  cubiertos por igual.
- **Escape y ⌘Enter escuchan en `window`, y el modal toma el foco al abrirse.**
  Un handler en el div del modal solo recibe la tecla si el `target` está dentro,
  y eso fallaba en los tres caminos normales: abrir con el mouse deja el foco en
  la tarjeta de atrás, los popovers viven en un portal sobre `body`, y un click
  en zona no enfocable manda el foco al `body`. Los dos atajos quedaban muertos
  sin síntoma. El foco además evita un choque con el board: las tarjetas llevan
  los `listeners` de `useSortable` y el `KeyboardSensor` de dnd-kit arranca un
  arrastre con Enter o Espacio **sin mirar los modificadores**, así que ⌘Enter
  sobre una tarjeta enfocada *levantaba la tarjeta*.
- La tarea llega como prop desde el board (datos frescos) y un `useEffect`
  re-sincroniza los campos que no se estén editando.

### 4.5 Backlog

`list_backlog`: `scheduled_date IS NULL AND status = 'TODO' AND source_state =
'ACTIVE'`, agrupado por contexto. El agrupado vive en
**`src/features/backlog/grouping.ts`** (`folderOf`, `groupByContext`), puro y
compartido por sus tres consumidores — la vista, el sidebar y el panel de la
semana—; estaba escrito tres veces. `includeEmpty` es explícito porque los
consumidores difieren: **la vista lo quiere en `true`** (un contexto vacío ahí
sigue mostrando su botón "Agregar tarea", que es la única forma de crear en un
contexto que todavía no tiene nada), y el sidebar y el panel en `false`, porque
no crean nada.

Se ve en tres lugares:

- **La vista `/backlog`** (`BacklogView`): **un contexto por columna**, lado a
  lado, con el chrome de `.day-col` (rótulo con su punto, cuántas tiene, y su
  botón "Agregar tarea" arriba) y scroll horizontal como el board de la semana.

  **La columna es de 236px**, el ancho de una columna de día, y eso es el punto:
  la card es la misma de toda la app (`TaskCardStatic` con `hidePlaceholders`,
  con el badge "Desde el X" cosido al borde superior como en el panel) y
  estirarla deja de leerse como la misma card — la regla que ya estaba escrita
  para el ritual diario. La vista la rompía dos veces: primero con un reskin
  propio de `.task-card` (`.backlog .task-card`, borrado), después con una lista
  vertical de 720px de ancho. Lo que comparte con el panel está declarado una
  sola vez, con los dos selectores juntos (`.backlog-panel__item,
  .backlog__item`, en `week.css`).

  **Columnas y no una lista vertical** porque los contextos son pocos y cortos:
  apilados, la mayor parte del scroll era aire entre rótulos y llegar al sexto
  obligaba a pasar por los cinco anteriores.

  Dos diferencias con el board de la semana, a propósito: **no arrastra** (acá no
  hay días a los que soltar, y reordenar dentro del backlog no significa nada —
  de ahí `TaskCardStatic`), y las columnas son de ancho **fijo** y no `flex: 1 0
  236px`: con pocos contextos el grow las estiraba hasta llenar la ventana, que
  es justo lo que hacía irreconocible a la card.

  **El buscador de la cabecera** filtra por título (`includes` en minúsculas, el
  mismo del buscador de los selects) y con él escrito los contextos sin
  resultados **se esconden** — es lo contrario de perderlos: estás filtrando, y
  una columna vacía no es un resultado. Sin filtro **sí se dibujan los contextos
  vacíos**, que es donde vive el único botón que crea una tarea en un contexto
  que todavía no tiene ninguna (de ahí el `includeEmpty: !filtro`). El subtítulo
  deja el total al lado del filtrado ("1 de 12 pendientes"): el filtrado a secas
  escondería cuántas hay en realidad.
- **El sidebar**: solo el item, con el total en un **badge**. Cuenta todo,
  incluidas las tareas sin canal, para que el número coincida con la lista que
  abre. Es badge y no número suelto porque al lado del atajo, en la misma
  tipografía tenue, se leía como parte del ruido de la fila — y es **gris y no un
  color de la paleta**: con el durazno del acento parecía un contador de errores,
  y esto es cuántas cosas hay, no un estado. Neutro tampoco puede ser una
  superficie: el fondo del sidebar es `--surface-sunken` y el de la fila activa
  `--surface-raised`, así que el badge desaparecería en uno de los dos. **Los canales no se
  listan acá**: se ven en la vista, que es donde además se pueden abrir y editar
  — repetirlos en el sidebar era una segunda lista que mantener y una columna más
  larga de nombres sobre los que no se puede hacer nada.
- **El panel de la semana** (`BacklogPanel`), detrás del segundo icono de la
  tira. Arrastra en los dos sentidos: al día y de vuelta. Ahí sí agrupa **por
  contexto**, porque el contexto es lo que estás decidiendo al planificar.

#### El panel de la semana

Es **el primer panel de la tira que participa del DnD** (la agenda es referencia
y no tiene ningún `useDroppable`), así que vive **dentro** del `DndContext` de la
semana. No hace falta backend: `move_task` con fecha ya registra
`START_DATE_SET`, y con `null` registra `MOVED`, que es de donde salen los
rótulos "desde el X".

- **Las tareas sin fecha se cargan dentro de `useBoard`, en el mismo array
  `tasks`**, detrás de un cuarto parámetro `withBacklog` que solo la vista semana
  enciende. En el mismo array y no en uno aparte porque `reorderLocal` ya mueve
  una tarea entre el bucket nulo y un día en una sola pasada, y porque
  `activeTask` (el `DragOverlay`) y `selectedTask` (el modal) buscan ahí — una
  tarea del backlog que no esté arrastra un overlay vacío. Es seguro porque los
  conjuntos son disjuntos por construcción (`IS NOT NULL` vs `IS NULL`) y
  `tasksByDate` ya saltea las de fecha nula.
- **No se reordena por dentro.** La `position` del backlog es global sobre el
  bucket `scheduled_date IS NULL` mientras `list_backlog` ordena por
  `category_id, position, id`, así que un índice dentro de un grupo de contexto
  no corresponde a ninguna posición global. Todo drop que caiga en el panel entra
  en **0**, que con el agrupado del lado del cliente significa "primera de su
  contexto" — igual antes y después de la recarga, así que no salta. Por lo mismo
  el `SortableContext` va **sin estrategia**: `verticalListSortingStrategy` abre
  un hueco de inserción y prometería un reordenamiento que no existe.
- **Del backlog al backlog no pasa nada.** Con el panel superpuesto el arrastre
  *empieza* con el puntero adentro y la card fuente sigue montada en su
  rectángulo, así que un empujón de 5px —la constante de activación— resuelve el
  panel; sin el guard, ese empujón reescribiría la `position` de todo el bucket.
- **Una tarea completada no entra.** `list_backlog` filtra `status='TODO'`, así
  que saldría del día sin entrar al backlog y quedaría **inalcanzable en toda la
  app**. El drop es no-op y el panel tampoco se ilumina para ella (un marco
  encendido sobre un destino que va a rechazar promete algo que no pasa). El
  estado viaja en la `data` del `useSortable` de `TaskCard`, porque durante el
  arrastre el panel solo tiene los datos del `active`.
- **Mover desde o hacia el backlog invalida** (`bumpData`), porque los conteos
  del sidebar y `BacklogView` se refrescan solo con `dataVersion`. El
  `bumpData()` **reemplaza** al `reload()`, no se suma: el efecto de carga de
  `useBoard` ya depende de `dataVersion`, así que llamar a los dos son dos
  recargas por arrastre. Un reordenamiento dentro de un día no invalida nada.
- **Solo mueve, no crea.** Crear sigue siendo de la vista y del compose.

**La geometría es la misma que la de la agenda superpuesta**, y tiene que
seguir siéndolo: los dos se abren en el mismo lugar y se alternan, así que
cualquier diferencia se lee como un salto al cambiar de panel. Eso incluye la
cabecera, que es una clase compartida (`.panel-head`, en `week.css`): dos líneas
—el nombre del panel y qué está mostrando— porque en una sola fila los dos
niveles competían sin que se supiera cuál leer primero. El rail **fijo** de Today
conserva su cabecera de una línea: ahí la vista ya dice de qué día es.

Los dos llegan **hasta el fondo de la app** con un `bottom` negativo que cancela
el padding de `.app-main`; sin eso quedaba una franja en blanco abajo. La tira
baja con ellos, o el panel colgaría por debajo de su propia perilla. Y el panel
redondea **solo** su esquina superior izquierda, que es la única que queda suelta
sobre el board.

**Entran y salen con la misma animación** (`panel-in` y su reverso
`panel-out`, en `week.css`): un panel que entra deslizándose y desaparece de
golpe se siente como si se hubiera roto, no como si se hubiera cerrado. Animar la
salida obliga a que el panel siga montado mientras se va, y de eso se encarga
`usePanelPresence`. Mientras sale lleva `pointer-events: none`: ya no está, y
además sigue siendo un droppable dentro del `DndContext`.

Dos detalles que costaron una vuelta y por eso están escritos en el código:

- **La salida declara el `animation` entero, no solo `animation-name`.** Cambiar
  una longhand sobre un elemento que ya corrió su animación de entrada deja el
  reinicio a merced de cómo el motor empareja la lista de animaciones, y la salida
  no corría.
- **El temporizador del desmontaje es más largo que la animación** (240 ms contra
  160). El temporizador arranca cuando corre el efecto y la animación en el
  pintado siguiente, uno o dos frames después; con el mismo número los dos, el
  desmontaje llega antes del final y se ve un corte — indistinguible de no tener
  animación. La holgura no se nota porque `forwards` deja el panel quieto en su
  último fotograma.

**El rótulo de origen es un badge montado sobre el borde superior de la card**,
centrado, con el fondo de la card para cortar el borde en vez de taparlo. Como
línea suelta debajo tenía márgenes propios y rompía el pulso de la lista: una card
con rótulo dejaba 14px hasta la siguiente y una sin rótulo 8px, justo en las
tareas que traían más información. El `padding-top` del contenedor es la mitad del
alto del badge, que es lo que lo deja a caballo del borde; si cambia uno, cambia
el otro.

**Las cards del panel esconden los rellenos de los campos vacíos**
(`hidePlaceholders` en `TaskCardContent`): ni el `--:--` de tiempos ni el chip `#`
de canal. En el backlog la mayoría de las tareas no tiene ninguno de los dos
todavía, así que las cards se llenaban de marcas de posición en vez de datos —y un
numeral a 12px no se lee como "poner canal" sino como un glifo raro—. En una
columna de día sí se muestran: ahí "sin estimar" es lo que no está contando para
la capacidad. No se pierde nada, el reloj del pie abre los tiempos y el canal se
cambia desde el detalle. La vista `/backlog` pasa el mismo flag, por lo mismo:
son la misma superficie.

**Dos costos asumidos de que se superponga** (misma geometría que la agenda,
`right: 44px`), los dos documentados en `BacklogPanel`:

1. La columna que tapa no recibe drops mientras esté abierto. Para soltar ahí se
   scrollea el board.
2. **El autoscroll del arrastre no llega al borde tapado**: dnd-kit sigue al
   scroller del nodo de destino, y el panel más la tira cubren el borde derecho.
   Arrastrando no se alcanza un día fuera de las columnas visibles — hay que
   cerrar el panel, scrollear y reabrirlo. Es una limitación del layout, no un
   bug pendiente.

### 4.6 Timer / taxímetro

Respaldado en la DB (`time_entries`), no en memoria. Estado en
`src/features/timer/timerStore.ts`.

- `start_timer(taskId)`: cierra el timer previo si había (I4), **reabre la
  tarea si estaba completada** (I5) e inserta una entrada abierta
  (`ended_at IS NULL`).
- `stop_timer()`: cierra la entrada, calcula sus segundos y **suma** a
  `tasks.actual_seconds` (I1). Devuelve `(taskId, seconds)`.
- `get_active_timer()`: la entrada abierta + `base_seconds` = `seconds_today`
  de esa tarea (I3).
- El taxímetro muestra `actual / planned` con barra de progreso. Click en el
  título → enfoca `main` y emite `sunrise://goto` con `/focus`. Mantener y
  mover → arrastra la ventana (`useDragOrClick` distingue click de drag).
- Botones: play/pausa siempre visible; ocultar (ojo) y **completar-y-avanzar**
  (check) viven en un panel que **entra deslizándose desde la derecha** al pasar
  el mouse **por ese botón** (no por toda la tarjeta: es decisión de producto
  que no aparezcan al pasar por el título). El panel va en `position: absolute`,
  superpuesto al título y los tiempos, para que aparecer no cambie el tamaño de
  la caja. El panel se enciende **solo** por la clase `is-hover-controls`, que
  pone `useCursorHover` sondeando la posición global del puntero: en esta
  ventana el `:hover` de CSS no sirve y además se queda pegado (ver §5.4.5).
  El hit-test usa la envolvente del botón y el panel, así que los 4px de
  separación visual entre ambos no cortan el recorrido. Ver también §5.4.4 y
  §7. Al
  completar, la tarea se manda al final de **su propio día**, no de hoy: el
  taxímetro puede estar cronometrando una tarea de otro día (arrancada desde la
  semana, o reanudada), y completarla no debe reprogramarla. Si no tiene fecha
  (backlog), no se mueve. Después salta a la siguiente pendiente de hoy; si no
  queda ninguna, el taxímetro se oculta.
- **Campana** al alcanzar el estimado, **decidida y tocada en Rust**
  (`bell.rs`): sin estimado —`null` o `<= 0`— nunca suena, suena al **alcanzar**
  el estimado y **una sola vez por (entrada, estimado)**, así que pausar y
  reanudar la vuelve a armar — y también **subirle el estimado**. El sonido se sintetiza con `rodio` (`sound.rs`). **Sin notificación
  nativa a propósito**: bastan el sonido y el taxímetro cambiando de color; una
  notificación del sistema hay que ir a descartarla y se apila si se pasan
  varias tareas.

  > **Estaba en el front y ahí no podía funcionar.** La decisión vivía en el
  > `tick` de 1 s del webview de `main`, con el taxímetro excluido para que no
  > sonaran dos copias. El problema es cuál de las dos ventanas quedó a cargo:
  > `main` es la que se tapa o se minimiza, y **un webview que no se ve no corre
  > sus timers** —macOS los estrangula—, así que en una reunión la campana no
  > sonaba y recién lo hacía cuando algo despertaba la página, por ejemplo un
  > evento del poller de calendario: hasta `poll_minutes` de atraso. El taxímetro,
  > que sí estaba a la vista y contaba bien, era justo el que no tenía permiso
  > para sonar. Un proceso nativo no se estrangula, y de paso **desaparece la
  > invariante de "una sola ventana toca la campana"**: no hay ventana que elegir.
  >
  > **La llave es el par y no la entrada sola**, y eso salió de un reporte: sonó a
  > la hora, se le subió el estimado, y esa entrada quedaba muda para siempre
  > porque "ya había sonado". La campana no promete "te avisé una vez por esta
  > tarea" sino "te avisé que alcanzaste **este** tiempo"; si el tiempo cambia, la
  > promesa es otra.
  >
  > **El vigilante duerme hasta el momento en que tiene que sonar**
  > (`next_wake`), con un techo de 30 s, y sin ningún timer corriendo espera el
  > timbre (`Armed`, que toca `start_timer`) con un techo largo de 5 min. O sea que
  > no hay pulso fijo: en una tarea de una hora son un par de docenas de
  > despertadas y no 720, darle play arma la campana en el acto, y mientras no hay
  > nada que vigilar no mira el reloj.
  >
  > **Pero ni el momento calculado ni el timbre son la decisión**: cada vez que
  > despierta vuelve a leer la base, y los techos son la red. Un `sleep` hasta el
  > momento justo, disparado y creído, habría que invalidarlo al **bajar** el
  > estimado, al ajustar el tiempo a mano, al pausar, al cambiar de tarea y **al
  > volver de dormir la máquina** —los temporizadores no corren mientras duerme, así
  > que una espera larga despierta tarde en tiempo de reloj—. Validar al despertar
  > que la hora sea la esperada cubre **solo el último** de esos casos: en los otros
  > cuatro el problema es que el momento se adelantó y nadie va a despertar a
  > mirarlo. Con los techos, los cinco llegan con atraso acotado en vez de no
  > llegar. Es la misma lección que `useDayWatcher`, que compara **fechas** en vez
  > de contar tiempo transcurrido, y por eso mismo.
  >
  > **Y por qué no en el taxímetro, que ya tiene un tick de 1 s**: porque se puede
  > esconder (el ojo tachado del widget) y porque no existe mientras no haya timer
  > ni tarea pausada. "Si no hay taxímetro visible no suena" convierte un botón de
  > la UI en un interruptor silencioso del aviso, que es la misma clase de bug que
  > este módulo vino a arreglar.
  >
  > `isOverEstimate` sigue en el front, pero **solo para pintar**
  > (rojo del taxímetro, aviso de Focus); la misma regla vive en `bell::is_due`, y
  > si cambia una cambia la otra. **Fuera de Tauri no hay campana**: en el browser
  > el tick dibuja y nada más.
  >
  > `bell::elapsed_today` espeja `runSeconds` del front, **incluido el recorte a
  > medianoche**: `base_seconds` son las entradas cerradas **de hoy**, así que una
  > entrada abierta desde ayer no puede acreditar lo de ayer o la campana sonaría
  > al arrancar el día. Las dos usan `repo::start_of_today()` para que "hoy"
  > signifique lo mismo en los dos lados.
- `last` (última tarea pausada) se persiste en `localStorage` para poder
  reanudar; el taxímetro se muestra mientras haya `active` **o** `last`.

### 4.7 Focus Mode

- Cola = `focus_queue(date, nowHhmm)`: tareas `TODO` del día ordenadas por
  (1) sin hora o ya empezada antes que agendadas más tarde, (2) con hora
  primero dentro del grupo, (3) `scheduled_time`, (4) `position`, (5) `id`.
- Check ⇒ completa, **manda la tarea al final del día** y avanza.
- ↑/↓ mueven el foco entre tareas del día (ignorado si el foco está en un
  input/textarea).
- Si el timer arranca en otra tarea, Focus salta a ella **una sola vez por
  tarea** (`syncedFor`), para no pelear con las flechas después.
- **Nunca auto-cierra ni bloquea al pasarse del estimado**: muestra el aviso
  "puedes seguir trabajando". Regla de producto, no detalle de UI.

### 4.8 Settings

Seis secciones, cada una con título y bajada propia (`Card` en
`SettingsView.tsx`), en este orden: **General**, **Apariencia** (§4.28),
**Calendarios** (§4.12), **Canales**, **Atajos de teclado** (§4.9),
**Notificaciones** (§4.27) y **Respaldo** (§4.17). En dev hay una séptima al final,
**Dev Tools** (§4.24), que la app instalada no muestra. El orden de la
lista lateral y el de las cards **tienen que coincidir**: el resaltado lo decide
un `IntersectionObserver` sobre las secciones, así que si divergen la lista marca
una y se ve otra. Las dos salen de la misma lista, `settings/secciones.ts`, que es
también de donde sale el icono de cada una (§7) — y desde Mej.1 lo vigila un test
(§8), porque hasta entonces era una regla escrita sin nada que la sostuviera.

- Capacidad diaria: autosave al salir del foco, acepta `8h`/`7h30`/`480`.
- **Jornada** (`work_start`/`work_end`): dos horas en formato 24 h, autosave al
  salir del foco. Es lo que dibuja la grilla del rail (§4.13). El formulario
  **valida al escribir** —hora imposible o rango invertido se rechazan y se
  avisan— aunque `workHours()` ya caiga al default: ese fallback protege la
  lectura de la base, pero si el campo se tragara un `25:00` en silencio, el rail
  no cambiaría y nada explicaría por qué.
- **Días plegados** (`collapsed_weekdays`): siete botones con los días de la
  semana, marcados los que se dibujan como tira angosta en la vista semana (§4.3).
  Por defecto sábado y domingo. Siete botones y no siete interruptores porque la
  pregunta es "cuáles", y una fila se lee de un vistazo. Se guarda como números
  ISO separados por coma (`"6,7"`).
- **Abrir sunrise al iniciar sesión** (§4.18): el único control de Configs que
  **no** lee ni escribe la tabla `settings`.
- **El alta de un contexto o canal se confirma con Enter o al salir de la fila**,
  no en el blur del nombre: elegir el color primero perdía el alta a medio camino
  (la regla completa, en §7).
- Contextos/channels: renombrar en línea, borrar, y el color se elige con un
  **punto que abre la paleta en un popover** (grilla de 6×4). Las muestras solían
  estar visibles en cada fila: con ocho categorías eran 64 puntos compitiendo con
  los nombres, que es lo que uno viene a leer — con veinticuatro colores serían
  192, así que el popover pasó de conveniencia a requisito.

Los ajustes viven en la tabla `settings` (TEXT/TEXT) y se leen vía
`src/lib/settings.ts`: `useSettingsStore` los carga desde `Shell` y los relee con
cada invalidación, así un cambio en una ventana llega a la otra.
**Toda lectura pasa por un parser con fallback** (`dailyCapacityMinutes`,
`capacityWarnRatio`, `workHours`, `planMark`, `collapsedWeekdays`, `noticeSound`,
`bellSound`, `fontFamily`): la clave puede faltar, venir vacía o traer basura editada a
mano, y un `NaN` suelto dejaría el semáforo en OK para siempre sin error visible,
porque toda comparación con `NaN` es false.

`planned_at` (§4.14) es la primera clave que **no siembra ninguna migración**, y
está bien: `set_setting` es un upsert y la lectura ya tiene fallback. Guarda una
sola marca, no un historial — la pregunta es "¿ya planifiqué hoy?"; llevar la
cuenta de qué días planificaste es materia de la review.

**Guarda fecha y hora** (`'YYYY-MM-DDTHH:mm'`, hora local), y no la fecha pelada
con la que nació. Con la fecha sola la app afirmaba algo que no se podía
desmentir: un ritual cerrado a las 00:20 marca el día que recién empieza, y el
aviso no tenía con qué decir cuándo fue. Dos reglas que van juntas y se rompen en
silencio si se separan:

- **Se escribe con `toISOTimestamp`, nunca con `toISOString()`.** Los primeros
  diez caracteres tienen que ser el mismo día que devolvería `todayISO()` en ese
  instante, porque es contra ese prefijo que se compara al leer. `toISOString()`
  da la fecha **en UTC**: en Santiago, las últimas cuatro horas de cada día
  quedarían marcadas como el día siguiente — el mismo error de medianoche que la
  hora vino a hacer visible, movido de lugar.
- **Al leer, el string no pasa por `new Date()`.** `planMark` corta en la `T`:
  `new Date('2026-08-21')` es medianoche **UTC**, que acá se lee como el día
  anterior a las 20:00. La hora es opcional en la lectura —una marca sin hora
  vale como "ese día" y el aviso lo dice así—, porque una fecha pelada es lo que
  puede quedar de una edición a mano.

La migración 10 **borra** la clave vieja (`planned_on`) en vez de renombrarla:
nadie sabe con qué gesto se escribió el valor que había (Mej.23 lo dejó anotado
sin afirmarlo), y moverlo a una clave que ahora promete una hora sería inventarle
una procedencia.

**`collapsed_weekdays` es el caso contrario, y es la única clave donde la ausencia
y el vacío no significan lo mismo**: ausente es "nunca se configuró" y toma el
default (el fin de semana); presente y vacío es "ningún día plegado", que es una
elección legítima. Si las dos cayeran al default, destildar los siete días en
Configs rebotaría a sábado y domingo y la semana completa sería inexpresable. **Por
eso la migración 9 siembra la fila**, al revés que `planned_at`. La basura se
tolera como basura: se queda con los números 1..7 y descarta el resto sin volver
al default, así un `"6,ocho"` editado a mano pliega el sábado y no promete nada
sobre lo que no entendió.

### 4.9 Atajos de teclado

Registro central en `src/lib/shortcuts.ts` (`SHORTCUT_ACTIONS`) y **un solo
listener** (`useShortcuts`, montado por `Shell`), en vez de un hook por atajo:
agregar un atajo es agregar una fila, y la detección de colisiones tiene todo a
la vista.

| Acción | De fábrica |
|---|---|
| Nueva tarea | `Mod+A` |
| Ir a Home | `Mod+1` |
| Ir a Today | `Mod+2` |
| Ir a Focus | `Mod+3` |

- Se guardan en `settings`, **una fila por atajo**: `hotkey_<accion>`.
- El valor es **normalizado y portable**: `Mod+Shift+F`, nunca `cmd+F`. `Mod` es
  ⌘ en macOS y Ctrl en el resto. La plataforma solo importa al **mostrar**
  (`displayCombo`), nunca al comparar: `matchesCombo` acepta ⌘ **o** Ctrl.
- Shift y Alt se comparan **exactos**, para que ⌘⇧A no dispare el atajo de ⌘A.
- Un valor guardado que no se entiende cae al de fábrica (`resolveShortcuts`),
  igual que el resto de `settings`. Un valor vacío también: así "restaurar" es
  escribir `""` y no hace falta un comando para borrar filas.
- **Los atajos se ignoran si el foco está en un `input`, `textarea` o
  `contenteditable`** (`isEditingText`), para no pisar "seleccionar todo" y
  equivalentes. Mismo criterio que las flechas de Focus.
- En Settings se reasignan **pulsando la combinación**, no escribiéndola; la
  captura usa `capture: true` para ganarle al listener global, y avisa si la
  combinación ya la usa otra acción en vez de dejar un atajo muerto.
- El **sidebar muestra el atajo** junto a los ítems que tienen uno, en texto
  apagado. Va con `aria-hidden` más un `aria-keyshortcuts` en el link: si el
  texto quedara dentro del link, el nombre accesible pasaría a ser "Focus ⌘ 3"
  en vez de "Focus" (y los tests que buscan el link por nombre se caen, que fue
  justo como se detectó).

### 4.10 Cierre de la app

Cerrar con ⌘Q, el menú Quit o el botón de la ventana **pide confirmación**.
Rust cancela el cierre y emite `sunrise://close-requested`; el front abre el
diálogo (`QuitConfirm`) y solo al confirmar llama a `confirm_quit`, que cierra.
No protege datos —todo se autoguarda—: evita que un ⌘Q accidental baje la app.

- **En macOS hay que reemplazar el ítem Quit del menú.** El predefinido mapea a
  `NSApplication terminate:`, que mata el proceso **sin pasar por el event
  loop**: ni `ExitRequested` ni `CloseRequested` llegan, y ⌘Q cierra de una. En
  `setup` se cambia por un `MenuItem` propio (`sunrise-quit`) con el mismo
  acelerador, que llega como `MenuEvent`. Si el menú por defecto de Tauri deja
  de terminar en el Quit esperado, se deja tal cual y se avisa por log en vez de
  borrar el ítem equivocado.
- `WindowEvent::CloseRequested` se atiende **solo para `main`**: el taxímetro no
  debe abrir este diálogo.
- En `RunEvent::ExitRequested`, `code: None` significa que lo pidió el usuario
  (⌘Q, menú) ⇒ se cancela y se pregunta. `code: Some(_)` es una salida
  programática —la de `confirm_quit`— ⇒ pasa sin volver a preguntar. Ese
  contraste evita necesitar un flag global de "ya confirmó".
- El diálogo se cierra con Escape y confirma con Enter, y **suspende los atajos
  globales** mientras está abierto para que no se navegue por debajo.
- **Los tres caminos pasan por `request_close`, que levanta `main` antes de
  preguntar** (`unminimize` + `show` + `set_focus`). El diálogo vive **dentro** de
  esa ventana, así que con la ventana minimizada el usuario apretaba ⌘Q, no veía
  nada y la app parecía colgada con el timer corriendo. **macOS no la levanta
  solo**: con la ventana minimizada y la app al frente, ⌘Q dejaba `AXMinimized` en
  true y el proceso vivo — o sea el pedido llegaba y la respuesta se dibujaba
  donde nadie la ve. La alternativa —un `ask()` nativo— se descartó en Mej.17: el
  diálogo propio es el mismo componente que el resto de la app.

> **Cómo se comprueba esto, que no lo cubre ningún test** (no hay ⌘Q en jsdom ni
> en el browser). Con `pnpm tauri dev` arriba, desde AppleScript: minimizar
> `window "sunrise"` del proceso, dejar la app al frente, mandar `keystroke "q"
> using command down` **al proceso** —nunca a System Events global, que se lo
> come la app que esté adelante— y leer `AXMinimized` después. `true` es el bug;
> `false` con el proceso vivo es el arreglo. Un `screencapture` sería la prueba
> directa, pero necesita permiso de Grabación de pantalla, que no se pide.

**El timer no se detiene al cerrar.** Dejar el taxímetro corriendo entre
sesiones es el comportamiento esperado: la entrada queda abierta y sigue
contando. El diálogo lo dice cuando hay uno activo, para que no sorprenda al
volver.

### 4.11 Tema

Claro/oscuro en `src/lib/theme.ts`, persistido en `localStorage` bajo
`sunrise-theme`. El taxímetro escucha ese `storage` y sigue el tema de `main`.

### 4.12 Feeds de calendario (ICS)

Tres capas en `src-tauri/src/calendar/`, y la separación es lo que hace testeable
la parte difícil:

| Capa | Qué hace | Pureza |
|---|---|---|
| `fetch` | descarga el `.ics` con `reqwest` | lo único que toca la red |
| `ics` | interpreta el texto a `IcsEvent` | puro: se prueba con fixtures |
| `repo::import_events` | escribe las tareas | puro sobre `&Connection` |

`commands::sync_calendar_feed` es el pegamento y **no decide nada**: baja,
interpreta, importa y sella. Si aparece una regla ahí, está en la capa
equivocada.

**Las decisiones de interpretación**, que son las que definen qué hace la
feature:

- **Las series se expanden**, en una ventana que va de **hoy a tres semanas**
  (`ics::ventana`). Sin expandir, un standup semanal se importa una vez y no
  vuelve a aparecer. **Nada del pasado**: una reunión de la semana pasada que
  nunca se trackeó no aporta a la review y solo ensucia el tablero con algo que
  ya no se puede hacer; las que sí se trabajaron están en la base con su tiempo y
  el import no las vuelve a tocar.
- **Una clave por instancia**: `calendar_uid` es `UID#<instante local>` para las
  ocurrencias de una serie, y el `UID` pelado para un evento suelto. El `UID` de
  un evento recurrente es **uno solo para todas sus repeticiones**, así que con
  el `UNIQUE(feed_id, calendar_uid)` usarlo pelado colapsaría el mes en una fila.
  Una instancia editada llega como un VEVENT aparte con `RECURRENCE-ID`: su clave
  es la de la repetición que reemplaza, así el upsert deja una sola.
  - **El `TZID` del `RECURRENCE-ID` vive en sus parámetros, no en su valor.**
    `property_value` devuelve el valor pelado, y leerlo así lo interpreta en la zona
    **del computador**: en cuanto tu máquina no está en la misma zona que el
    calendario, la clave de la instancia editada deja de calzar con la de la
    repetición y la reunión movida sale **dos veces** en la semana. Se lee con
    `ev.properties().get("RECURRENCE-ID")` y su parámetro `TZID`. Sin `TZID` el
    valor es flotante y ahí sí se lee en local, que es lo que manda el estándar.
    Esto estuvo roto desde el primer commit y no se notó porque la máquina de
    desarrollo y las fixtures comparten zona; lo delató el primer tag, porque **CI
    corre en UTC**.
- **Todo se convierte a hora local** (`ics::to_local`), y las tres formas de ICS
  —UTC con `Z`, con `TZID`, y flotante— tienen que aterrizar en la misma regla.
  Cortar el timestamp por los primeros 10 caracteres da el día UTC: un evento de
  la tarde se iría al día siguiente. Es el mismo error que ya se pagó en
  `completeAndAdvance` y en `timeByDay`.
- **Día completo = sin reloj**: sin `scheduled_time`, sin `event_start`/`_end` y
  sin `estimated_minutes`. Un feriado no son 24 horas trabajadas, y con la regla
  3 del rollup semanal lo serían.
- **`STATUS:CANCELLED` se descarta.** `PARTSTAT=DECLINED` **no**: para saber cuál
  de los invitados eres tú hace falta tu email en `settings`, así que hoy una
  reunión rechazada se importa igual. Es una limitación conocida, no un olvido.
- **`import_as_tasks = 0` baja el feed pero no escribe**, para que una URL
  revocada siga apareciendo como error en vez de quedar muda.

**El link de la reunión** vive en `tasks.meeting_url` (migración 4). Se busca en
`X-GOOGLE-CONFERENCE` (lo que usa Google para el Meet), `CONFERENCE` (RFC 7986),
`LOCATION` si es una URL (Zoom y Teams), y por último la primera URL de la
`DESCRIPTION` **con host de videollamada conocido**: esa lista existe porque la
descripción de Google trae además links de ayuda y de adjuntos, y sin filtrar el
botón "Entrar" abriría cualquiera. Va en **columna propia y no dentro de
`notes`** porque las notas son del usuario y la sincronización las pisaría cada
15 minutos; con columna aparte el link se puede refrescar sin destruir nada.

Se abre con **`tauri-plugin-opener`** (`abrirExterno` en
`features/calendar/MeetingLink.tsx`), no con un `<a target="_blank">`: dentro del
webview un anchor externo **no navega a ninguna parte** y el click se traga sin
error. Necesita `opener:allow-open-url` en `capabilities/default.json`, con la
lista de esquemas permitidos. Los links detectados en las notas pasan por el
mismo camino, porque tenían el mismo problema en silencio.

**El canal por defecto del feed** (`default_category_id`) se le pone a cada
reunión que entra, y además **a las que ya estaban importadas sin canal**
(`apply_default_channel`, que corre al guardar el feed). Sin esa segunda
parte, elegir el canal solo valía para lo que entrara después y había que
etiquetar a mano lo ya importado, que es justo el trabajo que el default viene a
evitar. **Solo toca las que tienen `category_id IS NULL`**: una reunión que
moviste de canal a mano no se pisa, ni acá ni en la sincronización.

**Descripción y participantes** (`event_description`, `attendees`, migración 5)
siguen la misma regla que el link: son del feed, no tuyos, así que van en
columnas propias y la sync las refresca sin tocar `notes`. `attendees` guarda
**JSON** y no una tabla aparte porque es un dato de solo lectura que siempre se
muestra completo junto a su tarea; un JSON ilegible se lee como "sin
participantes" en vez de tumbar la lectura de la tarea. El organizador va
primero y marcado, y si además está invitado se deduplica por correo (Google lo
manda en las dos propiedades).

> **Un calendario compartido "ocultando los detalles" no trae nada de esto.** Es
> la restricción de Google —y la que suele imponer un Workspace que no permite
> compartir hacia afuera con detalle—: el feed emite eventos con `SUMMARY:busy`
> y **sin** descripción, invitados, ubicación ni link de reunión. Lo único
> aprovechable es cuándo y cuánto duran. No hay nada que la app pueda hacer con
> eso: el dato no existe del otro lado. **Para tener detalles hace falta la
> dirección secreta del calendario**, que es lo único que emite el feed completo.

**En la UI:**

- En la tarjeta, la **hora es un label** con el mismo diseño que ACTUAL/PLANNED
  pero con su propio color: es información de otra naturaleza —cuándo, no
  cuánto—. El **icono de calendario va junto a la hora**, no al título: la hora
  es justamente lo que no se puede tocar en una reunión. Un evento de día
  completo no tiene hora, así que su label dice "todo el día" — sin esa
  excepción perdía su marca de origen por completo.
- En el detalle, un bloque de solo lectura **arriba de las notas**, en el orden en
  que uno lo necesita antes de una reunión: hora ("4:00 PM - 4:30 PM"), link para
  entrar con el código de sala, participantes, y descripción. Las notas propias
  van después de una línea divisoria. **Focus muestra exactamente lo mismo**
  (`CalendarEventCard`), con las notas y el canal editables: es la pantalla en
  la que estás cuando empieza la reunión, y tener que abrir otra para saber por
  dónde entrar no tiene sentido. Lo que Focus **no** tiene es eliminar — un botón
  de borrar al lado del play es un accidente esperando.
- Los **participantes son un punto de color y un nombre**, sin avatares ni
  iniciales: la app no tiene fotos y unas letras en un círculo compiten con el
  nombre. Verde asiste, azul quizás, rojo no asiste, gris sin responder — y cada
  uno con su texto accesible, porque cuatro estados distinguidos solo por color
  son cuatro estados indistinguibles para quien no ve bien los colores, y "no va"
  contra "no respondió" es justo la diferencia que importa.
- La descripción de Google llega con **HTML crudo adentro** (`<br>`, `<li>`,
  `<b>`). Se convierte a texto legible al mostrarla (`descripcion.ts`): las
  etiquetas de bloque pasan a salto, los `<li>` a viñeta, el resto se descarta y
  las entidades se decodifican. **No se inyecta como HTML** —vendría de un
  tercero y sería un XSS por una invitación de calendario— ni se renderiza como
  markdown, que no es lo mismo que HTML. La conversión va **al mostrar y no al
  importar**, para no perder el original.

**El upsert no pisa lo que tocaste a mano.** Actualiza título, fecha, hora y
horario del evento —lo que cambia cuando alguien mueve la reunión— y deja
intactos `status`, `actual_seconds`, `position`, `category_id` y `notes`. Si no, cada
pasada del poller (cada 15 minutos) tiraría a la basura el trabajo hecho sobre
una tarea de calendario. La categoría por defecto del feed es un **valor
inicial**, no una imposición.

**`last_synced_at` se sella también cuando falla**: significa "cuándo lo intenté",
y es lo que el poller usa para no reintentar en bucle contra un feed caído. Lo
que distingue el resultado es **`last_error`** (migración 3): sin esa columna, un
feed con la URL revocada se ve idéntico a uno sano. El error nunca se traga —va a
la columna, se muestra en Configs y además sale por `eprintln!`— y **nunca
incluye la URL**, que es una credencial.

**La descarga pide gzip** y no intenta peticiones condicionales, porque el
endpoint de Google **no emite `ETag` ni `Last-Modified`** e ignora un
`If-Modified-Since` (medido). Un ICS comprime ~10×, así que gzip es la única
palanca que hay para gastar menos por pasada. Si algún día se agrega otro
proveedor que sí mande validadores, ahí vale la pena guardarlos por feed.

**El poller** corre en Rust (`tauri::async_runtime::spawn`), despierta cada
minuto y sincroniza los feeds a los que ya les toca según su `poll_minutes`
(mínimo **2**, default **5**). Google **no documenta** ningún límite para el
endpoint `.ics` —ni la página de cuotas de la API ni la de "use limits" lo
mencionan— pero sí throttlea acciones repetidas sin publicar los números, así que
el piso no baja de 2. El endpoint tampoco emite `ETag` ni `Last-Modified`, o sea
que **no admite peticiones condicionales**; la única palanca para gastar menos es
gzip, que en el feed de prueba llevó 120 KB a 12 KB.

**Además se sincroniza al abrir la app y al volver a la ventana**
(`useCalendarSyncRuntime` en `src/lib/calendarSync.ts`). Eso es lo que de verdad
hace que se sienta al día: el momento en que importa es cuando te sientas a
mirarlo, y el poller solo mira el reloj.

**Pero con freno: `syncIfStale` y un mínimo de dos minutos** (`MIN_AUTO_MS`, el
mismo piso que `poll_minutes`: el intervalo más agresivo que se puede configurar a
mano es también lo más seguido que tiene sentido pegarle al volver a la ventana). La
sincronización del front va con `force`, que se saltea el `is_due` de Rust, así
que sin el freno **cada cambio de foco bajaba todos los feeds enteros** — y sin
validadores no hay petición condicional que lo abarate. Tres detalles que hacen
que el freno no se vuelva el problema:

- **El botón no lo mira.** Pedir la sincronización a mano es pedirla ahora.
- **El reloj es `ultimaSync`, el sello que escribe Rust**, no un contador de la
  sesión. Así el freno cuenta también el botón y sobrevive a recargar la ventana:
  abrir una segunda ventana recién sincronizada no vuelve a salir a la red. Por
  eso, además, en el montaje el `refresh` va **antes** del `syncIfStale`: al revés
  la marca todavía es `null` y la primera pasada saldría siempre.
- **Una marca ilegible o en el futuro no frena nada.** El caso raro cae del lado
  de sincronizar: un freno que se equivoca al revés deja el calendario mudo para
  siempre y sin ningún síntoma.

**El estado de la sincronización es un store compartido** (`useCalendarSync`),
no estado local de cada vista, porque hay **dos** botones —vista semana y
Configs— que tienen que ser el mismo botón: si uno corre, el otro se bloquea y
los dos muestran la misma antigüedad. `ultimaSync` es la marca más reciente entre
todos los feeds. El store además garantiza **una sola sync a la vez**, y libera el
botón en un `finally` para que un feed caído no lo deje trabado hasta reiniciar.

**El alta de un calendario es un modal**, no una fila editable. Inline fallaba por
una razón concreta: con cuatro campos y autosave al salir de cada uno, cualquier
orden de llenado guardaba a medias (pasar de Nombre a URL hacía desaparecer la
fila). El alta es una operación con todos los datos; el autosave queda para editar
lo que ya existe. **La URL no se puede editar** desde la lista: es lo que
identifica al feed, y cambiarla en un campo `password` con autosave es la receta
para apuntar a otro calendario sin darse cuenta. Cuando escribió algo emite `sunrise://calendar-synced`, y el front
lo recibe con `useCalendarListener` llamando **`markDataStale()`, no
`bumpData()`**: el evento de Tauri ya llega a las dos ventanas, así que avisar de
vuelta por `localStorage` sería el ping-pong que §5.3 vino a evitar.

**Borrar un feed no borra sus tareas** (`feed_id` es `ON DELETE SET NULL`): pasan
a ser tareas normales. Con cascada se irían reuniones ya completadas y con tiempo
trackeado encima.

**Lo que desaparece del feed** lo resuelve `reconcile_feed`, que corre después
de cada import con los UIDs que este acaba de ver. La regla es **asimétrica a
propósito, porque borrar es barato de equivocarse y caro de deshacer**. Se borra
solo lo intacto y por venir:

**Una tarea con el taxímetro corriendo queda intocada**, ni borrada ni
`ORPHANED`. Las dos la sacan del tablero, y con el timer andando eso deja la
cuenta corriendo sobre algo que ya no puedes ver ni detener desde ahí. Al
pausar, la siguiente sincronización la resuelve con las reglas normales.

Del resto, se borra solo lo intacto y por venir:

| Condición | Por qué |
|---|---|
| sin `time_entries` | ese tiempo es tuyo; que alguien cancele la reunión en Google no borra una hora que ya trabajaste |
| no completada | si la marcaste hecha, es historia y la review la necesita |
| `scheduled_date >= hoy` | **la ventana arranca hoy**, así que cada mañana las reuniones de ayer dejan de venir en el feed: sin este filtro, la primera sync del día borraría toda tu historia de reuniones |

Lo que no se puede borrar se reparte en dos, según si llegaste a trabajarlo:

| Estado | Qué le pasa | Por qué |
|---|---|---|
| con `time_entries` o `DONE` | **se libera del feed**: `feed_id = NULL`, `calendar_uid = NULL`, sigue `ACTIVE` | dejó de ser del calendario y pasó a ser tuya. Precedente: borrar un feed entero ya deja sus tareas así vía `ON DELETE SET NULL` |
| sin trabajar | queda **`ORPHANED`** | nunca fue tuya; sale de los listados sin borrarse |

Con eso `ORPHANED` significa **una sola cosa**: "no se trabajó y no se puede
borrar". Antes significaba a la vez "no la planifiques" y "no la muestres", y esas
dos no siempre van juntas: una reunión que hiciste, trackeaste y completaste
desaparecía del tablero en la primera sincronización del día siguiente —basta con
que pase la medianoche, porque la ventana de import arranca hoy.

`calendar_uid` se limpia junto con `feed_id`: si el evento vuelve al feed, entra
como una tarea nueva en vez de chocar con el `UNIQUE(feed_id, calendar_uid)`.

La **migración 6** aplica la misma regla a las que ya habían quedado escondidas
antes del cambio. Sin ella el arreglo solo valdría hacia adelante: la consulta del
reconciler filtra `source_state = 'ACTIVE'`, así que nunca volvería a mirarlas.

### 4.13 Rail de calendario (`CalendarRail`)

La agenda del día, en una columna a la derecha de la lista, para **planificar
alrededor** de lo que ya está comprometido. Se monta de dos formas:

- **Fija en `TodayView`**, al lado de la única columna del día.
- **Superpuesta en `WeekView`** (`rail--overlay`), detrás del primer icono de la
  **tira de paneles** (`SideDock`). En la semana no vive abierta: son siete
  columnas y el espacio es de las tareas. Muestra **hoy** si la semana visible lo
  contiene, y el lunes si no; **clickear el título de una columna** cambia el día
  que muestra (y abre el panel si estaba cerrado), que es lo que permite proyectar
  un día que todavía no llega. El click va en la cabecera y no en la lista: la
  lista es la zona de drop del board y competiría con el arrastre. Al cambiar de
  semana la elección se descarta —ese día ya no está en pantalla. Mientras está
  abierta tapa la última columna, que por lo tanto no recibe drops. Es aceptable
  porque la agenda se abre para **consultar** a qué hora hay algo, no para
  arrastrar: se cierra y se arrastra. Un rail que se corriera para dejar la columna
  libre movería las siete de lugar cada vez que se abre.

**La tira (`SideDock`, `.dock`)** es una columna de iconos **permanente** pegada
al borde derecho: no se superpone, y los paneles se abren a su izquierda
(`rail--overlay` y `.backlog-panel` tienen `right: 44px`, el ancho de la tira).
Recibe sus botones como lista porque va a tener tres —agenda, backlog y objetivos
de la semana—, pero **solo se dibujan los paneles que ya existen**: un icono que
no hace nada al apretarlo enseña que la barra no responde. El de objetivos llega
con M3.5, que ya calcula ese avance para la review.

**Se abre uno a la vez** (`panel: "agenda" | "backlog" | null` en `WeekView`), y
no es una preferencia: los dos se montan en el mismo lugar, así que dos abiertos
se apilarían. Por lo mismo, **clickear la cabecera de un día trae la agenda**
incluso con el backlog abierto — el click es un pedido de ver ese día, y dejarlo
sin efecto visible sería peor que el cambio de panel.

Daily planning (M3.4) lo usa con las mismas props.

El cálculo está separado del render en `railLayout.ts` (`buildRail`), puro y
testeado: entra la lista de tareas del día y salen bloques en minutos.

**Tres clases de bloque**, y el orden en que se colocan importa porque cada una
ocupa espacio para la siguiente:

| Tipo | Cuándo | Regla |
|---|---|---|
| `REAL` | hay tiempo trackeado ese día | hora y duración del **taxímetro**; es un registro, no se mueve ni se parte |
| — | …y además le falta para su estimado | **lo que falta se sigue proyectando** como cualquier pendiente, y se parte alrededor de lo que venga |
| `FIJO` | tiene `scheduled_time` y no se trabajó | va donde dice; es un compromiso |
| `PROYECTADO` | el resto | lo pone el rail; borde punteado |

- **Lo trabajado manda sobre lo estimado.** Una reunión de 15 minutos que
  arrancó 46 tarde y duró 18 se dibuja a las 23:46 durando 18, no a las 23:00
  durando 15: en ejecución las cosas duran lo que duran, y el rail muestra el
  día, no el plan del día. En cuanto le das play a algo, su lugar pasa a ser la
  hora real —con piso de un minuto, para que el bloque no salte de un lado a
  otro de la grilla durante los primeros 30 segundos.
- **`REAL` también ocupa** para la proyección: sin eso se dibujaría trabajo
  pendiente encima del rato que efectivamente pasaste en algo.
- **Trabajar algo no lo agota.** Una tarea de 45 minutos con 19 hechos deja su
  bloque `REAL` donde ocurrió **y** proyecta los 26 restantes, partidos si hace
  falta. Al principio lo trabajado reemplazaba a la tarea entera y una tarea
  empezada desaparecía del resto del día justo cuando más importa saber si el
  tiempo alcanza. El resto solo se calcula si la tarea **tiene estimado propio**:
  sin él `DURACION_POR_DEFECTO` es un número inventado por el rail, y decir "te
  faltan 11 minutos" sobre algo que nunca estimaste es peor que no decir nada.
  Una completada no debe nada, por mucho que el estimado fuera mayor.
- **Nada pendiente se proyecta antes de lo ya trabajado.** El arranque de la
  proyección es el mayor entre el inicio de la jornada, "ahora" (solo hoy) y el
  fin del último bloque `REAL`: planificar hacia atrás de lo que ya hiciste no
  significa nada. Consecuencia a tener presente: trabajando **antes** del inicio
  de la jornada, lo pendiente se proyecta desde ahí y no desde "ahora" —a las
  00:30 el resto del día aparece a partir de las 9:00.
- **Las completadas con tiempo trackeado se quedan**, con un punto verde. El
  rail responde "qué me queda" y también "qué llevo hecho". *Limitación
  conocida*: una tarea completada **sin** tiempo trackeado y sin hora no aparece
  — no hay ningún dato que diga cuándo ocurrió, y ubicarla sería inventarlo.
- El dato viene de **`repo::day_work`** (una fila por tarea con el primer
  inicio del día y los segundos cerrados) más los segundos de la corrida abierta,
  que el front toma del taxímetro porque todavía no están escritos.
- **La grilla es siempre el día completo (24 h).** La jornada solo pone **dos
  líneas**: marcan que el tiempo se acaba, no bloquean nada. Trabajar a las 7:00
  o a las 22:00 se ve igual de bien. Al montar, el rail se desplaza al inicio de
  la jornada (en el frame siguiente: al correr el efecto el contenedor puede no
  tener alto todavía y `scrollTop` se recortaría a 0).
- **La hora sale de `scheduled_time` y `estimated_minutes`, nunca de
  `event_start`/`event_end`.** No es un atajo: el importador guarda esos dos en
  RFC 3339 **UTC**, así que cortarles caracteres para sacar la hora movería una
  reunión de la tarde de bloque. Es el mismo error que ya se pagó en
  `completeAndAdvance` y en `timeByDay`. `scheduled_time` viene de
  `local_start` y `estimated_minutes` es la duración: los dos campos locales
  alcanzan y no queda conversión que hacer.
- **Día completo ⇒ franja arriba de la grilla, no un bloque.** Un feriado no
  tiene dónde caer en la escala de horas (§4.12, "día completo = sin reloj").
  Una tarea **a mano** sin hora no entra en esa franja: no es de día completo,
  es una tarea sin hora, y va a la proyección (abajo).
- **Proyección: el rail muestra el día entero, no solo lo comprometido.** Las
  tareas sin hora se encadenan en los huecos que dejan las fijas, en **orden de
  tablero** (`position`, el que ya arreglaste arrastrando cards). Responden "si
  sigo mi orden, ¿dónde cae cada cosa?", y se dibujan con borde punteado porque
  esa hora la puso el rail.
  - **Se parten alrededor de las reuniones.** Media hora libre antes de una
    reunión y una tarea de una hora ⇒ media hora antes y media después, no una
    hora entera empujada al otro lado. Saltar el hueco tiraría a la basura tiempo
    real de trabajo y proyectaría un día más corto del que se tiene.
  - Un hueco menor a `TRAMO_MINIMO` (15') **se deja vacío**: cinco minutos entre
    dos reuniones no son un rato de trabajo, y varios así astillarían la tarea
    hasta volver ilegible el rail. La regla es "saltar el hueco", nunca "achicar
    la tarea": el total proyectado siempre suma el estimado.
  - Cada tramo lleva `parte`/`partes` y el bloque muestra `1/2`. Sin eso, una
    tarea partida deja dos bloques con el mismo título a distinta hora y no hay
    cómo saber que son la misma — sobre todo en el layout compacto, que trunca.
    La clave de React es `taskId#parte` por lo mismo: con solo `taskId`, React
    descartaría todos los tramos menos el primero.
  - **La proyección NO escribe `scheduled_time`.** Ese campo es un dato
    persistido —lo escribe el import y ordena la cola de Focus—, así que una hora
    inventada no puede terminar ahí: después no habría cómo distinguir la que
    puso el usuario de la que adivinamos. Se calcula al dibujar y muere ahí.
  - **En el día de hoy arranca en "ahora"**, no en `work_start`: a las 2 de la
    tarde no tiene sentido proyectar hacia la mañana. El reloj entra **por
    parámetro** (`ahoraMin`), para que `railLayout.ts` siga siendo puro.
  - **Lo completado no se proyecta**: el rail responde "qué me queda por
    delante". Una reunión completada sí se queda, porque su hora fue un
    compromiso real.
  - **Si el día no cabe, la proyección se sale de la jornada** y la grilla se
    estira: ese desborde es justamente el aviso. Lo que no cabe antes de
    medianoche **se descarta entero, no a medias**: estirar al día siguiente
    sería mentir sobre en qué día cae, y dejar solo el primer tramo se leería
    como un error de ubicación en vez de "ya no te queda día".
- **Los carriles se reparten por grupo de solapados, no por el día.** Si a las
  10 hay tres reuniones juntas y a las 16 una sola, la de las 16 usa todo el
  ancho; contar el máximo del día dejaría la tarde en blanco.
- **La jornada (`work_start`/`work_end`) define la grilla pero no recorta:** una
  reunión a las 7:30 estira el rango hacia arriba en vez de desaparecer. Una
  jornada invertida cae a los defaults, porque si no el rail queda de altura cero
  y se ve vacío sin decir por qué (`workHours` en `lib/settings.ts`).
- **El panel de la semana cuelga de `.week__body`, no de `.board`.** El board
  tiene scroll horizontal: un absoluto colgado de él se va de pantalla al
  desplazar las columnas. Y queda **debajo de la barra**, no sobre ella, o
  taparía el mismo botón que lo cierra. Escape también lo cierra, pero **solo si
  no hay un modal abierto**: `TaskModal` escucha en `window` igual que él y
  `preventDefault()` no frena a los demás listeners de la ventana, así que un
  Escape cerraría los dos de una.
- **Es de solo lectura y queda fuera del `DndContext`.** Soltar ahí tendría que
  escribir `scheduled_time`, y `boardCollision` está afinada para el board
  (§4.3). Un bloque solo abre el detalle.
- Recibe **la misma lista** que la columna del día, para que las dos lecturas del
  mismo día no puedan divergir.
- La línea de "ahora" solo se dibuja en el día de hoy, y relee el reloj en vez de
  acumular: macOS agrupa los temporizadores al suspender (mismo criterio que
  `checkDayChange`, §5.3.1).

### 4.14 Planificación diaria (`DailyPlanningView`)

**Dos pasos** a la izquierda y el rail (§4.13, mismas props que en Today) a la
derecha, en `/daily-planning`. Todo se centra, y las columnas del paso 2 miden
**lo mismo que una columna de la semana** (el `flex-basis` de `.day-col`): una
card estirada al doble deja de leerse como la misma card, así que el espacio que
sobra queda como aire en vez de repartirse.

1. **Cómo cerró ayer** — una portada con el día, `cerradas/total`, planificado y
   trabajado, y debajo las tareas en **las mismas cards** del tablero: las que
   quedaron abiertas (con traer a hoy o mandar al backlog) y las cerradas.
2. **Qué hay para hoy** — el día y el **backlog** como dos columnas del mismo
   tablero, arrastrables entre sí, con la agenda al lado.

Eran tres: "armar el día" y "ver si cabe" se juntaron porque son el mismo gesto
—se saca algo justamente porque no cabe— y separarlos obligaba a ir y volver para
tomar una sola decisión. Los pasos **se pueden saltear** (la barra de arriba es
navegación, no un trámite): es un guion, no un formulario por etapas.

**La carga del día vive en la barra de abajo, en una línea** (`.cap-line`): el
total, la barra con el semáforo y el mensaje. Como card ocupaba media pantalla
para decir dos números, y estaba en el paso equivocado — se mira **mientras** se
ordena, no al final.

**El conteo del día es directo, y puede serlo por cómo quedó §4.2**: la
degradación diaria **preserva justamente el día que el ritual repasa**, así que
no hay tareas que se hayan ido de ahí sin que las vieras. Mientras el carry-over
arrastraba todo a hoy, esto costó dos parches seguidos y el día igual se veía más
corto y más exitoso de lo que fue.

**Entrar a un día ya planificado abre un aviso** (`role="alertdialog"`), con
salir a la semana o revisar igual, y **dice a qué hora planificaste** — o dice que
la marca no trae hora, que es distinto de callarlo. La hora sale de lo guardado y
no del reloj de ahora: un diálogo que muestre la hora actual se ve perfecto justo
el día en que se prueba. Era un sello en la cabecera y se leía como
decoración: el ritual está para hacerse una vez, y volver a entrar suele ser sin
querer. Se dispara **una vez por día** —el `ref` guarda para qué fecha se
decidió, así una sesión que cruza la medianoche vuelve a preguntar— y espera a
que los ajustes estén cargados (`loaded`), o el diálogo saltaría un frame tarde,
con la vista ya dibujada. Comparte las clases `.dialog*` con la confirmación de
⌘Q (§4.10) y agrega `.dialog--hero` —icono en círculo y todo centrado—: un aviso
que no pediste tiene que verse como un aviso, no como un formulario.

**Y se puede desmentir.** "Volver a planificar hoy" (`.dialog__deny`) borra
la marca —deja `""`, que `planMark` lee como ausente— y sigue el ritual. Antes el
aviso solo se podía cerrar, así que una marca escrita con un gesto que el usuario
no reconoce como planificar dejaba a la app afirmando algo indiscutible. Va
**debajo del cuerpo y arriba de la fila de botones**, y **se ve como texto y no
como botón**: corrige la frase que acaba de afirmar algo en vez de sumar una
tercera acción, y un botón más en la fila competiría con las dos decisiones de
verdad (además de no caber en 380px sin apilarse).

**No guarda nada, y el botón del final no es un "Guardar".** Todo lo que se toca
acá ya persiste solo —autosave es la convención del proyecto (§7)—, así que
"Empezar el día" es un **terminador de ritual**: sella `planned_at` con la fecha
y la hora, tira confeti y te devuelve a la semana. Si se lee como un save, alguien lo va a
"arreglar" o lo va a borrar por inútil.

**El ritual no mueve nada solo.** La degradación (§4.2) ya corrió al montar
cualquier vista, pero preserva el día que se repasa: lo que ves es el día tal
cual quedó. Quien planifica decide si la tarea va a hoy, al backlog o se queda.

- **El backlog es una columna del tablero** (`BacklogColumn`), no una lista
  aparte: `scheduled_date IS NULL` es lo único que lo define (§3.2), así que
  sacar algo del día es **soltarlo al lado** y traerlo es soltarlo en el día. Por
  eso reusa `{ type: "column", date: null }` y el `onDragEnd` no necesita saber
  que esa columna es especial. **No hay botones de "mañana" ni "al backlog" ahí**:
  el arrastre ya lleva la acción y la intención, y dos caminos para lo mismo
  obligan a mantener los dos. (Es media Mej.11 hecha: falta montarlo en la
  semana, donde el `DndContext` abarca siete columnas.)
- **`date: null` es un destino válido, no "no hay destino".** La vista semana
  puede tratarlo como cancelación porque ahí ninguna columna es el backlog; en el
  ritual eso descartaría el drop.
- **El repaso mide lo trabajado con `day_work`, no con `actual_seconds`**:
  ese campo es el total de la tarea, y una arrastrada de tres días lo trae todo
  junto — el repaso pregunta por **ese** día (misma Regla 2 de M3.5).
- **El paso 1 repasa el último día con tareas, no "ayer" a secas.** Un lunes,
  ayer es domingo y está vacío, mientras que lo que hay que cerrar es el viernes.
  Se lee una ventana de 7 días hacia atrás y se elige la fecha más reciente con
  algo (`lastDayWithTasks`) — **el mismo día que preserva §4.2**.
- **Es el único camino para rescatar una reunión.** La degradación no toca las de
  calendario, así que una reunión sin cerrar se queda en su día para siempre y
  ninguna vista de hoy la vuelve a mostrar; el botón "A hoy" del paso 1 es la
  única salida.
- **En el backlog del paso 2, las rescatadas se agrupan por día**: el rótulo dice
  "Desde el 18 ago" una sola vez para todas las de ese día, y las que guardaste a
  propósito quedan abajo bajo "Guardadas". La fecha **no** se repite bajo cada
  card —era lo que se leía mal (Mej.21): con tareas de días distintos eran N
  fechas sueltas colgando entre las cards, y la fecha es justamente lo que uno
  compara.
  Los rótulos van **dentro** del `SortableContext`: partirlo en uno por día
  rompería el arrastre entre grupos. Por lo mismo **el orden sigue siendo el de
  `position`, no la fecha**: si el orden intercala dos días, el rótulo del primero
  se repite más abajo, y eso es preferible a reordenar por debajo lo que acabas de
  mover a mano. Como lo que baja al backlog entra en posición 0, en el caso normal
  cada día sale una sola vez.
- **El semáforo pesa el día entero, no solo lo pendiente.** Completar tareas no
  puede ir apagando la alarma de un día sobrecargado: el día siguió siendo igual
  de largo, y si la carga se repite hay que verla. Lo pendiente se muestra
  aparte, que es la otra pregunta ("¿alcanzo con lo que queda?").
- **Las tareas sin estimar se cuentan y se avisan**, no se rellenan con un
  número: el medidor iría corto y nadie sabría por qué. Es la misma regla que el
  rail con `DURACION_POR_DEFECTO`.
- **Sin objetivo de capacidad (`target <= 0`) la holgura es `null`**, que no es
  lo mismo que "te sobra 0" — el mensaje lo dice en vez de mostrar un número.
- **La navegación queda pegada abajo** (`position: sticky`) mientras la columna
  de pasos scrollea: con una lista larga, "Siguiente" no puede estar al final del
  scroll.
- **El paso 2 usa la `DayColumn` de la semana**, sin copia: ordenar acá es
  ordenar allá, y ese orden es justamente el que proyecta el rail. Lo único que
  se oculta es la barra de progreso del día — se está planificando, no midiendo.
  Agregar tareas es el botón que la columna ya trae. El cableado de dnd-kit
  —sensores, `boardCollision`, overlay y el índice al soltar— vive en
  **`DayBoard`**, compartido con Today; la vista semana **no** lo usa, porque ahí
  el `DndContext` envuelve las siete columnas y eso es lo que permite cruzar de
  día.
- **El detalle busca la tarea en hoy, en los días previos y en el backlog.**
  `useBoard` solo carga hoy, así que abrir una del paso 1 no encontraba nada y el
  click quedaba sin efecto — peor que no ser clickeable.
- **Las cards del repaso son las mismas del tablero** (`TaskCardStatic`: la card
  de siempre, sin arrastre — misma marca de "corriendo" y mismo
  `hidePlaceholders` que la arrastrable; lo único que le falta es el
  `useSortable`). Una lista de títulos al lado de un tablero de cards
  se lee como otra app; y soltar ahí no significaría nada, porque el día anterior
  ya pasó.
- El confeti se llama **imperativamente** desde `lib/confetti.ts`:
  `canvas-confetti` cuelga su `<canvas>` de `document.body` y así sobrevive al
  `navigate` que viene enseguida. Un componente React con el canvas adentro se
  desmontaría con la ruta. Vive en un módulo propio además porque el canvas de
  jsdom no implementa `getContext`: es lo único mockeable en los tests.

Las cuentas están en `dailyPlan.ts` (puro y testeado), separadas del render por
la misma razón que `railLayout.ts`.

### 4.15 Weekly review (`WeeklyReviewView`)

La semana mirada hacia atrás, en `/weekly-review`: qué se cerró, cuántas horas se
fueron y en qué. Se navega semana a semana (`← · Esta semana · →`).

**Todo el cálculo llega hecho de `repo::weekly_rollup(week_start)`, un solo
comando.** No es comodidad: la atribución por día es **local** y las reglas de
abajo son la parte frágil del milestone, así que viven donde se prueban con
SQLite en memoria. Devuelve los 7 días (trabajado, planificado, cerradas, sin
estimar), las celdas **día × categoría** —con el contexto ya resuelto— y las
tareas completadas.

Las tres reglas que lo definen:

- **Regla 2 — el tiempo se atribuye por `time_entries.started_at`**, nunca por
  `scheduled_date`. Mover una tarea a otra semana no puede cambiar las horas de
  una semana pasada: ya ocurrieron. Cada entrada cae entera en un día porque
  `stop_timer` las parte en la medianoche local (I3), así que acá solo se agrupa.
- **Regla 3 — una reunión sin ninguna `time_entry` cuenta su duración de
  evento** (`event_end - event_start`): estuviste ahí aunque no encendieras el
  taxímetro. **Las entradas reales priman** —basta una para que deje de usar el
  respaldo, o la reunión contaría dos veces—, se acredita al día local de
  `event_start` (no a `scheduled_date`, que pudiste mover) y **solo si ya
  empezó**: una reunión del viernes no puede aparecer trabajada un lunes.
- **El rollup NO filtra `source_state = 'ACTIVE'`** para el tiempo (I7). Las
  `ORPHANED` existen justamente para el historial y la review; filtrarlas
  borraría horas reales de semanas pasadas.

Las tres viven en **`work_by_day`**, el núcleo compartido con la bitácora
(§4.16): la semana lo agrupa en celdas día × categoría, la bitácora en timelines.

**Lo planificado sí sale de `scheduled_date`, y esa asimetría es correcta**:
replanificar una tarea mueve su barra de plan pero no la de horas. Son dos
preguntas distintas —"qué dije que haría ese día" y "qué hice ese día"—, y
alinearlas obligaría a mentir sobre una de las dos.

**La cabecera lleva las cifras**, entre el título y la navegación de semanas:
cerradas, trabajado, planificado y el avance de objetivos, cada una como **un
chip con su punto de color**. El punto no es adorno: el gris de "planificado" es
el mismo de la marca punteada del gráfico, así que ata la cifra a lo que
representa más abajo. Tres intentos anteriores se descartaron por la misma razón
—no separaban la cifra del título—: banda salvia a lo ancho (se leía como un
aviso), texto suelto con filetes y caja hundida. Como banda propia a lo ancho decían cuatro números y se
comían el alto que necesita "lo que se cerró", que es la parte que se mira. Por
lo mismo **los objetivos son la tercera columna de la fila de gráficos** —son una
lista corta— y no una sección aparte. **Ese panel está siempre**, con o sin
objetivos: una semana sin ninguno es un dato de la review, y esconderlo lo haría
pasar por un olvido. Vacío muestra el icono y "Semana sin objetivos"; con datos,
un tilde por objetivo cumplido.

Detalles que ya costaron algo:

- **El piso en 0 va por tarea y por día.** Un ajuste manual hacia abajo se
  guarda como una entrada con delta negativo (I2); clavar el piso más arriba
  dejaría los segmentos de una barra sin sumar su total, y no ponerlo dibujaría
  un segmento negativo. Desde Mej.29 el recorte se reparte en la escritura y
  ningún día debería llegar acá en negativo: **el piso quedó como red para las
  bases que ya tienen filas viejas**, no como el mecanismo que hace cuadrar la
  cuenta. Que un día siga saliendo negativo es un dato, no algo que este piso
  tenga que arreglar.
- **`category_id IS NULL` tiene su propio grupo** ("Sin channel"), y una
  categoría borrada conserva sus horas. Con un JOIN interno el donut deja de
  sumar el total y nadie se entera.
- **El donut agrupa por contexto** (`parent_id ?? id`) y **las barras por
  channel**: de un vistazo importa el contexto, y al mirar un día importa el
  detalle. El contexto viene resuelto en SQL para no cruzar el árbol de
  categorías en cada render.
- **La escala de las barras es de la semana, no de cada día** (y nunca baja de
  una hora): con una escala por día, un sábado de 20 minutos se ve igual de alto
  que un martes de 8 horas.
- **Lo planificado es una marca punteada sobre la barra, no una segunda barra**:
  son dos medidas de la misma jornada, no dos jornadas.
- **Los gráficos son a mano** —divs para las barras, un `<svg>` con
  `stroke-dasharray` para el donut— aunque `recharts` esté instalado. El color de
  un channel es un **token de la paleta** (`var(--mint)`), y pasarlo como prop a
  una librería obliga a resolverlo a hex y a volver a resolverlo al cambiar de
  tema. Con CSS los dos temas salen gratis. En el donut el color va en `style` y
  no como atributo: los atributos de presentación de SVG no resuelven variables.
- **"Lo que se cerró" agrupa por `completed_at`**, no por `scheduled_date`: la
  pregunta es qué se terminó ese día.

**`weekly_rollup` toma su semana literal**: son los 7 días desde `week_start`,
sin encajar al lunes ISO. La vista siempre le pasa `weekDates(...)[0]`, y el
gemelo de `mockDb.ts` hace lo mismo — si uno de los dos encajara y el otro no,
devolverían semanas distintas.

**El detalle guarda la tarea abierta, no su id.** La vista lista solo lo cerrado:
destildar desde el modal saca la tarea de esa lista, y buscarla ahí dejaría el
modal desaparecido a media edición. Es el mismo bicho que costó un fix en §4.14,
con otra lista de origen.

Las cuentas de presentación están en `weeklyReview.ts` (puro y testeado). El
donut tiene su propio test de geometría: al dibujarlo a mano, que las porciones
sean contiguas y cubran la vuelta es responsabilidad nuestra, y un test de
agregación no lo ve.

> **Regla 2 también en la escritura (Mej.14).** `set_actual_seconds` estampa su
> entrada de delta en **el día de la tarea**, no en el día en que la corregiste:
> su `scheduled_date` con su `scheduled_time` si la tiene, mediodía local si no.
> Antes usaba `now()`, y ajustar a mano una tarea de la semana pasada le acreditaba
> las horas a hoy — la Regla 2 rota en el origen, no en la review. Sin fecha
> (backlog) o con fecha futura sigue siendo hoy: mañana no se trabajó.

> **Y un recorte se reparte entre los días trabajados (Mej.29).** Sellar el día
> correcto no alcanza cuando el trabajo está en varios: un timer olvidado cruza la
> medianoche y `stop_timer` lo parte en un tramo por día (I3.3), así que un recorte
> de 21 horas contra un día que solo tiene 14 lo dejaba en −7 y el piso en 0 de acá
> abajo se comía el sobrante **en silencio**. El día siguiente seguía mostrando las
> horas del timer olvidado, y la review contaba 15 horas de una tarea de 3.
> `spread_cut` reparte el recorte topándolo al saldo de cada día: **primero el día
> de la tarea** —la regla de arriba extendida al desborde— y después el resto del
> más reciente al más viejo, que es el candidato más probable a ser el que sobra.
> Si el recorte supera todo lo repartido, el sobrante **se descarta**: escribirlo
> igual para que la suma cuadre es el mismo bug otra vez, y el total de la tarea lo
> manda `actual_seconds` (I1), no las entradas.

### 4.16 Bitácora y cierre del día (`DailyHighlightsView` / `DailyShutdownView`)

Dos rutas y una sola idea: **la bitácora se escribe sola, y el shutdown es el
gesto de cerrar el día con tus palabras.**

**Daily highlights (`/daily-highlights`) — la bitácora.** Un día por entrada, del
más nuevo al más viejo (ventana de 30 días), centrada y **sin tarjetas**: el corte
lo hace un **separador con la fecha**, para que el feed se lea como un cuaderno.
A la izquierda los highlights como **línea de tiempo** (punto del color del
channel, unido por una línea), cada uno con su channel **arriba y más chico que el
título**; a la derecha los contadores, el timeline completo y el **donut de
channels, plegado por defecto** — es un detalle que se consulta, no algo que se
mire siempre. Sale de `repo::daily_log(to_date, days)`.

**Las dos vistas cuelgan de esa única llamada**, y por eso conviene saber cómo se
ve cuando falla: la bitácora se queda en "Cargando la bitácora…" para siempre
—`days` nunca deja de ser `null`— y el shutdown renderiza entero pero vacío, sin
chips y diciendo "Todavía no cerraste nada hoy". Es lo que pasó cuando el
renombre a inglés dejó la clave del `invoke` en `to` contra un parámetro
`to_date` (§2.2): dentro de Tauri la llamada se rechazaba completa, y como las
dos suites corren contra el mock, nada se puso rojo. Un cargando eterno acá
significa que el comando ni siquiera respondió.

**Los contadores son chicos a propósito.** Van en `h:mm` (`formatMinutes`, el
mismo formato de las cards) y en un cuerpo menor que el contenido: son un dato de
referencia, no lo que se viene a leer. El contenido son las tareas y lo que
escribiste sobre ellas.

**El punto de cada hito va centrado verticalmente** sobre la fila entera, con o
sin channel y con o sin resumen: alineado arriba, cada hito parecía arrancar a una
altura distinta. **Su color es el del channel** (`var(--<token>-ink)`), el mismo
que el `#tag` de las cards del tablero: es el idioma de color de la app, no un
estado. Un hito siempre está cerrado, así que un tilde verde no distinguiría nada.
Y **hacer click en un hito abre el detalle** de esa tarea.

**Incluir es curar.** Un día puede tener ocho cerradas y solo cinco que merezcan
una línea: los highlights son las que **subiste** desde el shutdown, y el resto
queda afuera. Lo que las separa es tener **fila** en `day_task_notes`
(`note != null`), **no** que el texto tenga contenido: una tarea recién incluida
no tiene resumen todavía y así y todo es un highlight. Si no incluiste ninguna
salen todas, porque una entrada vacía en un día en que sí trabajaste es peor que
mostrar de más. Y **lo que queda afuera se cuenta** ("y 3 más, sin resumen"):
esconderlo en silencio haría leer el día como más chico de lo que fue. El día
**completo** sigue a la derecha, en el timeline — que es la diferencia entre las
dos columnas.

**Se llena sola, y eso es la regla que la define.** Los días salen del trabajo
trackeado y de las tareas cerradas, no de haber pasado por el shutdown:
`day_entries` solo aporta la nota y el sello. Por eso **un día que nunca cerraste
aparece igual, marcado como borrador** —y los días anteriores a que existiera la
tabla también—. Ese "borrador" es el dato, no un hueco.

Los días **vacíos se saltan** (ni trabajo, ni cerradas, ni nota, ni cierre), pero
**hoy nunca**: es el día que se está por cerrar, y esconderlo dejaría la bitácora
sin la entrada que se viene a escribir.

**Daily shutdown (`/daily-shutdown`) — el cierre.** El título **es el día**, y ahí
mismo se elige un **emoji de cómo estuvo** (`day_entries.mood`, toggle: volver a
elegir el mismo lo borra) y se escribe el resumen, sin caja, donde se va a leer.

**El selector de emoji es una grilla en popover** (`MoodPicker`), como las
reacciones de un chat: botón redondo → grilla de caras → click. Va en portal como
el resto de los popovers, así que no lo recorta el `overflow` de la vista. Elegir
el que ya estaba lo borra —es un toggle— y hay un "Quitar" explícito para cuando
no te acuerdes de cuál era.

La lista es **curada, no el set completo de Unicode**: el mood es "cómo me sentí",
así que sobran las banderas y las frutas. Un picker completo son cientos de KB de
datos de emoji dentro de una app que tiene que andar offline (misma razón por la
que las fuentes van auto-hospedadas), y encima obliga a buscar entre miles para
elegir una cara.
Debajo: **Highlights** (lo que subiste, cada uno con su campo de resumen),
**Otras actividades** (el resto de lo cerrado, cada fila con un botón **Incluir**
que aparece al pasar por encima) y **Qué quedó pendiente**, que acá es **solo de
lectura**: replanificar es del daily planning (§4.14), y tener el mismo gesto en
dos vistas obliga a mantener la misma regla en dos lugares. Los chips de la ficha
van **arriba a la derecha**, y a la derecha del todo el timeline y el donut —que
en el shutdown va **siempre abierto**, al revés que en la bitácora: éste es el
momento de mirar cómo se repartió el día, la bitácora es un archivo que se hojea.
Termina en **Cerrar el día** → confeti → bitácora.

Las reglas que lo sostienen:

- **Escribir no es cerrar.** El autosave (al salir del campo, como todo el resto
  de la app) usa `set_day_note`, que **no toca `closed_at`**. Si teclear diera el
  día por terminado, no habría forma de dejar una nota a medias y volver.
- **`closed_at` no se vuelve a sellar.** `close_day` es idempotente y conserva la
  hora original: "a qué hora cerré" es el dato interesante. Hay `reopen_day` para
  volver a borrador sin perder las notas.
- **La nota de una tarea es del día, no de la tarea.** `day_task_notes` tiene la
  fecha en la clave porque una tarea se puede trabajar varios días y cada uno
  merece su línea. **No es `tasks.notes`**, que son las notas con las que
  trabajás.
- **Incluir y escribir son gestos distintos.** `include_in_log` crea la fila
  con el resumen vacío; `set_day_task_note` solo escribe. **Vaciar el texto no
  baja la tarea**: la fila es lo que significa "incluida", y confundir las dos
  cosas hacía desaparecer una tarea al borrar una palabra. Sacarla es explícito
  (`remove_from_log`). Por eso `note` distingue **tres** estados: `null` = no
  incluida, `""` = incluida sin resumen, texto = incluida y escrita.
- **La nota del día en blanco sí se borra** (`set_day_note`), porque ahí no hay
  nada que "incluir": o hay texto o no hay.
- **Una reunión no se mueve.** En "qué quedó pendiente" las filas de calendario no
  tienen botones: es el registro de algo que pasó (o no) ese día, y mandarla a
  mañana sería mentir sobre cuándo fue. Misma regla que la degradación diaria
  (§4.2). Tildarla sí se puede, desde la card.
- **El timeline muestra la corrida en curso** aunque todavía no haya sumado
  segundos: es justamente la tarea que estás haciendo. Los segundos se los pone
  el front desde el taxímetro (`workedWithRunning`), igual que el rail — en la
  base no están hasta que pares. **Solo se le suman a hoy**: `runTotal` se mide
  desde la medianoche local (I3), así que en otro día no significa nada, y un
  timer abierto desde las 23:50 de ayer marca la fila de ayer como corriendo.
- **Recargar no pisa lo que estás escribiendo.** `load` corre con cada
  invalidación —tildar una tarea, mover una pendiente, un aviso de la otra
  ventana—, y sembrar los campos desde el servidor borraba el texto a medio
  escribir. Los campos "sucios" (un `ref` con las claves) no se tocan hasta que
  se guardan. Es el precio de tener texto libre en una vista que se recarga sola.

**El aviso de cierre** (`useShutdownReminder`) llega a la hora de `work_end`
—el mismo ajuste que usa el rail, nunca una hora hardcodeada—, **una vez al día**
y solo si el día no está cerrado. Va montado en `Shell`, que existe solo en la
ventana principal: es la misma razón que I6, dos ventanas avisarían dos veces. La
marca es la fecha (`shutdown_notified_on`) y no un booleano, por lo mismo que
`planned_at`. Sin permiso de notificaciones **se marca igual**: reintentar cada
minuto no cambia nada y deja la app pidiendo lo mismo toda la tarde.

> **Este camino no se puede verificar fuera de Tauri**, como ⌘Q (§4.10): en el
> browser y en jsdom no hay notificaciones nativas. Lo que sí está cubierto son las
> dos decisiones: si avisar (`shouldRemindShutdown`) y **si marcar el día después**
> (`markAfter`). La segunda es la que se rompe en silencio: `notify` devuelve
> `sent | denied | failed | unavailable` justamente para que el hook distinga las
> tres políticas —se marca al mandarlo y también sin permiso, **no** cuando falló,
> porque eso puede ser pasajero—. Si `notify` devolviera `void`, las tres serían una
> y un aviso que falló quedaría marcado como dado.
>
> **Y ya no hay que esperar la hora**: Configs → Notificaciones prueba cada aviso
> con su texto real, muestra el estado del permiso y borra la marca del día
> (§4.24). El texto de cada aviso vive en `features/notifications/notify.ts` y de
> ahí lo toman los dos —el botón y el aviso de verdad—, o la prueba diría una cosa
> y el real otra.

**El rollup lo comparte con la weekly review.** `work_by_day` es el único
lugar donde viven la atribución por día local, la Regla 2, la Regla 3, el
no-filtrar `ORPHANED` y el piso en 0 por tarea; la semana lo agrupa en celdas
día × categoría y la bitácora en timelines. Tener dos consultas garantizaba que
se separaran.

Las cuentas de presentación están en `dailyLog.ts` (puro y testeado).

### 4.17 Respaldo y restauración (`BackupCard`)

Un respaldo es **un `.zip` en una carpeta que el usuario elige**. La app no habla
con ninguna nube y no sabe qué es esa carpeta: si es de Drive, Dropbox o iCloud,
el respaldo sale de la máquina porque el cliente de esa nube lo sube; si es local,
el usuario puede mandarla por `scp` a un VPS. Esa fue la decisión de alcance —el
`rsync` integrado que planteaba M4 habría sido credenciales SSH, `shell-out` y
ningún test posible, para hacer lo que el sistema operativo ya hace.

**Dentro del zip van dos archivos**: `sunrise.sqlite` y un `manifest.yml` con
`app`, `version`, `schema_version`, `created_at`, `db_file` y `db_bytes`. El
manifest existe para el **import futuro**, que no está hecho: sin la versión de la
app y del esquema, un zip de hace seis meses es un archivo del que no se sabe si
se puede leer. `version` sale de `APP_VERSION` (`env!("CARGO_PKG_VERSION")`), que
es la misma que Tauri le pone al `.dmg`, y **tiene que ser semver**: un test lo
exige y además exige que `Cargo.toml`, `tauri.conf.json` y `package.json` no
divergan, porque si divergen el manifest miente sobre de qué build salió.

**`VACUUM INTO`, no copiar el archivo.** La base corre en WAL, así que
`sunrise.sqlite` no es la base: lo último escrito está en `sunrise.sqlite-wal`
hasta que alguien hace checkpoint. Copiar solo el archivo principal da un respaldo
con horas de trabajo faltantes y sin ningún error a la vista.

**El zip se escribe con nombre temporal y se renombra al final.** Con el nombre
definitivo desde el principio, el cliente de la nube sube un archivo a medio
escribir que se ve como un respaldo válido.

**El nombre es `sunrise-YYYYMMDD-HHMMSS.zip`**, en hora local, con segundos para
que dos del mismo minuto no se pisen. Su orden alfabético es el cronológico, y de
ahí sale también la fecha que muestra la lista: la del sistema de archivos cambia
con cualquier copia o sincronización.

**Respaldar y podar son un solo paso** (`create_and_prune`), y por eso da lo mismo si
el respaldo lo pidió el reloj o el botón: siete clicks seguidos dejan `conservar`
archivos, no siete. Estaba bien desde el principio, pero era una propiedad del
comando y no del módulo; ahora no hay forma de respaldar sin podar, y hay un test
que lo fija.

> **La retención es la operación más peligrosa de la app.** `purgar` solo borra
> archivos cuyo nombre calza **exactamente** con ese patrón, y lo comprueba dos
> veces: una al listar y otra justo antes del `remove_file`. No hay recursión y no
> se borra ningún directorio. La carpeta es del usuario y lo más probable es que
> esté compartida con el resto de su vida: un glob suelto ahí es pérdida de datos.
> `purgar(dir, 0)` no borra nada — un 0 por un ajuste mal tipeado no puede
> significar "borra todos mis respaldos". Hay un test que se pone rojo si el
> patrón se afloja a `*.zip`.

**El automático corre a `backup_time`, una vez al día, y lo corre Rust**
(`backup::start_watcher`, pulso de 60 s). La decisión vive en
`backup::should_backup`, pura y testeada, con tres cortes: sin carpeta no corre,
una vez al día (`backup_ran_on`) y recién pasada la hora. **Corre igual en dev**
— ver §4.20. La
marca es una **fecha local**, y el efecto es que **se pone al día**: si la app
estaba cerrada a las 20:00 y se abre a las 23:00, respalda ahí; si se abre al otro
día, la fecha ya no es hoy y también respalda. Lo único que no cubre es un día en
que la app no se abrió nunca.

> **Vivía en el front y se movió por I6.** Era un `setInterval` de 60 s en el
> webview de `main` (`useBackupRuntime`), y un webview que no se ve no corre sus
> timers: con la ventana tapada el respaldo esperaba a que algo despertara la
> página. **Medido en la app instalada: con la hora en 00:22, el zip salió a las
> 00:27.** Es el segundo caso de la misma clase después de la campana (§4.6), y
> por eso I6 dejó de ser una anécdota. Al moverlo desaparece además una
> invariante que había que mantener a mano —el hook vivía en `Shell` **solo** para
> que el taxímetro no hiciera su propio zip al mismo minuto—: con un proceso no
> hay ventana que elegir.
>
> Es un **pulso simple y no un sueño calculado** como el de la campana, a
> propósito: el respaldo apunta a una hora de pared una vez al día y se pone al
> día por construcción, así que la precisión no era lo que estaba roto. Lo único
> que se compró es que corra con la ventana tapada.
>
> La hora se compara **en minutos y no como texto**. El front lo hacía
> lexicográficamente y `hour()` acepta una hora de un dígito: con `9:05`,
> `"9:05" >= "20:00"` es falso todo el día y el respaldo no corría nunca.

**Configs se entera por evento.** Lo que escribe el vigilante —la marca del día y,
si falló, el error— no pasa por `setSetting`, que es lo que antes hacía redibujar
la sección. Rust emite `sunrise://backup-ran`, `useBackupListener` relee los
ajustes y `BackupCard` relista los zips cuando la marca cambia. Sin ese hilo el
síntoma es el silencioso de siempre: Configs diciendo que hoy no pasó nada.

**Y la marca del día se puede desmentir** ("Volver a respaldar hoy", la misma
regla que §4.24). No es una comodidad: con el de hoy hecho, cambiarle la hora no
dispara nada —la regla es una vez al día— y eso se ve **exactamente igual que un
automático roto**. Fue lo que pasó al probarlo.

**Carpeta vacía = respaldo apagado.** Es el estado de fábrica: los ajustes de
respaldo no los siembra ninguna migración, como `planned_at`. Y **la carpeta se
valida al guardarla** con una prueba de escritura real (`test_backup_dir`), no a
la hora del respaldo: un volumen de solo lectura o un Drive sin sesión es
perfectamente legible, y un ajuste que se acepta y falla nueve horas después no da
forma de saber qué se escribió mal (mismo criterio que §4.13 con la jornada).

**El fracaso queda escrito.** `backup_ran_on` se marca solo si salió bien; si
falló se guarda `backup_last_error` y la card lo muestra. Un respaldo que dejó de
correr en silencio es peor que no tener respaldo, porque se cuenta con él. La
fecha **sí** se marca cuando falla, por lo mismo que el aviso de cierre: un error
por minuto hasta la medianoche no arregla un disco desconectado.

#### La restauración

Reemplaza **todo**: no mezcla nada. Pasa por un `alertdialog` que lo dice, y de
paso dice las otras dos cosas que no son obvias — que la app guarda antes una
copia de la base que va a pisar (`antes-de-restaurar-…`, con nombre que la
retención **nunca** borra), y que un timer corriendo va a quedar apuntando a la
base nueva. El botón de confirmar queda en spinner (`.is-spinning`, el mismo del
sync) mientras corre.

**Al terminar se abre un segundo diálogo, no un aviso que se va solo.** Es la
única acción de la app que no se puede deshacer desde la app, así que el resultado
tiene que quedar en pantalla hasta que se lea. Muestra tres cosas, y el criterio
de qué **no** mostrar es igual de importante — el manifest trae también el tamaño
y el número de esquema, y con ninguno de los dos se puede decidir nada:

| Qué | Por qué |
|---|---|
| El momento del snapshot, con su antigüedad al lado | La pregunta real después de restaurar es "¿cuánto perdí?". Sale del **manifest**, con zona, que es más preciso que la fecha del nombre del archivo |
| Tareas y último trabajo de la base restaurada | Es lo que delata haber abierto el zip equivocado, que es el error que de verdad ocurre |
| La ruta de la copia de seguridad | Es el deshacer, y con la app corriendo no hay otra forma de volver |

La versión aparece **solo si difiere** de la actual: "0.1.0 → 0.1.0" es ruido, pero
venir de otra versión explica por qué hubo migración. Un respaldo sin manifest lo
dice en vez de mostrar la fecha del archivo como si fuera la del snapshot.

> Ojo con los dos formateadores de fecha, que hacen lo contrario a propósito:
> `readableDate` **no** convierte zonas (su entrada sale del nombre del archivo y
> no la declara), y `readableMoment` **sí** (el `created_at` del manifest trae
> offset y los `started_at` traen `Z`). Usar el primero para lo segundo mostraría
> un respaldo de las 20:03 a las 16:03.

El orden de `restore_backup` está puesto para que **ningún fallo deje la app sin
base**, y es lo único que importa de ese comando:

1. Se toma el lock del `Mutex` y no se suelta: nadie más escribe mientras corre.
2. La base del zip se extrae, se valida **y se migra** en un temporal. Todo lo que
   puede fallar por culpa del respaldo falla acá, con la base viva intacta.
3. Se guarda la copia de seguridad.
4. Recién entonces se cierra la conexión, se copia encima, se borran los `-wal` y
   `-shm` de la base anterior —abrir con ellos ahí sería pedirle a SQLite que
   recupere cambios de otra base— y se reabre.

**Los ajustes de respaldo sobreviven al reemplazo.** `backup_dir`, `backup_time` y
`backup_keep` se releen antes del swap y se vuelven a escribir después: describen
**esta máquina**, no los datos. Sin eso, restaurar un zip hecho antes de configurar
la carpeta dejaría `backup_dir` vacío y el respaldo automático se apagaría solo —
justo el fallo silencioso que `backup_last_error` existe para evitar. Es la única
excepción al "se reemplaza todo".

Si el paso 4 falla igual, se intenta volver a la copia; y si eso también falla, el
error nombra el archivo para poder recuperarlo a mano. **La conexión se reemplaza
en caliente** dentro del `Mutex` en vez de reiniciar la app: `app.restart()`
dispararía el propio `ExitRequested` (§4.10) y abriría el diálogo de salida. Lo
que hace que alcance con el swap es que `repo.rs` no guarda estado; el front se
entera con un `bumpData()`.

**Migrar antes del reemplazo no es la validación de versión que quedó fuera de
alcance**, es lo que hace la restauración usable: un zip de un build anterior trae
un esquema viejo y sin migrar la app consultaría columnas que no existen. Al
revés no se puede y se rechaza con un mensaje claro: un respaldo con
`schema_version` mayor que el máximo de esta app trae tablas que no conoce.

Se rechaza también un zip sin ningún `.sqlite` adentro y uno cuya base no tenga
`tasks`, `settings` y `_migrations`. Eso no es validar versiones: es no reemplazar
la base con el zip equivocado.

> **La restauración no se puede verificar fuera de Tauri**: el mock no tiene base
> que reemplazar. Lo que está cubierto en Rust es todo el camino de archivos
> (crear, listar, purgar, extraer, validar, la copia de seguridad), y en jsdom la
> UI y sus confirmaciones.

### 4.18 Inicio automático (`autostart`)

Casilla en Configs → General: **abrir sunrise al iniciar sesión**. Apagada de
fábrica.

**Por qué existe.** Tres cosas de la app pasan a una hora y las tres necesitan
que esté abierta: el aviso de cerrar el día (`work_end`, §4.16), el respaldo
automático (`backup_time`, §4.17) y el poller de calendario (§4.12). Un respaldo
configurado a las 20:00 no ocurre nunca el día que te olvidaste de abrir la app,
y no hay forma de que se entere.

**Arranca con la ventana visible**, sin argumentos extra. No hay icono en la barra
de menú (se descartó el tray a propósito), así que arrancar escondida sería
arrancar invisible: la app estaría corriendo y nada lo diría.

> **I** — **El estado no vive en `settings`, y eso no es una omisión.** La verdad
> la tiene el sistema operativo: en macOS, un plist en `~/Library/LaunchAgents`
> que el usuario puede borrar desde Ajustes del sistema sin pasar por acá. Una
> copia en la tabla mentiría la primera vez que eso pase. Y peor: cruzaría los
> respaldos, porque el zip se lleva la tabla entera —restaurar un zip de hace un
> mes prendería o apagaría el arranque de **esta** máquina. Es la misma razón por
> la que las tres claves de respaldo se reescriben después de restaurar (§4.17),
> resuelta al revés: en vez de proteger la clave, no tenerla.
>
> Se lee preguntándole al sistema en cada montaje del componente
> (`api.autostartEnabled()`), no desde `useSettingsStore`.

Se usa `MacosLauncher::LaunchAgent` y no `AppleScript`: escribe el plist sin pedir
permiso de automatización, que es lo que haría aparecer un diálogo del sistema al
prender la casilla.

El switch es **optimista y se revierte**: cambia al toque y vuelve atrás con el
error a la vista si el sistema rechaza el cambio. Un switch que espera al disco
antes de moverse se siente roto, y uno que se queda prendido después de fallar
miente sobre lo que va a pasar mañana.

> **En `pnpm tauri dev` lo que se registra es la ruta del binario que corre**, o
> sea `target/debug/sunrise`. Prenderlo en dev deja un LaunchAgent apuntando a un
> binario que puede desaparecer con un `cargo clean`. Se permite igual —es el
> único modo de probar el camino— pero hay que apagarlo antes de salir de dev.

### 4.19 Empaque (`.dmg`)

`pnpm dmg` (alias de `pnpm tauri build`). Deja dos cosas en
`src-tauri/target/release/bundle/`: `macos/sunrise.app` (~24 MB) y
`dmg/sunrise_<versión>_aarch64.dmg` (~8,5 MB). El build de release toma unos tres
minutos desde cero.

Verificado en el paquete que sale: versión `0.1.0`, identifier
`app.sunrise.desktop`, `LSMinimumSystemVersion` 11.0 (el build es
`aarch64-apple-darwin`, así que no hay macOS anterior donde correrlo),
`public.app-category.productivity`, y el `.icns` con la marca.

**La versión se toca en tres archivos y hay un test que lo vigila**:
`Cargo.toml` (de donde sale `APP_VERSION`, que va en el manifest de cada respaldo,
§4.17), `tauri.conf.json` (con la que Tauri nombra el `.dmg`) y `package.json`.
Subir una y olvidar otra deja los respaldos mintiendo sobre de qué build salieron.

> **I** — **Probar el `.app` de release toca tus datos de verdad, no una copia.**
> El identifier es el mismo en los dos, así que `app_data_dir()` resuelve a la
> misma carpeta (`~/Library/Application Support/app.sunrise.desktop`); lo que ya
> **no** comparten es el archivo, desde que dev y producción tienen bases separadas
> (§4.20): `db::file_name()` decide por `debug_assertions`, así que un `tauri build`
> abre `sunrise.sqlite` —la real— y `tauri dev` abre `sunrise-dev.sqlite`.
>
> La consecuencia práctica no cambió: **un build de release compilado para mirar
> algo escribe en tus datos**. Para probar sin riesgo, respalda antes desde la app;
> y ojo con que `tauri build --debug` cae del lado de dev, que a veces es lo que se
> quiere y a veces no.

**Sin firma de desarrollador, pero el bundle sí se firma ad-hoc.**
`bundle.macOS.signingIdentity` vale `"-"`, y eso **no es cosmético**: sin esa
clave, Tauri no firma el bundle, y el único que queda firmado es el binario
Mach-O, porque en Apple Silicon el linker lo firma solo —un ejecutable sin firma
no corre—. Ese estado a medias es peor que no tener firma: la firma del binario
promete recursos sellados que nadie selló (`Sealed Resources=none`,
`Info.plist=not bound`), y ante la contradicción macOS no dice "desarrollador no
verificado" sino **`"sunrise" is damaged and can't be opened`**, que manda a
botar el `.dmg`. Pasó con la 0.1.0.

Firmar ad-hoc no evita el bloqueo de Gatekeeper —ad-hoc no es notarizado, y
`spctl` sigue rechazando— pero lo convierte en el bloqueo que sí se puede
levantar. Un `.dmg` construido localmente no queda en cuarentena, así que
instalarlo acá funciona sin trámite; **el que baja del navegador sí**, y la
primera instalación pide

```bash
xattr -cr /Applications/sunrise.app
```

Está escrito en el README. **Las actualizaciones no vuelven a pasar por esto**:
el `.tar.gz` lo baja Rust y lo verifica con la llave del updater (§4.21), no el
navegador, y la cuarentena la pone quien descarga. Firmar y notarizar de verdad
necesita cuenta de Apple Developer (99 USD al año) y dos secrets más; mientras la
app la instale su autor, no hace falta.

**El fondo del `.dmg` y las posiciones de los iconos son un par, no dos ajustes.**
`src-tauri/dmg/background.svg` está dibujado para 660×400 con el resplandor puesto
en (180, 170), que es exactamente donde el bundler deja caer el icono de la app: el
sol del logo no está dibujado en el fondo porque **el sol es el icono**, saliendo
sobre la línea del horizonte. Por eso `windowSize`, `appPosition` y
`applicationFolderPosition` están **explícitos** en `tauri.conf.json` aunque hoy
coincidan con los defaults de Tauri — si un default cambiara, el resplandor
quedaría en el lugar equivocado y nada fallaría.

El fondo no lleva texto: la tipografía del proyecto es Sora y viene de
`@fontsource`, no del sistema, así que al rasterizar caería a una sans genérica.
El PNG va commiteado porque el bundler no lee SVG; se regenera con

```bash
rsvg-convert -w 660 -h 400 src-tauri/dmg/background.svg -o src-tauri/dmg/background.png
```

`bundle.targets` es `["app", "dmg"]` y no `"all"`: los targets de Linux y Windows
no aplican, y pedirlos solo hace que el bundler avise que no puede.

#### El Release lo publica CI

`.github/workflows/release.yml` se dispara **al empujar un tag `v*`** —no en cada
push— y publica el `.dmg` en un GitHub Release. Sacar una versión son dos pasos:
subir el número en los tres archivos y `git push --tags`.

El workflow corre en un runner **fijo** (`macos-26`) y no en `macos-latest`, y hay
dos razones que no son la misma. La primera es la arquitectura: el proyecto compila
solo arm64 y `macos-13` es Intel, así que ahí saldría un `.dmg` que no corre en
ningún Mac del equipo.

La segunda se descubrió comparando la app instalada con una compilada localmente:
**el SDK contra el que se enlaza el binario decide la apariencia de la ventana**.
macOS le da a cada app el marco de su SDK, así que con `macos-14` (SDK 14.5) lo
publicado salía con los botones de ventana de macOS 14 mientras en la máquina del
dev (SDK 26.5) se veían los actuales — misma configuración, mismo commit, distinto
marco. Se ve en el binario con `otool -l | grep -A5 LC_BUILD_VERSION`.

`macos-latest` arreglaría lo segundo, pero **moviéndose solo**: la apariencia de lo
que publicas cambiaría un día sin que nadie tocara nada, y el `minimumSystemVersion`
seguiría en 11.0 sin que nadie lo hubiera revisado contra el SDK nuevo. Por eso el
runner se sube a mano.

Tiene un paso propio que **compara el tag con los tres archivos** y falla si no
coinciden. Es el único lugar donde eso se puede pillar: el test de Rust comprueba
que los tres archivos coincidan **entre sí**, pero no sabe nada del tag, así que un
`v0.2.0` sobre un repo en `0.1.0` publicaría un `.dmg` llamado `0.1.0`. Y corre
`pnpm test:all` antes de empaquetar: un `.dmg` publicado con tests rojos es peor
que no publicar, porque alguien lo instala.

Está ejercitado desde la `v0.1.0`, y las tres versiones publicadas salieron por
ahí. La primera corrida falló, y no por el workflow: encontró un bug de zona
horaria que en Santiago pasaba por casualidad (ROADMAP 5.5).

#### Los tests corren en cada push

`.github/workflows/tests.yml` corre `pnpm test:all` **en cada push a `main` y en
cada pull request**. Es un archivo aparte y no un job más de `release.yml`, por
dos razones: ese workflow necesita `contents: write` para crear el Release y toca
la llave del updater, y ninguna de las dos cosas tiene por qué estar al alcance de
un PR. Éste corre con `contents: read` y no publica nada.

**Lo que agrega es el reloj, no la suite.** `pnpm test:all` ya corría antes de
empaquetar, así que un tag nunca publicó tests rojos. Lo que faltaba es que
corrieran **antes**: CI trabaja en UTC y la máquina del dev no, y esa diferencia
ya encontró dos bugs de fecha (ROADMAP 5.5 y 5.7) —las dos veces al empujar el
tag, con el número de versión ya commiteado y el release a medio camino. Ahora el
mismo hallazgo llega en el push que lo introdujo.

Corre en `macos-26` como el de release, pero **por otro motivo**: allá manda el
SDK, que decide la apariencia de la ventana; acá es que `pnpm test:rust` compila
el crate de Tauri entero, y en Linux eso arrastra las dependencias de sistema de
webkit2gtk. Además es la plataforma donde la app corre.

Tiene `concurrency` con `cancel-in-progress`: un push encima de otro cancela la
corrida anterior, porque los runners de macOS son lentos y una fila de rojos ya
superados no le sirve a nadie.

### 4.20 Dev y producción conviviendo

`pnpm tauri dev` y el `.dmg` instalado **pueden estar abiertos a la vez y no
comparten datos**. La base se separa por nombre de archivo dentro del mismo
directorio: `sunrise-dev.sqlite` en debug, `sunrise.sqlite` en release
(`db::file_name()`).

**Por qué existe.** El identifier es el mismo en los dos perfiles, así que
`app_data_dir()` resuelve al mismo lugar. Antes de esto, abrir `pnpm tauri dev` para
probar un cambio escribía en los datos de verdad: sellar un día, correr una
migración a medio escribir, arrastrar tareas de prueba. Sin ninguna señal de que
estaba pasando.

> **I** — **La separación es por archivo, no por directorio.** El directorio lo
> decide el identifier, y cambiar el identifier en dev se lleva a otro lado el
> permiso de notificaciones y la ruta del LaunchAgent del inicio automático
> (§4.18). El nombre del archivo no arrastra nada. La condición es
> `debug_assertions`, que es exactamente la que separa `tauri dev` de `tauri build`;
> un `tauri build --debug` cae en dev, y está bien: es un artefacto de desarrollo.

**El puente entre las dos bases es el respaldo.** Respaldas en producción y
restauras ese zip en dev, y trabajas contra datos reales sin tocarlos. Funciona
porque **el nombre de la base dentro del zip no depende del perfil**: siempre es
`sunrise.sqlite` (`backup::DB_IN_ZIP`). Hay un test que lo fija — si el zip llevara
el nombre del perfil, un respaldo tomado en dev no se podría restaurar en
producción, y el puente no existiría.

> **I** — **El respaldo automático corre también en dev, y lo que lo hace seguro
> son los nombres.** Producción escribe `sunrise-…` y dev escribe `sunrise-dev-…`
> (`backup::prefix`), y `is_backup_name` —que es **el único permiso para borrar**—
> exige el prefijo de su propio perfil. Con eso los dos conjuntos son **disjuntos**:
> apuntando los dos a la misma carpeta, ninguna retención puede alcanzar lo que
> escribió la otra. Cada perfil lista solo lo suyo, y el puente sigue existiendo
> porque restaurar toma la ruta del selector de archivos, no de la lista.
>
> **Antes estaba apagado**, y la razón era real: las bases están separadas pero
> `backup_dir` es una ruta en el disco, así que si restauras un zip de producción
> en dev —o sea, si usas el puente— dev hereda la carpeta, empieza a escribir zips
> de prueba ahí y con un nombre compartido **la retención borra los respaldos de
> verdad** para conservar los de prueba. Lo que cambió no es la evaluación del
> riesgo, es que el riesgo desapareció: separar los nombres es más barato que
> apagar la función. Y apagado **no había forma de probar el automático antes de
> publicar una versión**, que es exactamente cuando importa que funcione.
>
> Tres tests lo sostienen: que ningún perfil reconozca el nombre del otro, que la
> retención de dev no toque los de producción en la misma carpeta, y que cada uno
> liste solo lo suyo.

**El `localStorage` tampoco se cruza, pero por otra razón.** La base no es el único
almacén de la app: el canal entre ventanas (`sunrise-data`, §5.2), el tema y la
última tarea del taxímetro viven en `localStorage`. El store del webview **sí** es
compartido —está en `~/Library/WebKit/sunrise`, con el nombre del producto, que es
el mismo en los dos perfiles— pero adentro está **particionado por origen**, y los
dos perfiles tienen orígenes distintos: dev sirve el front desde
`http://localhost:1420` y el release lo carga por el protocolo `tauri://`. Así que
un `bumpData()` en dev no invalida las vistas de producción, y la tarea que el
taxímetro recuerda no se filtra apuntando a un id que en la otra base no existe.

> **Ojo: eso es un efecto secundario, no una decisión.** El aislamiento del
> `localStorage` depende de que dev use un servidor de desarrollo. Si algún día
> `devUrl` apuntara al protocolo propio, o dev se armara con el front empaquetado,
> los dos perfiles caerían en el mismo origen y compartirían las cuatro claves.
> Verificado hasta donde se puede sin instalar el `.app`: en el disco hay un solo
> directorio de origen (`http://localhost`) con `sunrise-data`, `sunrise-timer`,
> `sunrise-theme` y `sunrise-tax-pos`.

**En pantalla se ve cuál es cuál.** El sidebar muestra un distintivo `dev` al lado
de la marca, con el archivo de base en su `title`. No es decoración: dos ventanas
idénticas con datos distintos son indistinguibles, y el error natural es editar en
la equivocada. Sale de `useProfile()` (`src/lib/profile.ts`), que pregunta **una vez
por sesión** y cachea la promesa —es un dato del binario, no puede cambiar— y
devuelve `null` mientras no llega. Ese `null` significa "todavía no sé", **no** "es
producción": asumir producción por un instante alcanza para que el respaldo
automático corra una vez.

### 4.21 Actualizaciones (`updater`)

La app se actualiza sola desde el mismo Release de GitHub que publica el `.dmg`
(§4.19), con `tauri-plugin-updater`. Configuración en `tauri.conf.json`:

```json
"plugins": { "updater": { "endpoints": ["…/releases/latest/download/latest.json"], "pubkey": "…" } },
"bundle":  { "createUpdaterArtifacts": true }
```

**El updater no usa el `.dmg`.** Con `createUpdaterArtifacts` el build produce
además un `.app.tar.gz` con su firma al lado, y `tauri-action` escribe el
`latest.json` que la app consulta. El `.dmg` sigue siendo solo para la primera
instalación.

**La firma del updater no tiene nada que ver con la de Apple.** Es un par de
llaves propio (`pnpm tauri signer generate`): la pública va versionada en
`tauri.conf.json`, la privada vive en los secrets del repo y el workflow la pasa
como `TAURI_SIGNING_PRIVATE_KEY`. Es lo que impide que alguien sirva una
actualización falsa desde esa URL. Se generó **sin contraseña**: guardarla en el
mismo almacén de secrets que la llave no protege de nada, pero la variable
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` va igual porque el firmador la exige aunque
esté vacía.

> **I** — **El repo tiene que ser público.** La URL del `latest.json` se pide sin
> credenciales; en un repo privado devuelve 404 a todos, y el síntoma es "nunca hay
> actualizaciones", que es indistinguible de estar al día. Si algún día se cierra,
> el updater deja de funcionar en silencio y hay que cambiar la forma del endpoint
> (uno con token, o un repo público aparte solo para los Releases).

> **I** — **La llave privada no entra al repo.** Ni como archivo suelto (hay
> `*.key` en `.gitignore`) ni pegada en un YAML. Si se pierde, no se puede firmar
> una actualización que las apps ya instaladas acepten: hay que repartir un `.dmg`
> nuevo con la llave pública nueva.

> **I** — **Faltar una pieza de config no rompe nada visible.** Sin `pubkey` el
> plugin no arranca, sin `endpoints` no hay a quién preguntar, sin
> `createUpdaterArtifacts` el Release sale con `.dmg` pero sin manifiesto, y sin
> `TAURI_SIGNING_PRIVATE_KEY` los artefactos salen sin firmar y la app los rechaza.
> Las cuatro dan el mismo síntoma —"nunca hay actualizaciones"— que es
> indistinguible de estar al día. El test `la_config_del_updater_esta_completa`
> cubre las tres primeras; la cuarta solo se ve en el primer tag.

**Todo el updater vive en Rust**, en `commands.rs`: `check_for_update` (que
devuelve `Option<AppUpdate>`, donde `None` es "estás al día") e
`install_update` (que descarga, instala y llama a `app.restart()`, así que
no retorna). El plugin también tiene API de JavaScript, y no se usa: obligaría a
un paquete npm más y a abrirle permisos en `capabilities/default.json`, y dejaría a
`ipc.ts` de ser la única puerta a la app. `install_update` vuelve a
preguntar en vez de guardarse el `Update` de la búsqueda anterior — mantenerlo vivo
entre dos comandos obliga a un `State` con media operación de red adentro, y el
costo real es una petición HTTP.

**Cuándo se busca.** Al abrir la app y después **cada 4 horas** (`useUpdateRuntime`,
§4.23), más el botón de Configs → General → Actualizaciones cuando quieras
preguntar ahora.

> **I** — **Nada de esto interrumpe.** La decisión original de 5.3 fue no buscar al
> arrancar, con el argumento de que la app ya interrumpe dos veces a una hora fija
> (el aviso de cerrar el día y el respaldo). El sondeo automático **no la
> contradice**: lo que aparece es una franja en el sidebar que espera, no un modal.
> Lo que sigue prohibido es que algo se ponga adelante del día sin que lo pidas. Y
> sin la consulta al arrancar, un intervalo de 4 horas no dispararía nunca para
> quien cierra la app todos los días.

**El fallo se dice en gris, no en rojo.** Sin conexión, o antes de que exista el
primer Release, la consulta al `latest.json` no llega. La vista distingue los tres
finales —hay versión nueva, no hay, no se pudo preguntar— porque los dos últimos se
ven parecidos y significan lo contrario: "estás al día" es una respuesta, "sin
conexión" es la falta de una.

### 4.22 Changelog y el aviso "Lo nuevo"

`docs/CHANGELOG.md` es **la fuente única de lo que se anuncia**, y de cada sección
salen tres textos:

| Dónde se lee | Qué parte |
|---|---|
| Modal "Lo nuevo en la vX.Y.Z", al abrir después de actualizar | el primer párrafo |
| Configs → Actualizaciones, **antes** de instalar (`AppUpdate.notes`) | la sección entera |
| El cuerpo del Release en GitHub | la sección entera |

> **I** — **El aviso previo y el modal salen del mismo texto.** Es la razón del
> diseño: si fueran dos, se prometería una cosa en Configs y se anunciaría otra al
> reiniciar, y nadie lo notaría hasta que ya está publicado.

**El formato es estricto porque lo leen dos cosas distintas.** `## vX.Y.Z — fecha`
abre la sección; los párrafos que siguen son el anuncio; `### Detalle` empieza lo
que **no** llega al modal (el detalle técnico). En el front lo parsea
`src/lib/changelog.ts` (`announcementFor` / `sectionFor`); en CI, un `awk` de tres
líneas en `release.yml`. No son dos parsers del mismo dato: uno quiere el primer
párrafo y el otro la sección completa.

**El changelog viaja en el bundle** (`import ... from "../../docs/CHANGELOG.md?raw"`).
Cuesta unas decenas de líneas por versión y compra lo que importa: el modal aparece
justo después de que el updater reinició la app, y ahí no es momento de depender de
una petición HTTP.

> **I** — **La versión que se compila tiene que tener su sección.** Si no, el modal
> queda vacío **y** las notas del Release también, sin que nada se ponga rojo. Lo
> cubre un test en `src/lib/changelog.test.ts` que lee la versión de `package.json`
> — el equivalente del que compara los tres archivos de versión en Rust.

**El modal `WhatsNew` no se abre solo.** Lo levanta el aviso del sidebar, que es lo
que aparece al volver de un update — ver §4.23.

---

### 4.23 El aviso del updater en el sidebar

Una franja arriba del switch de tema, con **dos estados y ninguno interrumpe**.
`UpdateBanner` la dibuja; `useUpdateRuntime` decide cuál va.

| Estado | Cuándo | Al apretarlo | Cuánto dura |
|---|---|---|---|
| **Versión X disponible** | el sondeo encontró algo | descarga, instala y **reinicia la app** | hasta que lo aprietes |
| **Estás al día** | esta sesión viene de un cambio de versión | abre el modal "Lo nuevo" | **30 segundos** |

> **I** — **Se monta una sola vez, en `Shell`** (ventana `main`). Dos ventanas
> sondeando serían dos consultas por intervalo, por lo mismo que el aviso de
> cierre (I6). La campana y el respaldo automático **ya no** son ejemplos de esto:
> se fueron a Rust justamente porque depender de una ventana los dejaba muda al
> uno y tarde al otro (§4.6 y §4.17).

**El aviso reemplazó al modal automático**, que fue la primera versión de esto. Un
modal encima de la app al abrirla es la interrupción que §4.21 descartó: el aviso
espera en el sidebar y tú decides si lo lees. Y como se va solo a los 30 segundos,
no deja basura en pantalla para quien no le interesa.

**Cómo se detecta "vengo de un update".** Se compara `app_version` contra
`sunrise-seen-version` en `localStorage`:

- **Sin marca** (instalación nueva) no avisa nada y solo la deja. Abrir la app por
  primera vez con un aviso encima es la peor bienvenida posible.
- **Marca distinta** ⇒ avisa, si además hay anuncio escrito para esa versión: sin
  texto, el aviso llevaría a un modal vacío.
- **La marca se escribe siempre**, incluso cuando no se avisa. Si no, una versión
  sin anuncio dejaría la marca vieja y el aviso saltaría en la siguiente mostrando
  el texto equivocado.

> **I** — **La marca vive en `localStorage`, no en `settings`.** Por lo mismo que el
> inicio automático (§4.18): describe esta instalación, no tus datos. En `settings`
> viajaría dentro de los respaldos, y restaurar un zip viejo haría reaparecer el
> aviso de una versión ya leída. Depende de que el store de WebKit
> —`~/Library/WebKit/sunrise`, con el nombre del producto (§4.20)— **sobreviva a que
> el updater reemplace el `.app`**, y sobrevive porque no está indexado por el
> bundle. Si eso cambiara, el aviso aparecería en cada arranque.

**Dispara con cualquier cambio de versión**, no solo con una actualización
automática: reinstalar el `.dmg` a mano también cuenta. Detectar "vengo del updater"
pediría que Rust dejara una marca y no compra nada — lo que importa es que la
versión cambió desde la última vez que miraste.

**`updatedTo` y `bannerVisible` son dos campos y no uno.** Apretar el aviso lo
apaga, pero el modal todavía necesita saber **qué** versión mostrar; con un solo
campo, el click se llevaría el dato junto con el aviso.

**Si la instalación falla, el botón vuelve.** La app no se reinició, así que dejarlo
en "Instalando…" para siempre es mentirle a alguien que está mirando el sidebar
esperando que algo pase.

**Las animaciones tienen que poder apagarse.** El brillo que cruza la franja, la
flecha que sube y la chispa se anulan bajo `prefers-reduced-motion`, y ahí no se
pierde información: el color, el icono y el texto dicen lo mismo. Los 30 segundos
los cuenta el store y no el CSS, así que el aviso se va igual.

**Cómo se prueban las dos franjas antes de publicar.** No se puede esperar a tener
dos versiones: `devFake.ts` deja un banco de pruebas en la consola del webview, con
`sunriseDev.flujoCompleto()`, `.hayUpdate()`, `.alDia()` y `.limpiar()`. Trabaja
sobre el store y no sobre `mockDb`, que es lo que lo hace servir **dentro de
`pnpm tauri dev`**: ahí el front habla con Rust y el mock no participa.

> **I** — **El banco de pruebas no llega a producción.** Todo cuelga de
> `import.meta.env.DEV`, que en el build es una constante falsa. Y la instalación
> simulada **no llama a `installUpdate`**: descargaría un paquete real y reiniciaría
> la app. Aterriza en la versión que está corriendo y no en la falsa, porque es la
> única con anuncio escrito — sin eso el flujo de prueba muere en una franja muda.

> **I** — **Los 28 s del desvanecido y los 30 del store van juntos.** La animación
> de salida arranca a los 28 y dura 2; el store desmonta a los 30. Si alguien mueve
> uno sin el otro, el aviso desaparece de golpe o se queda invisible ocupando lugar.

### 4.24 Configs → Dev Tools (solo en dev)

La última sección de Configs, y **la única que depende del binario**: se dibuja
solo cuando `profile.dev` es `true` (§4.20). No son ajustes — nadie que use la app
instalada tiene por qué ver un botón que dispara un aviso de mentira—, así que va
después de Respaldo y con su propio criterio de existencia.

> **I** — **La lista y las cards se filtran con el mismo booleano.** El resaltado
> de las tabs lo decide un `IntersectionObserver` sobre las secciones (§4.8), así
> que una tab sin su card marca una y muestra otra. `visibleTabs(dev)` en
> `settings/secciones.ts` es el único lugar donde se decide, y la card se dibuja
> con la misma condición. Fuera de Tauri el mock dice `dev: true`, que es lo
> correcto: en el browser y en jsdom no hay ninguna app instalada.

**Probar las notificaciones** es la primera herramienta que vive ahí (Mej.16).
Los avisos nativos son el único camino de la app que **no se puede ver ni en el
browser ni en jsdom** y encima dependen del reloj (§4.16), así que antes cada
cambio en esa maquinaria se verificaba esperando. Tres controles:

- **Probar cada aviso**, con **el texto de verdad**. Los textos viven en
  `features/notifications/notify.ts` (`SHUTDOWN_NOTICE`, `nextTaskNotice`) y de
  ahí los toman los dos consumidores. Es la misma razón que el changelog: si el
  botón escribiera su propia versión, la prueba diría una cosa y el aviso real
  otra, y no se notaría hasta que llegue el real.
- **El estado del permiso a la vista.** Sin permiso el aviso simplemente no llega
  y nada en pantalla lo dice; peor, el aviso del cierre marca el día igual a
  propósito. El plugin solo expone `isPermissionGranted()`, un booleano, así que
  **"denegado" y "nunca se preguntó" no se pueden distinguir** sin pedirlo — y
  pedirlo al renderizar abriría el diálogo de macOS sin que nadie lo pidiera. Por
  eso el estado es `granted | unknown | unavailable` y el texto de `unknown` dice
  las dos posibilidades, con la ruta de Ajustes del sistema para el caso denegado,
  que ya no se puede volver a pedir desde la app.
- **Volver a avisar hoy**, que borra `shutdown_notified_on` para probar el camino
  real sin esperar al día siguiente. Toca **solo** esa clave: `planned_at` se
  parece pero es de otro ritual, y el suyo se borra desde su propio aviso
  (§4.14).

**El botón lo único que hace es mandar**: no escribe `shutdown_notified_on`. Si lo
escribiera, probar un aviso con el permiso denegado apagaría el aviso real de ese
día.

**El aviso de "próxima tarea" existe acá antes que su disparador** (Mej.4 todavía
no está): hoy el botón es lo único que lo muestra. Cuando se haga, tiene que
consumir `nextTaskNotice` en vez de escribir su propio texto.

#### Dos cosas de los avisos nativos que no son nuestras

**En dev, el aviso lleva el icono de la Terminal, no el de sunrise.** No es un
bug de la app ni le falta nada al icon set: el plugin lo hace a propósito, en
`desktop.rs`, `set_application("com.apple.Terminal")` cuando `tauri::is_dev()`, y
usa el identificador del bundle (`app.sunrise.desktop`) solo en producción. Un
proceso sin `.app` no tiene identidad que macOS pueda atribuir. **Se ve bien en la
app instalada y no hay nada que arreglar en dev.**

**Los avisos suenan, y el de sunrise es `Blow`** (`DEFAULT_SOUND`, probado en la
app). El sonido se elige por **nombre de archivo sin extensión**, y macOS lo busca
en las carpetas `Sounds`: las del sistema (los catorce de fábrica — Basso, Blow, Bottle,
Frog, Funk, Glass, Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, Tink) y
**`~/Library/Sounds`**, que es dónde va uno propio. `SYSTEM_SOUND` es la
alternativa que no es un archivo: el literal `NSUserNotificationDefaultSoundName`,
o sea "el que use el sistema". `notice_sounds()` lista las dos carpetas, así que un `.aiff` dejado ahí aparece en el selector de Dev Tools con el
nombre del archivo, sin extensión. La trampa: **un nombre que no existe no suena y
no falla**, así que un typo deja los avisos mudos sin decir nada.

El selector de Dev Tools **no persiste** la elección: es para escuchar los sonidos.
Elegir el de verdad es un ajuste, y va con Mej.1.

### 4.25 Alertas: el aviso que se queda hasta que respondas

**El botón es necesario y no es suficiente.** Un aviso con botón de acción puede
quedarse en pantalla hasta que la saques o la acciones —como el aviso de reunión
del Calendario—, pero **quién decide si se queda es el estilo de notificación de la
app**: *Alertas* se queda, *Banners* se va solo, y eso vive en Ajustes del sistema
→ Notificaciones, por aplicación. Medido: con los botones puestos, el aviso seguía
yéndose solo, porque en dev se atribuía a la Terminal (ver la invariante de la
identidad, más abajo) y el ajuste que mandaba era el de la Terminal.

**Comprobado en la máquina del dev**, y es lo que cierra el tema: con
`Notificaciones → sunrise → Alert Style` en **Persistent**, las dos —la alerta de
próxima tarea y el banner del cierre— se quedan pegadas hasta que las saques. En
**Temporary**, que es como estaba, las dos se van solas aunque tengan botones.

> **I** — **No se puede garantizar que quede en Persistent, y no es que falte
> intentarlo: lo gatea Apple.** El estilo es del usuario —no se puede leer ni
> escribir desde la app, y macOS lo recuerda por identificador, así que reinstalar
> tampoco lo reinicia—, **el default documentado para cualquier app es `banner`**
> ("la mayoría de las apps no debería necesitar el estilo alerta", dice Apple), y
> la única clave que pide otra cosa —`NSUserNotificationAlertStyle=alert` en
> `src-tauri/Info.plist`, que Tauri mezcla con el que genera— **está reportada como
> inefectiva** (radars y hilos de desarrolladores que la ponen y reciben banners
> igual). Se deja porque no cuesta nada, no porque se cuente con ella.
>
> **Calendar "solo funciona" porque es de Apple**: su app viene con el estilo
> alerta de fábrica, y eso no es algo que una app de terceros pueda declarar. La
> documentación de Apple para Calendar describe el estilo como un ajuste del
> usuario, en el mismo panel.
>
> Así que lo único que la app puede hacer es **decirlo**, y lo dice en **Configs →
> Notificaciones** (§4.26): nombra el ajuste exacto y tiene el botón que abre ese
> panel (`x-apple.systempreferences:com.apple.preference.notifications`, abierto
> **desde Rust** por la trampa del `opener`). Dev Tools lo repite para el que está
> probando. Una feature que promete avisarte y depende de un switch escondido no
> puede quedarse callada.

**El plugin de notificaciones no sirve para esto**, y no es cosa de configurarlo:
manda por `notify-rust`, cuyo backend de macOS pasa título, cuerpo, icono y sonido
y nada más. Así que las alertas hablan directo con `mac-notification-sys` —la misma
librería que el plugin usa por abajo— desde el comando `notify_alert`.

Quién es alerta y quién no lo dice **la copia misma**: un `NoticeCopy` con `action`
viaja por `notify_alert`, uno sin `action` por el plugin. Hoy el de próxima tarea
lleva botón ("Ir a Focus") y el del cierre del día no, y esa asimetría es la
decisión: si te pierdes el aviso del cierre, el shutdown sigue ahí; la reunión, no.

> **I** — **El comando no espera la respuesta, y no puede.** El `send()` de
> `mac-notification-sys` **bloquea el hilo hasta que la persona hace algo** —eso es
> lo que significa que la alerta sea persistente—, así que esperar dentro del
> comando congelaría la app hasta que alguien mirara la esquina de la pantalla. Se
> manda en un hilo aparte y la respuesta vuelve por el evento
> `sunrise://notification-action` (`useNotificationActions`), con cinco valores:
> `action | click | close | reply | none`.

> **I** — **La identidad se reclama al arrancar, y con el identificador de
> sunrise incluso en dev.** `set_application` de `mac-notification-sys` es un
> `Once` de proceso que el plugin de notificaciones también llama —con la Terminal
> cuando `tauri::is_dev()`—, así que gana el primero:
> `claim_notification_identity` corre en el `setup` de `lib.rs`, antes de que se
> mande ningún aviso. No es cosmético: **el estilo del aviso lo decide el ajuste
> de notificaciones de la app a la que se atribuye**, así que atribuido a la
> Terminal manda el ajuste de la Terminal y poner sunrise en "Alertas" no hace
> nada.
>
> **Depende de que la app esté instalada**, y no es un supuesto: la librería hace
> `LSCopyApplicationURLsForBundleIdentifier` y devuelve `false` si LaunchServices
> no conoce el identificador. En una máquina que solo corre `pnpm tauri dev` se
> cae a `com.apple.Terminal` —el mismo lugar donde estaba antes— y Dev Tools lo
> **muestra**, porque es la explicación de por qué un aviso no se queda. Si no se
> fijara ninguna, la librería resuelve `use_default` y termina en
> `com.apple.Finder`: funcionaría igual, con otro icono prestado y sin que nadie
> lo dijera.
>
> **El precio en dev**: el aviso pertenece a la app *instalada*, así que apretar su
> botón puede activarla a ella y no a la de desarrollo.

> **I** — **No le agregues esquemas raros a `opener:allow-open-url`.** Sumar
> `x-apple.systempreferences:*` a esa entrada de `capabilities/default.json` dejó
> la app **sin ningún aviso del sistema** —ni banner ni alerta, las dos rutas
> muertas— y volvió todo a la normalidad al revertirlo. Se comprobó por
> eliminación, con el sonido descartado por separado: **con la entrada no salen,
> sin la entrada salen**. El mecanismo **no está explicado** (el glob es válido y
> el `ScopeObject` deserializa bien, así que no es un error de parseo evidente), y
> por eso queda como una regla y no como una teoría. Lo que sí está claro es dónde
> aparece el síntoma: en la consola del webview, no en la terminal, y a varios
> metros de lo que se tocó.
>
> Por eso **abrir el panel de Ajustes del sistema va por un comando de Rust**
> (`open_notification_settings`, que usa la API Rust del plugin `opener`): desde
> Rust el ACL no aplica, igual que el updater, así que no hay capability que tocar.

**La respuesta trae el destino**, no solo qué se apretó. `NoticeResponse` es
`{ action, route, taskId }`, y el destino viaja de ida y vuelta sin usarse en el
envío: es lo único que le permite al front saber **a dónde ir**. Es una ruta y no
solo un id porque los tres avisos van a lugares distintos —la reunión y la campana
a Focus con su tarea, el cierre del día al shutdown, que no tiene tarea—, y sin la
ruta cada aviso nuevo obligaría a inventar otro campo.

> **I** — **La alerta no lleva botón de cerrar, y el click sobre ella hace lo mismo
> que el botón.** El "Cerrar" no servía para nada: la alerta ya se saca con el gesto
> de siempre, y un botón para no hacer nada al lado del botón útil solo da una forma
> más de ignorar el aviso. Sin él, el click sobre la alerta entera vuelve como
> `Click` y se trata igual que `ActionButton` — que es lo que la gente hace por
> instinto. `close` y `none` no navegan: descartar un aviso no pidió ir a ninguna
> parte.

**Los tres avisos llevan botón, así que los tres son alertas.** El del cierre del
día era un banner, con el argumento de que si te lo pierdes el shutdown sigue ahí.
Cierto, pero tampoco llevaba a ninguna parte: había que ir a buscar la vista a mano,
que es justo el trabajo que el aviso viene a ahorrar.

### 4.26 El aviso de próxima reunión (Mej.4)

**Lo manda Rust** (`notice.rs`), y es el tercer vigilante después de la campana y
el respaldo. Por la invariante I6, y acá es lo más literal de los tres: el caso que
este aviso cubre es **estar en otra ventana** cuando se te viene el Meet encima, y
un webview que no se ve no corre sus timers.

**La espera es la de la campana, no la del respaldo**, y la diferencia es la que
hay que entender antes de tocarlo:

| | Espera | Se pone al día |
|---|---|---|
| campana | hasta el cruce, techo 30 s | sí (el estimado sigue excedido) |
| respaldo | pulso fijo de 60 s | sí (por construcción) |
| **este** | hasta el cruce, techo 60 s | **no** |

`due` exige que la reunión **todavía no haya empezado** —la ventana es
`[hora - lead, hora)`— y ese borde superior es toda la diferencia: un "en 5
minutos" a las 09:30 para una reunión de 09:00 es basura, y es también lo que evita
que un Mac recién despertado mande seis avisos viejos de golpe. Por eso no hay
número de gracia arbitrario: la condición útil es "la reunión no empezó".

**Solo de reuniones del calendario** (`source = 'CALENDAR'`), y no por decisión de
producto: **nada de la UI escribe `scheduled_time`**. La columna existe de punta a
punta —`create_task`, `TaskPatch`, el rail, la card, y `dailyPlan` la cuenta como
compromiso— pero el único que la llena es el import. El día que exista un selector
de hora para una tarea manual, `repo::meetings_for_date` es el filtro que hay que
aflojar.

**La memoria de "ya avisé" es `tasks.notified_for` (migración 11), y guarda la
hora, no un booleano.** La promesa no es "avisé una vez por esta tarea", es "avisé
que empezaba a **esta** hora": si la sincronización mueve la reunión de 15:00 a
16:00 es otra promesa y hay que volver a avisar. Con un flag la tarea quedaría muda
para siempre, que es exactamente el bug que tuvo la campana con su llave (§4.6).

> **I** — **La sincronización del calendario no pisa `notified_for`.** Es dato
> nuestro, no del feed, igual que `status` y `actual_seconds`. Y el upsert **sí**
> actualiza `scheduled_time`, que es justamente lo que hace que una reunión movida
> vuelva a entrar.

> **I** — **Va en `tasks` y no en `settings`.** `settings` guarda **una** marca
> (como `planned_at` o `backup_ran_on`); esto necesita un conjunto de ids que
> sobreviva al reinicio. En la fila de la tarea es una lectura, sin join, y se va
> con ella al borrarla.

**La marca se escribe antes de mandar**, no después: `send()` bloquea su hilo hasta
que la persona responde, así que anotarla después dejaría dos vueltas del loop
mandando dos avisos de la misma reunión. Y el loop guarda además la última promesa
en memoria, como red para el caso en que la escritura falle — sin eso, `due`
devolvería la misma reunión cada dos segundos.

**El texto vive en `notice::copy` (Rust) y solo ahí.** Estaba en `notify.ts` con el
resto, y se movió porque el que lo manda es el vigilante: dejar la copia en el front
obligaba a escribirlo dos veces y el botón de prueba de Dev Tools acabaría probando
un texto que el aviso real no usa. Dev Tools lo pide con `preview_meeting_notice`,
así que prueba **el de verdad**.

Dice **"Cambio de Focus a las 15:00" / "Sigue Weekly de equipo. Toca para
verla."**, y cada parte del texto tiene su razón:

- **La hora del evento, no los minutos que faltan.** El aviso puede salir en
  cualquier punto de su ventana —la app estaba cerrada, la máquina durmió, la
  sincronización movió la reunión—, así que "en 5 min" es un número que se puede
  equivocar; `scheduled_time` no. Es el mismo criterio que `readableDate` con las
  fechas del respaldo: mostrar el dato que no depende de cuándo se lea.
- **El título dice qué clase de cosa es y a qué hora; el cuerpo, cuál.** Con varios
  avisos apilados, "Cambio de Focus a las 15:00" se reconoce de una pasada sin leer
  el nombre completo de la reunión. El de la campana tiene la misma forma —"Se acabó
  el tiempo estimado" / "Llevas los 90 min de X"— para que los dos se lean igual.
- **"Sigue X" y no "Toca X"**: el cierre del cuerpo ya usa *toca* como "púlsalo", y
  la misma palabra con dos sentidos en la misma frase obliga a releerla.
- **El cierre enseña el gesto** (`notice::HINT`, "Toca para verla"), y es la misma
  frase en los dos avisos: sin botón de cerrar, que el click sobre la alerta entera
  valga no se descubre mirando, y repetirla hace que se aprenda una vez. **No dice
  "en sunrise"**: macOS ya pone el nombre de la app arriba, y repetirlo gasta la
  línea que sirve para decir qué hacer.

**El click lleva a Focus con esa tarea.** `useMeetingNotice` escucha la respuesta,
escribe `focusTaskId` en el store y navega; `FocusView` lo **consume** al cargar su
cola y lo limpia. Tres cosas que importan: se monta en `Shell` (el evento llega a
las dos ventanas y el taxímetro no tiene esas vistas), **solo `action` navega**
—`click` y `close` no pidieron ir a ninguna parte—, y sin `taskId` no navega, porque
el aviso del cierre pasa por el mismo evento.

**El ajuste es `notice_meeting_minutes`, con 0 = apagado** (mismo patrón que
`backup_dir` vacío). Un aviso que no se puede apagar es peor que no tenerlo.

**Focus abre en la tarea del aviso**, y eso tiene un detalle que costó un bug:
`focusTaskId` se lee como valor y se limpia en un efecto aparte, **no con un "tomar
y vaciar" dentro de la carga**. En dev React monta los efectos dos veces, así que
consumirlo en la primera pasada lo dejaba vacío para la segunda, que reseteaba el
índice — el aviso abría Focus sin mover la tarea. Y el efecto va declarado
**después** del salto al timer que ya existía, porque React corre los efectos en
orden y puesto antes el timer lo pisaba: un aviso que acabas de accionar es más
explícito que el timer que venía corriendo.

---

### 4.27 Configs → Notificaciones

Tres switches —**se viene una reunión**, **hora de cerrar el día**, **se acabó el
tiempo estimado**— más los minutos de adelanto del primero.

**Es sección propia y no un campo de General**, y la razón no es la cantidad de
controles: acá además hay que explicar que **macOS decide si el aviso se queda en
pantalla** (§4.25), y eso no cabe como una línea suelta entre la capacidad diaria y
la jornada. La nota nombra el ajuste exacto (*Persistent*) y trae el botón que abre
ese panel.

> **I** — **El default no es el mismo para los tres, y no es un descuido.** El del
> cierre del día viene **encendido**: ya andaba antes de que hubiera dónde apagarlo,
> y leer "falta la clave" como apagado lo habría silenciado en la actualización que
> trajo esta sección. La notificación de la campana viene **apagada**, por la
> decisión de M2 (§4.6): la campana no notifica —el sonido alcanza y una
> notificación por tarea se apila—, así que es opt-in. `"1"` enciende, `"0"` apaga,
> y **cualquier otra cosa cae en el default de esa clave**: un valor que no se
> entiende no puede inventar una decisión. Lo hacen `noticeOn` (con su tabla de
> defaults) en el front y `bell::notice_enabled` / `notice::lead_minutes` en Rust,
> y cada uno tiene su test.

> **I** — **El switch de la campana apaga la notificación, no la campana.** El
> sonido no depende de él: es la campana, no el aviso, y un switch que apagara el
> sonido mentiría sobre lo que dice apagar. La etiqueta lo dice en la card.

**Cada switch lo lee quien manda el aviso, no la vista**: el de la campana en
`bell.rs`, el de la reunión en `notice.rs`, el del cierre en
`shouldRemindShutdown`. En `bell.rs` se consulta **después** de que suena y no en
`is_due`: `is_due` es la regla de producto —cuándo le toca campana a un timer— y
meterle un ajuste la volvería dependiente de la base, que es justo lo que la hace
testeable.

**El primer switch dice "Evento de tu Calendar importado"** y no "reunión", porque
eso es literalmente lo que cubre: lo que trae hora es el import del calendario
(§4.26), y llamarlo reunión prometería también las tareas con hora, que no existen.

**El sonido de los avisos se elige acá, arriba de los tres switches** (`notice_sound`,
Mej.1). Arriba y no entre ellos porque vale para los tres: puesto en medio se leería
como el de uno solo. Vivía en Dev Tools con `useState`, o sea que se elegía para
probar y se perdía al cerrar la sección — y el botón de prueba sonaba distinto al
aviso de verdad, el mismo desacuerdo que ya se había arreglado con el texto.

Lo leen **los dos lados**, y tiene que ser así: tres de los cuatro avisos los manda
Rust (`commands::sound_or_default`), y `notify()` lo lee del store en cada llamada
—no como default de parámetro— para que cambiarlo en Configs se sienta en el aviso
siguiente sin recargar nada.

> **I** — **Un nombre de sonido que no existe no suena y no falla.** macOS lo busca
> en las carpetas `Sounds` y si no está, manda el aviso en silencio. Por eso los dos
> parsers descartan el vacío y los espacios en vez de pasarlos tal cual: un valor con
> basura dejaría todos los avisos mudos sin ningún síntoma en pantalla. Y por eso el
> selector tiene **botón de probar**: es lo único que distingue "elegí este sonido" de
> "elegí un nombre que no existe".

**El botón de probar toca el archivo, no manda un aviso.** Va por `afplay` en Rust
(`preview_notice_sound`) y no por rodio, que es lo que toca la campana: los sonidos
del sistema son `.aiff` y los decodificadores de rodio son wav, mp3, flac y vorbis —
sonarían la mitad, y los que no, en silencio. Tocar el archivo en vez de mandar un
aviso también evita dos cosas: depender del permiso de notificaciones, y llenar el
centro de avisos de pruebas. Con "el que use el sistema" el botón se **apaga**: ese
valor no es un archivo, es un nombre que macOS resuelve al mandar el aviso.

> **I** — **El aviso de la campana llega mudo, y el "mudo" viaja en la copia.** La
> campanada ya está sonando cuando llega; las dos cosas en el mismo instante se
> escuchan como un solo sonido reventado. `NoticeCopy.silent` va junto al texto y no
> lo decide quien manda, por lo mismo que el texto: si cada llamador lo eligiera, el
> botón de probar de Dev Tools sonaría distinto al aviso real. En Rust viaja como
> `Option<String>` y `send_alert` **no llama** a `.sound()` — no un nombre vacío, que
> sería mudo por accidente e indistinguible de un typo.

**La campana del timer no está acá, está en Apariencia (§4.28)**, y no es un
descuido: este sonido es parte de un aviso que se puede apagar; la campana suena
siempre que corras un timer.

> **I** — **Los tres botones de prueba de Dev Tools mandan el texto de verdad**, no
> una copia. El del cierre usa la misma constante `SHUTDOWN_NOTICE` que el
> recordatorio; los otros dos piden el texto a Rust
> (`preview_meeting_notice` / `preview_bell_notice`), porque ahí viven
> `notice::copy` y `bell::copy`. Un botón que escribe su propia versión prueba un
> aviso que no existe, y el desacuerdo no se nota hasta que llega el real. Si
> agregas un aviso, su texto va en una función y el botón la consume.

---

### 4.28 Configs → Apariencia (Mej.1)

Cómo se **ve** y cómo **suena** sunrise: la campana del timer y la tipografía. Son
dos cosas y una sección porque ninguna cambia qué hace la app ni cuándo, solo cómo se
presenta.

**La campana.** `bell_sound` tenía valor sembrado desde la migración 2 y ningún
consumidor (era la deuda D4). Ahora manda:

| Valor | Qué suena |
|---|---|
| `SUNRISE` | la síntesis interna (un cuenco tibetano aproximado) |
| un nombre de archivo | ese audio, de la carpeta `sounds` del directorio de datos |
| ausente, vacío, o un archivo que ya no está | la síntesis |

> **I** — **Manda el ajuste, no la presencia del archivo.** Antes bastaba con dejar
> un audio en el directorio de datos y sonaba; con eso no había forma de volver a la
> campana de la app sin ir a borrarlo. La migración 12 reescribe el valor sembrado
> (`'bell'`, que era un tronco de nombre) a `SUNRISE`, y el efecto que hay que
> nombrar es que **un archivo dejado a mano deja de sonar** hasta elegirlo desde
> Configs. Es a propósito: la copia a mano era el diseño provisorio de cuando no
> había picker.

> **I** — **El audio se valida decodificándolo, no por su extensión.** `play_bell`
> cae a la síntesis cuando el decoder falla, **y en silencio**, porque una campana
> que revienta no puede tumbar el timer. Sin validar al copiar, elegir un archivo que
> rodio no entiende se vive como "elegí mi mp3 y sigue sonando el de la app".
> `install_bell` lo abre con `Decoder::new` y devuelve el error mientras la persona
> mira el diálogo. Y el ajuste se escribe **con el nombre que devuelve Rust**: si la
> copia falla, la campana que sonaba sigue sonando.

Queda **una sola** campana propia: al instalar una, los audios que había en la
carpeta se borran. Y es una subcarpeta (`sounds/`) y no el directorio de datos a
secas justamente por eso — borrar audios en la carpeta que además tiene la base de
datos es pedir un accidente.

**Volver a la campana de sunrise borra la copia.** No se guarda "por si acaso"
porque no habría por si acaso: `bell_sound` guarda un nombre solo, así que al volver a
`SUNRISE` ese nombre se pierde y el archivo queda sin nadie que lo nombre. Lo que se
borra es la copia; el original sigue donde lo eligieron, y la nota de la card lo dice
antes de que lo aprieten. **El ajuste se escribe primero y el borrado después**: al
revés, un borrado exitoso con un `set` que falla dejaría el ajuste nombrando un
archivo que ya no está — sonaría la síntesis y la card seguiría diciendo otra cosa.

**La tipografía son dos ajustes, no uno**: `font_title` y `font_body`. Son dos roles —
los títulos aguantan una fuente con carácter y el cuerpo necesita una que se lea en 12
px— y con una sola clave elegir la de los títulos cambiaría las dos sin decir por qué.
Cada una guarda uno de dos centinelas o **el nombre de una familia instalada**:

| Valor | Qué se usa |
|---|---|
| `SUNRISE` | la de fábrica: **Sora** en títulos, **Manrope** en el cuerpo |
| `SYSTEM` | `system-ui`, sin nombrar familia — la única forma de pedir la del sistema que sigue andando si le cambian el nombre |
| una familia | esa, entre comillas, **más la pila de respaldo detrás** |

Los centinelas van en MAYÚSCULAS para no poder chocar con un nombre de familia real,
que siempre viene capitalizado normal.

**La lista de familias la da Core Text, no la carpeta de fuentes** (`fonts.rs`, con la
crate `core-text`): el nombre que necesita el CSS es el de la **familia** (`Helvetica
Neue`) y el del archivo no lo es (`HelveticaNeue.ttc`), así que sacarlo del nombre de
archivo obligaría a parsear las tablas de cada fuente para llegar a lo que el sistema
ya sabe. Son ~180 familias, así que el selector tiene búsqueda.

> **I** — **La lista se filtra, y no por prolijidad.** Se van las de puntito
> (`.AppleSystemUIFont`, internas de macOS, que CSS no puede pedir por nombre) y **las
> de símbolos y dingbats** (`Symbol`, `Wingdings 2`, `Zapf Dingbats`). Esas sí se
> pueden pedir, y ese es el problema: con una puesta, cada letra de la app sale como un
> cuadrito, y volver atrás habría que hacerlo a ciegas. Las numeradas se filtran por
> palabra y no por nombre exacto, o la lista se queda corta con la próxima versión de
> macOS.

> **I** — **Toda elección arrastra la pila de respaldo.** Una familia desinstalada no
> resuelve, y sin la pila la app se quedaría con la fuente por defecto del webview —una
> serif—: un cambio de tipografía no puede verse como "la app se rompió". Por eso el
> parser **no** valida contra la lista de instaladas: la lista solo existe dentro de la
> app, y el CSS ya hace lo correcto solo.

Se aplica **sobreescribiendo los tokens** `--font-title` / `--font-body` en `<html>`,
no tocando componentes: todo el CSS ya los usa. Con `SUNRISE` la propiedad se **borra**
en vez de reescribirse, para que el valor vuelva a salir de `tokens.css` y no haya dos
lugares diciendo cuál es la fuente de la app. Cada selector muestra debajo una frase de
ejemplo con la fuente puesta y en el tamaño de su rol: es lo único que responde "¿cómo
se ve?" sin cerrar Configs.

> **I** — **La tipografía llega al taxímetro por `localStorage`, igual que el tema.**
> Los valores viven en `settings` —son ajustes—, pero el taxímetro es otra ventana con
> su propio documento y **no monta el store de ajustes**: es una ventana chica que
> solo muestra el timer. La ventana principal manda y espeja el valor; el taxímetro
> lo aplica al arrancar y sigue el evento `storage` (§5.2). La base sigue siendo la
> fuente de verdad; el espejo es el canal. Sin esto, la app en la fuente del sistema
> con el taxímetro en Sora se ve partida.

## 5. Sincronización de estado — LEER ANTES DE TOCAR

Hay **tres** capas de estado, y ninguna es un store global único:

| Capa | Contenido | Alcance |
|---|---|---|
| `useAppStore` (`src/lib/store.ts`) | modal de compose, `dataVersion` | **por ventana** |
| `useTimerStore` (`timerStore.ts`) | timer (respaldado en DB), `last` | **por ventana** |
| `useBoard` (`useBoard.ts`) | tasks/categories/objectives + acciones | **por componente** |

### 5.1 El patrón: invalidación manual por contador

`dataVersion` es un contador. Cada vista lo observa y recarga cuando cambia:
`useBoard`, `FocusView`, `BacklogView`, `WeeklyPlanningView`, `Sidebar`.
**Toda mutación tiene que llamar `bumpData()`** o las otras vistas quedan
obsoletas. No hay invalidación automática ni eventos desde Rust.

### 5.2 El canal entre ventanas: `localStorage`

Rust nunca emite eventos de datos. La comunicación `main` ↔ `floating-timer` es
`localStorage` + eventos `storage` (que **no** se disparan en el documento que
los origina — de ahí que el timer sea un store y no estado local por
componente).

| Clave | Escribe | Escucha |
|---|---|---|
| `sunrise-timer` | `timerStore` (start/stop/dismiss) | `useTimerRuntime` (ambas ventanas) |
| `sunrise-last-task` | `timerStore` | `useTimerRuntime` |
| `sunrise-data` | `bumpData()` | `useDataSync` en `main` (invalida las vistas) + `useTimerRuntime` (refresca el timer) |
| `sunrise-theme` | `theme.ts` | `timer.tsx` |
| `sunrise-tax-pos` | la propia ventana flotante | `useFloatingWindow` al mostrarla |

### 5.3 El cruce de ventanas: `useDataSync`

`bumpData()` hace dos cosas: incrementa `dataVersion` **en la ventana que lo
llama** y escribe `sunrise-data`. Del otro lado, **`useDataSync()`**
(en `src/lib/store.ts`, montado por `Shell` en `App.tsx`) escucha ese `storage`
e invalida las vistas de `main`. Sin ese eslabón, completar una tarea desde el
taxímetro quedaba bien guardado pero dejaba la semana, Today, el backlog y el
sidebar mostrando lo viejo.

Dos detalles del diseño que hay que respetar:

- **`useDataSync` llama `markDataStale()`, no `bumpData()`.** Los eventos
  `storage` no se disparan en el documento que los origina, así que quien
  escribe nunca se escucha a sí mismo; el riesgo real es **responder**: si al
  recibir el aviso se volviera a escribir en el canal, la otra ventana recibiría
  ese eco, respondería a su vez, y las dos quedarían recargándose en ping-pong
  para siempre. Por eso el store expone las dos acciones por separado.
- **Va en `Shell`, no en `useTimerRuntime`.** Ese hook corre en las dos
  ventanas, y el taxímetro no tiene vistas que dependan de `dataVersion`.

Cuando M3 traiga el poller de ICS mutando datos desde Rust, el evento de Tauri
puede entrar por esta misma puerta llamando a `markDataStale`.

### 5.3.1 El día también es estado (`useDayWatcher`)

Una app de escritorio se queda abierta cruzando la medianoche. El escenario
real: el Mac se suspende a las 19:00 y despierta a las 9:00 del día siguiente.
Nada le avisaba a la app, así que Today seguía mostrando ayer —con título y
todo—, la semana se quedaba en la anterior si el salto cruzó un domingo, y el
la limpieza de días viejos no corría hasta el primer click que provocara una
recarga.

**`src/lib/day.ts`** es la única fuente de "qué día es hoy":

- `useToday()` (sobre `useSyncExternalStore`) devuelve el día y **re-renderiza
  cuando cambia**. Las vistas ya no llaman `todayISO()` al renderizar.
- `useDayWatcher()`, montado una sola vez en `Shell`, revisa en `focus`,
  `visibilitychange` y un intervalo de 60s. Los tres hacen falta: si la ventana
  nunca se ocultó ni perdió el foco —justo el caso de la suspensión— los dos
  primeros no se disparan nunca.
- Al detectar el salto llama **`markDataStale()`** (no `bumpData`: esto corre
  solo en `main` y el taxímetro no tiene vistas que dependan de `dataVersion`).
  Con eso `useBoard` recarga y **la degradación corre sola** (§4.2), porque su
  guarda ya es por fecha.

La comparación es de **fechas de reloj**, nunca de tiempo transcurrido: macOS
suspende y agrupa los temporizadores al dormir, así que el intervalo puede
disparar tarde, una vez o ninguna. Una comparación pura acierta se ejecute
cuando se ejecute; con lógica de "pasaron N ms" habría que adivinar cuánto
durmió la máquina.

**`WeekView` necesita más que invalidar**: hay que mover su `anchor`, y solo si
corresponde. `anchorAfterDayChange` (en `src/features/week/anchor.ts`) devuelve
`null` —dejar quieta la vista— en dos casos: si la semana visible no contenía el
día anterior (el usuario navegó a otra semana a propósito y saltarle la vista
bajo el cursor sería peor), y si el día nuevo ya cae en la semana visible
(dormir el viernes, despertar el domingo: mismas siete fechas, recargar sería de
gusto).

### 5.4 Trampas del taxímetro (documentadas a golpes)

En `useFloatingWindow.ts`, ya pagadas:

1. **`show()` va primero y aislado.** Si antes se llama algo no soportado en la
   plataforma (p. ej. `setVisibleOnAllWorkspaces`), lanza y la ventana no
   aparece. Los ajustes best-effort van después, cada uno en su `attempt()`.
2. **El valor de `visible` tiene que ser estable.** Si se le pasa el objeto
   `display` (cuya identidad cambia con cada tick del reloj), `show()` corre una
   vez por segundo y la ventana roba el foco sin parar. Por eso `App.tsx` pasa
   `!!(s.active || s.last)`, un booleano.
3. **Dos controladores para la misma ventana**: `useFloatingWindow` en `Shell`
   (main) y `useSelfVisibility` en `FloatingTimer` (la propia ventana). Es
   redundancia deliberada, pero si tocas una considera la otra.
4. **Todo lo que se superponga a la tarjeta cuenta como control para
   `useDragOrClick`.** El hook decide click-vs-arrastre y descarta los eventos
   que caen en `button, .tax__opts`. El panel de opciones aparece deslizándose
   *bajo el cursor*, así que un click que empieza en el título puede terminar
   soltándose encima de él: si no estuviera en esa lista, ese `pointerup`
   abriría Focus y la ventana principal saltaría sola. Si agregas otra capa
   flotante al taxímetro, súmala al selector.
5. **No uses `:hover` de CSS en el taxímetro.** La ventana casi nunca tiene el
   foco y en macOS los eventos de mouse van a la ventana *key* (tao registra el
   hover con el `addTrackingRect` legado, que es solo para ella). El modo de
   falla no es que no encienda: es que **enciende y no apaga**, porque llega la
   entrada y no la salida. El panel quedaba pegado hasta que volvías a pasarle
   el mouse por encima. Un hover que sabe prender pero no apagar es peor que
   ninguno, así que el `:hover` se sacó del CSS.

   Quien manda es `useCursorHover`: sondea `cursorPosition()` —posición global
   del puntero, independiente del foco— cada 120ms y prende
   `is-hover-controls` haciendo hit-test contra la **envolvente** de los rects
   del botón y del panel (la envolvente, no cada caja, para que el hueco de 4px
   entre ambos no cuente como afuera). Solo corre mientras hay algo que mostrar
   — el webview sigue vivo con la ventana oculta.

   **Las dos coordenadas no vienen en la misma escala.** `cursorPosition()`
   multiplica por la escala del monitor **principal**;
   `outerPosition()`, por la de **su propia ventana**. Con un solo monitor
   coinciden y restarlas en crudo parece correcto; con dos de distinta densidad
   —un externo 1x junto al Retina— quedan en unidades distintas y la resta no
   significa nada. Hay que pasar cada una a lógicas con su propia escala antes
   de restar. Este bug dejó el sondeo sin acertar ni una vez y no se veía con un
   solo monitor. `acceptFirstMouse: true` en
   `tauri.conf.json` es lo que hace que además el **click** funcione a la
   primera sin activar la ventana antes.

   **Necesita `core:window:allow-cursor-position` en
   `src-tauri/capabilities/default.json`.** Sin ese permiso la llamada se
   rechaza, y como el sondeo atrapa el error para no dejar el panel clavado
   abierto, el síntoma es que el hover sin foco simplemente no funciona, sin una
   sola línea en la consola. Ya pasó una vez. Por eso ahora el `catch` avisa
   —una vez, no una cada 120ms—. Y ojo: las capabilities se compilan dentro de
   la app, así que tocarlas obliga a reiniciar `pnpm tauri dev`; con recargar el
   webview no basta.

---

## 6. Invariantes — no romper

- **I1. `actual_seconds` ACUMULA; nunca se recalcula desde `time_entries`.**
  `stop_timer` hace `actual_seconds = actual_seconds + seconds`. Recalcular
  desde las entradas pisaría los ajustes manuales de tiempo.
- **I2. Los ajustes manuales de tiempo pasan por `set_actual_seconds`**, que
  además inserta una **entrada cerrada con el delta** para que el rollup
  semanal siga cuadrando. Por eso `update_task` desvía `actual_seconds` a esa
  función en vez de escribir la columna. No lo cortocircuites. **Subir es una
  entrada; recortar pueden ser varias** —una por día, topada a su saldo
  (`spread_cut`, §4.15)—, porque el trabajo de una tarea puede estar repartido en
  varios días y una sola fila negativa deja alguno bajo cero.
- **I3. `base_seconds` es `seconds_today`, no el total histórico.** El contador
  del taxímetro cuenta lo trabajado **hoy**: una tarea arrastrada al día
  siguiente arranca en 0 aunque su acumulado sea mayor.

  Tres reglas que sostienen esa frase, las tres pagadas con un contador que
  mostraba `-14:-17:-39`:

  1. **`seconds_today` tiene piso en 0** (`MAX(0, …)`). El delta negativo de un
     ajuste manual (I2) puede superar lo trackeado hoy, y un tiempo trabajado
     negativo no es correcto nunca.
  2. **Lo corrido se mide desde la medianoche**, no desde `started_at`
     (`runSeconds` en `timerStore.ts`). Si no, un timer que quedó abierto toda
     la noche muestra 15 horas a las 9 de la mañana, y el contador dejaría de
     ser "lo de hoy" justo cuando más se nota.
  3. **`stop_timer` parte la corrida por día local** cuando cruza una
     medianoche (`segments_by_local_day`). El tiempo se atribuye por
     `started_at`, así que una sola fila de 15h le acreditaría todo al día en
     que empezó y cero al siguiente. Esto no es solo del taxímetro: el rollup
     diario de M3 (§3.5, regla 2) agrupa por día leyendo esta tabla, y con filas
     que cruzan días esa regla es inimplementable sin aritmética de solapamiento
     en cada consulta. Se corrigió en la escritura, una vez, en vez de en cada
     lector. El último tramo absorbe el resto de la división para que la suma de
     las filas siga dando exactamente el total (I1).
- **I4. Un solo timer activo.** Solo puede existir una fila de `time_entries`
  con `ended_at IS NULL`; `start_timer` llama a `stop_timer` primero.
- **I5. Estado y timer se mueven juntos, y eso vive en Rust.** Dos reglas
  simétricas: `set_task_status(DONE)` **detiene** el timer si la tarea
  completada era la activa, y `start_timer` **reabre** la tarea si estaba `DONE`
  (`status = 'TODO'`, `completed_at = NULL`) — volver a trabajar en algo es
  decir que no estaba terminado. Están en `repo.rs` y no en cada vista para que
  valgan desde semana, Today, Focus, el modal y el taxímetro, que son cinco
  lugares con botón de play. **Corolario: quien llame `setTaskStatus` debe hacer
  `bumpData()` después**, porque el estado del timer pudo cambiar (`start` ya lo
  hace solo).
- **I6. Lo que depende del reloj y tiene que pasar aunque no mires, va en Rust.**
  La campana del estimado lo aprendió a la mala (§4.6): estaba en el `tick` de un
  webview, y un webview que no se ve no corre sus timers, así que no sonaba con la
  ventana tapada. Vive en `bell.rs`. Lo que **sí** puede vivir en el front es lo
  que solo importa cuando estás mirando —el dibujo del taxímetro— y lo que igual
  necesita una ventana; eso último, montado en `Shell`, que solo existe en `main`,
  para que no ocurra dos veces (el aviso de cierre, el updater). **El respaldo
  automático siguió el mismo camino que la campana** (§4.17): llegaba cinco minutos
  tarde por lo mismo, y ahora lo corre `backup.rs`. Con dos casos medidos, lo que
  queda en el front por "necesita una ventana" hay que justificarlo, no heredarlo
  — el aviso de cierre es el próximo candidato y su costo es el envío, que hoy
  pasa por el plugin de JS.
- **I7. Los listados filtran `source_state = 'ACTIVE'`.** Las `ORPHANED` existen
  solo para el historial y la review. **La única excepción es el tiempo del
  rollup compartido** (`work_by_day`, §4.15 y §4.16), que las cuenta a
  propósito: son historial, y filtrarlas borraría horas reales de semanas pasadas.
- **I8. Enums en MAYÚSCULAS**, espejados `migrations.rs` ↔ `enums.ts`.
- **I9. Las migraciones aplicadas son inmutables**: se agrega una versión nueva.
- **I10. Todo acceso a datos pasa por `src/lib/ipc.ts`**, con su gemelo en
  `mockDb.ts`. Ningún componente llama `invoke` directo.
- **I11. Toda mutación llama `bumpData()`.** No hay invalidación automática: es
  lo que hace que el resto de las vistas —y la otra ventana— se enteren (§5.3).
  Para invalidar **sin** avisar hacia afuera está `markDataStale()`, que existe
  solo para el listener que recibe esos avisos.

---

## 7. Convenciones de UI (pedidas explícitamente)

> **El español es de Chile, no del Río de la Plata.** La app le habla al usuario
> de **tú**, nunca de vos: "puedes", "quieres", "incluye", "sube", "mira",
> "cierras" — no "podés", "querés", "incluí", "subí", "mirá", "cerrás". Vale para
> todo lo que se ve en pantalla, los `aria-label` y los mensajes de las
> notificaciones. Ya se colaron formas de voseo dos veces, así que si escribís un
> texto nuevo, releelo buscando imperativos y segundas personas.
>
> Lo que **sí** es chileno y se usa: "acá", "recién", "de una". Lo que no: el
> "che", los diminutivos en -ito de relleno, y el "ojo que" en la UI (en
> comentarios de código está bien).

> **La ventana no tiene barra de título, y eso reparte responsabilidades.**
> `titleBarStyle: "Overlay"` deja los botones nativos de macOS flotando sobre el
> contenido, así que **el hueco de arriba lo tiene que dejar el CSS**: el token
> `--titlebar-h` (28px) lo reservan el padding del sidebar y el de `.app-main`.
> Bajarlo en un solo lado deja el título de una vista debajo de los botones. Es un
> número fijo y Tauri avisa que **el alto real de la barra cambia entre versiones
> de macOS**: si algún día los botones se ven pegados o sobrados, se ajusta acá y
> las dos columnas se corrigen juntas.
>
> **Las dos columnas reservan el mismo alto por razones distintas**, y por eso el
> respiro que se le suma es el mínimo (`--space-1`) en las dos: en el sidebar es
> por los botones nativos, que flotan sobre esa columna y **obligan** a no bajar de
> `--titlebar-h` —menos que eso mete la marca abajo del semáforo—; en `.app-main`
> los botones no llegan nunca, y lo que hay que despejar es la zona de arrastre,
> que es `fixed` y se comería los clicks de lo que quedara debajo. Sin barra de
> título que llenar, un respiro más grande era aire: la primera fila de contenido
> arranca 4px debajo de la franja, en las dos columnas y por construcción.
>
> Tauri documenta además una limitación del modo `Overlay` que no es nuestra y no
> tiene arreglo desde acá: **con la ventana sin foco, arrastrarla no funciona** al
> primer click. Hay que activarla y después moverla.
>
> Sin barra de título tampoco hay de dónde tomar la ventana para moverla: eso lo
> da `.app-dragbar`, un `div` fijo con `data-tauri-drag-region` que cruza todo el
> borde superior. **No declara `z-index` a propósito** — siendo `fixed` ya queda
> sobre el contenido estático, y sin declararlo cualquier elemento posicionado
> que venga después en el DOM le gana. Eso importa porque las tabs de Configs son
> `sticky` y los modales se abren encima de todo: con un `z-index` propio, la
> franja les comería los clicks del borde superior y se vería como un control que
> no responde.
>
> **El sidebar se colapsa a un rail de 84px**, y ese número tampoco es estético:
> tiene un piso en 68px, que es hasta dónde llegan los botones nativos —un rail más
> angosto los dejaría montados sobre su borde—, y por encima de ese piso manda el
> aire. Los botones del rail son **cuadrados de 44px centrados**, no cajas
> estiradas de borde a borde: estiradas, el recuadro de hover llegaba a los dos
> bordes y se leía torcido aunque midiera simétrico. El estado vive en `localStorage`
> (`sunrise-sidebar-collapsed`), se estampa como `data-sidebar` en `<html>` para
> que cualquier vista pueda consultarlo, y dibuja con la clase `is-collapsed`.
> **Los dos anchos son literales en `global.css`, no tokens**, y el shell es flex y
> no grid: el ancho se anima, y en grid vivía en la pista, que no interpola —medido,
> la columna se quedaba quieta casi un segundo y después saltaba—. En flex el ancho
> es del elemento, que es el caso normal de una transición; a cambio hay que darle
> `min-width: 0` a `.app-main` o las columnas de la semana dejan de encoger.
> La ventana flotante del taxímetro **se sale del `color-scheme`** (`normal` en
> `.timer-body`): es `transparent: true` y un esquema declarado le pinta el canvas
> raíz, que es justo lo que no puede tener. No pierde nada — ahí no hay scrollbars
> ni controles nativos.
>
> Colapsado se esconde el texto por CSS, con dos excepciones que sí cambian el
> render: **los contextos del backlog no se dibujan** (un punto de color sin su
> nombre no dice cuál es) y **el aviso del updater sí se mantiene**, como icono,
> porque es la única señal de que hay una versión nueva (§4.23).
>
> El colapso **no se anima**. Animar `grid-template-columns` cuando el valor viene
> de una custom property no interpola: medido en el navegador, el ancho se queda
> quieto casi un segundo y después salta, que se siente como un click perdido.
>
> El **botón de colapsar vive arriba**, al lado de la marca, y colapsado se apila
> bajo ella. Abajo se leía como un item de navegación más. El **tamaño de los
> iconos lo pone el CSS** y no el prop `size` de lucide (19px expandido, 22px
> colapsado): el prop es un atributo del `<svg>` y no sabe en qué estado está el
> sidebar. Lo mismo vale para `SunriseMark` (21/26px), que va un pelo más grande
> que los iconos porque es la marca y no un item más — y por la misma razón hay que
> acordarse de ella al cambiar los tamaños: tiene su propio prop `size` y no se
> entera.

> **Las barras de scroll se dibujan a mano, y `color-scheme` no reemplaza eso.**
> `color-scheme` (§7, tokens) pinta la barra nativa del color del tema y arregla
> los `<select>` y el caret, pero **no cambia su forma**: WebKit en macOS dibuja
> barras *overlay* —finas, superpuestas, que se esconden solas— y el navegador
> dibuja las clásicas, anchas y siempre visibles. Son dos implementaciones y no hay
> propiedad que salte de una a la otra, así que la que se quería hubo que dibujarla
> con `::-webkit-scrollbar` (pulgar de 6px con zona de agarre de 12, vía `border`
> transparente más `background-clip: content-box`).
>
> **El precio es 12px permanentes** en cada contenedor que hace scroll: una barra
> dibujada deja de ser overlay. Se aceptó porque una barra que aparece y desaparece
> sobre las columnas de la semana tapa el borde de las cards justo cuando las estás
> mirando. Ojo con dos consecuencias al agregar un contenedor con scroll: si su
> ancho está calzado a mano, ahora le faltan 12px; y **si su contenido tiene que
> quedar centrado, la barra lo corre**, porque ocupa de un solo lado.
>
> **El sidebar es la excepción: no muestra barra** (`.sidebar::-webkit-scrollbar`
> en 0). Sin eso el rail colapsado se ve torcido, que fue el síntoma reportado. El
> primer intento fue `scrollbar-gutter: stable both-edges`, que reserva a los dos
> lados y **en el navegador funciona** —medido, simétrico— pero **el webview de
> macOS no lo honra**: reserva solo a la derecha y el rail queda corrido igual. Es
> el caso de manual de por qué esto se verifica en la app y no en el browser. Se
> pierde poco: son diez items que rara vez pasan del alto de la ventana, y la rueda
> y el trackpad siguen desplazando.

> **Hay clases compartidas entre features, y eso es intencional.** `shutdown.css`
> usa `.review__panel`, `.review__h2`, `.review__head`, `.review__cifras`,
> `.chip-cifra` y `.cifra` de la weekly review, y `.repaso__row` /
> `.repaso__acciones` del ritual diario. Son la misma familia de vistas —mirar
> hacia atrás— y duplicar los estilos garantizaba que se separaran con el primer
> retoque. **Consecuencia: restilar la review toca la bitácora.** Si vas a
> cambiar una de esas clases, mira las tres vistas.
>
> El otro caso es `.sync-btn` / `.resp-btn` en `week.css`: **una sola definición
> con dos nombres**. El botón plano del sync de calendarios y las acciones de
> Respaldo tienen que verse idénticos, y dos reglas separadas se habrían separado
> en el primer ajuste. El icono va en 13px en los dos.

- **La marca: un sol saliendo sobre el horizonte, y un solo archivo.**
  `public/app-icon.svg` es la fuente: de ahí sale el icon set del `.app` y del
  `.dmg` (`pnpm tauri icon public/app-icon.svg`, que reescribe todo
  `src-tauri/icons/`) y de ahí sale el favicon de las dos ventanas. **No editar
  los PNG a mano**: se regeneran.

  Dos formas macizas y nada más, sol y horizonte. Rayos, nubes o reflejos son
  trazos finos que a 32px se vuelven suciedad, y 32px es el tamaño en que un icono
  se usa de verdad. El cielo del icono es oscuro aunque la app sea clara: vive en
  el Dock sobre el fondo de pantalla de cualquiera, y un sol pastel sobre un cielo
  pastel desaparece. Los colores siguen siendo los tokens (`apricot`, `butter`,
  `ink`, `surface`); lo que cambia es la relación entre ellos.

  Dentro de la app la marca es `SunriseMark.tsx`, que es la misma figura **sin el
  cielo**: el horizonte va en `currentColor` —hereda el color del texto que la
  acompaña y se aclara solo en tema oscuro— y el sol en los tokens de la paleta.
  El apricot queda arriba y el butter abajo, no al revés: el borde superior es la
  única silueta que la separa del fondo, y butter sobre el `--surface` claro no se
  ve. Los ids de los degradados salen de `useId()`, porque dos marcas montadas a
  la vez con el mismo id hacen que el navegador resuelva las dos referencias al
  primer `<defs>`, y una de las dos deja de responder a su propio degradado sin
  que nada falle.

  Reemplazó al `.sidebar__brand-dot`, que escalaba perfecto pero era un círculo
  pastel más.

  **`pnpm iconos` deja `icon.icns` modificado aunque el dibujo sea idéntico**, y
  no es que algo haya cambiado: el generador escribe las entradas del contenedor
  en orden distinto cada vez (una corrida empieza en `ic10`, la siguiente en
  `ic08`), así que difiere el 99% de los bytes con el mismo tamaño exacto. Si
  regeneras y **solo** cambia ese archivo, descártalo con
  `git checkout src-tauri/icons/icon.icns`: los PNG, que sí son deterministas, son
  la señal de si el dibujo cambió de verdad.

  Ojo con el SVG del icono: **es XML**, así que un comentario no puede contener
  dos guiones seguidos. Nombrar un token como `--ink` ahí lo vuelve ilegal y
  `tauri icon` falla con un error de parseo que no menciona el logo. Hay un test
  que lo agarra (§8).

- **Las secciones de Configs salen de una lista, no de cada card.**
  `src/features/settings/secciones.ts` define orden, nombre e icono, y de ahí lo
  toman las dos partes: la tab del menú y el título de la card. Vive en su propio
  módulo porque dos cards (`FeedsCard`, `BackupCard`) son de otros módulos y
  también necesitan su icono — importarlo desde `SettingsView` sería un ciclo, ya
  que la vista las importa a ellas. **El orden de las cards tiene que seguir al de
  la lista**: el resaltado lo decide un `IntersectionObserver` sobre las secciones,
  así que si divergen el menú marca una y se ve otra.

- **La distribución no se rediseña sobre la marcha.** Ante una duda de layout, la
  respuesta sale de lo que ya existe —la vista hermana, la card equivalente, el
  modal que resuelve el mismo problema— y no de una variante "mejorada" inventada
  para el caso. Es una app de uso diario: la consistencia entre vistas vale más
  que la mejor idea suelta, porque la mano ya aprendió dónde está todo.
- **Todo el texto de la app va en español**: labels, placeholders, `aria-label`,
  `title`, errores, historial, días y meses. Las excepciones son el **sidebar
  completo** (Home, Today, Focus, los ítems de Daily y Weekly, Backlog y los
  rótulos "Daily rituals" / "Weekly rituals"), porque funcionan como nombres
  propios de la app y no como etiquetas traducibles —"Daily shutdown" es el nombre
  del ritual, igual que "Focus"—, y los **títulos de vista
  que espejan una entrada del sidebar**, que si se traducen dejan la página
  diciendo algo distinto del link que lleva a ella. La única entrada del sidebar
  traducida es **Settings → Configs**, y el `<h1>` de la vista dice lo mismo que
  el link del sidebar. Los formatos numéricos (`hms`,
  `formatMinutes`, `shortDuration`) no tienen idioma. El menú nativo de macOS
  queda en inglés: lo genera `Menu::default` de Tauri, y traducir solo nuestro
  ítem de Quit dejaría el submenú a medias.
- **Las fechas se formatean con los helpers de `src/lib/date.ts`**, que ya
  llevan el locale `es` por llamada (no con `setDefaultOptions`, que además
  movería los límites de semana). No es traducir tokens: en español el día va
  antes del mes ("10 de agosto", no "agosto 10") y date-fns devuelve los días en
  minúscula, así que `weekdayLabel` capitaliza. Los componentes de terceros
  traen su propio texto: `<DayPicker>` necesita `locale={es}` en cada uso.
- **Autosave siempre. Nada de formularios planos con botón "Guardar".**
- **Pero una fila con varios controles no se guarda en el blur de un campo.** El
  blur del primero confirma la operación y desmonta la fila a mitad de camino.
  Pasó dos veces: la fila de feeds al pasar de Nombre a URL (§3.1) y la de alta de
  canales al ir a elegir el color. El patrón es `AddRow` en `SettingsView.tsx`:
  el `onBlur` va **en la fila** y solo cuenta si `relatedTarget` cayó afuera, y el
  control que abre el popover hace `preventDefault` en el `mousedown`
  (`keepFocus` en `ColorDot`). La segunda defensa es la que sostiene el caso real
  —si el click en el botón no lo enfoca (se reporta de WebKit y no está verificado
  acá) el foco se va al `body` y el blur llega con `relatedTarget` en `null`,
  indistinguible de irse de la fila; el `preventDefault` no depende del motor— y va
  **opt-in**, porque las filas de renombre dependen del blur contrario.
  Se testea con `userEvent`: `fireEvent.click` no mueve el foco y el test pasaría
  con el bug puesto.
- **El corrector ortográfico va solo donde hay prosa.** En macOS el webview
  corrige, subraya y **capitaliza al salir del campo** todos los `input`, y llega a
  cambiar lo escrito. Un campo que no es prosa spreadea `PLAIN_INPUT`
  (`src/components/plainInput.ts`), que apaga `spellCheck`, `autoCorrect` y
  `autoCapitalize`. Queda encendido en el **título y las notas de una tarea**. Para
  un campo nuevo la pregunta no es si molesta el subrayado, es si alguien
  escribiría ahí una frase.
- **El botón de confirmar es salvia, no naranjo** (`.btn-primary`, tokens
  `--sage`/`--sage-ink`). El damasco de la paleta es **el mismo tono** que el
  semáforo de capacidad usa para "te pasaste" (`--cap-over`), así que un botón de
  aceptar en naranjo se lee como una advertencia. El naranjo queda para lo que
  avisa. Y todo botón de acción lleva **su icono** (`lucide-react`) además del
  texto.
- **La paleta de categorías son 24 colores en tono medio, y se eligieron midiendo,
  no a ojo.** Cada color son **tres** tokens: el color (`--rose`), su `-ink` para
  el texto encima, y para el verde además dos sólidos (`--mint-solid`,
  `--sage-solid`). Tiene que sobrevivir a
  cuatro usos: el punto a saturación completa (`SearchSelect`, el sidebar, el
  donut), el chip al 35% (`.cat-tag`), el bloque del rail al 18% (`CalendarRail`)
  y el `-ink` como texto **y como punto sólido** (los highlights del shutdown).
  Son los tintes los que traicionan: **dos matices que se distinguen a full
  colapsan al 18%**, así que mirar las muestras del picker no sirve para decidir.

  El criterio fue distancia perceptual (ΔE en Lab) contra todos los demás en los
  tres fondos, tomando el mínimo. Quedó en **ΔE mínimo 8.1**; la paleta pastel
  anterior estaba en 4.2, y el síntoma era el reportado: una lista de canales
  difícil de seguir porque los puntos se parecían todos.

  > **Tres caminos medidos y descartados**, porque los dos primeros parecen la
  > respuesta obvia. **Un anillo uniforme** (misma L, mismo croma, matiz cada 15°)
  > da **3.8: peor que la pastel** — 15° de matiz no es un paso perceptual
  > constante y en los verdes y azules casi no se ve. **Optimizar sin
  > restricciones** llega a 13.8 pero rompe los nombres (`sage` sale verde
  > eléctrico, `amber` café): un ΔE mejor con una paleta incoherente es peor
  > producto. Y **croma alto dentro de la caja pastel** (L 80–95) topa en 5.3 — la
  > caja era el límite, no el matiz. Lo que quedó es diseño a mano, con **la
  > luminosidad siguiendo al matiz** como una rueda de pigmentos (los amarillos
  > claros, los azules y violetas más oscuros: a luminosidad constante el amarillo
  > se ve café), y el optimizador gastando el presupuesto solo en los pares que
  > chocaban.

- **Los `-ink` sí cambian por tema; el color no.** El chip pinta el `-ink` sobre
  el color al 35% de un fondo que **sí** cambia, así que un solo hex tiene que
  fallar en un tema: con el hex único, en oscuro el chip quedaba en contraste
  1.1–1.5 (era Mej.28, y el mismo bug hacía ilegible el badge del timer en curso).
  Los 24 están calculados para llegar a **4.6 de contraste** contra el peor de sus
  fondos en cada tema — el mínimo AA para texto chico es 4.5. Van en **las tres
  ramas** de tema, por lo mismo que `color-scheme`, y hay un test que exige los 24
  en las tres: darle variante a uno solo deja el chip de un canal legible y el del
  canal de al lado no, sin ninguna razón visible.

  > **I** — **El color en sí no se redefine por tema**, y eso también tiene test.
  > El punto de un canal siendo de dos colores distintos según el tema rompe lo
  > único que sirve para reconocerlo.
  >
  > **I** — **Un fondo sólido con texto blanco encima no puede salir del `-ink`.**
  > Hay nueve bloques que hacen `background: var(--mint-ink)` con `color: #fff`
  > (el play de Focus y del modal, los cuatro checks): con el ink claro en oscuro,
  > blanco sobre claro no se lee. Usan **`--mint-solid`**, que es fijo en los dos
  > temas. Los fills **sin** texto —el punto pulsante, las barras de progreso— sí
  > siguen al tema, porque un verde oscuro sobre fondo oscuro desaparece. La
  > pregunta al agregar uno es "¿lleva texto encima?", no "¿es un fondo?".
  >
  > **I** — **El 35% es parte de la calibración: el `-ink` no sirve sobre el color
  > entero.** Los 24 están calculados contra el chip **al 35%** y las tres
  > superficies; más concentrado que eso quedan fuera del cálculo, y sobre el color
  > a full llegan a **1.2–2.0 de contraste**, que es texto invisible. Costó tres
  > lugares a la vez —el botón de confirmar (`.btn-primary`, diez llamadores), el
  > icono del diálogo de ritual y el texto seleccionado (`::selection`)—, y en los
  > dos temas por igual, que es lo que lo delató. **La salida no es oscurecer el
  > color**: es uno de los 24 y mover su hex corre los ΔE de toda la familia. Va un
  > sólido: `--sage-solid` (el mismo tono a L 38%, aguanta blanco en 5.5) y
  > `--selection-ink` (el fondo de la selección es `--peach`, que no cambia por
  > tema, así que su texto tampoco puede). Lo vigila un test que **lee todos los
  > CSS** buscando el par exacto.
  >
  > **I** — **Un botón relleno no se apaga con `opacity`.** Bajarle la opacidad
  > acerca el fondo **y** el texto a la superficie al mismo tiempo, así que el
  > contraste se derrumba (2.3 en claro) por más oscuro que sea el relleno. El
  > `:disabled` de `.btn-primary` declara su par: fondo aguado al 22% —donde el
  > `-ink` sí está calibrado— con el `-ink` encima (4.8 y 7.7). Los botones fantasma
  > sí pueden usar `opacity`: ahí solo se atenúa el texto contra una superficie que
  > no se mueve.

- **El canal se dibuja siempre como chip**, nunca como texto teñido: la card de la
  semana, el modal de detalle y `CategoryTag` comparten `.cat-tag` y sacan sus
  variables de `chipVars`. El fondo del chip es lo que se reconoce de reojo en una
  lista; un texto de color con veinticuatro colores en tono medio se lee como
  texto raro. Duplicar el estilo en cada lugar sería la forma de que los tres se
  separen con el primer ajuste.
- **Los diálogos chicos son un componente, no un patrón copiado**
  (`src/components/Dialog.tsx`): confirmar salida (⌘Q), el aviso de "ya
  planificaste", "Lo nuevo", y los dos de Respaldo. Él es dueño del overlay, de
  `role="alertdialog"` + `aria-modal`, del `stopPropagation`, del foco inicial y
  —lo que importa— **de las teclas en `window` con `capture`**. Estaba copiado
  cinco veces y **faltaba en dos**: la confirmación de restaurar, la acción más
  destructiva de la app, no se cerraba con Escape.
  - `onClose` ausente = no se cierra ni con Escape ni con el click afuera, que es
    lo que necesita un diálogo a mitad de una operación irreversible
    (`restaurando`).
  - **`onEnter` va aparte del botón primario a propósito.** En la confirmación de
    restaurar no se pasa, **y el botón destructivo tampoco lleva `autoFocus`**:
    un botón enfocado se activa con Enter, así que el `autoFocus` que estaba ahí
    alcanzaba para reemplazar la base con una tecla. Ahí Escape cancela y confirmar
    es un click.
  - No lo usan `TaskModal` ni `AddFeedModal`: no son confirmaciones sino una vista
    y un formulario, con su propio teclado (⌘Enter, Enter por campo). Comparten el
    `.modal-overlay` y nada más. Las confirmaciones **en línea** de dos pasos
    (borrar tarea, quitar feed) tampoco: no son modales.
  - Los estilos se mudaron de `task-modal.css` a `src/components/dialog.css`, que
    es donde se los busca ahora.
- **Popovers en portal con posición fija** (`src/components/Popover.tsx`). Si no,
  los recorta el `overflow` de columnas y modales, y el ancho queda limitado por
  el contenedor del chip.
  **El foco inicial lo da el `Popover`, no el picker**: monta
  `visibility: hidden` mientras mide su posición, y un `focus()` sobre un
  elemento invisible **no hace nada** —los efectos de mount de `SearchSelect` y
  `TimePicker` caían justo en ese hueco, así que el picker abría con el foco en el
  botón que lo abrió y había que hacer un click más para escribir—. Enfoca el
  primer `input`/`textarea` que tenga adentro cuando ya hay posición; el que no
  trae campo (la paleta de colores, el ánimo, el calendario) no cambia el foco.
- **Selects con búsqueda local** vía `src/components/SearchSelect.tsx`
  (componente único reutilizable). Duraciones vía `src/components/TimePicker.tsx`.
- **Slots de altura fija** en vez de renderizar condicionalmente algo que
  empuje el contenido: mantiene las columnas alineadas.
- **Los controles que aparecen al hover no pueden tener huecos muertos.** Si el
  panel se separa visualmente de su disparador, la zona sensible tiene que
  cubrir igual la separación (envolviendo ambos, o con un `::after` que la
  puentee) o el puntero pierde el hover justo al cruzar y el panel se cierra en
  la cara. Se superponen al contenido en vez de empujarlo
  —si empujan, la caja se reacomoda al pasar el mouse— y entran con `transform`
  además de `opacity`: solo el fundido se siente pegado. Referencia:
  `.tax__opts` en `src/features/timer/timer.css`.
- **Un panel superpuesto que además es zona de drop necesita ganar la colisión a
  mano.** dnd-kit no sabe nada del `z-index`: lo que el panel tapa sigue teniendo
  su rectángulo y sigue compitiendo, así que el `z-index` alcanza para verse
  encima y no para *recibir* el drop. Y como `closestCorners` nunca devuelve
  vacío, el panel también hay que sacarlo de los fallbacks — pero solo cuando hay
  puntero, porque sin él (teclado) los fallbacks son el único camino que queda.
  Referencia: `boardCollision` en `src/features/week/collision.ts`.
- **Los paneles de la tira se abren de a uno.** Se montan todos en el mismo lugar
  (`right: 44px`, 300px), así que dos abiertos se apilan. Es un solo estado con el
  nombre del panel, no un booleano por panel.
- Fuentes de fábrica: **Sora** (títulos) + **Manrope** (cuerpo), auto-hospedadas
  (`@fontsource`) para funcionar offline. Paleta pastel en tokens CSS con tema
  claro/oscuro.

---

## 8. Tests

Obligatorios por milestone. La Fase 0 cerró con **140 tests front y 35 Rust**;
estado actual: **467 tests front (55 archivos) y 181 Rust, todos verdes.**

```bash
pnpm test        # Vitest + RTL
pnpm test:rust   # cargo test (SQLite en memoria)
pnpm test:all    # ambos
TZ=UTC pnpm test:rust   # como corre CI, que es donde aparecen los supuestos de zona
```

**CI corre en UTC y eso es una ventaja, no un estorbo.** El primer tag de la 0.1.0
falló ahí por un bug de zona horaria que llevaba desde el primer commit (§4.12,
`RECURRENCE-ID`): en Santiago pasaba por casualidad. Si un test toca zonas, córrelo
con `TZ=UTC` antes de empujar, y de paso escríbelo con una zona **distinta** a la
tuya — un caso con fixtures en tu propia zona no puede detectar el error.

- **Rust** (`#[cfg(test)]` en `repo.rs` y `sound.rs`): eventos de creación y
  movimiento, degradación selectiva al backlog, acumulación del timer, supervivencia del
  ajuste manual, contador del día que ignora ayer, un solo timer activo,
  completar detiene el timer (y no detiene el de otra tarea), `focus_queue`,
  backlog, síntesis del sonido.
- **Front**: `capacity` (semáforo + parseo), `date`, `history`, `useTimer`,
  `useDragOrClick`, `TaskCard`, `TaskModal`, `Sidebar`, `FocusView`,
  `SettingsView`.
- **El DnD del board**, en las dos piezas puras que jsdom puede mirar:
  `src/features/week/collision.test.ts` (con rectángulos falsos: el panel de
  backlog superpuesto ganando por puntero aunque la columna tapada esté más cerca,
  y su exclusión de los fallbacks solo cuando hay puntero) y
  `src/features/week/destino.test.ts` (`resolveDrop`: los índices de columna y de
  card, el día plegado, backlog→backlog, y la card completada al backlog). **El
  gesto no se testea**: jsdom no devuelve rectángulos, así que se verifica en el
  browser.
- **El posicionamiento del scroll**: `src/features/week/anchor.test.ts`
  (`scrollDelta`: pegado a la izquierda, centrado, una columna ya centrada que no
  mueve nada, el negativo sin acotar y el board más angosto que la columna). Solo
  la aritmética; que hoy quede efectivamente al centro y que la flecha no rebote se
  verificó en el browser.
- **La ventana de la vista semana**: `src/lib/date.test.ts` (`threeWeeks`: tres
  semanas de siete, la del ancla al medio, cada una arrancando en lunes, cortes de
  mes y de año) y `WeekView.test.tsx` (las 21 columnas en orden, un rótulo por
  semana con números consecutivos, los días de atrás apagados, los del ajuste
  plegados salvo hoy, y el click que abre uno plegado). El **scroll y el pegado del
  rótulo no se testean en jsdom**: no implementa `scrollLeft`, no devuelve
  rectángulos y no resuelve `position: sticky`, así que un assert sobre la posición
  pasaría o fallaría por el motivo equivocado. Eso se verificó en el browser, igual
  que el arrastre.
- **El ajuste de días plegados**: `src/lib/settings.test.ts` (ausente ⇒ el fin de
  semana, **vacío ⇒ ninguno**, orden y duplicados, basura descartada sin volver al
  default) y `SettingsView.test.tsx` (el ida y vuelta por los siete botones, y que
  destildarlos todos guarde la clave presente y vacía).
- **El contrato del puente IPC**: `src/lib/ipcContract.test.ts` lee `ipc.ts`,
  `commands.rs` y `lib.rs` **como texto** y compara los dos lados: que la clave de
  cada argumento del `invoke` sea el parámetro de Rust en camelCase, y que todo
  comando esté en el `invoke_handler![]`. Es el único test que no prueba
  comportamiento sino el contrato, y existe porque las dos suites corren contra
  `mockDb` y por definición no pueden ver un desacuerdo con Rust (§2.2).
- **Settings**: `src/lib/settings.test.ts` (parsers con clave ausente, vacía o
  basura; rango del umbral; round-trip por ipc/mockDb).
- **Atajos**: `src/lib/shortcuts.test.ts` (parseo, matching exacto de
  modificadores, captura, fallback y colisiones) y
  `src/lib/useShortcuts.test.tsx` (el cableado real: navega, abre el modal, se
  ignora dentro de un input, y respeta el atajo reasignado).
- **Degradación diaria**: `src/features/tasks/useBoard.test.tsx` (corre una vez,
  no se repite con cada invalidación, y dos vistas comparten una sola corrida).
- **Taxímetro**: `src/features/timer/timerStore.test.ts` (completar manda la
  tarea al final de su propio día, no a hoy).
- **Reapertura al dar play** (I5): tres tests en `repo.rs` — reabre una
  completada, la devuelve a la cola de Focus, y no toca una que ya estaba
  pendiente.
- **Cierre de la app**: `src/components/QuitConfirm.test.tsx` (el diálogo, sus
  dos mensajes según haya timer o no, Escape/Enter). **El camino real de ⌘Q no
  está cubierto por tests**: necesita Tauri corriendo.
- **Rail de calendario**: `src/features/calendar/railLayout.test.ts` (la hora
  sale del campo local y no del `event_start` en UTC, día completo fuera de la
  grilla, carriles por grupo de solapados, la jornada estira pero no recorta) y
  `CalendarRail.test.tsx` (el bloque abre el detalle, la franja de día completo,
  la proyectada marcada como tal, y la línea de "ahora" solo en hoy). La
  el bloque de **lo trabajado** tiene el suyo (la reunión se dibuja donde arrancó
  el taxímetro y cuanto duró, la completada se queda, lo real ocupa para la
  proyección, la corrida en curso crece, una fila sin segundos no dibuja nada, y
  **lo que falta del estimado se sigue proyectando y partiendo**),
  y la proyección tiene el suyo: orden de tablero, **partirse alrededor de
  una reunión**, repartirse entre varios huecos sumando el estimado, saltar el
  hueco que no llega al tramo mínimo (y usarlo cuando da justo), arranque en
  "ahora", nada de completadas, y el desborde de la jornada.
- **Planificación diaria**: `dailyPlan.test.ts` (el semáforo pesa el día entero
  aunque esté completado, las sin estimar se cuentan en vez de rellenarse, sin
  objetivo no hay holgura, el último día con tareas no es "ayer" a secas, el
  repaso separa cerradas de abiertas) y `DailyPlanningView.test.tsx` (arranca en
  el repaso, cuenta lo cerrado del último día con actividad, **trae a hoy lo que
  la degradación no toca**, lo anterior ya está en el backlog bajo "venían de un
  día", abre el detalle de una tarea de otro día, **montar la vista no escribe
  nada**, terminar sella `planned_at` con fecha **y hora local**, el aviso dice a
  qué hora planificaste —o dice que la marca no la trae—, y desmentirlo la borra).
  Más `settings.test.ts` sobre `planMark`: la fecha pelada vale como ese día sin
  hora inventada, una hora imposible se descarta sin perder el día, y la fecha
  **no** pasa por `new Date()`. El archivo
  depende del orden dos veces y está anotado: los ajustes del mock son de módulo,
  y la degradación corre **una sola vez por archivo** —aislar un caso con `-t` lo
  puede dejar pasar en falso. Más seis en `repo.rs` para
  `demote_pending` y `rescued_from_backlog`: preserva el último día y baja
  lo anterior, lo rescatado queda arriba del backlog, no toca calendario ni
  completadas, sin días anteriores no hace nada, distingue lo que venía de un día
  de lo que nació en el backlog —incluidos los envíos a mano—, y
  `last_day_with_tasks` ignora hoy y el futuro.
- **Agenda de la semana**: `src/features/week/WeekView.test.tsx` (la tira solo
  trae los paneles que existen, arranca cerrada, la abre y la cierra el mismo
  icono, el aspa, Escape, y nombra el día que muestra).
- **`day_work`**: cuatro tests en `repo.rs` (una fila por tarea con su
  primer inicio, el día acotado en hora **local** —las 22:00 en Chile ya son el
  día siguiente en UTC—, la corrida en curso marcada sin segundos, y una fecha
  ilegible que devuelve vacío en vez de todo).
- **Jornada**: `SettingsView.test.tsx` valida **al escribir** (hora imposible y
  rango invertido se rechazan y se avisan), que es distinto del fallback de
  `workHours()` al leer la base.
- **Weekly review**: doce en `repo.rs` para `weekly_rollup` —la Regla 2 (mover
  la tarea de semana no mueve sus horas, pero sí su plan), lo trabajado de noche
  que no se va al día siguiente, la Regla 3 y su límite (las entradas reales
  priman, una reunión que aún no empieza no cuenta), la agregación por channel y
  por contexto padre, el grupo sin channel, **las `ORPHANED` que sí cuentan**, el
  ajuste negativo que no deja segundos bajo cero, las sin estimar, lo cerrado
  agrupado por `completed_at` y los siete días siempre presentes—, más
  `weeklyReview.test.ts` (donut por contexto vs barras por channel, categoría
  borrada que conserva sus horas, escala de la semana con piso de una hora,
  formato de horas, y el día local de cierre) y `WeeklyReviewView.test.tsx`
  (las cifras, la columna del día, trabajado ≠ cerrado, el aviso de sin estimar y
  el cambio de semana, los objetivos junto a los gráficos con su avance arriba, y
  **el modal que no se cierra solo al destildar**).
  **Los gráficos no se asertan por su SVG** salvo la geometría del donut, que sí
  es nuestra: porciones contiguas que cubren la vuelta.
- **Bitácora y cierre del día**: doce en `repo.rs` para `bitacora` y compañía
  (se arma sola sin pasar por el shutdown, va del día más nuevo al más viejo,
  escribir la nota **no** cierra, la nota del día en blanco se borra, cerrar no
  vuelve a sellar la hora, la nota de una tarea es del día en que se trabajó,
  **incluir y quitar son gestos aparte de escribir**, el día trae sus celdas por
  categoría, el mood se guarda y se borra, el timeline muestra la corrida en curso
  aunque no haya sumado, va en el orden en que se tomó el trabajo, y una fecha
  ilegible da vacío), más `dailyLog.test.ts` (día vacío, los vacíos se saltan pero
  hoy no, **incluidas son las que tienen fila aunque el resumen esté vacío**,
  borrador vs cerrado, la suma de la corrida en curso, y las tres condiciones de
  `shouldRemindShutdown`) y `DailyShutdownView.test.tsx` (arranca sin cerrar, incluir
  sube y abre el resumen, **vaciar el resumen no la baja pero sacarla sí**, el
  mood es un toggle, una pendiente se manda al backlog, recargar no pisa el texto
  a medio escribir, cerrar sella + confeti + navega, un día cerrado ofrece
  reabrir, la bitácora dibuja el día con su timeline, **el donut arranca plegado**,
  y un hito abre el detalle). Este archivo **depende del orden**: el mock guarda la
  bitácora en memoria de módulo. **El aviso nativo de `work_end` no está
  cubierto**: necesita Tauri.
- **Respaldo**: veintitrés en `backup.rs` (el zip trae la base y el manifest, lo
  recién escrito está en el snapshot **sin checkpoint del WAL**, el nombre es
  cronológico, la versión es semver y coincide en los tres archivos, el zip sin
  base / con una base ajena / de una versión más nueva se rechazan, la copia de
  seguridad sobrevive a la retención, **siete respaldos seguidos dejan los que se
  conservan**, una carpeta que no existe no es error), **siete de ellos sobre
  `should_backup`**: sin carpeta no corre, una vez al día y al
  día siguiente de nuevo, **la fecha de la marca es local y no UTC**, una hora
  ilegible cae al default en vez de congelar el respaldo, y **una hora de un
  dígito se entiende** (comparada como texto no funcionaba), y **tres sobre la
  separación de perfiles**: ningún perfil reconoce el nombre del otro, la retención
  de dev no toca los de producción en la misma carpeta, y cada uno lista solo lo
  suyo. Más
  `backup.test.ts` (el `conservar` que no puede ser 0 y **los dos formateadores de
  fecha: uno convierte zona y el otro no**), los dos de **la marca del día que se
  puede desmentir** en `BackupCard.test.tsx`, y
  `BackupCard.test.tsx` (sin carpeta está apagado, la ruta se valida **al
  escribir**, vaciarla apaga sin validar, el error del automático se muestra y un
  manual exitoso lo limpia, restaurar exige la confirmación que nombra lo que se
  pierde, y al terminar abre el resumen —con el momento, las tareas y la copia de
  seguridad, y **sin** la versión cuando es la misma).
  **El test de la retención es el importante**: se pone rojo si el patrón de
  borrado se afloja a `*.zip`, y está verificado a mano que lo hace. **La
  restauración real no está cubierta**: el mock no tiene base que reemplazar.
- **Paleta**: ocho en `src/styles/tokens.test.ts` — cada nombre de `PALETTE` tiene
  sus dos tokens, no hay un `-ink` huérfano, no hay nombres repetidos, **los 24
  `-ink` están en las tres ramas de tema**, el color en sí **no** se redefine por
  tema, y los sólidos y `--selection-ink` no siguen al tema.
  **El octavo es el que lee todos los CSS** y exige que ninguna regla pinte un
  color a full con su propio `-ink` de texto: es el par que da 2.0 de contraste, y
  el modo de falla es que compila, se ve "verde sobre verde" y hay que medirlo para
  descubrirlo. Está verificado a mano contra los tres lugares que lo tenían. Lo
  acompaña un noveno que exige que el glob **haya leído algo**: con el CSS apagado
  Vitest devuelve string vacío sin avisar, y el test pasaría para siempre sin
  vigilar ni un archivo — por eso `vite.config.ts` procesa todo `*.css?raw` y no
  solo `tokens.css`. Los tres últimos son los que dejó
  Mej.28 y cada uno protege una decisión: darle variante oscura a un `-ink` suelto
  deja el chip de un canal legible y el del canal de al lado no; darle variante al
  color haría que el punto de un canal fuera de dos colores según el tema; y
  `--mint-solid` siguiendo al tema pone blanco sobre claro. El primero está
  verificado a mano —se pone rojo agregando un color inventado a `PALETTE`— y cubre
  el fallo que ningún otro ve: sin el token, `var(--x)` no resuelve y el punto sale
  **transparente, sin un error en consola**.
- **Aviso de próxima reunión**: once en `notice.rs` — avisa dentro de la ventana,
  **no avisa de una que ya empezó** (el borde que hace que el aviso no se ponga al
  día), no repite la misma hora, **si le mueven la hora vuelve a avisar**, en 0 está
  apagado, una hora ilegible se salta sin tumbar el resto, avisa de la primera que
  toque, el ajuste cae al default con basura y un negativo es apagado, duerme justo
  hasta el cruce, y **el piso cuando ya hay algo pendiente** (arrancar la app a las
  14:57 no puede costar un minuto de un aviso que avisa con cinco). Más los dos
  switches en `settings.test.ts` y `dailyLog.test.ts`: **una clave ausente es
  encendido**, que es lo que evita silenciar los tres avisos al actualizar.
- **Sonidos y tipografía (Mej.1)**: cuatro en `sound.rs` —la síntesis suena cuando el
  ajuste dice `SUNRISE` **aunque haya un audio en la carpeta**, el ajuste nombra el
  archivo y cae a la síntesis si ya no está o si intenta salir de la carpeta con
  `../`, y **dos de rechazo al instalar**: lo que no es audio, y lo que rodio no puede
  decodificar. El segundo es el que importa: sin él, un archivo roto se vive como "el
  selector no hace nada". Dos en `commands.rs` para el sonido de los avisos (vacío,
  espacios y basura caen al de la app), su espejo en `settings.test.ts`, uno en
  `notify.test.ts` para el **aviso mudo** (`null` y no un nombre vacío, ni siquiera con
  un sonido pasado a mano), seis en `AppearanceCard.test.tsx` —el nombre que se guarda
  es el que devolvió la copia, **si la copia falla el ajuste no se toca**, cada rol de
  tipografía se guarda por separado y volver a la de sunrise borra la copia— y tres en
  `fonts.test.ts`, donde los casos que hay que sostener son los de vuelta: con la fuente
  de sunrise el token se **borra** (o `tokens.css` deja de ser el único lugar donde está
  declarada) y **toda elección arrastra la pila de respaldo**.
- **Familias del sistema**: dos en `fonts.rs`. El filtro es puro y se prueba con una
  lista armada a mano —se van las de puntito, las de dingbats numeradas y los
  repetidos—, y hay un segundo que llama a Core Text de verdad y exige **más de 20
  familias**: si la API cambiara o el filtro se pasara de estricto, el selector quedaría
  con una opción y eso se ve como "no tengo fuentes", no como un error.
- **El orden de Configs**: `SettingsView.test.tsx` compara los `data-section` que se
  dibujan contra `visibleTabs(true)`. Vigila una invariante que `secciones.ts` pedía
  por escrito y **no tenía test**: el resaltado del menú lo decide un
  `IntersectionObserver`, así que una sección de más, de menos o corrida marca una y
  muestra otra, sin error y sin nada roto a la vista. Verificado a mano moviendo una
  card. Y comprueba que cada sección tenga su `id="set-<tab>"`, que es el atributo
  cuyo olvido dejó el click de la tab de Notificaciones sin llevar a ninguna parte.
- **Marca**: `SunriseMark.test.tsx` — dos instancias no repiten el id del
  degradado, `public/app-icon.svg` es XML válido, y sigue siendo el favicon de las
  dos ventanas. Los tres cubren fallos que **ningún otro test puede ver**: el id
  duplicado no lanza nada (solo apaga un degradado), y el SVG del icono no lo
  renderiza React —lo leen `tauri icon` y la pestaña—, así que un error ahí
  aparece recién al empaquetar. El de XML está verificado a mano: se pone rojo si
  se escribe un token como `--ink` dentro de un comentario del SVG.
- **Inicio automático**: dos en `SettingsView.test.tsx` — el switch refleja el
  estado del sistema y lo cambia **sin agregar ni una clave a `settings`**, y
  vuelve atrás con el error a la vista si el sistema rechaza el cambio. El primero
  es el que importa: protege la decisión de §4.18, no el botón. Si alguien mueve el
  ajuste a la tabla "por consistencia", empieza a viajar dentro de los respaldos.
  **El registro real en el sistema no está cubierto**: necesita Tauri.
- **Dev y producción conviviendo** (§4.20): `db::file_name()` no puede devolver lo
  mismo que `PROD_FILE` —si los dos perfiles abren el mismo archivo, probar un cambio
  escribe en la base de verdad—, `DB_IN_ZIP` **sí** tiene que ser el nombre de
  producción para que el respaldo cruce entre las dos, y **ningún perfil reconoce
  el nombre de respaldo del otro** —la garantía de la que depende que dev pueda
  respaldar sin borrar los zips de verdad. Los tres
  protegen decisiones, no código: cada uno se pone rojo si alguien "simplifica" la
  separación en la dirección obvia. Y en `Sidebar.test.tsx`, que el distintivo
  `dev` esté y diga qué base usa: es **toda** la protección del lado del usuario, y
  si desaparece el aislamiento sigue funcionando pero el error humano —editar en la
  ventana equivocada— vuelve intacto.
- **El aviso del sidebar** (§4.23): siete en `UpdateBanner.test.tsx` — que sin
  versión nueva no ocupa espacio, que instala al apretarlo, que **si la instalación
  falla el botón vuelve** (dejarlo en "Instalando…" es mentir), que "Estás al día"
  abre el modal, que **desaparece a los 30 segundos** sin que nadie lo toque, que
  una instalación nueva no avisa pero sí deja la marca, y que el sondeo pregunta al
  arrancar y otra vez a las 4 horas, y que **un update de prueba no llama al
  updater** (llamarlo mientras miras el componente reiniciaría la app). El de los
  4 h usa timers falsos con
  `shouldAdvanceTime`: instalados **antes** de montar, porque el intervalo se crea
  en el efecto y uno instalado después no lo controla.
- **Changelog y "Lo nuevo"** (§4.22): en `changelog.test.ts`, que el anuncio corta
  antes del detalle (es la distinción que sostiene el diseño), que una versión
  ausente no es un error, y —el que importa— **que la versión de `package.json`
  tenga su sección escrita**: sin eso el modal y las notas del Release quedan
  vacíos en silencio. Y en `WhatsNew.test.tsx`, los cuatro caminos: primera
  ejecución (no abre solo), versión distinta
  (muestra el texto del changelog de verdad), y versión sin entrada (no abre un
  modal vacío).
- **Actualizaciones** (§4.21): `la_config_del_updater_esta_completa` en Rust —
  `pubkey`, `endpoints` https que terminen en `latest.json`, y
  `createUpdaterArtifacts` — y cuatro en `SettingsView.test.tsx`: que **no** se
  busque al montar (si hubiera chequeo de arranque, ya habría corrido), que sin
  versión nueva diga "estás al día", que con una ofrezca instalarla con sus notas,
  y que un fallo de red **no** se cuente como estar al día. Ese último es el que
  vale: los dos estados se ven parecidos y significan lo contrario. **La descarga
  no está cubierta**: reemplaza el `.app` instalado y reinicia el proceso.
- **Cruce entre ventanas**: `src/lib/store.test.tsx` (el listener invalida, no
  responde al aviso, ignora otras claves, se desregistra) y
  `src/features/today/TodayView.sync.test.tsx` (una tarea completada por la otra
  ventana aparece completada en la vista). Ambos se ponen rojos si se desactiva
  `useDataSync`.

> `pnpm` v11 lee su configuración de `pnpm-workspace.yaml`, no del campo `pnpm`
> de `package.json` (ahí está `onlyBuiltDependencies: [esbuild]`).

---

## 9. Deuda técnica conocida

- ~~**D4. `bell_sound` sigue sin consumidor**~~ — resuelto en Mej.1: lo lee
  `commands::bell_choice` y se elige en Configs → Apariencia (§4.28), con un picker
  del Finder en vez de la copia a mano que preveía el diseño original.
  `work_start`/`work_end` habían dejado de ser deuda antes, con el rail (§4.13).
- ~~**D5. `USER_NAME` hardcodeado**~~ — resuelto, pero no como decía la deuda:
  no hacía falta una fuente de datos para el nombre, sino dejar de tener sujeto.
  Pasó por `HISTORY_ACTOR = "You"` y `= "Tú"` antes de desaparecer del todo
  cuando el historial pasó a español y el sujeto se disolvió en el verbo
  ("Moviste…"). Con eso `src/lib/config.ts` quedó sin exports y se borró.
- **D6. `SettingsView` no observa `dataVersion`**: solo recarga con su propio
  `load`.
- **D7. Warning de `act()`** en el test del `Sidebar` (pasa, pero ensucia).
- **D9. El error de reemplazo en la restauración se muestra en un webview que
  quizá ya no puede leer su base.** Si `db::open` falla después de copiar
  (§4.17), el mensaje va a la card de Configs como cualquier otro. Un `message()`
  nativo del plugin de diálogo llegaría igual. Es el peor caso de un camino que
  además tiene vuelta atrás (el archivo previo queda al lado), así que es de baja
  prioridad; queda anotado porque es el único lugar donde lo nativo le gana a
  nuestro propio estilo. Sale de Mej.17.
- ~~**D8. El ajuste manual de tiempo se acredita al día equivocado**~~ —
  **resuelto** (Mej.14). `set_actual_seconds` estampa el día de la tarea
  (`scheduled_date` + `scheduled_time`, o mediodía local), y hoy solo cuando no
  tiene fecha o es futura. La consecuencia buscada tiene su otra cara: un ajuste
  sobre una tarea de otro día **ya no aparece en el contador del taxímetro**, que
  mide solo hoy. Detalle en §4.15.
