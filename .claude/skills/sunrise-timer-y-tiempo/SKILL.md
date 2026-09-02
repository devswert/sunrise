---
name: sunrise-timer-y-tiempo
description: Reglas e invariantes del timer, `time_entries` y todo el tiempo trackeado de sunrise (taxímetro flotante, Focus Mode, campana al estimado, actual vs planned, rollup semanal). Úsala siempre que toques el taxímetro, el timer, `actual_seconds`, `estimated_minutes`, `time_entries`, la campana, o cualquier cálculo o agregación de tiempo — incluso si el cambio parece trivial, porque varias de estas reglas se rompen con ediciones que se ven correctas (por ejemplo "recalcular el total desde las entradas").
---

# Timer y tiempo en sunrise

El tiempo trabajado está respaldado en la DB (`time_entries`), no en memoria.
Estas reglas existen porque cada una ya se rompió o estuvo a punto: son
deliberadas, y la mayoría tiene su comentario en `src-tauri/src/repo.rs`.

**Dónde está escrito lo demás:** las invariantes en su forma corta viven en
[`docs/specs/invariantes.md`](../../../docs/specs/invariantes.md) (I1 a I6), el detalle del taxímetro y del rollup en
`docs/specs/tiempo.md` (§4.6, §4.7 y §4.15), y **por qué** cada regla es así —con
las alternativas que se descartaron y los números— en `docs/DECISIONES.md` §1 y §2.
Acá está lo que hay que saber para **editar** esto sin romperlo.

## Dónde vive cada cosa

| Archivo | Qué |
|---|---|
| `src-tauri/src/repo.rs` | `start_timer`, `stop_timer`, `get_active_timer`, `seconds_today`, `set_actual_seconds`, `focus_queue` |
| `src-tauri/src/bell.rs` | **decide y toca** la campana del estimado (vigilante) |
| `src-tauri/src/sound.rs` | síntesis de la campana con `rodio` |
| `src/features/timer/timerStore.ts` | store del timer (por ventana), `isOverEstimate`, `hms` |
| `src/features/timer/useTimer.ts` | `useTimerRuntime` (ciclo de vida por ventana) + `useTimer` |
| `src/features/timer/FloatingTimer.tsx` | el taxímetro |
| `src/features/focus/FocusView.tsx` | Focus Mode |

## Las reglas que no se deben romper

**La frontera del día sale de `repo::local_midnight`, y de ningún otro lado.** Es
lo único que convierte una medianoche local a UTC, y recibe la zona **por
parámetro** (`chrono_tz::Tz`). No escribas `chrono::Local` ni
`from_local_datetime(...).single()` en código nuevo:

- `.single()` devuelve `None` cuando la medianoche es **ambigua** (salto de otoño:
  ocurre dos veces). Eso ya rompió `start_of_today` —caía a `Utc::now()`, o sea el
  taxímetro en cero todo el día— y `utc_range_of_day`, que devolvía un rango vacío
  y dejaba el rail en blanco.
- `.earliest()` **no** cubre el caso en que la medianoche **no existe**: sobre
  `LocalResult::None` no hay ninguna candidata que ordenar. En Santiago no pasa,
  pero sí en otras zonas, y la zona es un ajuste del usuario.
- El cierre de un rango de día es **la medianoche del día siguiente**, nunca
  `inicio + 24 h`: un día con salto dura 23 o 25 horas.

**La zona es un ajuste (`settings.timezone`) y viaja distinto según quién la
necesite.** Los helpers que hacen aritmética la reciben por parámetro —para poder
testearlos con una zona fijada, que es la razón de ser del ajuste—; los llamadores
que no tienen `&Connection` (`bell.rs`, `start_of_today`) leen el caché de proceso
con `repo::zone_cached()`, que invalida `set_setting`. En el front la zona vive en
`src/lib/date.ts` y la empuja `useSettingsRuntime` con `setZone`; **nada en el front
lee `new Date().getHours()` directo** — para eso están `nowHhmm`, `nowMinutes`,
`minutesOfDay`, `dayInZone`, `startOfDayAt` y `todayISO`, que ya aplican la zona.

**Si tocas fechas, el test declara su zona.** `TZ=` en el entorno es global al
proceso y no se puede variar entre casos; por eso hubo tests que solo pasaban en
Santiago. Fija la zona por parámetro (o `TZ_FIXTURES` en `ics.rs`) y, cuando la
propiedad lo permita, **barre** en vez de elegir una fecha: el test que cubre las
fronteras de día recorre toda medianoche de toda zona de tzdata entre 2020 y 2030 y
tarda menos de un segundo.

**`actual_seconds` acumula; nunca se recalcula desde `time_entries`.**
`stop_timer` hace `actual_seconds = actual_seconds + seconds`. Se ve tentador
derivar el total con un `SUM(seconds)` sobre las entradas —es más "limpio"— pero
eso **pisa los ajustes manuales de tiempo** y hace que el usuario pierda lo que
escribió a mano. Si necesitas el total, lee la columna.

**Los ajustes manuales pasan por `set_actual_seconds`, no por `update_task`.**
Esa función, además de guardar el total, inserta una **entrada cerrada con el
delta** (`started_at = ended_at`, fechada en el día de la tarea — ver más abajo).
**Subir es una entrada; recortar pueden ser varias**, una por día (`spread_cut`). Es lo que permite que el rollup
semanal siga cuadrando cuando alguien corrige un tiempo porque se le olvidó
encender el taxímetro. Por eso `update_task` detecta `actual_seconds` en el
patch y **desvía** la escritura a `set_actual_seconds` en vez de escribir la
columna directo. No cortocircuites ese desvío.

**`base_seconds` es `seconds_today`, no el total histórico.**
El contador del taxímetro cuenta lo trabajado **hoy** (entradas cerradas con
`started_at >= medianoche local`). Consecuencia intencional: una tarea
arrastrada al día siguiente arranca en 0 aunque su acumulado sea de horas. Si
alguien reporta "el timer no recuerda mi tiempo", esto es el diseño, no un bug.

Tres reglas sostienen ese "hoy" —el piso en 0 de `seconds_today`, el recorte a
medianoche de `runSeconds`, y el corte por día local de `stop_timer`— y están en
`docs/specs/invariantes.md` (I3), las tres pagadas con un taxímetro que mostró `-14:-17:-39`. Al
editar, lo que hay que recordar es que **`segments_by_local_day` está espejado en
`mockDb`**: si solo cambias Rust, el browser atribuye los días distinto.

Y `hms()` pone el signo **una vez y adelante**: con `Math.floor` y `%` sobre un
negativo cada componente salía con su propio signo. No recorta a cero a
propósito — si vuelve a llegar un tiempo negativo, tiene que verse.

**Ojo con la diferencia entre "hoy" y "el total", que son dos números distintos
para el mismo trabajo:**

- **El taxímetro muestra HOY** (`elapsed` = `base_seconds` + `runSeconds`).
- **El campo del tiempo trabajado muestra el TOTAL** (`task.actualSeconds` +
  `timer.runTotal`), en la tarjeta, el modal y Focus.

En la UI ese campo se llama **"Real"**, y su par **"Estimado"**. En la DB y en
estas reglas siguen siendo `actual_seconds` y `estimated_minutes`, así que hay
que traducir mentalmente al leer código: no busques un label "ACTUAL" en las
vistas, ya no existe. Y no se llama "Actual" en español a propósito — "actual"
significa *presente*, o sea justo lo contrario del acumulado histórico que el
campo muestra: habría sido la traducción literal más engañosa posible.

No los mezcles. Estuvieron mezclados: esas tres vistas usaban `timer.elapsed`
mientras el timer corría y el acumulado cuando estaba detenido, así que el mismo
campo cambiaba de significado y darle play a una tarea arrastrada hacía *bajar*
el número. Si necesitas lo corrido de la entrada abierta, hay dos helpers a
propósito en `timerStore.ts`: `runSeconds` (recortado a la medianoche, para
"hoy") y `runTotalSeconds` (completo, para el total).

**Para ver el reparto por día** existe `timeByDay` (`features/tasks/timeByDay.ts`),
que agrupa `time_entries` por la fecha **local** de `startedAt`. Si vas a agrupar
tiempo por fecha en otra parte, úsala o cópiale el criterio: cortar el timestamp
con `slice(0, 10)` da el día UTC, y en Chile eso corre al día siguiente todo lo
trabajado después de las 20:00.

**Un solo timer activo en todo el sistema.**
Solo puede existir una fila de `time_entries` con `ended_at IS NULL`.
`start_timer` llama a `stop_timer` primero. `get_active_timer` toma la más
reciente (`ORDER BY e.id DESC LIMIT 1`) como red de seguridad.

**Estado y timer se mueven juntos, y eso vive en Rust.**
Son dos reglas simétricas, y conviene tratarlas como una sola:

- `set_task_status(id, "DONE")` **detiene** el timer si la tarea completada era
  la activa, para que el tiempo quede registrado y no siga corriendo algo ya
  cerrado.
- `start_timer(id)` **reabre** la tarea si estaba `DONE` (`status = 'TODO'`,
  `completed_at = NULL`). Volver a trabajar en algo es decir que no estaba
  terminado; si no, quedaría acumulando tiempo una tarea marcada como cerrada y
  encima fuera de la cola de Focus mientras se trabaja en ella.

Ambas viven en `repo.rs` y no en las vistas porque hay **cinco** lugares con
botón de play (card de la semana, Today, Focus, el modal y el taxímetro):
ponerlas en el front obliga a repetirlas en los cinco y a que el sexto se olvide.

**Corolario:** quien llame `setTaskStatus` desde el front debe hacer `bumpData()`
después, porque el estado del timer pudo cambiar sin que la vista lo pidiera.
`start` ya lo hace solo. Ver la skill `sunrise-sync-ventanas`.

**Y el mock tiene que espejarlo.** `mockDb.startTimer` replica la reapertura; si
solo se cambia Rust, la app en el browser y los tests se comportan distinto al
backend real.

**La campana la toca Rust, no una ventana** (`src-tauri/src/bell.rs`).

Antes la decidía el `tick` de 1 s del webview de `main`, con el taxímetro
excluido para que no sonaran dos copias. Falló donde importaba: **un webview que
no se ve no corre sus timers** —macOS los estrangula—, así que con la ventana
tapada o minimizada la campana no sonaba, y recién lo hacía cuando algo despertaba
la página (un evento del poller de calendario, o sea hasta `poll_minutes` de
atraso). Y el taxímetro, que sí estaba a la vista contando bien, era justamente el
que no tenía permiso para sonar.

De ahí sale la regla general: **lo que depende del reloj y tiene que pasar aunque
no estés mirando, va en Rust** (I6). Si vas a agregar otro aviso de este tipo —el
de "se viene tu próxima tarea", Mej.4—, no lo cuelgues de un `setInterval` del
front.

**Ya son tres vigilantes en Rust**, y todos tienen la misma forma —leer la base,
dormir, **releer** y decidir— pero **no la misma espera**. La diferencia es lo que
hay que copiar bien:

| | Espera | ¿Se pone al día? |
|---|---|---|
| `bell.rs` | hasta el cruce, techo 30 s | sí: el estimado sigue excedido |
| `backup.rs` | pulso fijo de 60 s | sí, por construcción |
| `notice.rs` | hasta el cruce, techo 60 s | **no** |

Dos reglas que salen de la tabla:

- **Si lo que agregas se pone al día solo, no le calcules el momento.** Un sueño
  calculado hay que invalidarlo, y olvidarse de invalidarlo no deja síntoma. El
  respaldo llegaba cinco minutos tarde por vivir en un `setInterval` de `main`
  (`docs/specs/distribucion.md` §4.17): lo que se compró al moverlo fue que corra tapado, no precisión.
- **Si no se pone al día, ponle borde de arriba.** El aviso de reunión exige que la
  reunión no haya empezado, y eso hace dos cosas a la vez: no manda un "en 5
  minutos" a las 09:30, y no deja que un Mac recién despertado vomite seis avisos
  viejos. No hace falta un número de gracia arbitrario.

Y la que se paga dos veces si se olvida: **lo que recuerda "ya avisé" guarda la
promesa, no un booleano, y la guarda en la base.** La campana usa
`tasks.bell_rung_for` (`día local|estimado`); el aviso de reunión, `tasks.notified_for`
con **la hora**. Dos formas de equivocarse, y las dos ya se pagaron:

- **Con un flag**, cambiar el estimado o mover la reunión deja eso mudo para
  siempre y sin ningún síntoma.
- **En memoria del proceso**, se pierde al reiniciar — y el timer **no** se
  pierde, porque sobrevive al cierre a propósito. La campana vivía así: al
  arrancar sonaba de inmediato sobre cualquier timer ya pasado de su estimado.
  En dev, una campanada por recompilación.

## Semántica de la campana y del estimado

- `isOverEstimate(elapsed, planned)`: con `planned` `null` o `<= 0` **nunca** se
  considera excedido. Sin estimado no hay campana ni aviso.
- Suena **una sola vez por (tarea, día local, estimado)**, y eso vive en
  `tasks.bell_rung_for`. Los tres datos están por algo: **subirle el estimado** es
  otra promesa y la rearma (con la tarea sola quedaría muda para siempre), y **el
  día** la rearma mañana, porque el contador del taxímetro es de hoy (I3) y sin
  esa parte la tarea nunca volvería a sonar. **Pausar y reanudar ya no la
  rearma**: la llave era la entrada, y sobre una tarea pasada de su estimado eso
  daba una campanada en cada play.
- **La espera y el timbre son optimizaciones, no la decisión.** Duerme hasta el
  momento en que tiene que sonar (`next_wake`, techo 30 s); sin timer espera el
  timbre `Armed` —que toca `start_timer`— con un techo de 5 min; y **cada vuelta
  relee la base**. No conviertas eso en un `sleep` de una sola vez ni cuelgues la
  campana del timbre: habría que invalidar el momento al bajar el estimado, al
  ajustar tiempo a mano, al pausar, al cambiar de tarea y al despertar la máquina
  (los temporizadores no corren mientras duerme), y olvidarse de uno deja la
  campana muda **sin ningún síntoma**. Con los techos, un olvido cuesta atraso.
- **Qué suena lo decide `bell_sound`, no la presencia de un archivo** (Mej.1):
  `SUNRISE` es la síntesis, y cualquier otro valor es el nombre de un audio en la
  subcarpeta `sounds` del directorio de datos, que copió `install_bell` desde el
  picker del Finder. Un archivo que ya no está cae a la síntesis. Dos cosas que se
  rompen fácil acá: **`play_bell` se come el error del decoder en silencio** —a
  propósito, una campana que revienta no puede tumbar el timer—, así que la validación
  del audio tiene que pasar al **instalarlo** o el usuario se queda con "elegí mi mp3
  y sigue sonando el de la app"; y el ajuste se escribe con el nombre que **devuelve**
  Rust, no con el path elegido, porque el original puede moverse de lugar.
- **El sonido de la campana y el de los avisos son dos ajustes distintos**
  (`bell_sound` y `notice_sound`), y no es duplicación: la campana suena siempre que
  corras un timer, y el aviso es un extra que se puede apagar. Se eligen en dos
  secciones distintas de Configs por eso mismo.
- **El aviso de la campana llega mudo.** La campanada ya está sonando cuando llega, y
  las dos cosas en el mismo instante se escuchan como un solo sonido reventado. El
  "mudo" viaja en la copia (`NoticeCopy.silent`, `Option<String>` en Rust) y no lo
  decide quien manda: si cada llamador lo eligiera, el botón de probar de Dev Tools
  sonaría distinto al aviso real. Y es ausencia de `.sound()`, **no** un nombre vacío:
  un nombre que no existe deja el aviso mudo por accidente, indistinguible de un typo.
- **No la muevas al taxímetro** aunque ya tenga un tick de 1 s: se puede esconder
  con el ojo del widget y no existe mientras no haya timer ni tarea pausada. Un
  aviso que un botón de la UI puede apagar en silencio es el bug de vuelta.
- `isOverEstimate` sigue en el front pero **solo pinta** (rojo del taxímetro,
  aviso de Focus). La regla de la campana está en `bell::is_due`: son dos copias
  de la misma condición y hay que cambiarlas juntas.
- `bell::elapsed_today` espeja `runSeconds`, **incluido el recorte a medianoche**.
  Sin eso, un timer que quedó abierto toda la noche haría sonar la campana a las
  00:00 de cualquier tarea con estimado. Las dos preguntan `repo::start_of_today()`.
- **Fuera de Tauri no hay campana.** En el browser el tick solo dibuja.
- **Sin notificación nativa** al llegar al estimado: bastan el sonido y el
  cambio de color del taxímetro.
- **Pasarse del estimado nunca cierra ni bloquea nada.** Focus muestra "puedes
  seguir trabajando" y el taxímetro pinta el tiempo en rojo. Es una regla de
  producto y no un detalle de UI: el estimado es una **previsión**, no un
  presupuesto, y una app que te corta el trabajo cuando te pasaste te obliga a
  mentirle al estimado para poder seguir. No agregues auto-stop.

## Cola de Focus (`focus_queue`)

Tareas `TODO` del día, ordenadas por: (1) sin hora o ya empezada antes que las
agendadas más tarde, (2) con hora primero dentro del grupo, (3) `scheduled_time`,
(4) `position`, (5) `id`. Recibe `now_hhmm` desde el front porque la hora local
del usuario no le corresponde decidirla a SQLite.

Al completar en Focus, la tarea se manda **al final del día** y la cola avanza.

## Reglas del rollup (`repo::work_by_day`, M3.5/M3.6 — hecho)

**Todas viven en `work_by_day`**, que comparten `weekly_rollup` (lo agrupa en
celdas día × categoría) y `bitacora` (lo agrupa en timelines). Si necesitás el
trabajo de un rango, usá esa función: escribir una segunda consulta es cómo estas
reglas se separan. El front solo dibuja. Si vas a tocarlo, estas cuatro reglas son las que se rompen sin que nada
falle:

- **Atribución por `started_at`, nunca por `scheduled_date`.** Mover una tarea a
  otra semana no cambia las horas de semanas pasadas. Lo planificado sí sale de
  `scheduled_date`: esa asimetría es correcta, no la "arregles".
- **Meets sin `time_entries`** cuentan su duración de evento, con los dos límites
  de `docs/specs/tiempo.md` §4.15.
- **El rollup NO filtra `source_state = 'ACTIVE'`** para el tiempo: es la única
  excepción a I7.
- **`work_by_day` tiene DOS consultas y todo campo nuevo va en las dos.** La de
  `time_entries` y la de la Regla 3 (reuniones sin entradas). El corte
  objetivos/resto de la review (`objective_seconds`, §4.29) se pagó justo ahí: con
  `objective_id` solo en la primera, una reunión de calendario ligada a un objetivo
  no contaba y el número quedaba corto sin que nada fallara.
- **El día es local.** Nunca `date(started_at)` ni `substr(started_at,1,10)`: los
  timestamps son UTC y en Chile todo lo trabajado después de las 20:00 se iría al
  día siguiente. Se comparan los bordes de cada día local en UTC (`local_days`).

Y una que solo importa para el día de **hoy**: una tarea con el timer corriendo
suma **0** en la base hasta que pares, así que el front le agrega lo del
taxímetro (`workedWithRunning`, `segmentSeconds`), igual que el rail. Sin eso,
la tarea que estás haciendo ahora aparece en cero.

Y un detalle que parece cosmético: **el piso en 0 va por tarea y por día**
(un ajuste manual negativo, ver arriba). Más arriba, los segmentos de una barra
dejan de sumar su total.

**El ajuste manual se acredita al día de la tarea, y un recorte se reparte entre
los días trabajados** (`spread_cut`) en vez de ir como una sola fila. Las dos
reglas, con los casos que las obligaron y el orden del reparto, están en
`docs/DECISIONES.md` §1. Para editar, tres cosas:

- `set_actual_seconds` estampa `scheduled_date` + `scheduled_time`, **mediodía**
  local si la tarea no tiene hora (en el salto de DST la medianoche local no
  existe), y hoy si no tiene fecha o es futura.
- **Ese sello atribuye el día; no es la hora en que pasó algo, y el rail no dibuja
  desde ahí.** `day_work` devuelve `tracked_at`, que sale **solo de las corridas
  del taxímetro** (`ended_at` distinto de `started_at`, o abierta) y viene `null`
  si el día solo tuvo ajustes; `seconds` sí los suma. Con el mínimo sobre todas
  las entradas, un día con varias correcciones apilaba media columna a las 12:00 y
  una tarea trabajada a las 15:41 y corregida después se iba a las 12:00, porque
  el sello es más temprano que la corrida. Está espejado en `mockDb.dayWork`.
  **`work_by_day` no hace este corte y no debe hacerlo**: el cierre y el rollup
  agrupan por día, no por hora, y ahí el ajuste tiene que contar.
- Si el recorte supera todo lo repartido, el sobrante **se descarta**. Escribirlo
  igual para que la suma cierre es el mismo bug otra vez: el total lo manda
  `actual_seconds` (I1), y las entradas responden otra pregunta.
- **Está espejado en `mockDb.ts` y ahí no es opcional**: si solo lo sabe Rust, el
  browser atribuye los días distinto.

Consecuencia para leer el código: **el piso en 0 de `work_by_day` y `seconds_today`
quedó como red para las bases con filas viejas**, no como el mecanismo que hace
cuadrar la cuenta. Si ves un día en negativo, eso es un dato — no algo que el piso
tenga que tapar.

Su otra cara es intencional: un ajuste sobre una tarea de otro día **no aparece en
el contador del taxímetro**, que mide `started_at >= medianoche local`. Ese
contador es la sesión de hoy; el total de la tarea sigue completo en la columna.
Ojo con esto al escribir tests: un caso que ajuste tiempo y espere verlo en
`base_seconds` necesita que la tarea sea **de hoy**.

## Completar desde el taxímetro

**Completar avanza, pero no arranca.** `completeAndAdvance` deja la siguiente
pendiente del día **en pausa** (título, estimado y el play esperando), con el
contador en `0:00:00` porque el taxímetro cuenta lo de hoy. Arrancarla sola
—como hacía— ponía a correr el tiempo de una tarea que ni miraste.

**Si no queda ninguna, el taxímetro se oculta.** Que desaparezca ya dice que no
queda nada por hacer; un estado "todo listo" dentro del widget no agrega
información y sí un lugar más donde equivocarse. Lo que celebra el día terminado
es Focus, con su resumen y su confeti.

**`refresh` hace lo mismo que el check.** Si la tarea pausada está `DONE`
—la completaste desde Focus, la card o el modal— avanza a la siguiente o se
oculta. Tres cosas que se rompen al editar esto:

- **Completar desde el front exige `bumpData()`**, Focus incluido. Completar
  detiene el timer **en Rust**: sin el aviso, la ventana flotante no se entera.
  El síntoma fue exacto —desde la semana el taxímetro se ocultaba, desde Focus
  se quedaba ofreciendo retomar la tarea cerrada— y el `stop()` previo no
  alcanza, porque ocurre **antes** del `DONE`.
- **`completeAndAdvance` tiene que hacer su propio `broadcast()`.** Antes venía
  gratis porque terminaba en `start()` o `dismissLast()`.
- **`refresh` NO hace `broadcast()`, y escribe solo si el registro cambió.**
  Refrescar no es mutar, y avisar haría que la otra ventana refresque y avise de
  vuelta — con un `focus_queue` por salto desde que `refresh` puede avanzar.
- **La re-lectura de la tarea pausada refresca título y estimado, no el
  contador.** `actual_seconds` es el total histórico; el taxímetro muestra lo de
  hoy. Pisarlo ahí hacía saltar el número al primer refresco.

`completeAndAdvance` manda la tarea al final de **su propio día**, no de hoy.
El taxímetro puede estar cronometrando una tarea de otro día —arrancada desde la
vista semana, o reanudada desde `last`— y completarla no debe reprogramarla: si
la moviera a hoy, quedaría contada en un día en el que no se trabajó. Una tarea
sin fecha (backlog) no se mueve.

Para "hoy" usa `todayISO()` de `src/lib/date.ts`, que es la fecha **local**.
`new Date().toISOString().slice(0, 10)` da la fecha UTC y en Chile adelanta el
día varias horas antes de medianoche.

## El timer sobrevive al cierre de la app

Cerrar **no detiene el timer**: la entrada queda abierta y sigue contando entre
sesiones. Es intencional, no un descuido — no le agregues una limpieza al
arrancar. Consecuencia a tener presente: al reabrir, el taxímetro muestra
`ahora - started_at`, o sea también el rato que la app estuvo cerrada.

Cerrar sí pide confirmación (`QuitConfirm`), pero es para evitar un ⌘Q
accidental, no para proteger datos: todo se autoguarda.

## Tests

`repo.rs` ya cubre: acumulación del timer, supervivencia del ajuste manual,
contador del día que ignora lo de ayer, un solo timer activo, completar detiene
el timer (y no detiene el de otra tarea), `stop` sin timer activo, `focus_queue`,
y doce del rollup semanal (una por cada regla de arriba y sus bordes).
En el front, `src/features/timer/timerStore.test.ts` cubre `completeAndAdvance`
(incluido que **no** arranque la siguiente) y el avance de `refresh`, y
`FocusView.test.tsx` el `bumpData()` al completar, el resumen del día y que el
confeti salga solo al vaciar la cola.
**Si tocas una de las reglas de arriba, el test correspondiente debería fallar.**
Si no falla, el test es más débil de lo que parece y vale reforzarlo.
