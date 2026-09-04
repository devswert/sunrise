# §4.1–4.5, 4.30–4.31 Tareas y tablero

El CRUD de tareas, la degradación diaria al backlog, la vista semana y Today, el modal de detalle, el backlog, las prioridades y el modal de crear.

Vuelve al [índice de SPECS](../SPECS.md).
---

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
- **El orden de la columna es `position`, y es el plan del día**: para eso se
  arrastran las cards, y el rail proyecta en ese mismo orden (§4.13). Las tareas
  del calendario entran ubicadas por su hora —ordenadas **entre ellas**, sin
  desplazar lo que pusiste vos—: lo escribe `repo::place_by_time` al importar, no
  el front al dibujar. Detalle y motivo en §4.12.
- **Contador de capacidad** por día: suma de `estimatedMinutes` de lo que hay en
  la columna, así que **los eventos ignorados no cuentan** (§4.12), vs objetivo
  (de `settings`, default 480), semáforo por `computeCapacityLevel`:
  `> target` ⇒ `OVER` (rojo); `>= target * 0.85` ⇒ `WARN` (amarillo); resto
  `OK` (gris). `target <= 0` ⇒ siempre `OK`.
- **Aviso de "se sale del horario"** (`lateTaskIds`): en la columna de **hoy**, el
  badge de tiempo de una card va en ámbar (`.tc__badge.is-late`) si su bloque
  proyectado termina después de `work_end`. Tres precisiones:
  - Sale del **mismo `buildRail`** que dibuja la agenda (`useLateTasks`), y no de
    una suma aparte: el rail ya sabe de reales, fijos y tramos partidos, y dos
    proyecciones distintas del mismo día a la vista al mismo tiempo se
    contradirían. Por eso entra la **agenda** del día y no la lista de la
    columna: una reunión ignorada (§4.12) no es una card pero igual ocupa la
    tarde.
  - **Lo completado no se marca**, aunque su bloque REAL caiga tarde: haberte
    pasado ya no es un aviso.
  - El aviso **envejece solo**, así que `useLateTasks` se suscribe a
    `useMinuteTick` (`lib/day.ts`), el mismo reloj compartido del rail.
  - Es distinto del contador de capacidad de arriba: aquel compara el plan contra
    un presupuesto de minutos; este proyecta contra el reloj. Se puede estar
    holgado de presupuesto y no llegar igual.
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
- **La prioridad va a la izquierda del objetivo**, con la misma carcasa que sus
  dos vecinos (`chip-wrap` + `tmodal__meta` + `Popover`): es la tercera cosa que
  se elige de una lista en esa barra, y dibujarla distinta la haría parecer otra
  clase de control. **Sin buscador**, y ahí sí se separa de los otros dos: son
  cinco opciones fijas que caben enteras, y un campo de texto encima de cinco
  filas es un paso más para llegar a lo mismo. "Sin prioridad" manda `null`
  explícito, no la ausencia del campo — ausente en el patch significa "no tocar".
- **Todas las mutaciones del modal avisan** (`bumpData()`, §5.3), borrar incluido.
  El `onChanged` de la vista que lo monta recarga solo lo que esa vista considera
  suyo: en el ritual diario es `useBoard` con hoy, mientras el repaso del día
  anterior y la columna del backlog dependen de `dataVersion`. Borrar era la única
  que no avisaba, y la card se quedaba en pantalla después de borrarse (Mej.20).
- Notas en markdown (`react-markdown` + `remark-gfm`), click para editar.
  Los links se extraen del texto con `extractLinks` y se listan aparte.
- **Un link pegado en el título al crear la tarea termina acá como chip**, y el
  camino es el de arriba: el link **sale del título** y se escribe en las notas
  bajo una sección `# Recursos:`, un ítem por link (`resources.ts`). Las notas
  son el único lugar donde vive un link —los chips salen de `extractLinks(notes)`
  y nada más—, así que darle una sección propia es lo que permite limpiar el
  título sin inventarle una columna a la tarea ni dejar el link tirado en medio
  de una nota. Si la sección ya existe, el link entra **al final de su lista**,
  no en una segunda sección. Tres detalles que no son evidentes:
  - **La cosecha usa el mismo patrón que `extractLinks`.** Dos detectores
    distintos dejarían guardado un link que después ningún chip dibuja.
  - **Al escribir solo se cosecha un link ya cerrado** (con un espacio detrás);
    al **pegar** se cosecha todo. `https://g` ya calza con el patrón, así que
    cosechar en cada tecla se comería la URL a la novena letra. Y por lo mismo el
    espacio final se recorta al pegar pero no al escribir: es el que acaba de
    cerrar la URL, y sacarlo pega la letra siguiente a la palabra anterior.
  - **El modal de creación dibuja los links cosechados con una ×.** El título se
    limpia solo; sin ver a dónde fue el link, el gesto se leería como que se
    perdió, y no habría forma de arrepentirse antes de crear.

  **Editar el título en el detalle no cosecha nada**: acá el link ya se escribe a
  mano donde va.
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

  **El filtro por prioridad** vive al lado del buscador, **con su misma caja**
  (mismo alto, mismo radio, mismo fondo hundido): compacto como en el panel se
  leía como un botón pegado a un campo de otra familia, y el desnivel era lo
  primero que se veía de la cabecera. Acá el espacio sobra, que es justo lo que no
  pasa en el panel — de ahí que el mismo `.bfilter` tenga dos tallas. Es
  multiselección: el
  caso real no es "muéstrame los P1" sino "muéstrame lo que arde", que son dos o
  tres niveles. El conjunto vacío significa **todas**, no ninguna, así que
  destildar el último devuelve la lista entera. Se combina con el buscador, y
  cuenta como filtro para el `includeEmpty` y para el "N de M".
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
- **Filtra por prioridad y por canal, y ordena por prioridad o antigüedad, todo
  desde un solo control** (`PanelFilters`). La primera versión eran tres botones
  en fila, cada uno con lo aplicado escrito encima, y **envolvían a dos líneas en
  cuanto el canal elegido tenía nombre largo**: el ancho de la fila dependía del
  valor, y en 300px eso rompía la caja de la cabecera. Ensanchar el panel no es
  opción (se superpone a una columna del board) y tres iconos pelados no dicen
  qué hacen. Con un botón el ancho deja de depender de lo aplicado — el nombre del
  canal vive adentro del popover, que es portal y tiene el espacio que necesita.

  Dos marcas en el botón, y son distintas a propósito: **el contador es de
  filtros** (niveles + canal), que es lo que recorta la lista; **el orden no suma
  al contador** porque siempre hay uno y un "1" permanente no distinguiría nada,
  pero cuando no es el de por defecto el botón igual se enciende.

  **Todo se saca con el mismo click con que se puso**: el canal es un toggle igual
  que los niveles. No hay un limpiar por sección — ni "Ver todas" en los niveles ni
  la fila "Todos los canales" del select—: el primero solo existía cuando había
  algo puesto (la lista cambiaba de alto al elegir) y a lo ancho pesaba más que los
  cinco niveles juntos siendo la acción de deshacer; la segunda además desaparece
  al escribir en el buscador, o sea que cómo se quitaba el filtro dependía de lo
  que hubieras tecleado.

  **Sí hay un "Restablecer", uno solo y al pie del popover.** No es lo mismo que
  los anteriores: aquellos eran uno por sección, metidos entre los controles, y ahí
  la forma de quitar un filtro competía con la de ponerlo. Este responde otra
  pregunta —"déjame esto como estaba"— que con tres controles puestos son tres
  clicks, y deja también el orden en antigüedad. Aparece solo cuando hay algo que
  deshacer.

  **El botón va en la fila del contador**, no en una línea propia debajo ni en la
  del título. Lo primero porque el contador es justamente lo que los filtros
  cambian ("2 de 12" ← por esto), y en una tercera línea, con la cabecera ya
  terminada arriba, se leía como el primer elemento de la lista. Lo segundo porque
  la fila del título es del `panel-head` **compartido con el panel de agenda**, y el
  backlog es el único de los dos que filtra: un botón ahí que en el otro panel no
  existe es la forma de que las dos cabeceras dejen de leerse como la misma.

  **La X se queda.** El panel ya se cierra de tres formas —la X, Escape, y el icono
  de la tira, que es toggle— y la X es la única visible. Cerrar por click afuera
  quedó descartado y no por gusto: este panel participa del DnD, y un arrastre que
  termina sobre una columna suelta el puntero justamente afuera del panel.

  Adentro, el `SearchSelect` del canal va **embebido y no detrás de un segundo
  popover**: un popover encima de otro se cierra al primer click fuera del de
  arriba, que ahí es el de adentro. El filtro por canal acepta los **dos
  niveles** —elegir un contexto arrastra a sus channels (`filterByChannel`)—,
  porque el picker ofrece los dos y con la coincidencia exacta elegir un contexto
  devolvería la lista vacía.

  **El orden es por defecto antigüedad ascendente** (la más vieja arriba: el
  backlog se lee como una fila) y ahí **agrupa por contexto**, que es la forma
  normal del panel: se está planificando, y el contexto es lo que se decide.

  **Por prioridad, en cambio, la lista se aplana**: los rótulos de contexto
  desaparecen y quedan todas las tareas en una sola columna, de P1 a P5 y las sin
  prioridad al final (desempate por antigüedad). La primera versión ordenaba solo
  **dentro** de cada contexto y estaba mal por dos razones que se vieron recién al
  usarla: con una o dos tareas por contexto no movía nada y el control parecía
  roto, y peor, un P1 de Issues quedaba debajo de tres P4 de Thinking solo porque
  Thinking va antes en la lista de categorías — lo contrario de la pregunta que se
  estaba haciendo. La pregunta de ese orden es **qué es lo más urgente, y cruza
  los contextos**. No se pierde de dónde viene cada tarea: la card sigue llevando
  su chip de canal.

  **Nada de esto baja a SQL, y no es pereza**: `list_backlog` ordena por
  `category_id, position, id`, y de esa `position` global depende que un drop en
  0 signifique "primera de su contexto". Un `ORDER BY` nuevo cambiaría lo que
  significa soltar una tarea acá. El filtro y el comparador son puros y viven en
  `src/features/tasks/priority.ts` y `grouping.ts`, con sus tests.
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

**La card marca si la tarea cuelga de un objetivo, con el icono y sin el nombre**
(`tc__obj`, §4.29). El título del objetivo compite con el de la tarea en una card
de 200px, y de cuál se trata es una pregunta del detalle, no de la lista. Por lo
mismo **no lleva relleno cuando no hay objetivo** y no depende de
`hidePlaceholders`: solo se dibuja cuando hay algo que decir, así que nunca es una
marca de posición. Tampoco es un botón — el objetivo se cambia desde el detalle, y
un target clickeable ahí prometería algo que no hace.

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

### 4.30 Prioridades

Cinco niveles, **`P1` (lo que arde) a `P5` (lo que puede esperar)**, más
"sin prioridad" que es `NULL` y **no un sexto valor** (§3.1, §3.2). El nivel vive
en `tasks.priority` (migración 16) y el enum en `src/lib/enums.ts` (`Priority`,
`PRIORITIES`).

**No se configuran, y esa es la decisión.** Una escala que se edita deja de
comparar: un P2 de hace tres meses ya no significaría lo mismo que el de hoy, y el
color de cada nivel está calculado contra los otros cuatro. Lo único configurable
es el interruptor general en Configs → General (`priorities_enabled`, encendido de
fábrica): apaga el indicador de las cards, el selector del detalle y los filtros y
el orden del backlog, y **no borra nada** — volver a encenderlo devuelve cada tarea
con el nivel que tenía. Por eso las vistas que filtran dejan de aplicar el filtro
cuando está apagado: una lista recortada por un control invisible no se puede
deshacer.

**Los colores son una rampa, no cinco colores elegidos** (`--prio-p1`…`--prio-p5`
en `tokens.css`): los extremos son el rojo de P1 y el celeste de P5, y los tres del
medio salen de interpolar en **OKLCH** con el matiz por la vuelta corta —la que
pasa por ámbar, verde y verde agua—, de modo que la escala leída en orden se ve
como un semáforo. En sRGB el camino recto pasa por un gris embarrado en P3, que al
lado de la paleta de canales se lee como un color roto y no como un nivel
intermedio. **ΔE mínimo entre los cinco: 11.0**, más holgado que los 8.1 de los
canales porque acá son cinco y no veinticuatro.

**No llevan `-ink` y no deben llevarlo.** La marca es siempre punto de color +
etiqueta (`PriorityTag`, `● P2`), nunca la etiqueta escrita encima del color: así
el texto es el del tema, ningún nivel tiene que sostener un contraste calibrado
contra las superficies de los dos temas, y el nivel sigue siendo legible para quien
no distingue estos cinco matices entre sí. Sin prioridad **no dibuja nada** —es una
marca que está o no está, como la banderita del objetivo, así que tampoco depende
de `hidePlaceholders`.

Dónde aparece: el indicador en la card (§4.3), el selector en el detalle (§4.4), el
chip del modal de crear (§4.31), y el filtro de la vista Backlog más el filtro y el
orden del panel (§4.5). La lógica
—color, comparador, filtro y orden— es pura y vive en
`src/features/tasks/priority.ts`.

### 4.31 Modal de crear (`AddTaskModal`)

La tarea se agrega **en medio de una reunión**: la frase se escribe entera y se le
da Enter. Todo lo que sigue sale de ahí.

- **El click afuera no cierra.** Es el único modal de la app donde lo que se
  pierde no existe en ningún otro lado —no hay autosave que rescatar, la tarea
  todavía no está creada—, y el gesto que lo disparaba (un click al pasar) no se
  parece en nada a "descartar esto". Para salir están Escape y el atajo. Escape
  con un popover abierto cierra el popover, no el modal.
- **Los chips se llenan solos mientras se escribe** (`suggest.ts`): tiempo
  estimado, canal y objetivo de la semana. Tres reglas y una condición:
  - **Tiempo**: lo explícito manda ("30 min", "2h", "media hora", "hora y media",
    "un cuarto de hora"); recién si no hay número deciden las palabras clave, que
    son **configurables** (Configs → Sugerencias, más abajo). Entre dos reglas que
    calzan gana la de **menos minutos**, por lo mismo que los defaults se
    equivocan a la baja: subir un estimado es un click, y una agenda inflada deja
    de mirarse. El resultado se **redondea a un preset** de `TIME_PRESETS`:
    sugerir 25 min dejaría un chip que el picker no sabe volver a elegir.
  - **Canal**, tres formas en orden: el `#canal` escrito a mano —comparado
    **exacto**, porque es una intención y no una coincidencia: si `#docs-api` no
    existe, caer en `docs` es peor que no calzar—; una palabra mapeada en Configs
    (`issues`, `soporte`, `tickets` → `#incidencias`); y por último el nombre del
    canal aparecido en la frase, y entre varios el más largo. Para los nombres
    compuestos siguen valiendo los bordes de palabra: sin ellos `Docs` se
    activaría dentro de "documentación", que no habla de él.
  - **Objetivo**: solapamiento de palabras significativas con el título del
    objetivo. "Significativas" es concreto: se normalizan (sin tildes, en
    minúsculas), se descartan las de menos de cuatro letras y las vacías de
    contenido (`para`, `hacer`, `todos`…), y hace falta que coincidan **dos**, o
    **una sola si tiene seis letras o más**. Bajo el umbral **no sugiere nada**: un
    objetivo puesto por casualidad se guarda igual y nadie lo revisa después, así
    que es peor que ninguno.
  - **Las palabras se comparan con tolerancia** (`matching.ts`), y es lo que hace
    usable la lista configurable: si hubiera que escribir cada plural y cada
    variante, la lista se abandona a la tercera. Tres reglas, en este orden:
    igualdad tras normalizar (sin tildes, en minúsculas); **plural** (`+s`/`+es`,
    en cualquier sentido); y **Jaro-Winkler ≥ 0.9**.

    Jaro-Winkler es el algoritmo estándar para comparar nombres escritos a mano
    —el de la deduplicación de padrones—: da una similitud normalizada entre 0 y 1
    y premia el prefijo compartido, que acá viene bien porque el typo casi nunca
    está en la primera letra. **0.9 es su corte convencional**, y se deja en ese
    valor a propósito: antes esto eran tres tramos de distancia de edición
    elegidos a ojo contra nuestros propios ejemplos, y un umbral publicado vale
    más que unos números calibrados para pasar los tests de uno. Medido: entran
    `reviwe`/`review` (0.97), `tikcet`/`tickets` (0.92 — el typo y el plural
    juntos) y `sporte`/`soporte` (0.91); quedan afuera `mail`/`mall` (0.87),
    `docs`/`dock` (0.88) y `doc`/`docente` (0.87).

    Dos decisiones alrededor del algoritmo. **El plural se pregunta antes** y no
    se le deja a la métrica: es una certeza, y así `issue`/`issues` no queda
    sujeto a que dos letras sobre cinco pasen el umbral. Y **solo se comparan con
    tolerancia las palabras sueltas**: un compuesto con guion (`#docs-api`) es un
    nombre propio y se compara literal, o parecerse a un pedazo de él terminaría
    sugiriendo el canal `docs`. Lo que sí se acepta a sabiendas son las colisiones
    entre palabras largas que de verdad son distintas —`revisar`/`revisor`, 0.94—:
    lo que se juega es un chip que se corrige con un click, contra una función que
    deja de servir apenas escribes rápido, que es cuando se usa.
  - **No pisa lo elegido a mano.** Cada uno de los tres se traba en cuanto el
    usuario lo elige en su picker, y los `composeDefaults` cuentan como elegidos
    (quien abrió el modal desde una columna de canal ya dijo cuál). Sin la traba
    la ayuda se convierte en algo contra lo que hay que pelear.
  - **El `#canal` capturado sale del título al crear** (`stripChannelTag`), por lo
    mismo que los links de §4.4: si se queda, el canal viaja escrito dos veces y
    se lee en cada card. Solo la etiqueta —una anotación, no prosa—; el nombre
    suelto se queda, porque recortar "Preparar la meetings del lunes" deja una
    frase rota. Y lo mismo con el "90 min" de una frase: ahí el número puede ser
    del asunto ("comprar 2 horas de créditos"), así que no se toca. **Al crear y
    no al tipear**, igual que la cosecha de links espera a que la URL esté
    cerrada: borrarle el `#docs` a alguien que va escribiendo `#docs-api` le come
    lo que acaba de teclear.
  - **Se recalcula entero en cada tecla**, no se acumula: borrar "reunión" de la
    frase tiene que llevarse los 30 minutos con ella, no dejarlos colgados de una
    palabra que ya no está. Por eso `suggestFromTitle` es pura y devuelve los
    campos **ausentes** cuando no sabe — ausente es "no sé", `null` es una
    decisión, y la decisión la toma el usuario.
- **Configs → Sugerencias** (`SuggestionsCard.tsx`, en `features/tasks`: la card
  es de esta función y Configs solo la hospeda, como `FeedsCard`). Dos listas de
  reglas —palabras → minutos y palabras → canal—, editables en el lugar y con
  autosave, sin botón Guardar. Tres decisiones de forma:
  - **Cada palabra es una pill**, no un texto con comas. Separadas por coma se
    leen como una frase y hay que recorrerla entera para ver cuántas hay; en pills
    se cuentan de un vistazo y cada una se borra sola. Sin color, a diferencia del
    `#tag` de las tarjetas: acá no clasifican nada, son el mismo dato repetido. Se
    confirman con Enter o coma —guardar por tecla sería un `setSetting` por
    letra—, y también al salir del campo, porque lo tecleado y no confirmado se
    perdería en silencio. Pegar `issues, soporte` deja dos pills, no una.
  - **Una sola explicación para las dos listas.** Hacen lo mismo —un grupo de
    palabras que significa algo— y contarlo dos veces obliga a leer las dos para
    descubrir que dicen lo mismo; lo propio de cada una cabe en su rótulo.
  - **El vocabulario de fábrica es corto** (21 palabras, no 50): una lista larga se
    lee como algo cerrado, y lo que hay que invitar es lo contrario. Los sinónimos
    no vienen puestos (`contestar` junto a `responder`) porque agregarlos toma dos
    segundos, y el plural y los typos ya los toma `mismaPalabra`. **Ninguna palabra
    de fábrica se parece a otra por encima del umbral**, y al agregar una hay que
    verificar lo mismo: dos parecidas con tiempos distintos hacen que el chip lo
    decida el desempate y no lo que se escribió. Se guardan como JSON en `suggest_time_rules` y
  `suggest_channel_rules`, con la doctrina de `collapsed_weekdays`: **ausente ⇒ el
  default, presente ⇒ lo que diga, incluso vacío**. Vaciar la lista de tiempos es
  "no me adivines el tiempo" y tiene que sobrevivir al reinicio, no volver a los
  defaults. La de canales **arranca vacía** —los canales los inventa cada uno— y
  ahí ausente y vacío significan lo mismo. Todo lo que no calce con la forma
  esperada se descarta **regla por regla** (`parseTimeRules`): una fila rota, o un
  canal que se borró después, no puede apagar la lista entera.
- **Los chips se leen como etiquetas, no como botones**: fondo del papel y un
  borde suave, que es lo único que dice "esto se puede cambiar". Antes cada chip
  puesto se rellenaba de apricot y la barra entera terminaba pintada de un color
  que no significaba nada — el valor ya se distingue por el texto, que pasa de
  `--muted` a `--ink`. El apricot queda para lo que sí es un estado momentáneo: el
  chip con su popover abierto.
- **El chip de canal va teñido con el color de su canal** (`chip--canal` +
  `chipVarsForColor`, los mismos que los selectores de Calendarios): es el mismo
  dato que el `#tag` de las cards, y verlo en el apricot genérico de `.chip.is-set`
  acá y en su color allá lo desconecta de su canal. El `#` sigue la regla de la
  lista de la que se eligió (`channelOptions`): lo llevan los channels, no los
  contextos.
- **La prioridad solo si el interruptor está encendido** (§4.30). Mismo popover
  sin buscador que el detalle, y `null` explícito en "Sin prioridad".
- **El atajo del calendario dice "Al backlog", no "Sin fecha"**: con una fecha ya
  puesta, lo que se elige no es un estado sino a dónde se manda la tarea, y el
  backlog es el lugar que tiene nombre.
- **Los presets de tiempo son los mismos en toda la app** (`TIME_PRESETS` en
  `lib/capacity.ts`): el chip de acá, los dos pickers del detalle y de la card,
  los de Focus y el reparto por día de un objetivo. Estaban copiados en tres
  archivos y ya habían divergido —una lista tenía 180 y 240 y otra no—, así que la
  misma pregunta se respondía distinto según dónde la hicieras.
- Los links pegados en el título se cosechan y quedan como recursos: el camino
  entero está en §4.4.
