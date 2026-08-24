---
name: sunrise-timer-y-tiempo
description: Reglas e invariantes del timer, `time_entries` y todo el tiempo trackeado de sunrise (taxímetro flotante, Focus Mode, campana al estimado, actual vs planned, rollup semanal). Úsala siempre que toques el taxímetro, el timer, `actual_seconds`, `estimated_minutes`, `time_entries`, la campana, o cualquier cálculo o agregación de tiempo — incluso si el cambio parece trivial, porque varias de estas reglas se rompen con ediciones que se ven correctas (por ejemplo "recalcular el total desde las entradas").
---

# Timer y tiempo en sunrise

El tiempo trabajado está respaldado en la DB (`time_entries`), no en memoria.
Estas reglas existen porque cada una ya se rompió o estuvo a punto: son
deliberadas, y la mayoría tiene su comentario en `src-tauri/src/repo.rs`.

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

**`actual_seconds` acumula; nunca se recalcula desde `time_entries`.**
`stop_timer` hace `actual_seconds = actual_seconds + seconds`. Se ve tentador
derivar el total con un `SUM(seconds)` sobre las entradas —es más "limpio"— pero
eso **pisa los ajustes manuales de tiempo** y hace que el usuario pierda lo que
escribió a mano. Si necesitas el total, lee la columna.

**Los ajustes manuales pasan por `set_actual_seconds`, no por `update_task`.**
Esa función, además de guardar el total, inserta una **entrada cerrada con el
delta** (`started_at = ended_at`, fechada en el día de la tarea — ver más abajo). Es lo que permite que el rollup
semanal siga cuadrando cuando alguien corrige un tiempo porque se le olvidó
encender el taxímetro. Por eso `update_task` detecta `actual_seconds` en el
patch y **desvía** la escritura a `set_actual_seconds` en vez de escribir la
columna directo. No cortocircuites ese desvío.

**`base_seconds` es `seconds_today`, no el total histórico.**
El contador del taxímetro cuenta lo trabajado **hoy** (entradas cerradas con
`started_at >= medianoche local`). Consecuencia intencional: una tarea
arrastrada al día siguiente arranca en 0 aunque su acumulado sea de horas. Si
alguien reporta "el timer no recuerda mi tiempo", esto es el diseño, no un bug.

Tres reglas sostienen ese "hoy", y las tres se pagaron con un taxímetro que
mostró `-14:-17:-39`:

1. **`seconds_today` tiene piso en 0** (`MAX(0, …)`). El delta de un ajuste
   manual hacia abajo puede superar lo trackeado hoy y la suma se va a negativo.
2. **Lo corrido se mide desde la medianoche, no desde `started_at`**
   (`runSeconds` en `timerStore.ts`). Un timer olvidado toda la noche mostraba
   las 15 horas a las 9 de la mañana.
3. **`stop_timer` parte la corrida por día local** si cruza una medianoche
   (`segments_by_local_day`, espejado en `mockDb`). Como el tiempo se atribuye por
   `started_at`, una fila de 15h le acredita todo al día en que empezó. Esto le
   importa igual al rollup diario de M3, que agrupa por día leyendo la tabla: se
   arregla en la escritura, una vez, no en cada consulta. El último tramo absorbe
   el resto de la división, para que la suma de las filas siga cuadrando con
   `actual_seconds`.

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
  (SPECS §4.17): lo que se compró al moverlo fue que corra tapado, no precisión.
- **Si no se pone al día, ponle borde de arriba.** El aviso de reunión exige que la
  reunión no haya empezado, y eso hace dos cosas a la vez: no manda un "en 5
  minutos" a las 09:30, y no deja que un Mac recién despertado vomite seis avisos
  viejos. No hace falta un número de gracia arbitrario.

Y la que se paga dos veces si se olvida: **lo que recuerda "ya avisé" guarda la
promesa, no un booleano.** La campana usa `(entrada, estimado)`; el aviso de reunión
guarda `tasks.notified_for` con **la hora**. Con un flag, cambiar el estimado o
mover la reunión deja eso mudo para siempre y sin ningún síntoma.

## Semántica de la campana y del estimado

- `isOverEstimate(elapsed, planned)`: con `planned` `null` o `<= 0` **nunca** se
  considera excedido. Sin estimado no hay campana ni aviso.
- Suena **una sola vez por (entrada, estimado)**, no una vez por tarea: el
  vigilante recuerda ese par en una variable de su loop. Si se pausa y se reanuda
  hay entrada nueva, y **si se le sube el estimado la promesa es otra**, así que
  vuelve a armarse. Con la entrada como única llave —como estaba— subir el
  estimado dejaba esa entrada muda para siempre.
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

- **Atribución por semana en que ocurrió:** el tiempo se atribuye por
  `time_entries.started_at`, **NO** por `scheduled_date`. Mover una tarea a otra
  semana no cambia las horas de semanas pasadas. Lo planificado sí sale de
  `scheduled_date`: esa asimetría es correcta, no la "arregles".
- **Meets sin `time_entries`** cuentan su duración de evento
  (`event_end - event_start`). Con dos límites: **basta una entrada real** para
  que dejen de usar el respaldo (si no, cuentan doble), y una reunión que
  **todavía no empieza** no cuenta como trabajada.
- **El rollup NO filtra `source_state = 'ACTIVE'`** para el tiempo. Es la única
  excepción a I7: las `ORPHANED` son historial, y filtrarlas borra horas reales
  de semanas pasadas.
- **El día es local.** Nunca `date(started_at)` ni `substr(started_at,1,10)`: los
  timestamps son UTC y en Chile todo lo trabajado después de las 20:00 se iría al
  día siguiente. Se comparan los bordes de cada día local en UTC
  (`local_days`), como ya hacía `day_work`.

Y una que solo importa para el día de **hoy**: una tarea con el timer corriendo
suma **0** en la base hasta que pares, así que el front le agrega lo del
taxímetro (`workedWithRunning`, `segmentSeconds`), igual que el rail. Sin eso,
la tarea que estás haciendo ahora aparece en cero.

Y un detalle que parece cosmético: **el piso en 0 va por tarea y por día**
(un ajuste manual negativo, ver arriba). Más arriba, los segmentos de una barra
dejan de sumar su total.

**El ajuste manual se acredita al día de la tarea, no al día en que lo escribes.**
`set_actual_seconds` estampa su entrada con el `scheduled_date` de la tarea y su
`scheduled_time` si la tiene (mediodía local si no; hoy si la tarea no tiene fecha
o es futura). Estampaba `now()`, y corregir el lunes las horas de una reunión del
sábado se las acreditaba al lunes: la Regla 2 rota en la escritura. **Mediodía y no
medianoche** porque en el salto de DST la medianoche local no existe.

Su otra cara es intencional: un ajuste sobre una tarea de otro día **no aparece en
el contador del taxímetro**, que mide `started_at >= medianoche local`. Ese
contador es la sesión de hoy; el total de la tarea sigue completo en la columna.
Ojo con esto al escribir tests: un caso que ajuste tiempo y espere verlo en
`base_seconds` necesita que la tarea sea **de hoy**.

## Completar desde el taxímetro

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
En el front, `src/features/timer/timerStore.test.ts` cubre `completeAndAdvance`.
**Si tocas una de las reglas de arriba, el test correspondiente debería fallar.**
Si no falla, el test es más débil de lo que parece y vale reforzarlo.
