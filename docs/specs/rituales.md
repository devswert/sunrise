# §4.14, 4.16 Rituales del día

La planificación diaria y el cierre del día con su bitácora: los dos gestos guiados que abren y cierran la jornada.

Vuelve al [índice de SPECS](../SPECS.md).
---

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
  **`day_work` acota el día en hora local, no en UTC**: las 22:00 en Chile ya son
  el día siguiente en UTC, así que con el corte en UTC el trabajo de la noche se
  le acredita al día equivocado. Una corrida en curso viene marcada y sin
  segundos, y una fecha ilegible devuelve vacío en vez de todo.
- **El paso 1 repasa el último día con tareas, no "ayer" a secas.** Un lunes,
  ayer es domingo y está vacío, mientras que lo que hay que cerrar es el viernes.
  Se lee una ventana de 7 días hacia atrás y se elige la fecha más reciente con
  algo (`lastDayWithTasks`) — **el mismo día que preserva §4.2**. Ignora hoy y el
  futuro: el repaso es sobre lo que ya pasó, y una tarea agendada para mañana no
  es algo que cerrar.
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
