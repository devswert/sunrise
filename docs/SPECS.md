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

`color` guarda un **token de la paleta**, no un hex: `peach`, `apricot`,
`lavender`, `mint`, `sky`, `butter`, `rose`, `sage`. Se usa como
`var(--${color})` / `var(--${color}-ink)`. **Si agregas un color a `PALETTE` en
`SettingsView`, tiene que existir el token en `src/styles/tokens.css`.**

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
- **Mover** (`move_task`): cambia día y posición, corre +1 las tareas
  `>= position` del día destino, y registra `MOVED` (o `START_DATE_SET` si
  venía del backlog). `date = null` ⇒ manda al backlog.
- **Estado** (`set_task_status`): sella/limpia `completed_at`. Ver Invariante I5.
- **Borrar** (`delete_task`): borrado real. `ON DELETE CASCADE` limpia
  `task_events` y `time_entries`.

### 4.2 Degradación diaria al backlog

`degradar_pendientes(today)` manda al backlog lo que quedó pendiente en días
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
  (`ultimoDiaConTareas`), y **los dos tienen que coincidir**: si divergen, el
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
justamente lo que lee `rescatadas_del_backlog` para el grupo **"venían de un
día"**, que sale arriba de la columna de backlog (§4.14) y como línea de origen
en la vista Backlog. `CARRIED_OVER` sigue existiendo en `TaskEventType` por las
tareas que ya lo tienen en su historial, pero **nadie lo escribe más**.

Consecuencia que conviene tener presente: **mover una tarea pendiente a un día
pasado ya no es temporal**, mientras ese día sea el último con actividad. Si hay
días con tareas más recientes, la degradación se la lleva al backlog en la
siguiente corrida.

### 4.3 Vista semana (`WeekView`) y Today (`TodayView`)

- 7 columnas lunes→domingo de la semana ISO del ancla; navegación ± semana.
  `TodayView` reutiliza `DayColumn` con un solo día, y a su derecha monta el
  **rail de calendario** (§4.13), que en `WeekView` es un panel superpuesto que
  se abre con un botón.
- **DnD** con `@dnd-kit`. La detección de colisión es custom
  (`src/features/week/collision.ts`): `pointerWithin` → `rectIntersection` →
  `closestCorners`. Esa cascada existe para que **toda la columna** acepte el
  drop (incluida la mitad superior con el header y "Agregar tarea") y para que la
  card nunca se pierda entre columnas. No la simplifiques a un solo detector.
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
- **Tiempo por día** en el detalle (`tiempoPorDia` en
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
'ACTIVE'`, agrupado por contexto. El sidebar muestra los contextos que tienen
items y su conteo (`useBacklogFolders`), resolviendo el contexto de cada tarea
como `parentId ?? id` de su categoría.

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
- **Campana** al alcanzar el estimado: `isOverEstimate(elapsed, planned)`
  (`planned` null o `<= 0` ⇒ nunca suena). Suena **una sola vez por entrada**
  (`belledEntryId`) y **solo la ventana dueña** la toca (`setBellOwner`, ver I6).
  El sonido se sintetiza en Rust con `rodio` (`sound.rs`). **Sin notificación
  nativa a propósito**: bastan el sonido y el taxímetro cambiando de color; una
  notificación del sistema hay que ir a descartarla y se apila si se pasan
  varias tareas. El plugin sigue instalado porque el daily shutdown de M3 lo va
  a usar.
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

Cinco secciones, cada una con título y bajada propia (`Card` en
`SettingsView.tsx`), en este orden: **General**, **Calendarios** (§4.12),
**Canales**, **Atajos de teclado** (§4.9) y **Respaldo** (§4.17). El orden de la
lista lateral y el de las cards **tienen que coincidir**: el resaltado lo decide
un `IntersectionObserver` sobre las secciones, así que si divergen la lista marca
una y se ve otra. Las dos salen de la misma lista, `settings/secciones.ts`, que es
también de donde sale el icono de cada una (§7).

- Capacidad diaria: autosave al salir del foco, acepta `8h`/`7h30`/`480`.
- **Jornada** (`work_start`/`work_end`): dos horas en formato 24 h, autosave al
  salir del foco. Es lo que dibuja la grilla del rail (§4.13). El formulario
  **valida al escribir** —hora imposible o rango invertido se rechazan y se
  avisan— aunque `workHours()` ya caiga al default: ese fallback protege la
  lectura de la base, pero si el campo se tragara un `25:00` en silencio, el rail
  no cambiaría y nada explicaría por qué.
- **Abrir sunrise al iniciar sesión** (§4.18): el único control de Configs que
  **no** lee ni escribe la tabla `settings`.
- Contextos/channels: renombrar en línea, borrar, y el color se elige con un
  **punto que abre la paleta en un popover**. Las ocho muestras solían estar
  visibles en cada fila: con ocho categorías eran 64 puntos compitiendo con los
  nombres, que es lo que uno viene a leer.

Los ajustes viven en la tabla `settings` (TEXT/TEXT) y se leen vía
`src/lib/settings.ts`: `useSettingsStore` los carga desde `Shell` y los relee con
cada invalidación, así un cambio en una ventana llega a la otra.
**Toda lectura pasa por un parser con fallback** (`dailyCapacityMinutes`,
`capacityWarnRatio`, `workHours`, `yaPlanificado`): la clave puede faltar, venir vacía o traer basura editada a
mano, y un `NaN` suelto dejaría el semáforo en OK para siempre sin error visible,
porque toda comparación con `NaN` es false.

`planned_on` (§4.14) es la primera clave que **no siembra ninguna migración**, y
está bien: `set_setting` es un upsert y la lectura ya tiene fallback. Guarda una
sola fecha, no un historial — la pregunta es "¿ya planifiqué hoy?"; llevar la
cuenta de qué días planificaste es materia de la review.

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
| `ics` | interpreta el texto a `EventoIcs` | puro: se prueba con fixtures |
| `repo::import_eventos` | escribe las tareas | puro sobre `&Connection` |

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
- **Todo se convierte a hora local** (`ics::a_local`), y las tres formas de ICS
  —UTC con `Z`, con `TZID`, y flotante— tienen que aterrizar en la misma regla.
  Cortar el timestamp por los primeros 10 caracteres da el día UTC: un evento de
  la tarde se iría al día siguiente. Es el mismo error que ya se pagó en
  `completeAndAdvance` y en `tiempoPorDia`.
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
(`aplicar_canal_por_defecto`, que corre al guardar el feed). Sin esa segunda
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
  (`EventoDelCalendario`), con las notas y el canal editables: es la pantalla en
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

**Lo que desaparece del feed** lo resuelve `reconciliar_feed`, que corre después
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
(`rail--overlay` tiene `right: 44px`, el ancho de la tira). Recibe sus botones
como lista porque va a tener tres —agenda, objetivos de la semana y backlog
arrastrable—, pero **solo se dibujan los paneles que ya existen**: un icono que
no hace nada al apretarlo enseña que la barra no responde. Los otros dos llegan
con sus milestones (M3.5 y el panel de backlog).

Daily planning (M3.4) lo usa con las mismas props.

El cálculo está separado del render en `railLayout.ts` (`armarRail`), puro y
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
- El dato viene de **`repo::trabajo_del_dia`** (una fila por tarea con el primer
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
  `completeAndAdvance` y en `tiempoPorDia`. `scheduled_time` viene de
  `inicio_local` y `estimated_minutes` es la duración: los dos campos locales
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
  `revisarCambioDeDia`, §5.3.1).

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
salir a la semana o revisar igual. Era un sello en la cabecera y se leía como
decoración: el ritual está para hacerse una vez, y volver a entrar suele ser sin
querer. Se dispara **una vez por día** —el `ref` guarda para qué fecha se
decidió, así una sesión que cruza la medianoche vuelve a preguntar— y espera a
que los ajustes estén cargados (`loaded`), o el diálogo saltaría un frame tarde,
con la vista ya dibujada. Comparte las clases `.dialog*` con la confirmación de
⌘Q (§4.10) y agrega `.dialog--hero` —icono en círculo y todo centrado—: un aviso
que no pediste tiene que verse como un aviso, no como un formulario.

**No guarda nada, y el botón del final no es un "Guardar".** Todo lo que se toca
acá ya persiste solo —autosave es la convención del proyecto (§7)—, así que
"Empezar el día" es un **terminador de ritual**: sella `planned_on` con la fecha,
tira confeti y te devuelve a la semana. Si se lee como un save, alguien lo va a
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
- **El repaso mide lo trabajado con `trabajo_del_dia`, no con `actual_seconds`**:
  ese campo es el total de la tarea, y una arrastrada de tres días lo trae todo
  junto — el repaso pregunta por **ese** día (misma Regla 2 de M3.5).
- **El paso 1 repasa el último día con tareas, no "ayer" a secas.** Un lunes,
  ayer es domingo y está vacío, mientras que lo que hay que cerrar es el viernes.
  Se lee una ventana de 7 días hacia atrás y se elige la fecha más reciente con
  algo (`ultimoDiaConTareas`) — **el mismo día que preserva §4.2**.
- **Es el único camino para rescatar una reunión.** La degradación no toca las de
  calendario, así que una reunión sin cerrar se queda en su día para siempre y
  ninguna vista de hoy la vuelve a mostrar; el botón "A hoy" del paso 1 es la
  única salida.
- **El backlog del paso 2 abre con "venían de un día"**, y debajo "guardadas".
  Los rótulos van **dentro** del `SortableContext`: partirlo en dos rompería el
  arrastre entre grupos, y como todo lo que baja al backlog entra en posición 0,
  los rescates ya vienen juntos al principio.
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
  de siempre, sin arrastre). Una lista de títulos al lado de un tablero de cards
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

Las tres viven en **`trabajo_por_dia`**, el núcleo compartido con la bitácora
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
  un segmento negativo.
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

> **Deuda conocida (Mej.14):** `set_actual_seconds` estampa su entrada de delta
> con `now()`, así que ajustar a mano el tiempo de una tarea de la semana pasada
> le acredita las horas a **hoy**. Es la Regla 2 rota en el origen, no en la
> review.

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
mire siempre. Sale de `repo::bitacora(hasta, dias)`.

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
- **`closed_at` no se vuelve a sellar.** `cerrar_dia` es idempotente y conserva la
  hora original: "a qué hora cerré" es el dato interesante. Hay `reabrir_dia` para
  volver a borrador sin perder las notas.
- **La nota de una tarea es del día, no de la tarea.** `day_task_notes` tiene la
  fecha en la clave porque una tarea se puede trabajar varios días y cada uno
  merece su línea. **No es `tasks.notes`**, que son las notas con las que
  trabajás.
- **Incluir y escribir son gestos distintos.** `incluir_en_bitacora` crea la fila
  con el resumen vacío; `set_day_task_note` solo escribe. **Vaciar el texto no
  baja la tarea**: la fila es lo que significa "incluida", y confundir las dos
  cosas hacía desaparecer una tarea al borrar una palabra. Sacarla es explícito
  (`quitar_de_bitacora`). Por eso `note` distingue **tres** estados: `null` = no
  incluida, `""` = incluida sin resumen, texto = incluida y escrita.
- **La nota del día en blanco sí se borra** (`set_day_note`), porque ahí no hay
  nada que "incluir": o hay texto o no hay.
- **Una reunión no se mueve.** En "qué quedó pendiente" las filas de calendario no
  tienen botones: es el registro de algo que pasó (o no) ese día, y mandarla a
  mañana sería mentir sobre cuándo fue. Misma regla que la degradación diaria
  (§4.2). Tildarla sí se puede, desde la card.
- **El timeline muestra la corrida en curso** aunque todavía no haya sumado
  segundos: es justamente la tarea que estás haciendo. Los segundos se los pone
  el front desde el taxímetro (`trabajadoConEnCurso`), igual que el rail — en la
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
`planned_on`. Sin permiso de notificaciones **se marca igual**: reintentar cada
minuto no cambia nada y deja la app pidiendo lo mismo toda la tarde.

> **Este camino no se puede verificar fuera de Tauri**, como ⌘Q (§4.10): en el
> browser y en jsdom no hay notificaciones nativas. Lo que sí está cubierto es la
> decisión (`tocaAvisarCierre`). Y adentro de Tauri **hay que esperar a que pase
> `work_end`**, así que probar un cambio acá es incómodo a propósito hasta que
> llegue Mej.16 (un botón "Probar" en Configs y el estado del permiso a la vista).

**El rollup lo comparte con la weekly review.** `trabajo_por_dia` es el único
lugar donde viven la atribución por día local, la Regla 2, la Regla 3, el
no-filtrar `ORPHANED` y el piso en 0 por tarea; la semana lo agrupa en celdas
día × categoría y la bitácora en timelines. Tener dos consultas garantizaba que
se separaran.

Las cuentas de presentación están en `bitacora.ts` (puro y testeado).

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

**Respaldar y podar son un solo paso** (`crear_y_podar`), y por eso da lo mismo si
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

**El automático corre a `backup_time`, una vez al día, con la app abierta.**
`useBackupRuntime` es gemelo de `useShutdownReminder` y va montado en `Shell` por
la misma razón que I6: en las dos ventanas serían dos zips por día, o dos
`VACUUM INTO` peleándose el `Mutex`. La decisión vive en `tocaRespaldar` (puro y
testeado). La marca es la fecha `backup_ran_on`, y el efecto es que **se pone al
día**: si la app estaba cerrada a las 20:00 y se abre a las 23:00, respalda ahí; si
se abre al otro día, la fecha ya no es hoy y también respalda. Lo único que no
cubre es un día en que la app no se abrió nunca.

**Carpeta vacía = respaldo apagado.** Es el estado de fábrica: los ajustes de
respaldo no los siembra ninguna migración, como `planned_on`. Y **la carpeta se
valida al guardarla** con una prueba de escritura real (`probar_backup_dir`), no a
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
> `fechaLegible` **no** convierte zonas (su entrada sale del nombre del archivo y
> no la declara), y `momentoLegible` **sí** (el `created_at` del manifest trae
> offset y los `started_at` traen `Z`). Usar el primero para lo segundo mostraría
> un respaldo de las 20:03 a las 16:03.

El orden de `restaurar_backup` está puesto para que **ningún fallo deje la app sin
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

> **I** — **El `.app` de release y `pnpm tauri dev` comparten la base de datos.**
> El identifier es el mismo, así que `app_data_dir()` resuelve al mismo
> `~/Library/Application Support/app.sunrise.desktop` en los dos. Para una app
> personal es justo lo que se quiere —instalas el `.dmg` y tus datos están ahí, sin
> migrar nada— pero **probar el paquete toca tus datos de verdad, no una copia**.
> Si alguna vez hace falta aislarlos, es cambiando el identifier del build de dev,
> y eso deja la base vieja donde estaba.

**Sin firma de desarrollador.** No hay certificado en esta máquina, así que Tauri
firma **ad-hoc** (`Signature=adhoc`, `TeamIdentifier=not set`). Un `.dmg`
construido localmente no queda en cuarentena, así que instalarlo acá funciona sin
pelear con Gatekeeper. Copiarlo a otra máquina sí muestra el aviso de desarrollador
no verificado, y ahí hay que abrir con clic derecho → Abrir la primera vez. Firmar
y notarizar de verdad necesita cuenta de Apple Developer; mientras la app no salga
de esta máquina, no hace falta.

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

El workflow corre en **`macos-14`** y no en `macos-latest`: del 14 en adelante los
runners son arm64, y en `macos-13`, que es Intel, saldría un `.dmg` que no corre en
ningún Mac del equipo.

Tiene un paso propio que **compara el tag con los tres archivos** y falla si no
coinciden. Es el único lugar donde eso se puede pillar: el test de Rust comprueba
que los tres archivos coincidan **entre sí**, pero no sabe nada del tag, así que un
`v0.2.0` sobre un repo en `0.1.0` publicaría un `.dmg` llamado `0.1.0`. Y corre
`pnpm test:all` antes de empaquetar: un `.dmg` publicado con tests rojos es peor
que no publicar, porque alguien lo instala.

> **El workflow no está ejercitado**: cuando se escribió, el repo no tenía remoto.
> El YAML está validado y la lógica del paso de versión se probó en local, pero la
> primera corrida de verdad es la primera vez que se empuje un tag.

### 4.20 Dev y producción conviviendo

`pnpm tauri dev` y el `.dmg` instalado **pueden estar abiertos a la vez y no
comparten datos**. La base se separa por nombre de archivo dentro del mismo
directorio: `sunrise-dev.sqlite` en debug, `sunrise.sqlite` en release
(`db::archivo()`).

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
`sunrise.sqlite` (`backup::DB_EN_ZIP`). Hay un test que lo fija — si el zip llevara
el nombre del perfil, un respaldo tomado en dev no se podría restaurar en
producción, y el puente no existiría.

> **I** — **El respaldo automático no corre en dev**, y el corte vive en
> `tocaRespaldar` con los otros tres. Las bases están separadas, pero `backup_dir`
> es una ruta en el disco: si restauras un zip de producción en dev —o sea, si usas
> el puente— dev hereda la carpeta, empieza a escribir zips de prueba ahí y **la
> retención borra los respaldos de verdad** para conservar los de prueba. El botón
> manual sigue funcionando: eso lo pides tú, esto pasa solo.

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
la equivocada. Sale de `usePerfil()` (`src/lib/perfil.ts`), que pregunta **una vez
por sesión** y cachea la promesa —es un dato del binario, no puede cambiar— y
devuelve `null` mientras no llega. Ese `null` significa "todavía no sé", **no** "es
producción": asumir producción por un instante alcanza para que el respaldo
automático corra una vez.

---

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
corresponde. `anclaTrasCambioDeDia` (en `src/features/week/anchor.ts`) devuelve
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
  función en vez de escribir la columna. No lo cortocircuites.
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
     medianoche (`tramos_por_dia_local`). El tiempo se atribuye por
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
- **I6. Una sola ventana toca la campana.** `main` es la dueña
  (`useTimerRuntime({ bell: true })`); el taxímetro no. Si ambas suenan, se oye
  doble con desfase de ms y queda "vibrado".
- **I7. Los listados filtran `source_state = 'ACTIVE'`.** Las `ORPHANED` existen
  solo para el historial y la review. **La única excepción es el tiempo del
  rollup compartido** (`trabajo_por_dia`, §4.15 y §4.16), que las cuenta a
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
  `formatMinutes`, `duracionCorta`) no tienen idioma. El menú nativo de macOS
  queda en inglés: lo genera `Menu::default` de Tauri, y traducir solo nuestro
  ítem de Quit dejaría el submenú a medias.
- **Las fechas se formatean con los helpers de `src/lib/date.ts`**, que ya
  llevan el locale `es` por llamada (no con `setDefaultOptions`, que además
  movería los límites de semana). No es traducir tokens: en español el día va
  antes del mes ("10 de agosto", no "agosto 10") y date-fns devuelve los días en
  minúscula, así que `weekdayLabel` capitaliza. Los componentes de terceros
  traen su propio texto: `<DayPicker>` necesita `locale={es}` en cada uso.
- **Autosave siempre. Nada de formularios planos con botón "Guardar".**
- **El botón de confirmar es salvia, no naranjo** (`.btn-primary`, tokens
  `--sage`/`--sage-ink`). El damasco de la paleta es **el mismo tono** que el
  semáforo de capacidad usa para "te pasaste" (`--cap-over`), así que un botón de
  aceptar en naranjo se lee como una advertencia. El naranjo queda para lo que
  avisa. Y todo botón de acción lleva **su icono** (`lucide-react`) además del
  texto.
- **Popovers en portal con posición fija** (`src/components/Popover.tsx`). Si no,
  los recorta el `overflow` de columnas y modales, y el ancho queda limitado por
  el contenedor del chip.
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
- Fuentes: **Sora** (títulos) + **Manrope/Inter** (cuerpo), auto-hospedadas
  (`@fontsource`) para funcionar offline. Paleta pastel en tokens CSS con tema
  claro/oscuro.

---

## 8. Tests

Obligatorios por milestone. La Fase 0 cerró con **140 tests front y 35 Rust**;
estado actual: **346 tests front (40 archivos) y 138 Rust, todos verdes.**

```bash
pnpm test        # Vitest + RTL
pnpm test:rust   # cargo test (SQLite en memoria)
pnpm test:all    # ambos
```

- **Rust** (`#[cfg(test)]` en `repo.rs` y `sound.rs`): eventos de creación y
  movimiento, degradación selectiva al backlog, acumulación del timer, supervivencia del
  ajuste manual, contador del día que ignora ayer, un solo timer activo,
  completar detiene el timer (y no detiene el de otra tarea), `focus_queue`,
  backlog, síntesis del sonido.
- **Front**: `capacity` (semáforo + parseo), `date`, `history`, `useTimer`,
  `useDragOrClick`, `TaskCard`, `TaskModal`, `Sidebar`, `FocusView`,
  `SettingsView`.
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
  nada**, y terminar sella `planned_on`, tira confeti y navega). El archivo
  depende del orden dos veces y está anotado: los ajustes del mock son de módulo,
  y la degradación corre **una sola vez por archivo** —aislar un caso con `-t` lo
  puede dejar pasar en falso. Más seis en `repo.rs` para
  `degradar_pendientes` y `rescatadas_del_backlog`: preserva el último día y baja
  lo anterior, lo rescatado queda arriba del backlog, no toca calendario ni
  completadas, sin días anteriores no hace nada, distingue lo que venía de un día
  de lo que nació en el backlog —incluidos los envíos a mano—, y
  `ultimo_dia_con_tareas` ignora hoy y el futuro.
- **Agenda de la semana**: `src/features/week/WeekView.test.tsx` (la tira solo
  trae los paneles que existen, arranca cerrada, la abre y la cierra el mismo
  icono, el aspa, Escape, y nombra el día que muestra).
- **`trabajo_del_dia`**: cuatro tests en `repo.rs` (una fila por tarea con su
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
  ilegible da vacío), más `bitacora.test.ts` (día vacío, los vacíos se saltan pero
  hoy no, **incluidas son las que tienen fila aunque el resumen esté vacío**,
  borrador vs cerrado, la suma de la corrida en curso, y las tres condiciones de
  `tocaAvisarCierre`) y `DailyShutdownView.test.tsx` (arranca sin cerrar, incluir
  sube y abre el resumen, **vaciar el resumen no la baja pero sacarla sí**, el
  mood es un toggle, una pendiente se manda al backlog, recargar no pisa el texto
  a medio escribir, cerrar sella + confeti + navega, un día cerrado ofrece
  reabrir, la bitácora dibuja el día con su timeline, **el donut arranca plegado**,
  y un hito abre el detalle). Este archivo **depende del orden**: el mock guarda la
  bitácora en memoria de módulo. **El aviso nativo de `work_end` no está
  cubierto**: necesita Tauri.
- **Respaldo**: catorce en `backup.rs` (el zip trae la base y el manifest, lo
  recién escrito está en el snapshot **sin checkpoint del WAL**, el nombre es
  cronológico, la versión es semver y coincide en los tres archivos, el zip sin
  base / con una base ajena / de una versión más nueva se rechazan, la copia de
  seguridad sobrevive a la retención, **siete respaldos seguidos dejan los que se
  conservan**, una carpeta que no existe no es error) más
  `respaldo.test.ts` (las cuatro condiciones de `tocaRespaldar` —incluida la
  puesta al día al abrir la app—, el `conservar` que no puede ser 0, y **los dos
  formateadores de fecha: uno convierte zona y el otro no**) y
  `BackupCard.test.tsx` (sin carpeta está apagado, la ruta se valida **al
  escribir**, vaciarla apaga sin validar, el error del automático se muestra y un
  manual exitoso lo limpia, restaurar exige la confirmación que nombra lo que se
  pierde, y al terminar abre el resumen —con el momento, las tareas y la copia de
  seguridad, y **sin** la versión cuando es la misma).
  **El test de la retención es el importante**: se pone rojo si el patrón de
  borrado se afloja a `*.zip`, y está verificado a mano que lo hace. **La
  restauración real no está cubierta**: el mock no tiene base que reemplazar.
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
- **Dev y producción conviviendo** (§4.20): `db::archivo()` no puede devolver lo
  mismo que `ARCHIVO` —si los dos perfiles abren el mismo archivo, probar un cambio
  escribe en la base de verdad—, `DB_EN_ZIP` **sí** tiene que ser el nombre de
  producción para que el respaldo cruce entre las dos, y `tocaRespaldar` con
  `esDev: true` no respalda ni con todo configurado y pasada la hora. Los tres
  protegen decisiones, no código: cada uno se pone rojo si alguien "simplifica" la
  separación en la dirección obvia. Y en `Sidebar.test.tsx`, que el distintivo
  `dev` esté y diga qué base usa: es **toda** la protección del lado del usuario, y
  si desaparece el aislamiento sigue funcionando pero el error humano —editar en la
  ventana equivocada— vuelve intacto.
- **Cruce entre ventanas**: `src/lib/store.test.tsx` (el listener invalida, no
  responde al aviso, ignora otras claves, se desregistra) y
  `src/features/today/TodayView.sync.test.tsx` (una tarea completada por la otra
  ventana aparece completada en la vista). Ambos se ponen rojos si se desactiva
  `useDataSync`.

> `pnpm` v11 lee su configuración de `pnpm-workspace.yaml`, no del campo `pnpm`
> de `package.json` (ahí está `onlyBuiltDependencies: [esbuild]`).

---

## 9. Deuda técnica conocida

- **D4. `bell_sound` sigue sin consumidor.** La tabla `settings` ya se lee
  (§4.8). `work_start`/`work_end` dejaron de ser deuda: los usa el rail (§4.13)
  y se editan desde Configs → General.
- ~~**D5. `USER_NAME` hardcodeado**~~ — resuelto, pero no como decía la deuda:
  no hacía falta una fuente de datos para el nombre, sino dejar de tener sujeto.
  Pasó por `HISTORY_ACTOR = "You"` y `= "Tú"` antes de desaparecer del todo
  cuando el historial pasó a español y el sujeto se disolvió en el verbo
  ("Moviste…"). Con eso `src/lib/config.ts` quedó sin exports y se borró.
- **D6. `SettingsView` no observa `dataVersion`**: solo recarga con su propio
  `load`.
- **D7. Warning de `act()`** en el test del `Sidebar` (pasa, pero ensucia).
- **D8. El ajuste manual de tiempo se acredita al día equivocado** (Mej.14).
  `set_actual_seconds` estampa su entrada de delta con `now()`, así que corregir
  a mano las horas de una tarea de la semana pasada se las suma a hoy. Rompe la
  Regla 2 (§4.15) en la escritura: la review las agrupa bien, pero la fila ya
  nació con la fecha errada. El arreglo es chico —estampar el mediodía local de
  su `scheduled_date`, con `now()` de respaldo cuando no tiene día—, y hasta que
  llegue el rollup carga esa salvedad.
