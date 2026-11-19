//! Lo que hace cada tool del MCP, como funciones puras sobre `&Connection` (§4.32).
//!
//! Van separadas de `server.rs` por la misma razón que `repo.rs` va separado de
//! `commands.rs`: así se prueban con SQLite en memoria, sin levantar el protocolo.
//! Son **wrappers delgados sobre `repo.rs`**; lo que agregan es la validación del
//! borde —lo que manda el modelo no pasó por ningún formulario— y una salida
//! pensada para que la lea un modelo, no la UI.
//!
//! Los errores vuelven como texto en español para el modelo. Nunca un pánico: un
//! pánico mataría el proceso y Claude Desktop lo mostraría como servidor caído.

use std::collections::HashMap;

use chrono::{NaiveDate, NaiveTime, Utc};
use rusqlite::Connection;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::models::{Category, Task};
use crate::repo::{self, double_option, NewTask, TaskPatch};

/// El rango más largo que acepta `list_tasks`, en días.
const MAX_RANGE_DAYS: i64 = 62;
/// El título más largo que se acepta. El de la UI no tiene tope, pero un modelo
/// que pega un documento entero en el título casi seguro se equivocó de campo.
const MAX_TITLE_CHARS: usize = 300;
/// Un estimado de más de un día no es un estimado de una tarea.
const MAX_ESTIMATE_MINUTES: i64 = 24 * 60;

type ToolResult = Result<String, String>;

/// Saca el `"default"` que schemars le pone a cada campo con `#[serde(default)]`.
///
/// **No es cosmético: borraba datos.** Un `Option` con `#[serde(default)]` sale
/// en el esquema como `"default": null`, y el cliente completa con ese valor los
/// campos que el modelo no mandó. En `update_task` un `null` es "borrar", así que
/// editar las notas de una tarea le quitaba también el estimado, la hora, la
/// prioridad y el channel. El `#[serde(default)]` se queda —sin él, los campos con
/// `deserialize_with` serían obligatorios— y el esquema publica el campo como
/// opcional y sin valor por defecto.
fn no_defaults(schema: &mut schemars::Schema) {
    if let Some(props) = schema
        .get_mut("properties")
        .and_then(|p| p.as_object_mut())
    {
        for prop in props.values_mut() {
            if let Some(obj) = prop.as_object_mut() {
                obj.remove("default");
            }
        }
    }
}

/// Marca `date` como obligatoria en el esquema de `move_task`.
///
/// `#[schemars(required)]` no alcanza: schemars lo ignora en un campo con
/// `#[serde(default)]`, que acá hace falta para que `double_option` distinga
/// ausente de null.
fn date_required(schema: &mut schemars::Schema) {
    let required = schema
        .ensure_object()
        .entry("required")
        .or_insert_with(|| serde_json::json!([]));
    if let Some(list) = required.as_array_mut() {
        if !list.iter().any(|v| v == "date") {
            list.push("date".into());
        }
    }
}

// ---------------------------------------------------------------------------
// Parámetros. Los doc comments son la descripción que ve el modelo.
// ---------------------------------------------------------------------------

#[derive(Debug, Default, Deserialize, JsonSchema)]
#[schemars(transform = no_defaults)]
pub struct ListTasksParams {
    /// Día en formato YYYY-MM-DD. Si no viene, es hoy en la zona del usuario.
    #[serde(default)]
    pub date: Option<String>,
    /// Último día del rango, YYYY-MM-DD, inclusive. Si no viene, se lista solo `date`.
    #[serde(default)]
    pub end_date: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(transform = no_defaults)]
pub struct TaskIdParams {
    /// El id de la tarea.
    pub id: i64,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(transform = no_defaults)]
pub struct CreateTaskParams {
    /// Título de la tarea, corto.
    pub title: String,
    /// Día en que se planifica, YYYY-MM-DD. Sin día, la tarea va al backlog.
    #[serde(default)]
    pub date: Option<String>,
    /// Hora del día, HH:MM en 24 horas. Solo si la tarea tiene una hora fija.
    #[serde(default)]
    pub time: Option<String>,
    /// Tiempo estimado en minutos.
    #[serde(default)]
    pub estimated_minutes: Option<i64>,
    /// Id del channel (sale de `list_channels`).
    #[serde(default)]
    pub channel_id: Option<i64>,
    /// Prioridad: P1 es lo más urgente y P5 lo que puede esperar. Sin prioridad si no viene.
    #[serde(default)]
    pub priority: Option<String>,
    /// Notas en Markdown.
    #[serde(default)]
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(transform = no_defaults)]
pub struct UpdateTaskParams {
    /// El id de la tarea.
    pub id: i64,
    /// Título nuevo.
    #[serde(default)]
    pub title: Option<String>,
    /// Notas nuevas en Markdown; reemplazan las anteriores. Un texto vacío las borra.
    #[serde(default)]
    pub notes: Option<String>,
    /// Hora HH:MM, o null para quitarla.
    #[serde(default, deserialize_with = "double_option")]
    pub time: Option<Option<String>>,
    /// Minutos estimados, o null para quitar el estimado.
    #[serde(default, deserialize_with = "double_option")]
    pub estimated_minutes: Option<Option<i64>>,
    /// Id del channel, o null para dejarla sin channel.
    #[serde(default, deserialize_with = "double_option")]
    pub channel_id: Option<Option<i64>>,
    /// P1 a P5, o null para dejarla sin prioridad.
    #[serde(default, deserialize_with = "double_option")]
    pub priority: Option<Option<String>>,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(transform = no_defaults, transform = date_required)]
pub struct MoveTaskParams {
    /// El id de la tarea.
    pub id: i64,
    /// Día destino, YYYY-MM-DD, o null para mandarla al backlog. Queda al final del día.
    ///
    /// Obligatorio aunque acepte null: si faltar fuera lo mismo que null, un
    /// `move_task({id})` mandaría la tarea al backlog sin que nadie lo pidiera.
    #[serde(default, deserialize_with = "double_option")]
    pub date: Option<Option<String>>,
}

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

/// Una tarea como la lee el modelo: sin las columnas internas (`position`,
/// `feed_id`, `calendar_uid`…) y con el channel resuelto a su nombre.
#[derive(Debug, Serialize)]
struct TaskView {
    id: i64,
    title: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    time: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    estimated_minutes: Option<i64>,
    tracked_minutes: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    priority: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    channel: Option<ChannelView>,
    #[serde(skip_serializing_if = "Option::is_none")]
    notes: Option<String>,
    /// `MANUAL` o `CALENDAR`. Las de calendario no se editan por acá.
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    meeting: Option<MeetingView>,
}

#[derive(Debug, Serialize)]
struct MeetingView {
    #[serde(skip_serializing_if = "Option::is_none")]
    start: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct ChannelView {
    id: i64,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent: Option<String>,
}

/// Los channels activos por id, con el nombre del padre resuelto.
fn channels(conn: &Connection) -> Result<HashMap<i64, ChannelView>, String> {
    let all: Vec<Category> = repo::list_categories(conn).map_err(db_err)?;
    let names: HashMap<i64, String> = all.iter().map(|c| (c.id, c.name.clone())).collect();
    Ok(all
        .into_iter()
        .map(|c| {
            let view = ChannelView {
                id: c.id,
                parent: c.parent_id.and_then(|p| names.get(&p).cloned()),
                name: c.name,
            };
            (c.id, view)
        })
        .collect())
}

fn view(task: Task, channels: &HashMap<i64, ChannelView>) -> TaskView {
    let is_calendar = task.source == "CALENDAR";
    TaskView {
        id: task.id,
        title: task.title,
        status: task.status,
        date: task.scheduled_date,
        time: task.scheduled_time,
        estimated_minutes: task.estimated_minutes,
        tracked_minutes: task.actual_seconds / 60,
        priority: task.priority,
        channel: task.category_id.and_then(|id| channels.get(&id).cloned()),
        notes: task.notes.filter(|n| !n.trim().is_empty()),
        source: task.source,
        meeting: is_calendar.then_some(MeetingView {
            start: task.event_start,
            end: task.event_end,
            url: task.meeting_url,
            description: task.event_description,
        }),
    }
}

fn to_json<T: Serialize>(value: &T) -> ToolResult {
    serde_json::to_string(value).map_err(|e| format!("No pude armar la respuesta: {e}"))
}

fn db_err(e: rusqlite::Error) -> String {
    format!("Error de la base de sunrise: {e}")
}

// ---------------------------------------------------------------------------
// Validación del borde
// ---------------------------------------------------------------------------

fn parse_date(raw: &str) -> Result<NaiveDate, String> {
    NaiveDate::parse_from_str(raw.trim(), "%Y-%m-%d")
        .map_err(|_| format!("La fecha «{raw}» no es válida: usa YYYY-MM-DD."))
}

/// La fecha normalizada a `YYYY-MM-DD`, que es como la guarda la app. `2026-1-5`
/// parsea, pero guardado así no lo encontraría ninguna consulta por día.
fn date_string(raw: &str) -> Result<String, String> {
    parse_date(raw).map(|d| d.format("%Y-%m-%d").to_string())
}

fn time_string(raw: &str) -> Result<String, String> {
    NaiveTime::parse_from_str(raw.trim(), "%H:%M")
        .map(|t| t.format("%H:%M").to_string())
        .map_err(|_| format!("La hora «{raw}» no es válida: usa HH:MM en 24 horas."))
}

fn priority(raw: &str) -> Result<String, String> {
    let p = raw.trim().to_uppercase();
    match p.as_str() {
        "P1" | "P2" | "P3" | "P4" | "P5" => Ok(p),
        _ => Err(format!("La prioridad «{raw}» no existe: usa P1, P2, P3, P4 o P5.")),
    }
}

fn estimate(minutes: i64) -> Result<i64, String> {
    if (1..=MAX_ESTIMATE_MINUTES).contains(&minutes) {
        Ok(minutes)
    } else {
        Err(format!(
            "El estimado tiene que estar entre 1 y {MAX_ESTIMATE_MINUTES} minutos."
        ))
    }
}

fn title(raw: &str) -> Result<String, String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err("El título no puede quedar vacío.".into());
    }
    if t.chars().count() > MAX_TITLE_CHARS {
        return Err(format!(
            "El título tiene más de {MAX_TITLE_CHARS} caracteres; lo largo va en las notas."
        ));
    }
    Ok(t.to_string())
}

fn channel(conn: &Connection, id: i64) -> Result<i64, String> {
    if channels(conn)?.contains_key(&id) {
        Ok(id)
    } else {
        Err(format!(
            "No existe un channel con id {id}. Usa list_channels para ver los que hay."
        ))
    }
}

/// La tarea, si existe, se ve en la app y se puede editar desde acá.
///
/// Las de calendario quedan fuera: su dueño es el reconciler, que vuelve cada
/// quince minutos y reescribe título, día y hora desde el feed. Una edición acá
/// duraría hasta la próxima sincronización.
fn editable(conn: &Connection, id: i64) -> Result<Task, String> {
    let task = repo::get_task(conn, id)
        .map_err(db_err)?
        .filter(|t| t.source_state == "ACTIVE")
        .ok_or_else(|| format!("No existe una tarea con id {id}."))?;
    if task.source == "CALENDAR" {
        return Err(
            "Es un evento del calendario: se edita en el calendario de origen, y sunrise \
             lo sincroniza solo."
                .into(),
        );
    }
    Ok(task)
}

fn today(conn: &Connection) -> String {
    Utc::now()
        .with_timezone(&repo::zone(conn))
        .format("%Y-%m-%d")
        .to_string()
}

// ---------------------------------------------------------------------------
// Las tools
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct TaskList {
    today: String,
    tasks: Vec<TaskView>,
}

/// Las tareas de un día o de un rango, como las muestra el tablero.
///
/// Sin los eventos marcados "solo agenda" (`rail_only`): no son tarjetas del
/// tablero, y contarlos haría que el almuerzo pareciera trabajo planificado.
pub fn list_tasks(conn: &Connection, p: ListTasksParams) -> ToolResult {
    let today = today(conn);
    let start = match p.date.as_deref() {
        Some(d) => parse_date(d)?,
        None => parse_date(&today)?,
    };
    let tasks = match p.end_date.as_deref() {
        Some(e) => {
            let end = parse_date(e)?;
            let days = (end - start).num_days();
            if days < 0 {
                return Err("end_date no puede ser anterior a date.".into());
            }
            if days >= MAX_RANGE_DAYS {
                return Err(format!(
                    "El rango es de {} días; el máximo es {MAX_RANGE_DAYS}.",
                    days + 1
                ));
            }
            repo::list_tasks_for_range(
                conn,
                &start.format("%Y-%m-%d").to_string(),
                &end.format("%Y-%m-%d").to_string(),
            )
        }
        None => repo::list_tasks_for_date(conn, &start.format("%Y-%m-%d").to_string()),
    }
    .map_err(db_err)?;

    let channels = channels(conn)?;
    to_json(&TaskList {
        today,
        tasks: tasks
            .into_iter()
            .filter(|t| !t.rail_only)
            .map(|t| view(t, &channels))
            .collect(),
    })
}

/// Lo que espera en el backlog (sin día, sin completar).
pub fn list_backlog(conn: &Connection) -> ToolResult {
    let channels = channels(conn)?;
    let tasks: Vec<TaskView> = repo::list_backlog(conn)
        .map_err(db_err)?
        .into_iter()
        .map(|t| view(t, &channels))
        .collect();
    to_json(&tasks)
}

pub fn get_task(conn: &Connection, p: TaskIdParams) -> ToolResult {
    let task = repo::get_task(conn, p.id)
        .map_err(db_err)?
        .filter(|t| t.source_state == "ACTIVE")
        .ok_or_else(|| format!("No existe una tarea con id {}.", p.id))?;
    to_json(&view(task, &channels(conn)?))
}

/// Los channels activos, que es con lo que se clasifica una tarea.
pub fn list_channels(conn: &Connection) -> ToolResult {
    let mut all: Vec<ChannelView> = channels(conn)?.into_values().collect();
    all.sort_by_key(|c| c.id);
    to_json(&all)
}

pub fn create_task(conn: &Connection, p: CreateTaskParams) -> ToolResult {
    let input = NewTask {
        title: title(&p.title)?,
        scheduled_date: p.date.as_deref().map(date_string).transpose()?,
        scheduled_time: p.time.as_deref().map(time_string).transpose()?,
        estimated_minutes: p.estimated_minutes.map(estimate).transpose()?,
        category_id: p.channel_id.map(|id| channel(conn, id)).transpose()?,
        priority: p.priority.as_deref().map(priority).transpose()?,
        notes: p.notes.filter(|n| !n.trim().is_empty()),
        objective_id: None,
    };
    let task = repo::create_task(conn, input).map_err(db_err)?;
    to_json(&view(task, &channels(conn)?))
}

pub fn update_task(conn: &Connection, p: UpdateTaskParams) -> ToolResult {
    editable(conn, p.id)?;
    let patch = TaskPatch {
        title: p.title.as_deref().map(title).transpose()?,
        notes: p.notes,
        scheduled_time: p
            .time
            .map(|t| t.as_deref().map(time_string).transpose())
            .transpose()?,
        estimated_minutes: p
            .estimated_minutes
            .map(|m| m.map(estimate).transpose())
            .transpose()?,
        category_id: p
            .channel_id
            .map(|c| c.map(|id| channel(conn, id)).transpose())
            .transpose()?,
        priority: p
            .priority
            .map(|v| v.as_deref().map(priority).transpose())
            .transpose()?,
        // Ni objetivo ni tiempo trabajado: el tiempo tiene sus tools (`log_time`,
        // `set_task_time`), que pasan por `log_time_entry` y `set_actual_seconds` (I2).
        objective_id: None,
        actual_seconds: None,
    };
    let task = repo::update_task(conn, p.id, patch)
        .map_err(db_err)?
        .ok_or_else(|| format!("No existe una tarea con id {}.", p.id))?;
    to_json(&view(task, &channels(conn)?))
}

/// La manda a otro día o al backlog, **al final** de la lista destino.
///
/// `move_task` recibe el índice final y trata uno fuera de rango como "al
/// final", así que `i64::MAX` es la forma de pedirlo sin contar la lista.
pub fn move_task(conn: &Connection, p: MoveTaskParams) -> ToolResult {
    let date = p
        .date
        .ok_or("Falta date: un día YYYY-MM-DD, o null para mandarla al backlog.")?;
    editable(conn, p.id)?;
    let date = date.as_deref().map(date_string).transpose()?;
    let task = repo::move_task(conn, p.id, date.as_deref(), i64::MAX)
        .map_err(db_err)?
        .ok_or_else(|| format!("No existe una tarea con id {}.", p.id))?;
    to_json(&view(task, &channels(conn)?))
}

// ---------------------------------------------------------------------------
// El tiempo (#23): timers en vivo, tramos pasados y el total
// ---------------------------------------------------------------------------

/// El tramo más largo que acepta `log_time`. Un día entero ya es raro; más que
/// eso casi seguro es un error del modelo al armar las fechas.
const MAX_LOG_HOURS: i64 = 24;
/// El total más alto que acepta `set_task_time`, en minutos (1000 horas).
const MAX_TOTAL_MINUTES: i64 = 60_000;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(transform = no_defaults)]
pub struct StartTimerParams {
    /// El id de la tarea.
    pub id: i64,
    /// false pausa todos los demás timers (el play de la app); true la suma a los
    /// que ya corren sin tocarlos. Obligatorio: pausar lo que el usuario está
    /// cronometrando tiene que ser una decisión.
    pub parallel: bool,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(transform = no_defaults)]
pub struct LogTimeParams {
    /// El id de la tarea.
    pub id: i64,
    /// Inicio del tramo, fecha y hora en la zona del usuario: YYYY-MM-DD HH:MM.
    pub start: String,
    /// Fin del tramo, YYYY-MM-DD HH:MM en la zona del usuario. Posterior al
    /// inicio y no en el futuro; puede ser del día siguiente.
    pub end: String,
}

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(transform = no_defaults)]
pub struct SetTaskTimeParams {
    /// El id de la tarea.
    pub id: i64,
    /// El tiempo trabajado total de la tarea, en minutos. Reemplaza al actual.
    pub minutes: i64,
}

/// Un timer que corre, como lo lee el modelo.
#[derive(Debug, Serialize)]
struct RunningView {
    id: i64,
    title: String,
    /// Desde cuándo, `YYYY-MM-DD HH:MM` en la zona del usuario.
    since: String,
    running_minutes: i64,
}

#[derive(Debug, Serialize)]
struct PausedView {
    id: i64,
    title: String,
}

/// El tramo que quedó guardado, en hora local: si el modelo mandó un offset que no
/// era el del usuario, acá se ve.
#[derive(Debug, Serialize)]
struct LoggedView {
    start: String,
    end: String,
}

#[derive(Serialize)]
struct TimerResult {
    task: TaskView,
    #[serde(skip_serializing_if = "Option::is_none")]
    logged_minutes: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    logged: Option<LoggedView>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    paused: Vec<PausedView>,
    running: Vec<RunningView>,
}

/// La tarea existe y se ve en la app. A diferencia de `editable`, **acepta las de
/// calendario**: el tiempo de una reunión se trackea como el de cualquier tarea
/// (la card tiene play), y eso no lo reescribe el reconciler.
fn trackable(conn: &Connection, id: i64) -> Result<Task, String> {
    repo::get_task(conn, id)
        .map_err(db_err)?
        .filter(|t| t.source_state == "ACTIVE")
        .ok_or_else(|| format!("No existe una tarea con id {id}."))
}

fn local_label(tz: chrono_tz::Tz, rfc: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(rfc)
        .map(|d| d.with_timezone(&tz).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_else(|_| rfc.to_string())
}

fn running(conn: &Connection) -> Result<Vec<RunningView>, String> {
    let tz = repo::zone(conn);
    let now = Utc::now();
    Ok(repo::get_active_timers(conn)
        .map_err(db_err)?
        .into_iter()
        .map(|a| RunningView {
            running_minutes: chrono::DateTime::parse_from_rfc3339(&a.started_at)
                .map(|s| (now - s.with_timezone(&Utc)).num_minutes().max(0))
                .unwrap_or(0),
            since: local_label(tz, &a.started_at),
            id: a.task_id,
            title: a.title,
        })
        .collect())
}

fn timer_result(
    conn: &Connection,
    id: i64,
    logged_minutes: Option<i64>,
    paused: Vec<PausedView>,
) -> ToolResult {
    timer_result_with(conn, id, logged_minutes, None, paused)
}

fn timer_result_with(
    conn: &Connection,
    id: i64,
    logged_minutes: Option<i64>,
    logged: Option<LoggedView>,
    paused: Vec<PausedView>,
) -> ToolResult {
    let task = trackable(conn, id)?;
    to_json(&TimerResult {
        task: view(task, &channels(conn)?),
        logged_minutes,
        logged,
        paused,
        running: running(conn)?,
    })
}

/// Una fecha y hora **local** del usuario → UTC.
///
/// Acepta `YYYY-MM-DD HH:MM` (o con `T`, y con segundos). Una hora sola no: no
/// dice el día, y "23:00 a 00:30" no se puede leer sin inventar una regla que
/// choca con "el fin antes del inicio se rechaza". Un RFC 3339 **con offset**
/// también entra y se respeta tal cual, porque ese no es ambiguo.
///
/// Del salto de horario: una hora que ocurre dos veces toma la primera (como
/// `local_midnight`), y una que no existe se rechaza con su motivo.
fn local_datetime(tz: chrono_tz::Tz, raw: &str) -> Result<chrono::DateTime<Utc>, String> {
    use chrono::{LocalResult, NaiveDateTime, TimeZone};
    let s = raw.trim();
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Ok(dt.with_timezone(&Utc));
    }
    let naive = ["%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"]
        .iter()
        .find_map(|f| NaiveDateTime::parse_from_str(s, f).ok())
        .ok_or_else(|| {
            format!("«{raw}» no es una fecha y hora válida: usa YYYY-MM-DD HH:MM, en la zona del usuario.")
        })?;
    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => Ok(dt.with_timezone(&Utc)),
        LocalResult::Ambiguous(first, _) => Ok(first.with_timezone(&Utc)),
        LocalResult::None => Err(format!(
            "«{raw}» no existe en la zona del usuario ({tz}): cae en el salto del cambio de horario."
        )),
    }
}

/// Inicia el timer de una tarea, con las mismas reglas que el play de la app
/// (`repo::start_timer`): si ya corre no hace nada, y si estaba completada la
/// reabre (I5).
pub fn start_timer(conn: &Connection, p: StartTimerParams) -> ToolResult {
    trackable(conn, p.id)?;
    let before = repo::get_active_timers(conn).map_err(db_err)?;
    repo::start_timer(conn, p.id, p.parallel).map_err(db_err)?;
    let after = repo::get_active_timers(conn).map_err(db_err)?;
    let paused = before
        .into_iter()
        .filter(|b| !after.iter().any(|a| a.task_id == b.task_id))
        .map(|b| PausedView {
            id: b.task_id,
            title: b.title,
        })
        .collect();
    timer_result(conn, p.id, None, paused)
}

/// Detiene el timer de una tarea; los demás siguen. Si no corría no es un error:
/// el resultado lo dice con `logged_minutes` ausente.
pub fn stop_timer(conn: &Connection, p: TaskIdParams) -> ToolResult {
    trackable(conn, p.id)?;
    let stopped = repo::stop_timer(conn, p.id).map_err(db_err)?;
    timer_result(conn, p.id, stopped.map(|(_, secs)| secs / 60), Vec::new())
}

/// Registra un tramo pasado ya cerrado (`repo::log_time_entry`).
pub fn log_time(conn: &Connection, p: LogTimeParams) -> ToolResult {
    trackable(conn, p.id)?;
    let tz = repo::zone(conn);
    let start = local_datetime(tz, &p.start)?;
    let end = local_datetime(tz, &p.end)?;
    if end - start > chrono::Duration::hours(MAX_LOG_HOURS) {
        return Err(format!(
            "El tramo dura más de {MAX_LOG_HOURS} horas; revisa las fechas o regístralo en partes."
        ));
    }
    use repo::LogTimeError as E;
    let (_, secs) = repo::log_time_entry(conn, p.id, start, end).map_err(|e| match e {
        E::EndNotAfterStart => "El fin tiene que ser posterior al inicio.".to_string(),
        E::EndInFuture => {
            "El fin está en el futuro: log_time es para tramos que ya terminaron. Para lo que \
             está pasando ahora usa start_timer."
                .to_string()
        }
        E::TaskNotFound => format!("No existe una tarea con id {}.", p.id),
        E::Overlaps(a, b) => {
            let desde = local_label(tz, &a);
            match b {
                Some(b) => format!(
                    "Se pisa con un tramo ya registrado en esa tarea ({desde} a {}): ese tiempo ya \
                     está contado.",
                    local_label(tz, &b)
                ),
                None => format!(
                    "Se pisa con el timer de esa tarea, que corre desde {desde}: ese tiempo se \
                     cuenta al detenerlo."
                ),
            }
        }
        E::Db(e) => db_err(e),
    })?;
    let logged = LoggedView {
        start: local_label(tz, &start.to_rfc3339()),
        end: local_label(tz, &end.to_rfc3339()),
    };
    timer_result_with(conn, p.id, Some(secs / 60), Some(logged), Vec::new())
}

/// Corrige el total trabajado, como el ajuste a mano de la app
/// (`repo::set_actual_seconds`, I2): la diferencia queda como entrada de ajuste.
///
/// **Con el timer de la tarea corriendo se rechaza.** El total no incluye la
/// corrida abierta, que se suma al detenerla: "déjala en 2 horas" terminaría en
/// 2 horas más lo que llevaba corriendo.
pub fn set_task_time(conn: &Connection, p: SetTaskTimeParams) -> ToolResult {
    trackable(conn, p.id)?;
    if !(0..=MAX_TOTAL_MINUTES).contains(&p.minutes) {
        return Err(format!(
            "El total tiene que estar entre 0 y {MAX_TOTAL_MINUTES} minutos."
        ));
    }
    // La pregunta y la escritura en la misma transacción: entre las dos, la app
    // podría darle play.
    let was_running = repo::atomically(conn, || {
        if repo::get_active_timer(conn, p.id)?.is_some() {
            return Ok(true);
        }
        repo::set_actual_seconds(conn, p.id, p.minutes * 60)?;
        Ok(false)
    })
    .map_err(db_err)?;
    if was_running {
        return Err(
            "El timer de esa tarea está corriendo: detenlo primero con stop_timer, o el total \
             quedaría sumado a lo que lleva."
                .into(),
        );
    }
    timer_result(conn, p.id, None, Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use serde_json::Value;

    fn conn() -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c
    }

    fn json(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    fn create(conn: &Connection, title: &str, date: Option<&str>) -> i64 {
        let out = create_task(
            conn,
            CreateTaskParams {
                title: title.into(),
                date: date.map(Into::into),
                time: None,
                estimated_minutes: None,
                channel_id: None,
                priority: None,
                notes: None,
            },
        )
        .unwrap();
        json(&out)["id"].as_i64().unwrap()
    }

    /// Una tarea de calendario, insertada directo: ninguna tool las crea.
    fn calendar_task(conn: &Connection, date: &str) -> i64 {
        conn.execute(
            "INSERT INTO tasks (title, position, scheduled_date, source, calendar_uid,
                                created_at, updated_at)
             VALUES ('Reunión', 0, ?1, 'CALENDAR', 'uid-1', '2026-10-01', '2026-10-01')",
            [date],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn crear_valida_y_normaliza_lo_que_manda_el_modelo() {
        let c = conn();
        let out = create_task(
            &c,
            CreateTaskParams {
                title: "  Revisar PR  ".into(),
                date: Some("2026-10-14".into()),
                time: Some("9:30".into()),
                estimated_minutes: Some(45),
                channel_id: Some(1),
                priority: Some("p2".into()),
                notes: Some("con **detalle**".into()),
            },
        )
        .unwrap();
        let v = json(&out);
        assert_eq!(v["title"], "Revisar PR");
        assert_eq!(v["date"], "2026-10-14");
        assert_eq!(v["time"], "09:30", "la hora se guarda con dos dígitos");
        assert_eq!(v["priority"], "P2", "los enums van en MAYÚSCULAS");
        assert_eq!(v["channel"]["id"], 1);
        assert_eq!(v["source"], "MANUAL");
    }

    #[test]
    fn crear_sin_dia_la_manda_al_backlog() {
        let c = conn();
        let id = create(&c, "Algún día", None);
        let backlog = json(&list_backlog(&c).unwrap());
        assert_eq!(backlog[0]["id"].as_i64(), Some(id));
        assert!(backlog[0].get("date").is_none());
    }

    #[test]
    fn crear_rechaza_valores_que_la_app_no_sabria_leer() {
        let c = conn();
        let base_params = || CreateTaskParams {
            title: "x".into(),
            date: None,
            time: None,
            estimated_minutes: None,
            channel_id: None,
            priority: None,
            notes: None,
        };
        let cases = [
            CreateTaskParams { title: "   ".into(), ..base_params() },
            CreateTaskParams { date: Some("14/10/2026".into()), ..base_params() },
            CreateTaskParams { time: Some("25:00".into()), ..base_params() },
            CreateTaskParams { estimated_minutes: Some(0), ..base_params() },
            CreateTaskParams { priority: Some("ALTA".into()), ..base_params() },
            CreateTaskParams { channel_id: Some(9999), ..base_params() },
        ];
        for case in cases {
            let dbg = format!("{case:?}");
            assert!(create_task(&c, case).is_err(), "debió rechazar {dbg}");
        }
        let count: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0, "un rechazo no puede dejar una tarea a medias");
    }

    #[test]
    fn crear_deja_el_historial_como_la_app() {
        let c = conn();
        let id = create(&c, "Con fecha", Some("2026-10-14"));
        let events: Vec<String> = repo::list_task_events(&c, id)
            .unwrap()
            .into_iter()
            .map(|e| e.kind)
            .collect();
        assert_eq!(events, ["CREATED", "START_DATE_SET"]);
    }

    #[test]
    fn listar_un_dia_deja_fuera_lo_que_el_tablero_no_muestra() {
        let c = conn();
        create(&c, "Visible", Some("2026-10-14"));
        let lunch = calendar_task(&c, "2026-10-14");
        c.execute("UPDATE tasks SET rail_only = 1 WHERE id = ?1", [lunch])
            .unwrap();
        let orphan = create(&c, "Huérfana", Some("2026-10-14"));
        c.execute(
            "UPDATE tasks SET source_state = 'ORPHANED' WHERE id = ?1",
            [orphan],
        )
        .unwrap();

        let v = json(
            &list_tasks(
                &c,
                ListTasksParams {
                    date: Some("2026-10-14".into()),
                    end_date: None,
                },
            )
            .unwrap(),
        );
        let titles: Vec<&str> = v["tasks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["title"].as_str().unwrap())
            .collect();
        assert_eq!(titles, ["Visible"]);
        assert!(v["today"].is_string(), "el modelo necesita saber qué día es hoy");
    }

    #[test]
    fn listar_un_rango_y_sus_limites() {
        let c = conn();
        create(&c, "Lunes", Some("2026-10-12"));
        create(&c, "Viernes", Some("2026-10-16"));
        create(&c, "Otra semana", Some("2026-10-20"));
        let range = |d: &str, e: &str| {
            list_tasks(
                &c,
                ListTasksParams {
                    date: Some(d.into()),
                    end_date: Some(e.into()),
                },
            )
        };
        let v = json(&range("2026-10-12", "2026-10-18").unwrap());
        assert_eq!(v["tasks"].as_array().unwrap().len(), 2);
        assert!(range("2026-10-18", "2026-10-12").is_err());
        assert!(range("2026-01-01", "2026-12-31").is_err());
    }

    #[test]
    fn editar_aplica_solo_lo_que_viene_y_null_borra() {
        let c = conn();
        let id = create(&c, "Original", Some("2026-10-14"));
        update_task(
            &c,
            UpdateTaskParams {
                id,
                title: None,
                notes: None,
                time: None,
                estimated_minutes: Some(Some(30)),
                channel_id: None,
                priority: Some(Some("P1".into())),
            },
        )
        .unwrap();

        // Llega como JSON, igual que desde Claude: es lo único que cruza serde y
        // distingue `null` de ausente.
        let p: UpdateTaskParams =
            serde_json::from_str(&format!(r#"{{"id": {id}, "priority": null}}"#)).unwrap();
        let v = json(&update_task(&c, p).unwrap());
        assert_eq!(v["title"], "Original");
        assert_eq!(v["estimated_minutes"], 30, "lo ausente no se toca");
        assert!(v.get("priority").is_none(), "null quita la prioridad");
    }

    #[test]
    fn mover_va_al_final_del_dia_destino_o_al_backlog() {
        let c = conn();
        let already = create(&c, "Ya estaba", Some("2026-10-15"));
        let id = create(&c, "Se mueve", Some("2026-10-14"));

        move_task(&c, MoveTaskParams { id, date: Some(Some("2026-10-15".into())) }).unwrap();
        let day = repo::list_tasks_for_date(&c, "2026-10-15").unwrap();
        assert_eq!(day.iter().map(|t| t.id).collect::<Vec<_>>(), [already, id]);

        move_task(&c, MoveTaskParams { id, date: Some(None) }).unwrap();
        assert_eq!(repo::get_task(&c, id).unwrap().unwrap().scheduled_date, None);
    }

    #[test]
    fn mover_sin_date_no_la_manda_al_backlog() {
        let c = conn();
        let id = create(&c, "Quieta", Some("2026-10-14"));
        let p: MoveTaskParams = serde_json::from_str(&format!(r#"{{"id": {id}}}"#)).unwrap();
        assert!(move_task(&c, p).unwrap_err().contains("Falta date"));
        assert_eq!(
            repo::get_task(&c, id).unwrap().unwrap().scheduled_date.as_deref(),
            Some("2026-10-14")
        );
        // Y null explícito sí es el backlog.
        let p: MoveTaskParams =
            serde_json::from_str(&format!(r#"{{"id": {id}, "date": null}}"#)).unwrap();
        move_task(&c, p).unwrap();
        assert_eq!(repo::get_task(&c, id).unwrap().unwrap().scheduled_date, None);
    }

    #[test]
    fn las_tareas_de_calendario_se_leen_pero_no_se_editan() {
        let c = conn();
        let id = calendar_task(&c, "2026-10-14");
        assert!(get_task(&c, TaskIdParams { id }).is_ok());
        let p: UpdateTaskParams =
            serde_json::from_str(&format!(r#"{{"id": {id}, "title": "Otro"}}"#)).unwrap();
        assert!(update_task(&c, p).unwrap_err().contains("calendario"));
        assert!(move_task(&c, MoveTaskParams { id, date: Some(None) }).is_err());
        assert_eq!(repo::get_task(&c, id).unwrap().unwrap().title, "Reunión");
    }

    #[test]
    fn una_tarea_que_no_existe_es_un_error_legible() {
        let c = conn();
        assert!(get_task(&c, TaskIdParams { id: 42 })
            .unwrap_err()
            .contains("42"));
    }

    #[test]
    fn los_channels_traen_el_nombre_del_padre() {
        let c = conn();
        let v = json(&list_channels(&c).unwrap());
        assert!(!v.as_array().unwrap().is_empty());
        let child = repo::create_category(&c, Some(1), "Hijo", "#ffffff").unwrap();
        let v = json(&list_channels(&c).unwrap());
        let found = v
            .as_array()
            .unwrap()
            .iter()
            .find(|ch| ch["id"].as_i64() == Some(child.id))
            .unwrap();
        assert!(found["parent"].is_string());
    }

    // --- El tiempo (#23) ----------------------------------------------------

    fn ids(v: &Value, key: &str) -> Vec<i64> {
        v[key]
            .as_array()
            .map(|a| a.iter().map(|x| x["id"].as_i64().unwrap()).collect())
            .unwrap_or_default()
    }

    fn start(c: &Connection, id: i64, parallel: bool) -> Value {
        json(&start_timer(c, StartTimerParams { id, parallel }).unwrap())
    }

    #[test]
    fn start_timer_respeta_parallel_y_dice_que_pauso() {
        let c = conn();
        let a = create(&c, "a", Some("2026-10-14"));
        let b = create(&c, "b", Some("2026-10-14"));
        let d = create(&c, "d", Some("2026-10-14"));

        start(&c, a, false);
        let out = start(&c, b, true);
        assert_eq!(ids(&out, "running"), vec![a, b], "paralelo no toca al otro");
        assert!(out.get("paused").is_none());

        let out = start(&c, d, false);
        assert_eq!(ids(&out, "running"), vec![d]);
        let mut paused = ids(&out, "paused");
        paused.sort();
        assert_eq!(paused, vec![a, b], "el play clásico pausa todo y lo dice");

        // Ya corre: no hace nada, ni pausa a nadie.
        start(&c, a, true);
        let out = start(&c, d, false);
        assert_eq!(ids(&out, "running"), vec![d, a]);
        assert!(out.get("paused").is_none());
    }

    #[test]
    fn start_timer_reabre_una_completada_como_el_play_de_la_app() {
        let c = conn();
        let a = create(&c, "a", Some("2026-10-14"));
        repo::set_task_status(&c, a, "DONE").unwrap();
        let out = start(&c, a, true);
        assert_eq!(out["task"]["status"], "TODO");
    }

    #[test]
    fn stop_timer_para_solo_esa_y_sin_timer_no_es_error() {
        let c = conn();
        let a = create(&c, "a", Some("2026-10-14"));
        let b = create(&c, "b", Some("2026-10-14"));

        let out = json(&stop_timer(&c, TaskIdParams { id: a }).unwrap());
        assert!(out.get("logged_minutes").is_none(), "no corría: nada registrado");

        start(&c, a, true);
        start(&c, b, true);
        let out = json(&stop_timer(&c, TaskIdParams { id: a }).unwrap());
        assert_eq!(out["logged_minutes"], 0);
        assert_eq!(ids(&out, "running"), vec![b]);
    }

    #[test]
    fn las_tools_de_tiempo_aceptan_reuniones_pero_no_tareas_inexistentes() {
        let c = conn();
        let m = calendar_task(&c, "2026-10-14");
        start(&c, m, true);
        stop_timer(&c, TaskIdParams { id: m }).unwrap();
        // También las "solo agenda", que list_tasks no muestra pero ocupan su hora.
        c.execute("UPDATE tasks SET rail_only = 1 WHERE id = ?1", [m]).unwrap();
        log(&c, m, "2026-10-14 08:00", "2026-10-14 08:30").unwrap();
        // Una que su calendario quitó (I7) ya no existe para el MCP. Sin timer
        // corriendo: el reconciler no orfana una tarea con el timer abierto.
        c.execute("UPDATE tasks SET source_state = 'ORPHANED' WHERE id = ?1", [m])
            .unwrap();
        assert!(log(&c, m, "2026-10-14 09:00", "2026-10-14 10:00")
            .unwrap_err()
            .contains("No existe"));
        assert!(stop_timer(&c, TaskIdParams { id: 999 })
            .unwrap_err()
            .contains("No existe"));
    }

    fn log(c: &Connection, id: i64, start: &str, end: &str) -> ToolResult {
        log_time(
            c,
            LogTimeParams {
                id,
                start: start.into(),
                end: end.into(),
            },
        )
    }

    #[test]
    fn log_time_registra_en_la_zona_del_usuario_y_suma_al_total() {
        let c = conn();
        let a = create(&c, "a", Some("2026-10-14"));

        let out = json(&log(&c, a, "2026-10-14 15:41", "2026-10-14T16:41").unwrap());
        assert_eq!(out["logged_minutes"], 60);
        assert_eq!(out["logged"]["start"], "2026-10-14 15:41");
        assert_eq!(out["logged"]["end"], "2026-10-14 16:41");
        assert_eq!(out["task"]["tracked_minutes"], 60);

        // La entrada quedó en esa hora local, no en UTC.
        let entry = &repo::list_time_entries(&c, a).unwrap()[0];
        assert_eq!(local_label(repo::zone(&c), &entry.started_at), "2026-10-14 15:41");
        assert_eq!(local_label(repo::zone(&c), entry.ended_at.as_ref().unwrap()), "2026-10-14 16:41");
    }

    #[test]
    fn log_time_rechaza_lo_que_no_es_un_tramo_pasado() {
        let c = conn();
        let a = create(&c, "a", Some("2026-10-14"));
        let tomorrow = (Utc::now() + chrono::Duration::days(2)).format("%Y-%m-%d");

        assert!(log(&c, a, "15:41", "16:41").unwrap_err().contains("YYYY-MM-DD HH:MM"));
        assert!(log(&c, a, "2026-10-14 16:00", "2026-10-14 15:00")
            .unwrap_err()
            .contains("posterior"));
        assert!(log(&c, a, &format!("{tomorrow} 09:00"), &format!("{tomorrow} 10:00"))
            .unwrap_err()
            .contains("futuro"));
        assert!(log(&c, a, "2026-10-12 09:00", "2026-10-14 09:00")
            .unwrap_err()
            .contains("24 horas"));

        log(&c, a, "2026-10-14 09:00", "2026-10-14 10:00").unwrap();
        let err = log(&c, a, "2026-10-14 09:30", "2026-10-14 10:30").unwrap_err();
        assert!(err.contains("2026-10-14 09:00 a 2026-10-14 10:00"), "{err}");
        // Solo quedó el primero.
        assert_eq!(repo::get_task(&c, a).unwrap().unwrap().actual_seconds, 3600);
    }

    #[test]
    fn la_hora_local_sobrevive_al_cambio_de_horario() {
        let tz: chrono_tz::Tz = "America/Santiago".parse().unwrap();
        // Primavera 2026: de 00:00 se salta a 01:00 el 6 de septiembre.
        assert!(local_datetime(tz, "2026-09-06 00:30")
            .unwrap_err()
            .contains("cambio de horario"));
        // Otoño 2026: 23:00–23:59 del 4 de abril ocurre dos veces; va la primera (-03).
        assert_eq!(
            local_datetime(tz, "2026-04-04 23:30").unwrap().to_rfc3339(),
            "2026-04-05T02:30:00+00:00"
        );
        // Con offset explícito se respeta tal cual.
        assert_eq!(
            local_datetime(tz, "2026-10-14T15:41:00-03:00").unwrap().to_rfc3339(),
            "2026-10-14T18:41:00+00:00"
        );
    }

    #[test]
    fn set_task_time_fija_el_total_y_no_con_el_timer_corriendo() {
        let c = conn();
        let a = create(&c, "a", Some("2026-10-14"));

        let out = json(&set_task_time(&c, SetTaskTimeParams { id: a, minutes: 90 }).unwrap());
        assert_eq!(out["task"]["tracked_minutes"], 90);
        // Como el ajuste a mano: la diferencia queda como entrada de ajuste.
        let entries = repo::list_time_entries(&c, a).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].ended_at.as_deref(), Some(entries[0].started_at.as_str()));

        assert!(set_task_time(&c, SetTaskTimeParams { id: a, minutes: -1 }).is_err());

        start(&c, a, true);
        let err = set_task_time(&c, SetTaskTimeParams { id: a, minutes: 10 }).unwrap_err();
        assert!(err.contains("stop_timer"));
        assert_eq!(repo::get_task(&c, a).unwrap().unwrap().actual_seconds, 90 * 60);
    }
}
