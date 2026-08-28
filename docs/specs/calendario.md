# §4.12–4.13 Calendario: feeds ICS y rail

La importación de feeds ICS con su reconciler, y el rail que dibuja la agenda del día.

Vuelve al [índice de SPECS](../SPECS.md).
---

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
  - **Y la repetición del maestro se descarta**, en una primera pasada que junta
    todos los `RECURRENCE-ID` del archivo antes de expandir nada. Compartir clave
    alcanzaba para no mostrar la reunión dos veces, pero no para decidir cuál de
    las dos gana: eso lo decidía el orden de los VEVENT, y **Google lo cambia
    entre descargas** (medido: dos `curl` seguidos al mismo feed dejan al maestro
    antes y después de la instancia editada). Por eso una reunión movida saltaba
    entre su hora vieja y la nueva de una sincronización a otra. Dos detalles de
    esa pasada que no son opcionales: **no filtra por ventana** —una instancia
    movida a dentro de un mes no se importa, pero su repetición original sí cae
    en la ventana y sin suprimirla la reunión queda clavada en el horario del que
    la sacaste— y **`STATUS:CANCELLED` también suprime**, porque borrar una sola
    repetición llega así y no como `EXDATE` (el `EXDATE` es solo para las que
    borraste antes de que existiera la instancia).
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
- **`STATUS:CANCELLED` se descarta, y `PARTSTAT=DECLINED` también**: lo que
  rechazaste no entra. Saber cuál de los invitados eres tú **no necesita
  configurar nada**: Google emite `X-WR-CALNAME` con la dirección del calendario
  (`ics::my_email`). Cuatro detalles que hacen que la regla no muerda:
  - **Se lee del `ATTENDEE` crudo, no de `attendees`.** En la lista que se guarda,
    el organizador y el invitado se deduplican, así que justo en los eventos que
    organizas tú —donde tu respuesta importa igual— quedaría una sola fila.
  - **Solo `DECLINED`.** `NEEDS-ACTION` y `TENTATIVE` siguen entrando: son tiempo
    que quizás gastes, y no responder no es no ir.
  - **Si no se puede saber de quién es el calendario, no se filtra nada.**
    `X-WR-CALNAME` es el *nombre* del calendario: en el primario de Google es la
    dirección, pero en uno secundario puede ser "Cumpleaños". Se exige que
    parezca un correo, y ante la duda se importa: equivocarse identificando al
    dueño borraría reuniones de verdad en silencio.
  - **No hay lista negra, y no hace falta.** La respuesta viene en **cada**
    pasada, así que el feed ya es la fuente de verdad; guardar una lista sería una
    segunda copia que puede quedar desincronizada. Si vuelves a aceptar, la
    siguiente sincronización la importa de nuevo, y si la tarea ya existía,
    `reconcile_feed` la resuelve con sus reglas normales. Rechazar **una sola
    repetición** funciona igual: llega como instancia propia con `RECURRENCE-ID`,
    y por eso el filtro va **después** de la pasada que junta los
    `RECURRENCE-ID` — si esa instancia no suprimiera la repetición del maestro, la
    reunión rechazada se volvería a dibujar.
- **El `_R<instante>` de una serie partida se recorta** (`ics::base_uid`). Cuando
  alguien edita una recurrente con "este evento y los siguientes", Google **parte
  la serie**: la vieja queda con un `UNTIL` justo antes del corte y aparece un UID
  nuevo, el mismo con un `_R<instante-del-corte>` metido antes del `@`. Para la app
  eso era una serie **nueva**: cambiaba la clave de cada repetición futura, así que
  el reconciler borraba las tareas y el import creaba otras. Y borrar e insertar no
  es actualizar — se perdía todo lo tocado a mano (canal, notas, posición), y una
  instancia con tiempo trackeado se soltaba del feed **y** volvía a entrar con el
  UID nuevo, dejando la misma reunión dos veces en el tablero. Normalizando el UID
  la clave no se mueve y el upsert actualiza en su lugar, que es lo que un cambio
  de horario tiene que hacer. Se recorta **solo** la forma exacta del sello
  (`<8 dígitos>T<6 dígitos>`, `Z` opcional, o **solo la fecha** en un evento de día
  completo, cuyo `RECURRENCE-ID` no tiene reloj); un `_R` en el medio de un UID
  cualquiera no se toca. La **migración 15** alinea los `calendar_uid` ya
  guardados, para que la primera sincronización actualice en vez de borrar y crear.
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
manda en las dos propiedades) — **pero conservando su `PARTSTAT`**, que es lo que
trae la fila de `ATTENDEE` y no la de `ORGANIZER`. Descartarla sin más borraba tu
propia respuesta en **todos** los eventos que organizas tú (Google te pone como
invitado en ellos), así que el detalle te mostraba "sin responder" incluso
habiendo rechazado.

> **Un calendario compartido "ocultando los detalles" no trae nada de esto.** Es
> la restricción de Google —y la que suele imponer un Workspace que no permite
> compartir hacia afuera con detalle—: el feed emite eventos con `SUMMARY:busy`
> y **sin** descripción, invitados, ubicación ni link de reunión. Lo único
> aprovechable es cuándo y cuánto duran. No hay nada que la app pueda hacer con
> eso: el dato no existe del otro lado. **Para tener detalles hace falta la
> dirección secreta del calendario**, que es lo único que emite el feed completo.

**Eventos ignorados: los que solo ocupan la agenda** (`tasks.rail_only`,
migración 14). Un "focus time" del calendario —el almuerzo, un rato de
concentración— es espacio reservado, no trabajo. Con la marca la app lo **ignora
por completo**: lo único que sigue haciendo es ocupar su hora en el rail, que es
para lo que sirve —planificar alrededor—. Sin esto, hora y cuarto de almuerzo se
leían como hora y cuarto de trabajo planificado y el semáforo de capacidad mentía
todos los días.

"Ignorar" es literal, y son **cinco exclusiones** además de la tarjeta:

| Lectura | Qué se excluye | Por qué |
|---|---|---|
| columna del día (`tasksByDate`) | la tarjeta | no es trabajo que ordenar |
| capacidad / `plan_by_day` | sus minutos | no es carga |
| `focus_queue` | la tarea | no es algo que "hacer ahora" |
| `meetings_for_date` | el aviso | no interrumpe para anunciar el almuerzo |
| rollup semanal (regla 3) | su duración | una reunión sin trackear no se cuenta como trabajada |
| `last_day_with_tasks` | el día | un día con solo un almuerzo no es un día que repasar |

**La exclusión de la tarjeta vive en `tasksByDate`, así que una vista que quiera
"lo del día" tiene que leer de ahí y no del arreglo crudo `tasks`.** El cierre del
día filtraba `tasks` por fecha para armar "Qué quedó pendiente", y era la única
vista de la app donde el almuerzo reaparecía —encima como algo que quedó por
hacer—. `useBoard` expone las dos listas a propósito (`agendaByDate` es la del
rail, con los ignorados; `tasksByDate` es la de las tarjetas, sin ellos): elegir la
equivocada no da error, solo devuelve el bloque ignorado.

La fila sigue existiendo en `tasks` y **sigue siendo del feed**: la sincronización
la actualiza como a cualquier otra, así que si mueves el almuerzo en Google el
bloque se mueve. Lo que no existe es ninguna puerta para trabajarla —no hay
tarjeta, no está en Focus—, así que no puede acumular tiempo nuevo.

**Y por eso ignorar no toca las repeticiones que ya trabajaste** (con
`time_entries` o `DONE`): se quedan como tarjetas normales. Son dos trampas de una
sola regla, las dos con precedente:

- Con el **taxímetro corriendo**, ignorarla la saca del tablero *y* de Focus, así
  que el timer seguiría contando sobre algo que no podés ver ni detener desde ahí
  — exactamente lo que `reconcile_feed` decidió no hacer ni para marcar
  `ORPHANED`. Una corrida abierta es una `time_entry`, así que el mismo filtro la
  cubre.
- Una **trabajada o completada** escondida de la columna deja su tiempo contado en
  la review: el estado partido del que salió la migración 6. Ese tiempo es tuyo.

Al **desmarcar** sí se tocan todas, o alguna podría quedarse ignorada para
siempre. Y la consecuencia a tener presente: el día que trabajaste el almuerzo, esa
tarjeta se queda en la columna con su tiempo — es lo correcto, pero se nota.

- **La marca la pone el usuario, no el feed.** El ICS de Google **no distingue**
  un focus time de una reunión cualquiera: no emite `X-GOOGLE-EVENT-TYPE`, y el
  VEVENT del almuerzo es idéntico al de un evento suelto (medido sobre un feed
  real: ni participantes ni `TRANSP` sirven de pista). No hay nada que importar,
  así que la sincronización tampoco lo pisa.
- **Es de la serie, no de la repetición** (`calendar_series_prefs`). El almuerzo
  es semanal: con la marca en la tarea habría que volver a ponerla cada vez que
  entra una repetición nueva, para siempre. La clave es el UID pelado —lo que va
  antes del `#`—, y `import_events` la hereda al insertar. Se guarda además en
  `tasks.rail_only` porque la preferencia sola no cambiaría nada de lo ya
  importado.
- **Columna propia y no un `source_state`.** `ORPHANED` ya significó a la vez "no
  la planifiques" y "no la muestres", y desenredar esas dos costó la migración 6.
- **Al soltarse del feed la marca se cae** (`reconcile_feed`): una tarea sin feed
  que la conservara quedaría invisible en el tablero, con su tiempo trackeado
  encima y sin forma de recuperarla desde ahí.
- **No cuenta al reordenar.** El índice que manda la vista se cuenta contra las
  cards que se ven, así que `move_task` descuenta los bloques de agenda igual que
  las `ORPHANED`; si no, una card soltada debajo del almuerzo aterrizaba un lugar
  más abajo. `place_by_time` no los ubica: no están en la columna.
- **Se marca y se desmarca en el detalle**, con un switch **en el pie, a la
  derecha** (el mismo de Configs, `components/Switch`, y no un checkbox nativo:
  en macOS no se puede estilar sin redibujarlo entero). Ese lugar lo ocupaba
  "los cambios se guardan automáticamente", un texto que no decía nada que
  hiciera falta —el autosave se nota usándolo— y era el único espacio del modal
  que no hacía nada. Abajo queda además lejos del título y de las notas: es una
  decisión sobre el evento, no un campo que se edita. El rótulo es **"Ignorar
  como tarea"**, y dice justo lo que pasa: el evento no desaparece, deja de ser
  una tarea. Sin explicación al lado — un renglón de ayuda en una barra de una
  línea se desparrama hacia la izquierda y choca con el botón de eliminar.
  Ignorada, la tarea no tiene tarjeta, pero el detalle sigue
  siendo alcanzable: **su bloque del rail lo abre igual que cualquier otro**.
  Hubo una versión con un popover propio en el rail para desmarcarla, y se
  descartó: agregaba un comportamiento que hay que aprender y le daba al rail un
  camino de escritura, cuando el control de volver atrás ya estaba en el detalle.
- **El detalle de una ignorada esconde las acciones de trabajo**: completar, el
  play y los dos ajustes de tiempo. El play es el que importa: sobre una tarea sin
  tarjeta en ninguna columna dejaría el taxímetro corriendo donde no se puede ver
  ni detener — la misma trampa que `set_series_rail_only` evita al no tocar lo ya
  trabajado. Quedan sus datos del evento, sus notas, el canal y el switch. El
  lugar del círculo de completar **no** se reserva: se probó reservarlo para que
  el título no perdiera la sangría, y el hueco vacío se veía peor que el título
  pegado al borde.
- **Se ve atenuado y con borde punteado**, el mismo idioma que lo proyectado
  ("esto no es un compromiso de trabajo"), pero conserva su color: si no, no hay
  cómo saber de qué es el bloque.

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

**Las reuniones entran ordenadas por hora** (`repo::place_by_time`). El feed las
entrega en el orden que se le antoja a Google, y entrando al final de su día la
semana mostraba la agenda desordenada mientras el rail —que ordena por hora—
mostraba otra cosa.

**Pero solo se ordenan entre ellas: lo que no tiene hora no se mueve.** Esa es la
mitad del punto. La columna del día **es el plan del día** —para eso se arrastran
las cards— y dónde va una tarea a mano entre dos reuniones lo decide el usuario;
el rail proyecta en ese mismo orden (§4.13), así que la columna y el rail cuentan
la misma historia. Un orden impuesto del tipo "reuniones primero, tareas después"
haría imposible planificar con las cards.

La regla exacta: un evento entra **justo delante del primer evento posterior a su
hora**, y si no hay ninguno, al final. Dicho de otro modo, **un evento nuevo se
abre paso entre otros eventos y nunca desplaza una tarea tuya**. Entre reuniones
el resultado es idéntico a ordenarlas por hora; la diferencia aparece cuando
arrastraste algo a un hueco, y ahí gana lo que arrastraste. Un evento de **día
completo** no tiene reloj: va arriba de todo, que es donde el rail lo dibuja (una
franja sobre la grilla, no un bloque).

Se ubica **al importar y cuando el evento cambia de día o de hora**, no en cada
pasada: después de eso la columna es del usuario, y reubicar cada cinco minutos
borraría cualquier arrastre. Ordenar solo al dibujar no servía —el índice que
escribe un arrastre se cuenta contra la lista que se ve, y con la vista ordenada
distinto de `position` la card aterrizaba donde no la soltaste—; por eso el orden
se guarda en `position` y no se calcula en el front.

La **migración 14** lo aplica de una vez a lo ya importado, con el mismo criterio:
toma los lugares que hoy ocupan las tareas **con** hora y los reparte entre ellas
en orden de reloj; los lugares de las demás quedan intactos. Los eventos de **día
completo** son la excepción y suben al tope de su día: son la franja de arriba del
rail, no trabajo con un lugar en el plan, así que no hay nada del usuario que
preservar.

**El upsert no pisa lo que tocaste a mano.** Actualiza título, fecha, hora y
horario del evento —lo que cambia cuando alguien mueve la reunión— y deja
intactos `status`, `actual_seconds`, `category_id` y `notes`. `position` es la
excepción, y solo cuando el evento se movió de día o de hora: ver arriba. Si no, cada
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
de cada import con los UIDs que este acaba de ver. **Devuelve nombres y no solo
números** (`Reconciled`), y el log los emite: un "3 borradas" a secas no se puede
reconstruir después, porque las filas ya no existen. Y lo que desaparece del feed
casi nunca es un evento borrado —Google parte series, cambia UIDs, mueve
instancias—, así que el log es lo único que queda para entender qué pasó. La regla es **asimétrica a
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
  - **Las reuniones que están más arriba en la columna son una barrera, no solo
    un obstáculo.** Una tarea arrastrada debajo de la de las 15:00 se proyecta
    después de las 15:00, aunque la mañana esté entera libre; la misma tarea
    arrastrada arriba se proyecta a las 9:00. Sin esa regla el rail dibujaba el
    mismo día para dos órdenes distintos, y entonces ordenar las cards no servía
    para lo único que sirve: decir cómo se va a ver el día. La proyección hace un
    solo recorrido por la columna en orden de `position`, colocando las
    pendientes y corriendo el cursor al pasar por una fija.
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
  (§4.3). Un bloque solo abre el detalle, **también el de un evento ignorado**
  (§4.12): ese detalle es la única puerta que le queda a una tarea sin tarjeta, y
  es donde vive el switch para dejar de ignorarla.
- Recibe **la misma lista** que la columna del día, para que las dos lecturas del
  mismo día no puedan divergir. La única excepción son los **bloques de agenda**
  (§4.12): el rail recibe `agendaByDate` y la columna `tasksByDate`, que es la
  misma lista filtrada por `railOnly`. Las dos salen del mismo arreglo y difieren
  **solo** en ese campo, así que no hay forma de que una tarea aparezca en una y
  falte en la otra por accidente.
- La línea de "ahora" solo se dibuja en el día de hoy, y relee el reloj en vez de
  acumular: macOS agrupa los temporizadores al suspender (mismo criterio que
  `checkDayChange`, §5.3.1).
