---
name: sunrise-capa-de-datos
description: Cómo agregar o cambiar datos en sunrise de punta a punta — migración SQLite, `repo.rs`, comando Tauri, registro en `lib.rs`, cliente `ipc.ts`, gemelo en `mockDb.ts` y tipos espejados Rust↔TS. Úsala siempre que vayas a crear un comando nuevo, agregar un campo o una tabla, escribir una migración, tocar `repo.rs`/`commands.rs`/`models.rs`/`ipc.ts`/`mockDb.ts`/`types.ts`/`enums.ts`, o cuando un test se caiga con un comando que "no existe" en jsdom. Olvidar uno de los eslabones es el error más común del proyecto y rompe los tests o la app en el browser.
---

# Capa de datos de sunrise

Las reglas del esquema y de los campos están en
[`docs/specs/modelo-de-datos.md`](../../../docs/specs/modelo-de-datos.md) (§3) y
[`arquitectura.md`](../../../docs/specs/arquitectura.md) (§2). Acá está el
**procedimiento** —el orden de los eslabones— y las trampas que no son reglas sino
formas de perder una tarde.

## El flujo

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

**La lógica de negocio va en `repo.rs`, no en `commands.rs`.** Un comando que
valida, decide u ordena está en la capa equivocada: bájalo, y déjale al comando
tomar el `Mutex` y mapear el error a `String`. **Ningún componente llama `invoke`
directo.**

## Checklist para un comando nuevo

El que se olvida suele ser el 5 o el 6, y el síntoma aparece lejos.

1. **¿Necesita esquema?** Versión **nueva** en `MIGRATIONS`. Editar una aplicada
   deja tu DB y la del usuario en estados distintos, y el runner no lo nota
   (compara solo `MAX(version)`).
2. **Modelo** en `models.rs` con `#[serde(rename_all = "camelCase")]` y su `from_row`.
3. **Función** en `repo.rs`, pura sobre `&Connection`.
4. **Test Rust** en su `mod tests` (usa `db::open_in_memory()`).
5. **Comando** en `commands.rs` **y su línea en el `invoke_handler![]` de
   `lib.rs`**. Sin el registro falla en runtime, no al compilar.
6. **Tipo TS** en `types.ts`, espejo exacto en camelCase. **Los nombres son el
   contrato y nada los compara**: se escribe a mano, TypeScript no ve el otro lado,
   y un campo mal escrito llega `undefined`. Peor: el mock puede estar de acuerdo
   con el front y los dos equivocados, y entonces browser y tests se ven perfectos
   y **falla solo dentro de Tauri**. Ya pasó (`Rescue.from_date`) y el síntoma fue
   una pantalla en blanco. Si el modelo es nuevo, deja un test que serialice y
   compare las claves.
7. **Entrada en `ipc.ts`** con las dos ramas. **La clave de cada argumento del
   `invoke` es el parámetro de Rust en camelCase** (`to_date` → `toDate`), no como
   se llame el argumento de la función TS. Con una clave equivocada Tauri rechaza
   la llamada **entera**, y ninguna suite lo ve porque las dos corren contra
   `mockDb`, que recibe posicional.
8. **Implementación en `mockDb.ts`.** Sin esto los tests de ese camino se caen y la
   app deja de verse en el browser.

Lo vigila `src/lib/ipcContract.test.ts`. Si el comando usa una API de ventana,
agrega su permiso en `src-tauri/capabilities/default.json`.

## Los patches distinguen tres estados, no dos

En Rust `Option<Option<T>>`, en TS `T | null` opcional: **ausente** = no tocar ·
**`null`** = poner a NULL · **valor** = escribir. Aplanarlo a `Option<T>` pierde la
capacidad de borrar un campo.

**Va con `#[serde(default, deserialize_with = "double_option")]`.** El derive pelado
no alcanza: un `null` cae en `visit_none()` del `Option` de afuera y llega como
`None`, igual que un campo ausente. Estuvo roto en `TaskPatch` desde el principio
—"Sin canal" y "Sin objetivo" no borraban nada dentro de Tauri— con las dos suites
en verde, porque **un test que construye el patch en Rust no cruza serde y `mockDb`
recibe el objeto de JS**. El test que sirve deserializa el JSON:
`el_patch_distingue_null_de_ausente_como_lo_manda_el_front`.

Vale igual para `ObjectivePatch` y para `day_task_notes.note` (sin fila = no
incluida · `''` = incluida sin resumen · texto = incluida y escrita; por eso
`include_in_log` y `set_day_task_note` son funciones distintas, y vaciar el texto
no borra la fila).

**`actual_seconds` no se escribe con `update_task`**: el patch lo desvía a
`set_actual_seconds`. Lee la skill `sunrise-timer-y-tiempo` antes de tocar tiempo.

## `move_task` y el historial

**El `position` que recibe es el índice final**, contando que la tarea ya salió de
la lista: es lo que dnd-kit muestra mientras arrastras. El día destino se
**renumera entero** (0..n, sin huecos ni empates); antes corría +1 las tareas
`>= position`, que se equivoca en uno al reordenar dentro del mismo día. El índice
se cuenta contra la lista **visible**, así que la renumeración incluye a las
`ORPHANED` y a los eventos ignorados (`rail_only`) —para no empatar posiciones—
pero los saltea al ubicar. Olvidar uno de los dos filtros deja la card un lugar más
abajo de donde se soltó. Fuera de rango es "al final". `mockDb.moveTask` hace lo
mismo, y hay un test a cada lado.

Mandar al backlog es `move_task(id, null, 0)`.

**Historial**: `move_task` registra `MOVED`, o `START_DATE_SET` si venía del
backlog. Un `MOVED` con `to_date` nulo es "se fue al backlog", y de ahí sale el
grupo "venían de un día" (`rescued_from_backlog`): no hizo falta columna ni evento
propio. `create_task` registra `CREATED`, más `START_DATE_SET` si nace agendada. Si
agregas otra forma de cambiar la fecha, registra su evento o el historial del modal
queda con agujeros.

## El calendario tiene una capa más

`src-tauri/src/calendar/` parte en tres porque `repo.rs` **no puede tocar la red**
sin dejar de ser testeable:

| Capa | Qué | Pureza |
|---|---|---|
| `calendar::fetch` | descarga el `.ics` | lo único con red |
| `calendar::ics` | texto → `IcsEvent` | puro, se prueba con fixtures |
| `repo::import_events` | escribe las tareas | puro sobre `&Connection` |

El comando (`sync_calendar_feed`) solo las encadena. Si decides algo ahí —qué
evento entra, cómo se calcula una fecha— va en `ics`; si es cómo se guarda, en
`repo`. Reglas en [`calendario.md`](../../../docs/specs/calendario.md) §4.12.

Tres cosas que se rompen fácil:

- **El upsert no pisa lo que el usuario tocó**: ni `status`, ni `actual_seconds`,
  ni `category_id`, ni `notes`. El poller vuelve cada 15 minutos, así que un
  `INSERT OR REPLACE` tira el trabajo hecho sobre una reunión tres veces por hora.
  **`position` es la única excepción, y solo si el evento cambió de día o de
  hora**: ahí `place_by_time` lo reubica entre **los demás eventos**, nunca
  desplaza una tarea a mano.
- **`rail_only = 1` significa "ignorar", y son seis lecturas.** Un evento ignorado
  sigue siendo una fila de `tasks` —el rail necesita su hora— pero queda fuera de
  la columna del día, de `plan_by_day`, de `focus_queue`, de `meetings_for_date`,
  de la regla 3 del rollup y de `last_day_with_tasks`. **Si agregas una consulta
  sobre `tasks` que no sea la del rail, pregúntate si le corresponde
  `AND rail_only = 0`**: el modo de falla es silencioso y se ve como "el almuerzo
  cuenta como trabajo". Y marcar **no toca las repeticiones con `time_entries` o
  `DONE`**.
- **`import_events` devuelve los UIDs que vio**, que es lo que el reconciler
  necesita para saber qué dejó de venir. Y `reconcile_feed` devuelve `Reconciled`
  **con los títulos** de lo que borró, liberó y dejó `ORPHANED`: el log los emite
  porque después no hay forma de reconstruirlos. Los dos números de antes están en
  `.totals()`.

## La conexión se puede reemplazar en caliente

Restaurar un respaldo **pisa el archivo de la base**, así que `restore_backup` saca
la `Connection` del `Mutex`, la cierra, copia encima y mete una nueva.

- **No guardes nada derivado de la conexión fuera del `Mutex`.** Ni un
  `prepare_cached` a largo plazo, ni un id, ni un contador: después de una
  restauración apuntan a otra base. El `Mutex` no solo la protege, es su dueño.
- **`repo.rs` puede seguir siendo puro porque no guarda estado**, y es lo que hace
  que alcance con cambiar la conexión en vez de reiniciar la app.
- **El archivo se resuelve con `db::file_name()`**, nunca con `db::PROD_FILE` ni con
  el nombre escrito a mano: dev y producción usan archivos distintos en el mismo
  directorio, así que una ruta armada con la constante abre la base del **otro**
  perfil. Hay que escribir sobre el archivo en uso y borrar sus `-wal`/`-shm` antes
  de reabrir.
- **La excepción es el nombre de la base dentro del zip**, que sí es la constante:
  si llevara el perfil, un respaldo de dev no se podría restaurar en producción, y
  ese es justamente el puente entre las dos bases.
- **El nombre del zip es lo contrario**: ese sí lleva el perfil (`backup::prefix`).
  `is_backup_name` es **el único permiso para borrar** que tiene la retención y
  exige el prefijo propio; con eso los dos conjuntos son disjuntos y dev puede
  respaldar en la misma carpeta que producción sin borrarle nada. Si unificas los
  nombres, reactivas esa pérdida de datos.
- **`db::is_dev()` es la única definición de "es dev" del backend.** Un
  `cfg!(debug_assertions)` suelto en un cuarto lugar puede quedar en el lado
  equivocado sin que nada lo note.

Detalle en [`distribucion.md`](../../../docs/specs/distribucion.md) §4.17 y §4.20.

## `settings`

Tabla plana `key TEXT / value TEXT`. Lo básico —parsers con fallback, el `NaN` que
se propaga en silencio, `planned_at` sin migración— está en
[`app-y-ajustes.md`](../../../docs/specs/app-y-ajustes.md) §4.8. Lo que hay que
saber **antes de agregar una clave**:

- **Una clave nueva no necesita migración.** `set_setting` es un upsert y toda
  lectura tiene fallback: basta con sumarla a `SettingKey` y darle su parser. La
  migración solo sirve para sembrar un valor distinto del default, o para
  **limpiar** una que dejó de usarse.
- **Una migración también puede reescribir un valor sembrado, y a veces hay que
  hacerlo**: si una clave estrena consumidor y su semilla no significa lo que va a
  significar, la semilla es un valor inventado (la 12 lo hizo con `bell_sound`). No
  rompe la inmutabilidad —es una versión nueva— pero **sí cambia datos de alguien**:
  escribe en el comentario qué se pierde.
- **Ojo con una clave donde ausente y vacío NO significan lo mismo.** En
  `collapsed_weekdays`, ausente es "nunca se configuró" y toma el default; presente
  y vacío es "ninguno", que es una elección legítima. Si las dos cayeran al mismo
  fallback, destildar todo rebotaría al default. En ese caso **la migración tiene
  que sembrar la fila** y el parser distinguir `null` de `""`. Hay un test de Rust
  que cuenta las filas sembradas.
- **Una marca de "esto pasó" se guarda con fecha y hora locales**
  (`toISOTimestamp`), **nunca con `toISOString()`**: quien la lee compara los
  primeros diez caracteres contra hoy, y con UTC las últimas cuatro horas de cada
  día en Santiago se marcan como el día siguiente. Y al leer, **el string no pasa
  por `new Date()`** — una fecha pelada la interpreta como medianoche UTC. Se corta
  en la `T` y la hora se parsea aparte, opcional.
- **Hay claves que Rust también lee.** `backup_dir` y `backup_keep` las consulta
  `commands.rs` con `repo::get_setting`. Si les cambias el nombre, cámbialo en
  `SettingKey` **y** en las constantes de `commands.rs`; y un default que existe en
  los dos lados (`BACKUP_KEEP_DEFAULT` vs `SETTING_DEFAULTS.backupKeep`) se cambia
  en los dos.
- **La excepción: lo que el sistema operativo también puede cambiar.** El inicio
  automático **no** está en la tabla, y no es olvido: la verdad la tiene el sistema
  —un LaunchAgent que el usuario puede borrar— así que una copia acá mentiría en
  cuanto eso pase. Y el respaldo se lleva la tabla entera: restaurar un zip viejo
  cambiaría el arranque de **esta** máquina. Antes de agregar una clave, pregúntate
  si describe los datos o la máquina; si es lo segundo, o la sacas del respaldo a
  mano (como `backup_dir`/`backup_time`/`backup_keep`) o no la guardas. Hay un test
  que se pone rojo si el autostart aterriza en `settings`.
- **No recrees `src/lib/config.ts`** —existía para constantes sin fuente de datos y
  se vació hasta borrarse—: una constante hardcodeada es una decisión que el
  usuario no puede cambiar, y `settings` es donde sí puede.
