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

Esta sección **vive en `docs/specs/`**, un archivo por área. Se partió porque era
el 70% de este documento y lo volvía imposible de recorrer; **la numeración no
cambió**, así que los `§4.x` que hay repartidos por el código siguen siendo
válidos. Este índice dice en qué archivo cayó cada uno.

| Archivo | Secciones |
|---|---|
| [Tareas y tablero](specs/tareas-y-tablero.md) | §4.1 Tareas (CRUD) · §4.2 Degradación diaria al backlog · §4.3 Vista semana y Today · §4.4 Modal de detalle · §4.5 Backlog |
| [Tiempo: timer, Focus y rollup](specs/tiempo.md) | §4.6 Timer / taxímetro · §4.7 Focus Mode · §4.15 Weekly review |
| [Objetivos semanales](specs/objetivos.md) | §4.29 Objetivos, reparto de horas e histórico |
| [Calendario: feeds ICS y rail](specs/calendario.md) | §4.12 Feeds de calendario (ICS) · §4.13 Rail de calendario |
| [Rituales del día](specs/rituales.md) | §4.14 Planificación diaria · §4.16 Bitácora y cierre del día |
| [El marco de la app y sus ajustes](specs/app-y-ajustes.md) | §4.8 Settings · §4.9 Atajos de teclado · §4.10 Cierre de la app · §4.11 Tema · §4.24 Dev Tools · §4.28 Apariencia |
| [Notificaciones y alertas](specs/notificaciones.md) | §4.25 Alertas · §4.26 Aviso de próxima reunión · §4.27 Configs → Notificaciones |
| [Durabilidad y distribución](specs/distribucion.md) | §4.17 Respaldo y restauración · §4.18 Inicio automático · §4.19 Empaque `.dmg` · §4.20 Dev y producción · §4.21 Actualizaciones · §4.22 Changelog y "Lo nuevo" · §4.23 El aviso del updater |

El reparto sigue el mismo corte que la tabla de skills de `CLAUDE.md`, para que
las dos no digan cosas distintas sobre dónde vive cada dominio.

> **Los `Mej.N` que aparecen ahí adentro** son ítems del roadmap ya cerrados y
> podados. Su relato está en `git log -p docs/ROADMAP.md`; lo que se aprendió en
> ellos está en [DECISIONES.md](DECISIONES.md).

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
