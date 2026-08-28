# §3 Modelo de datos

Vuelve al [índice de SPECS](../SPECS.md).

Migraciones versionadas en `src-tauri/src/db/migrations.rs`: array
`(version, sql)`, aplicadas en orden dentro de una transacción y registradas en
`_migrations`. **Una migración aplicada no se edita: se agrega otra.**

Tablas: `categories`, `objectives`, `tasks`, `task_events`, `time_entries`,
`calendar_feeds`, `settings`.

## 3.1 Enums — SIEMPRE EN MAYÚSCULAS

TEXT en mayúsculas, espejados en `src/lib/enums.ts`:

| Campo | Valores |
|---|---|
| `tasks.status` | `TODO` · `DONE` |
| `tasks.source` | `MANUAL` · `CALENDAR` |
| `tasks.source_state` | `ACTIVE` · `ORPHANED` |
| `tasks.priority` | `P1` … `P5`, o `NULL` (migración 16) |
| `task_events.type` | `CREATED` · `MOVED` · `START_DATE_SET` · `CARRIED_OVER`¹ |
| (solo front) `CapacityLevel` | `OK` · `WARN` · `OVER` |

¹ `CARRIED_OVER` es **histórico**: lo escribía el carry-over, que ya no existe
(§4.2). Se mantiene porque hay tareas con ese evento en su historial.

## 3.2 Semántica de campos clave de `tasks`

- `scheduled_date` `NULL` ⇒ **está en el backlog**. No hay flag aparte.
- `scheduled_time` `NULL` ⇒ sin hora; ordena la cola de Focus y es **la única
  fuente de hora del rail** (§4.13).
- `position` ⇒ orden dentro de su día (o del backlog).
- `estimated_minutes` = planned. `NULL` es válido = sin estimado.
- `priority` ⇒ `P1` (lo más urgente) a `P5`. **`NULL` es "sin prioridad" y es un
  estado propio, no un P3 implícito**: es lo que tiene toda tarea recién creada y
  toda la que existía antes de la migración 16. El orden por prioridad las manda
  **al final**, explícitamente (`comparePriority`), y no las mezcla entre los P5:
  una tarea que nadie miró no es "menos urgente que un P5". TEXT y no INTEGER
  porque es un enum, y con un dígito el orden lexicográfico coincide con el
  numérico. Los cinco niveles y sus colores **no se configuran** — el único ajuste
  es el interruptor general (§4).
- `actual_seconds` = tiempo real **acumulado**. Ver [I1](invariantes.md).
- `source_state = 'ORPHANED'` ⇒ tarea de calendario que ya no está en el feed **y
  que nunca se trabajó**: sale de los listados sin borrarse, y **todos filtran por
  `ACTIVE`**. Si sí se trabajó (tiene `time_entries` o está `DONE`) el reconciler
  no la marca: la suelta del feed y la deja `ACTIVE` (§4.12). Marcarla `ORPHANED`
  la hacía desaparecer del tablero al día siguiente, justo cuando uno quiere ver
  lo que hizo.

## 3.3 Categorías = "channels"

Dos niveles vía `parent_id`. `NULL` ⇒ **contexto** (carpeta del backlog: Thinking,
Tooling, Docs, Projects, Selfcare, Issues, Meetings); con `parent_id` ⇒ **channel**
(el `#tag` de las cards). Una tarea apunta a cualquiera de los dos niveles, así
que para agrupar por contexto se resuelve `parentId ?? id`.

**Un objetivo también apunta a un channel** (`objectives.category_id`, migración
13) y es la **misma** tabla: no hay channels especiales de objetivos. La tarea que
crea el reparto de horas nace con el del objetivo, que es lo que evita que un
reparto deje siete tareas sin clasificar (§4.29).

`color` guarda un **token de la paleta**, no un hex: se usa como `var(--${color})`
/ `var(--${color}-ink)`. **Son veinticuatro**, en orden de matiz en
`src/lib/palette.ts` (`PALETTE`) — vive ahí y no en `SettingsView` porque es dos
cosas a la vez: las opciones del picker y el dominio de valores de esta columna.

**Agregar un color es compatible hacia atrás; renombrarlo o quitarlo rompe las
categorías que ya lo usan**, que quedan con un `var()` inexistente: un punto
transparente, sin error. Cada nombre necesita sus **dos** tokens en
`src/styles/tokens.css`, y lo vigila `tokens.test.ts` — el modo de falla es
silencioso, así que la regla escrita no alcanza. Cómo se eligieron, en
[§7](ui.md).

## 3.4 `objectives`

Objetivo/ritual semanal agrupado por `iso_week` en formato `2026-W32`, generado
por `isoWeekId()` en `src/lib/date.ts` (ISO real vía `date-fns`).
