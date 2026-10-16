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
        // Ni objetivo ni tiempo trabajado: el tiempo pasa por `set_actual_seconds`
        // (I2) y no está en el alcance del MCP.
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
}
