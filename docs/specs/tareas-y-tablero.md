# sunrise — SPECS §4: Tareas y tablero

El CRUD de tareas, la degradación diaria al backlog, la vista semana y Today, el modal de detalle y el backlog.

> Es una parte de [SPECS.md](../SPECS.md), partido por área. **La numeración de
> secciones no cambia**: un `§4.12` en un comentario del código sigue apuntando
> acá. El índice completo está en el [§4 de SPECS.md](../SPECS.md#4-funcionalidades-por-área).

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
