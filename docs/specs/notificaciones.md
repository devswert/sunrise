# sunrise — SPECS §4: Notificaciones y alertas

Las alertas que se quedan hasta que respondas, el aviso de próxima reunión y la sección de Configs que los gobierna.

> Es una parte de [SPECS.md](../SPECS.md), partido por área. **La numeración de
> secciones no cambia**: un `§4.12` en un comentario del código sigue apuntando
> acá. El índice completo está en el [§4 de SPECS.md](../SPECS.md#4-funcionalidades-por-área).

---

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
