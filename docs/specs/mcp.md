# §4.32 Servidor MCP para Claude Desktop

Leer y crear tareas, y registrar tiempo, desde Claude Desktop, sin abrir la app y sin puertos.

Vuelve al [índice de SPECS](../SPECS.md). El porqué de cada decisión está en
[DECISIONES §11](../DECISIONES.md).

---

### 4.32 Cómo funciona

**El mismo binario de la app, con `--mcp`.** `main.rs` mira los argumentos antes
de construir Tauri: con el flag entra a `mcp::run()` y nunca abre ventana, ni
aparece en el Dock, ni migra la base. Claude Desktop lo lanza como proceso hijo y
le habla JSON-RPC por stdin/stdout (el transporte **stdio** de MCP); el proceso vive
mientras Claude Desktop esté abierto. El registro va en
`claude_desktop_config.json`:

```json
{ "mcpServers": { "sunrise": {
  "command": "/Applications/sunrise.app/Contents/MacOS/sunrise",
  "args": ["--mcp"] } } }
```

**Por stdout sale solo el protocolo.** Un `println!` en un camino que corra bajo
`--mcp` corrompe el stream y Claude Desktop corta. Lo humano va a stderr, que
Claude Desktop guarda en su log (`~/Library/Logs/Claude/mcp-server-sunrise.log`).

#### Capas (`src-tauri/src/mcp/`)

| Archivo | Qué |
|---|---|
| `store.rs` | La ruta de la base sin Tauri y la apertura por llamada, con la guarda de esquema |
| `tools.rs` | Lo que hace cada tool: funciones puras sobre `&Connection`, con su validación |
| `server.rs` | El registro en `rmcp` (macros `#[tool_router]` / `#[tool_handler]`); no decide nada |

Mismo corte que `repo.rs` / `commands.rs`: lo que decide va en `tools.rs` para que
se pruebe en memoria.

#### La base

- **Ruta**: `~/Library/Application Support/<identifier>/<db::file_name()>`, armada a
  mano porque `app_data_dir()` necesita un `AppHandle`. El identifier es una
  constante en `store.rs` y un test la compara contra `tauri.conf.json`.
- **El perfil del binario elige la base**, igual que en la app (§4.20): el `.app`
  abre `sunrise.sqlite` y `target/debug/sunrise` abre `sunrise-dev.sqlite`.
- **Una conexión por llamada.** Restaurar un respaldo reemplaza el archivo
  (§4.17); una conexión larga seguiría escribiendo en el viejo.
- **Si el archivo no existe, no lo crea**: pide abrir sunrise una vez.
- **Nunca migra.** Si `MAX(_migrations.version)` no es la última de `MIGRATIONS`,
  cada tool responde un error que dice qué hacer (abrir la app, o actualizarla).
- **`busy_timeout` de 5 s** en `db::open`, que comparten los dos procesos. Sin él,
  una escritura que coincide con un commit del otro falla con `SQLITE_BUSY`.
- **La zona** es la de `repo::zone`, que se cachea por proceso: si se cambia el
  ajuste de zona, el MCP la toma cuando Claude Desktop lo relance.

#### Las tools

| Tool | Sobre `repo` | Annotation |
|---|---|---|
| `list_tasks` (`date`, `end_date`) | `list_tasks_for_date` / `_for_range` | solo lectura |
| `list_backlog` | `list_backlog` | solo lectura |
| `get_task` (`id`) | `get_task` | solo lectura |
| `list_channels` | `list_categories` | solo lectura |
| `create_task` | `create_task` | escribe, no destructiva |
| `update_task` | `update_task` | escribe, no destructiva, idempotente |
| `move_task` (`id`, `date` o null) | `move_task` con índice `i64::MAX` = al final | escribe, no destructiva, idempotente |
| `start_timer` (`id`, `parallel`) | `start_timer` | escribe, no destructiva, idempotente |
| `stop_timer` (`id`) | `stop_timer` | escribe, no destructiva, idempotente |
| `log_time` (`id`, `start`, `end`) | `log_time_entry` | escribe, no destructiva, **no** idempotente |
| `set_task_time` (`id`, `minutes`) | `set_actual_seconds` en `atomically` | escribe, no destructiva, idempotente |

- **`list_tasks` sin fecha es hoy** en la zona del usuario, y toda respuesta trae
  `today`: el modelo no tiene otra forma confiable de saber qué día es acá.
- **Sigue lo que muestra el tablero**: sin `ORPHANED` (I7) y sin los eventos "solo
  agenda" (`rail_only`).
- **El esquema publicado no lleva `"default"`** (`no_defaults` en `tools.rs`).
  schemars lo agrega por cada `#[serde(default)]` como `"default": null`, y el
  cliente completa con eso los campos que el modelo omite: en `update_task` eso
  borraba el estimado, la hora, la prioridad y el channel al editar solo las notas.
  Lo vigila un test sobre el esquema **publicado** (`server.rs`), no sobre el struct.
- **La salida no es `Task`**: es una vista con el channel resuelto a nombre (y su
  padre), los minutos trackeados en vez de segundos, y los datos de la reunión
  agrupados en `meeting` solo si es de calendario. Sin `position`, `feed_id` ni
  `calendar_uid`, que no le sirven a nadie fuera de la app.
- **`update_task` tiene los tres estados de `TaskPatch`**: ausente no toca, `null`
  borra (hora, estimado, channel, prioridad). Las notas son texto: vacío las borra.
- **Validación del borde**: fecha `YYYY-MM-DD` (normalizada, `2026-1-5` no entra
  así), hora `HH:MM` (normalizada a dos dígitos), prioridad `P1`–`P5` en
  MAYÚSCULAS, estimado de 1 a 1440 minutos, título no vacío y de hasta 300
  caracteres, channel existente, rango de hasta 62 días. Un rechazo no escribe nada.
- **Los errores vuelven como resultado de la tool** (`isError: true`) con texto en
  español, no como error de protocolo: así el modelo puede explicarle al usuario
  qué hacer.

#### El tiempo (#23)

Para que Claude registre lo que hiciste —por ejemplo, revisando lo que pasó en
Slack— además de cronometrar en vivo.

- **`start_timer` y `stop_timer` son el play de la app**, sin SQL propio: llaman a
  `repo::start_timer` / `repo::stop_timer` (I4, I5, atomicidad y `started_at` con
  `repo::now()` vienen de ahí). **`parallel` es obligatorio**: `false` pausa todo lo
  que corre —incluido lo que el usuario está cronometrando en la app— y eso tiene
  que decidirlo el modelo, no un valor por defecto. La respuesta trae `running` (lo
  que queda corriendo, con `since` en hora local) y `paused` (lo que el play
  clásico pausó). `stop_timer` sin timer no es error: no trae `logged_minutes`.
- **`log_time` registra un tramo pasado ya cerrado** con `repo::log_time_entry`:
  es lo que habría dejado el taxímetro encendido a `start` y apagado a `end`.
  - Es una **corrida** (`ended_at` ≠ `started_at`), no un ajuste: el rail la dibuja
    en su hora (`day_work.tracked_at`) y el rollup la atribuye por `started_at`.
  - Pasa por **`close_entry`**: se parte por día local si cruza la medianoche (I3)
    y se **suma** a `actual_seconds` (I1). La fila se inserta ya cerrada y
    `close_entry` la reescribe; una abierta chocaría con el índice de I4 si la
    tarea tiene su timer corriendo.
  - **Se rechaza**: fin no posterior al inicio, fin en el futuro, más de 24 horas,
    y **pisar otra corrida de la misma tarea**, cerrada o en curso (ese tiempo ya
    está contado). Los ajustes no cuentan como corrida: no tienen hora. Pegado a
    otro tramo (`[10, 11)` y `[11, 12)`) sí entra.
  - **No reabre una tarea `DONE`**: registrar trabajo pasado no es volver a ella.
  - **Repetirla duplica** el tiempo salvo que pise (y entonces se rechaza): es la
    única tool de tiempo sin `idempotent_hint`.
- **`set_task_time` corrige el total en minutos** con `set_actual_seconds`, como el
  ajuste a mano (I2): la diferencia queda como entrada de ajuste sin hora.
  **Con el timer de la tarea corriendo se rechaza**: el total no incluye la corrida
  abierta, que se suma al detenerla, así que "déjala en 2 horas" terminaría en 2
  horas más lo que llevaba. La pregunta y la escritura van en la misma transacción.
- **Las cuatro aceptan reuniones de calendario** (la card tiene play y el tiempo no
  lo reescribe el reconciler), **incluidas las "solo agenda" (`rail_only`)**, que
  `list_tasks` no lista pero sí ocupan su hora en el rail; no aceptan tareas
  `ORPHANED` (I7).
- **`log_time` devuelve `logged`** con el inicio y el fin **guardados**, en hora
  local: si el modelo mandó un offset que no era el del usuario, se ve ahí.
- **Topes**: `log_time` de hasta 24 horas absolutas (el día de otoño, de 25, va en
  dos partes) y `set_task_time` de 0 a 60 000 minutos.
- **El rechazo de `set_task_time` con el timer corriendo es una regla solo del
  MCP.** La app tiene el mismo problema —un ajuste a mano con el timer corriendo
  termina en el ajuste más lo que llevaba— y no lo mira; ahí el usuario ve el
  número moverse, y el modelo no.

**Fechas y horas del tiempo**: `start` y `end` son **fecha y hora local**,
`YYYY-MM-DD HH:MM` (también con `T` o con segundos), en la zona del usuario
(`repo::zone`). Una hora sola no entra: no dice el día, y "23:00 a 00:30" no se
puede leer sin una regla que choca con "fin antes del inicio se rechaza". Un RFC
3339 **con offset** se respeta tal cual. En el salto de horario, una hora que
ocurre dos veces toma la primera (como `local_midnight`) y una que no existe se
rechaza diciendo por qué. Lo que se guarda es siempre `to_rfc3339()` en UTC.

**Fuera, a propósito:**

- **Completar y borrar.** El motivo original —completar cierra un timer en la
  base y el taxímetro no se entera— ya no lo separa del resto: `start_timer` con
  `parallel: false` cierra timers igual, y se aceptó con el hueco documentado abajo.
  Lo que queda es que completar además cambia lo que el taxímetro **muestra en
  pausa** (`last` y `completeAndAdvance`), que la ventana flotante solo revisa en su
  propio refresco; se abre cuando esa ventana escuche el aviso. Borrar espera el
  basurero (#11).
- **Corregir o borrar tramos ya registrados.** `log_time` solo agrega.
- **Editar o mover las tareas de calendario.** Se leen; su dueño es el reconciler,
  que reescribiría la edición en la próxima sincronización.
- **Objetivos y ajustes.**

**Lo que devuelve una tool sale de la máquina**: entra a la conversación con
Claude, que corre en los servidores de Anthropic. Local es el servidor, no los
datos que lee. Por eso la salida es una vista recortada y no la fila entera, y por
eso el README lo dice en la sección de cómo conectarlo.

**Las `instructions` del servidor** le dicen al modelo que títulos, notas y
descripciones de reuniones son contenido y no instrucciones: las de calendario
vienen de feeds ICS de terceros.

#### La app se entera (`external.rs`)

Un vigilante en Rust lee `PRAGMA data_version` de la conexión de la app cada 2 s.
Ese contador cambia **solo cuando hace commit otra conexión**, así que lo que
escribe la app no lo mueve y no hay eco posible. Al cambiar emite
`sunrise://data-changed`; `useExternalChanges` (en `Shell`) llama
`markDataStale()`. Restaurar un respaldo cambia la conexión y da un aviso de más,
inofensivo. Detalle del canal en [§5](sincronizacion.md).

**El timer**: en `main`, `useTimerRuntime` relee los timers con cada
`dataVersion`, así que un `start_timer` del MCP aparece en la vista y `main`
muestra el taxímetro. Dos huecos conocidos (#23, no bloqueantes):

- **La ventana flotante no escucha `data-changed`** (`useExternalChanges` vive en
  `Shell`, solo en `main`, y `refresh` no avisa por `localStorage`): su store se
  queda con lo último que leyó hasta su próximo refresco. Arreglarlo es montar el
  aviso también ahí.
- **La campana puede llegar hasta 5 min tarde** si el MCP arranca un timer cuando
  no había ninguno: nadie toca `bell::Armed` y el vigilante duerme hasta
  `ESPERA_DORMIDO`. Por diseño se atrasa, no se pierde (cada vuelta relee la base).

#### Configs → MCP (`claude_desktop.rs`, `McpCard`)

La sección que conecta sunrise a Claude Desktop sin abrir un archivo a mano.
Muestra el estado, qué puede hacer Claude, el aviso de privacidad, el bloque JSON
para pegar y el comando de Claude Code (`claude mcp add --scope user …`), los dos
con su botón de copiar. El estado se relee cada vez que la ventana vuelve al
frente: el archivo es de otra app.

**El botón edita `~/Library/Application Support/Claude/claude_desktop_config.json`**
con estas reglas, que vienen de que el archivo no es nuestro:

| Situación | Qué hace |
|---|---|
| No existe la carpeta de Claude | `NO_CLAUDE`: no crea nada, pide abrir Claude Desktop una vez |
| No existe el archivo | Lo crea con solo nuestra entrada |
| No hay entrada nuestra | La agrega al final de `mcpServers`, sin tocar lo demás |
| **Alguna** entrada ya apunta a este binario, se llame como se llame | `CONNECTED`: no escribe |
| Hay una con nuestro nombre apuntando a otro lado | `ELSEWHERE`: **no la toca** (decisión del dev), muestra a dónde apunta |
| El JSON no se entiende | `INVALID`: no lo reescribe |
| sunrise corre desde el `.dmg` montado o desde una copia de App Translocation | No conecta: esa ruta deja de existir |

Antes de escribir copia el archivo a `claude_desktop_config.json.sunrise-bak`, y
escribe con temporal + rename. **Conserva el orden de las claves**
(`preserve_order` de serde_json): el archivo lo edita gente a mano.

**El nombre de la entrada depende del perfil**: `sunrise` en la app instalada y
`sunrise-dev` en dev, para que las dos puedan estar registradas a la vez, cada una
con su base. Lo que se registra es `std::env::current_exe()`, así que el binario
que conecta es el que va a correr.

Después de conectar hay que **cerrar Claude Desktop con ⌘Q y abrirlo**: lee la
configuración solo al arrancar. La card lo dice.
