# §4.6–4.7, 4.15 Tiempo: timer, Focus y rollup

El taxímetro, Focus Mode y la weekly review — o sea todo lo que cuenta, atribuye o agrega tiempo trabajado.

Vuelve al [índice de SPECS](../SPECS.md).
---

### 4.6 Timer / taxímetro

#### La zona en la que empieza y termina el día

**Todo instante se guarda en UTC** (`repo::now()`); la zona es solo el lente con el
que esos instantes se agrupan por día. Vive en `settings.timezone` como nombre IANA
(`America/Santiago`); **ausente o vacía = la del sistema**, y no la siembra ninguna
migración, así que el ajuste arranca sin efecto.

Quién la resuelve:

| Lado | Cómo |
|---|---|
| Rust, helpers de aritmética | por parámetro `tz: chrono_tz::Tz` |
| Rust, llamadores sin `&Connection` (`bell.rs`, `start_of_today`) | `repo::zone_cached()`, caché de proceso que invalida `set_setting` |
| Rust, entrada pública con conexión | `repo::zone(conn)` |
| Front | `src/lib/date.ts`; la empuja `useSettingsRuntime` con `setZone` |

**Solo nombres IANA.** `Intl` acepta también un desplazamiento fijo (`-04:00`) y
`chrono_tz` no, así que aceptarlo dejaría los dos lados agrupando el día distinto.
Se rechaza en `settings.timezone()` y hay tests a los dos lados que lo fijan.

**Qué se mueve al cambiarla y qué no.** Se mueven todas las fronteras de día, o sea
los totales por día y los rollups **incluidos los de semanas pasadas**. No se mueven
las horas de reloj que escribió el usuario (`scheduled_time`, la jornada): son
intenciones, no instantes. Sí se mueven las reuniones importadas, que son instantes
reales — y por eso cambiar el ajuste **fuerza un re-sync de los feeds**, porque su
`scheduled_time` se derivó al importar.

El razonamiento completo, con lo que se midió y lo que se descartó, está en
[DECISIONES §1 y §4](../DECISIONES.md).


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
  (backlog), no se mueve. Después deja lista la siguiente pendiente de hoy
  **en pausa** —avanzar no es empezar: arrancarla sola hacía correr el tiempo de
  una tarea que ni miraste—, con el contador en `0:00:00`, porque el taxímetro
  cuenta lo de hoy. Si no queda ninguna pendiente, **el taxímetro se oculta**:
  que desaparezca ya dice que no queda nada por hacer, y un estado "todo listo"
  dentro del widget no agrega información. Lo que sí celebra el día terminado es
  Focus (§4.7).
- **Campana** al alcanzar el estimado, **decidida y tocada en Rust**
  (`bell.rs`): sin estimado —`null` o `<= 0`— nunca suena, suena al **alcanzar**
  el estimado y **una sola vez por (tarea, día local, estimado)**. Subirle el
  estimado la vuelve a armar —es otra promesa—, y al día siguiente también,
  porque el contador es de hoy (I3). Pausar y reanudar dentro del mismo día ya
  **no**: la llave era la entrada, y con una tarea pasada de su estimado eso era
  una campanada en cada play. El sonido se sintetiza con `rodio` (`sound.rs`).

  > **La promesa vive en la base** (`tasks.bell_rung_for`, migración 17), no en
  > una variable del proceso, y el bug que lo obligó es la otra cara de una
  > decisión buena: **el timer sobrevive al cierre de la app** a propósito. La
  > promesa no lo hacía, así que al arrancar el vigilante no recordaba nada, veía
  > un timer que ya venía pasado y **sonaba de inmediato** sin que hubieras
  > alcanzado nada. En dev se cobraba en cada recompilación, y como al arrancar
  > también corre el sync inicial del calendario, las dos líneas aparecían juntas
  > en el log y el calendario parecía la causa. Formato `día|estimado`, por lo
  > mismo que `notified_for` guarda la hora: guarda **la promesa**, no un flag. **Sin notificación
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
- **`refresh` avanza igual que el check.** Re-lee la tarea pausada y, si la
  completaron desde otro lado (Focus, la card, el modal), pasa a la siguiente
  pendiente en pausa o se oculta. Antes quedaba en pantalla la tarea ya cerrada
  con su play, invitando a retomar algo terminado. Tres detalles que se rompen
  al editarlo: la re-lectura refresca título y estimado pero **no** pisa el
  contador con `actual_seconds` (total histórico, no lo de hoy); **no hace
  `broadcast()`**, porque refrescar no es mutar y avisar haría que la otra
  ventana refresque y avise de vuelta, con un `focus_queue` por salto; y por eso
  mismo escribe solo si el registro cambió.
- **Quien complete desde el front tiene que llamar a `bumpData()`**, y eso
  incluye a Focus. Completar detiene el timer **en Rust**, así que sin el aviso
  la ventana flotante nunca se entera: el síntoma fue exacto —completar desde la
  semana ocultaba el taxímetro y completar desde Focus lo dejaba ofreciendo
  retomar la tarea cerrada.

### 4.7 Focus Mode

- Cola = `focus_queue(date, nowHhmm)`: tareas `TODO` del día ordenadas por
  (1) sin hora o ya empezada antes que agendadas más tarde, (2) con hora
  primero dentro del grupo, (3) `scheduled_time`, (4) `position`, (5) `id`.
- Check ⇒ completa, **manda la tarea al final del día**, avanza y llama a
  `bumpData()` (ver §4.6: sin eso la ventana flotante no se entera).
- **Con la cola vacía, Focus es el cierre del día**: la marca de sunrise saliendo
  sobre el horizonte —el sol, no un check en un círculo: el check ya está en cada
  tarea que cerraste—, "Listo por hoy", el resumen del día —cuántas tareas y
  cuánto se trabajó contra lo planificado, de `daily_log`— y un botón que lleva
  al shutdown, que es el paso siguiente natural. El resumen se pide **solo** en
  ese estado, no en cada carga.
- **El confeti se dispara al vaciar la cola, no al montar la vista vacía.**
  Volver a Focus más tarde en un día ya terminado no vuelve a celebrarlo, y
  abrirlo en un día sin nada planificado tampoco.
- **`celebrate()` sale del centro de `.app-main`, no del de la ventana** (§7). Su
  canvas cubre la ventana entera, así que el `0.5` por defecto queda corrido a la
  izquierda de lo que estás mirando, y se corre otra vez al colapsar el sidebar
  con ⌘S. Se mide en cada llamada por eso. Vale para las tres celebraciones:
  Focus, planning y shutdown.
- **El encabezado son dos filas, no una**: arriba el canal a la izquierda y los
  tiempos con el play a la derecha; abajo el check y el título, con todo el ancho
  de la tarjeta. En una sola fila el título quedaba en una columna angosta y un
  título largo se partía en cuatro líneas con espacio libre al lado. El chip del
  canal es el mismo `.cat-tag` + `chipVars` de la card y el modal (§7): teñido con
  el color del canal, no con un color fijo de la vista.
- **La línea sobre las notas solo se dibuja si hay tarjeta del calendario**
  (`hasCalendarData`): sin nada que separar quedaba una segunda línea paralela a
  la del título con aire vacío en medio.
- ↑/↓ mueven el foco entre tareas del día (ignorado si el foco está en un
  input/textarea).
- Si el timer arranca en otra tarea, Focus salta a ella **una sola vez por
  tarea** (`syncedFor`), para no pelear con las flechas después.
- **Nunca auto-cierra ni bloquea al pasarse del estimado**: muestra el aviso
  "puedes seguir trabajando". Regla de producto, no detalle de UI.

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

> **Pero ese sello no le da hora al rail.** El mediodía es contable —atribuye el
> día—, no un dato de cuándo pasó algo, y dibujarlo como bloque inventa que la
> tarea ocurrió a mediodía: un día con varias correcciones apilaba media columna
> en la misma hora, cada bloque en su carril y ninguno legible. Por eso `day_work`
> devuelve **`tracked_at`, que solo mira las corridas del taxímetro** —las entradas
> con `ended_at` distinto de `started_at`, o abiertas— y viene en `null` cuando el
> día solo tuvo ajustes; `seconds` sí los suma, porque el total es correcto: lo que
> no se sabe es la hora. Sin ese corte pasaba algo peor todavía: como el sello es
> más temprano que la corrida, una tarea trabajada a las 15:41 y corregida después
> se dibujaba a las 12:00. En el rail, una tarea sin corrida se comporta como
> cualquier otra sin tiempo: con hora es un bloque fijo, sin hora se proyecta lo
> que falte, y completada no se dibuja. **El total no se pierde en ningún lado**:
> el cierre del día y el rollup agrupan por día, no por hora, y siguen leyendo
> `work_by_day`, que no cambió.

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
