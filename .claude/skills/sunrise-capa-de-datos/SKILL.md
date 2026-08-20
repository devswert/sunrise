---
name: sunrise-capa-de-datos
description: Cómo agregar o cambiar datos en sunrise de punta a punta — migración SQLite, `repo.rs`, comando Tauri, registro en `lib.rs`, cliente `ipc.ts`, gemelo en `mockDb.ts` y tipos espejados Rust↔TS. Úsala siempre que vayas a crear un comando nuevo, agregar un campo o una tabla, escribir una migración, tocar `repo.rs`/`commands.rs`/`models.rs`/`ipc.ts`/`mockDb.ts`/`types.ts`/`enums.ts`, o cuando un test se caiga con un comando que "no existe" en jsdom. Olvidar uno de los eslabones es el error más común del proyecto y rompe los tests o la app en el browser.
---

# Capa de datos de sunrise

## El flujo, y por qué está partido así

```
db/migrations.rs   → esquema versionado
repo.rs            → TODO el SQL, funciones puras sobre &Connection
commands.rs        → #[tauri::command], wrappers delgados
lib.rs             → registro en invoke_handler![]
        ── puente IPC (serde camelCase) ──
src/lib/types.ts   → espejo de models.rs
src/lib/ipc.ts     → cliente tipado único
src/lib/mockDb.ts  → misma API, in-memory
```

`repo.rs` **no conoce Tauri**: recibe `&Connection`, y eso es exactamente lo que
lo hace testeable con SQLite en memoria. Por eso **la lógica de negocio va en
`repo.rs`, no en `commands.rs`**. Un comando que valida, decide u ordena está en
la capa equivocada: bájalo a `repo.rs` y déjale al comando solo tomar el `Mutex`
y mapear el error a `String`.

`ipc.ts` decide en cada llamada: dentro de Tauri hace `invoke`, fuera delega en
`mock`. Eso es lo que permite correr los tests en jsdom y ver la app en el
browser sin Tauri. Por eso **ningún componente llama `invoke` directo.**

## Checklist para un comando nuevo

Salta los pasos que no apliquen, pero revísalos todos — el que se olvida suele
ser el 5 o el 6, y el síntoma aparece lejos (tests rojos, app en blanco).

1. **¿Necesita esquema?** Agrega una **versión nueva** a `MIGRATIONS` en
   `src-tauri/src/db/migrations.rs`. Las migraciones aplicadas son **inmutables**:
   editar una que ya corrió deja tu DB y la del usuario en estados distintos, y
   el runner no lo va a notar (compara solo `MAX(version)`).
2. **Modelo** en `src-tauri/src/models.rs` con
   `#[serde(rename_all = "camelCase")]` y su `from_row`.
3. **Función** en `src-tauri/src/repo.rs`, pura sobre `&Connection`.
4. **Test Rust** en el `mod tests` de `repo.rs` (usa `db::open_in_memory()`).
5. **Comando** en `src-tauri/src/commands.rs` **y su línea en el
   `invoke_handler![]` de `src-tauri/src/lib.rs`**. Si falta el registro, falla
   en runtime, no al compilar; lo vigila `src/lib/ipcContract.test.ts`.
6. **Tipo TS** en `src/lib/types.ts` (espejo exacto del modelo, en camelCase).
   **Los nombres son el contrato y nada los compara**: `types.ts` se escribe a
   mano, TypeScript no ve el otro lado, y un campo mal escrito no falla — llega
   `undefined`. Peor: el mock puede estar de acuerdo con el front y los dos
   equivocados, y entonces el browser y los tests se ven perfectos y **falla solo
   dentro de Tauri**, que es el único lado donde el nombre lo pone serde. Ya pasó
   (`Rescue.from_date` → el front leía `from`) y el síntoma fue una pantalla en
   blanco, no un dato faltante. Si el modelo es nuevo, deja un test que serialice
   y compare las claves, como `los_nombres_de_rescue_son_los_que_lee_el_front` en
   `models.rs`.
7. **Entrada en `src/lib/ipc.ts`** con las dos ramas. **La clave de cada
   argumento del `invoke` es el parámetro de Rust en camelCase** (`to_date` →
   `toDate`), no como se llame el argumento de la función TS. Con una clave
   equivocada Tauri rechaza la llamada **entera** —no llegan datos parciales,
   llega una promesa rechazada— y ninguna de las dos suites lo ve, porque las dos
   corren contra `mockDb`, que recibe posicional. `src/lib/ipcContract.test.ts`
   compara `ipc.ts` contra `commands.rs` y `lib.rs` justamente por eso.
8. **Implementación en `src/lib/mockDb.ts`.** Sin esto los tests que toquen ese
   camino se caen y la app deja de verse en el browser.

Si el comando usa una API de ventana, agrega su permiso en
`src-tauri/capabilities/default.json`.

## El calendario tiene una capa más

`src-tauri/src/calendar/` parte en tres porque `repo.rs` **no puede tocar la
red** sin dejar de ser testeable:

| Capa | Qué | Pureza |
|---|---|---|
| `calendar::fetch` | descarga el `.ics` | lo único con red |
| `calendar::ics` | texto → `IcsEvent` | puro, se prueba con fixtures |
| `repo::import_events` | escribe las tareas | puro sobre `&Connection` |

El comando (`sync_calendar_feed`) solo las encadena. Si te encuentras
decidiendo algo ahí —qué evento entra, cómo se calcula una fecha— va en `ics`;
si es cómo se guarda, en `repo`. Detalle de las reglas en SPECS §4.12.

Dos cosas que se rompen fácil al tocar esto:

- **El upsert no pisa lo que el usuario tocó**: ni `status`, ni
  `actual_seconds`, ni `position`, ni `category_id`. El poller vuelve a pasar
  cada 15 minutos, así que un `INSERT OR REPLACE` tira el trabajo hecho sobre una
  reunión tres veces por hora.
- **`import_events` devuelve los UIDs que vio.** No es decoración: es lo que el
  reconciler (M3.2) necesita para saber qué dejó de venir en el feed.

## Enums: SIEMPRE EN MAYÚSCULAS

Convención explícita del proyecto. Se guardan como TEXT en mayúsculas, con la
fuente de verdad en `migrations.rs` y el espejo en `src/lib/enums.ts`:

| Campo | Valores |
|---|---|
| `tasks.status` | `TODO` · `DONE` |
| `tasks.source` | `MANUAL` · `CALENDAR` |
| `tasks.source_state` | `ACTIVE` · `ORPHANED` |
| `task_events.type` | `CREATED` · `MOVED` · `START_DATE_SET` · `CARRIED_OVER`¹ |
| (solo front) `CapacityLevel` | `OK` · `WARN` · `OVER` |

¹ `CARRIED_OVER` es **histórico**: lo escribía el carry-over, reemplazado por la
degradación diaria al backlog (SPECS §4.2). Nadie lo escribe más; sigue ahí
porque hay tareas que lo tienen en su historial.

Si agregas un estado, va en mayúsculas y se espeja en los dos archivos.

## Semántica que hay que respetar

**`scheduled_date IS NULL` ⇒ la tarea está en el backlog.** No hay flag aparte.
Mandar al backlog es `move_task(id, null, 0)`.

**Todos los listados filtran `source_state = 'ACTIVE'`.** Las `ORPHANED` son
tareas de calendario que ya no están en el feed pero tienen tiempo trackeado o
están completadas: existen solo para el historial y la review. Un listado nuevo
que olvide el filtro las va a resucitar en el backlog.

**La única excepción es el tiempo del rollup semanal** (`weekly_rollup`, §4.15):
ahí se cuentan a propósito, porque son historial y filtrarlas borraría horas
reales de semanas pasadas. Si copias el `WHERE` de otro listado a una consulta de
la review, la vas a romper sin que ningún test de los otros listados se entere.

**`TaskPatch` distingue tres cosas, no dos.** En Rust
`Option<Option<i64>>`, en TS `number | null` opcional:
ausente = no tocar · `null` = poner a NULL · valor = escribir. Si aplanas eso a
`Option<i64>` pierdes la capacidad de borrar un campo.

**`actual_seconds` no se escribe con `update_task`.** El patch lo desvía a
`set_actual_seconds` a propósito. Ver la skill `sunrise-timer-y-tiempo` antes de
tocar cualquier cosa de tiempo.

**`position`** es el orden dentro del día (o del backlog). `next_position`
calcula el final.

**El `position` que recibe `move_task` es el índice final**, contando que la
tarea ya salió de la lista: es lo que dnd-kit muestra mientras arrastras. El día
destino se **renumera entero** (0..n, sin huecos ni empates); antes corría +1 las
tareas `>= position`, que se equivoca en uno al reordenar dentro del mismo día
—la tarea que se mueve deja libre su lugar— y ese era el bug de Mej.12. El índice
se cuenta contra la lista **visible**, así que la renumeración incluye a las
`ORPHANED` (para no empatar posiciones) pero las saltea al ubicar. Fuera de rango
es "al final". `mockDb.moveTask` hace exactamente lo mismo, y hay un test a cada
lado.

**Historial.** `move_task` registra `MOVED`, o `START_DATE_SET` si la tarea venía
del backlog. Un `MOVED` con `to_date` nulo es "se fue al backlog", y de ahí sale
el grupo "venían de un día" (`rescued_from_backlog`): no hizo falta ni columna
ni evento propio. `create_task` registra `CREATED` y además `START_DATE_SET` si nace
agendada. Si agregas otra forma de cambiar la fecha, registra su evento o el
historial del modal queda con agujeros.

## Categorías (los "channels")

Dos niveles vía `parent_id`. `parent_id IS NULL` ⇒ **contexto** (carpeta del
backlog). Con `parent_id` ⇒ **channel** (el `#tag` de las cards). Una tarea puede
apuntar a cualquiera de los dos niveles, así que para agrupar por contexto se
resuelve `parentId ?? id`.

`color` guarda un **token de la paleta** (`lavender`, `sky`, `mint`…), no un hex:
se usa como `var(--${color})`. Si agregas un color, tiene que existir en
`src/styles/tokens.css`.

## Tablas del día (M3.6)

`day_entries` (una fila por día: `note`, `closed_at`) y `day_task_notes`
(`date` + `task_id` → `note`). Dos cosas que hay que respetar:

- **La bitácora no depende de estas tablas.** Se arma del trabajo y de lo
  cerrado; acá solo viven la nota y el sello. Un día sin fila **igual aparece**,
  como borrador. Si algún listado exigiera la fila, la bitácora arrancaría vacía.
- **`closed_at` NULL ⇒ borrador**, y `close_day` **no lo re-sella**: conserva la
  hora original con un `COALESCE`. Escribir la nota (`set_day_note`) no lo toca:
  escribir no es cerrar.
- La nota de una tarea lleva **la fecha en la clave**: la misma tarea puede tener
  una reflexión distinta cada día. No es `tasks.notes`.
- **`day_task_notes.note` distingue tres cosas, como `TaskPatch`**: sin fila = no
  incluida en la bitácora; fila con `''` = incluida y sin resumen; fila con texto =
  incluida y escrita. Por eso **incluir** (`include_in_log`) y **escribir**
  (`set_day_task_note`) son funciones distintas, y vaciar el texto **no** borra la
  fila: sacarla es `remove_from_log`. Si aplanas eso a dos estados, la tarea
  desaparece de los highlights al borrar una palabra.
- `mood` es columna de `day_entries` (migración **8**, no un cambio a la 7: las
  aplicadas son inmutables). Guarda el emoji tal cual.

## La conexión se puede reemplazar en caliente (M4.1)

Restaurar un respaldo **pisa el archivo de la base**, así que `restore_backup`
saca la `Connection` del `Mutex<Connection>`, la cierra, copia encima y mete una
nueva. Consecuencias para cualquier cosa que escribas cerca:

- **No guardes nada derivado de la conexión fuera del `Mutex`.** Ni un
  `prepare_cached` a largo plazo, ni un id, ni un contador: después de una
  restauración apuntan a otra base. El `Mutex` no solo protege la conexión, es su
  dueño.
- **`repo.rs` puede seguir siendo puro porque no guarda estado.** Es justo lo que
  hace que alcance con cambiar la conexión en vez de reiniciar la app (reiniciar
  dispararía el diálogo de salida de §4.10).
- **El archivo se resuelve con `db::file_name()`**, nunca con `db::PROD_FILE` ni con
  `"sunrise.sqlite"` escrito a mano. Dev y producción usan archivos distintos en el
  mismo directorio (`sunrise-dev.sqlite` vs `sunrise.sqlite`, SPECS §4.20), así que
  una ruta armada con la constante abre la base del **otro** perfil. La restauración
  tiene que escribir exactamente sobre el archivo en uso, y borrar sus `-wal`/`-shm`
  antes de reabrir.

  La excepción es **el nombre de la base dentro del zip de respaldo**, que sí es la
  constante y no la función: si llevara el nombre del perfil, un respaldo hecho en
  dev no se podría restaurar en producción, y eso es justamente el puente entre las
  dos bases. Hay un test que lo fija.
- Nada de esto se puede probar fuera de Tauri (el mock no tiene base). Lo que sí
  está cubierto en `backup.rs` es todo el camino de archivos. Ver SPECS §4.17.

## `settings`

Tabla plana `key TEXT PRIMARY KEY, value TEXT`, sembrada por la migración 2
(`daily_capacity_minutes`, `capacity_warn_ratio`, `bell_sound`, `work_start`,
`work_end`). Se lee entera con `list_settings` y se escribe con `set_setting`
(upsert). En el front vive en `src/lib/settings.ts`: `useSettingsStore` la carga
desde `Shell` y la relee con cada invalidación.

**Ojo con una clave donde ausente y vacío NO significan lo mismo.** Es el caso de
`collapsed_weekdays` (los días plegados de la vista semana): ausente es "nunca se
configuró" y toma el default, presente y vacío es "ninguno", que es una elección
legítima. Si las dos cayeran al mismo fallback, destildar todo en Configs
rebotaría al default y el estado vacío sería inexpresable. Cuando pase eso, **la
migración tiene que sembrar la fila** —la 9 lo hace, al revés que `planned_on`— y
el parser distinguir `raw == null` de `raw === ""`. Y hay un test de Rust que
cuenta las filas sembradas: si agregas una, se pone rojo.

**Todo valor es TEXT, así que toda lectura necesita un parser con fallback.** La
clave puede faltar, venir vacía o traer basura editada a mano. Ojo con los
números: un `NaN` no explota, se propaga en silencio —toda comparación con `NaN`
da false— y el consumidor se queda en su rama por defecto para siempre. Sigue el
patrón de `dailyCapacityMinutes`/`capacityWarnRatio`, que además acotan el rango
cuando un valor fuera de él no tendría sentido.

**Una clave nueva no necesita migración.** `set_setting` es un upsert y toda
lectura tiene fallback, así que basta con sumarla a `SettingKey` y darle su
parser (`planned_on`, del ritual diario, nació así). La migración solo sirve para
sembrar un valor inicial distinto del default del parser.

**Hay claves que Rust también lee.** `backup_dir` y `backup_keep` las consulta
`commands.rs` con `repo::get_setting` (que devuelve `None` también cuando el valor
está vacío). Si les cambias el nombre, cámbialo en `SettingKey` **y** en las
constantes de `commands.rs`; y si cambias un default que existe en los dos lados
—`BACKUP_KEEP_DEFAULT` vs `SETTING_DEFAULTS.backupKeep`— cámbialo en los dos, o la
vista va a decir que conserva un número distinto del que Rust poda.

**La excepción: lo que el sistema operativo también puede cambiar.** El inicio
automático (`autostart_enabled` / `set_autostart`, M4.2) **no** está en la tabla,
y no es un olvido. La verdad la tiene el sistema —un LaunchAgent que el usuario
puede borrar desde Ajustes— así que una copia acá mentiría en cuanto eso pase. Y
el respaldo se lleva la tabla entera: restaurar un zip viejo cambiaría el arranque
de **esta** máquina. Antes de agregar una clave, pregúntate si describe los datos
o la máquina; si es lo segundo, o la sacas del respaldo a mano (como
`backup_dir`/`backup_time`/`backup_keep`, que se reescriben después de restaurar)
o no la guardas. Hay un test que se pone rojo si el autostart aterriza en
`settings`.

Si necesitas configuración nueva, agrégala acá. **No recrees `src/lib/config.ts`**
—existía para constantes sin fuente de datos y se fue vaciando hasta borrarse—:
una constante hardcodeada en el front es una decisión que el usuario no puede
cambiar, y la tabla `settings` es justamente el lugar donde sí puede.

## Idioma: código en inglés, texto en español

Convención del proyecto (CLAUDE.md). Identificadores —variables, funciones,
tipos, campos, archivos, comandos IPC— en **inglés**. Comentarios, texto de la
app, descripciones de tests y documentación en **español**. El nombre de un
`#[test]` de Rust es su descripción, así que va en español.
