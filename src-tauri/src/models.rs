//! Modelos serializables que cruzan el puente IPC hacia el frontend.
//! `rename_all = "camelCase"` para espejar los tipos TS de `src/lib/types.ts`.

use rusqlite::Row;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub color: String,
    pub position: i64,
    pub archived: bool,
}

impl Category {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Category {
            id: r.get("id")?,
            parent_id: r.get("parent_id")?,
            name: r.get("name")?,
            color: r.get("color")?,
            position: r.get("position")?,
            archived: r.get::<_, i64>("archived")? != 0,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Objective {
    pub id: i64,
    pub iso_week: String,
    pub title: String,
    pub position: i64,
    pub completed: bool,
}

impl Objective {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Objective {
            id: r.get("id")?,
            iso_week: r.get("iso_week")?,
            title: r.get("title")?,
            position: r.get("position")?,
            completed: r.get::<_, i64>("completed")? != 0,
        })
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: i64,
    pub task_id: i64,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub seconds: i64,
}

/// Una tarea del backlog que **venía de un día**, y de cuál.
///
/// No hace falta ni columna ni evento nuevo: mandar algo al backlog ya registra
/// un `MOVED` con `to_date` nulo, tanto si lo bajó la degradación diaria como si
/// lo mandaste tú.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rescate {
    pub task_id: i64,
    /// El día del que salió.
    pub desde: String,
}

/// Lo que una tarea trabajó en un día: cuándo empezó y cuánto sumó.
///
/// Es lo que necesita el rail de calendario para dibujar **lo que pasó de
/// verdad** en vez de lo estimado. Se agrega en `repo.rs` y no en el front
/// porque la atribución por día es local (Regla 2) y ya está resuelta acá.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrabajoDelDia {
    pub task_id: i64,
    /// El primer `started_at` del día, en RFC 3339 (UTC).
    pub started_at: String,
    /// Segundos de las entradas **cerradas** de ese día.
    pub seconds: i64,
    /// La corrida en curso empezó ese día y sigue abierta. Sus segundos todavía
    /// no están en `seconds`: los pone el front desde el taxímetro.
    pub running: bool,
}

/// Una celda del rollup semanal: cuánto se trabajó **ese día** en **esa
/// categoría**. Es lo que alimenta las barras apiladas y el donut.
///
/// Trae la categoría y su raíz porque el donut agrupa por **contexto**
/// (`parent_id ?? id`) y las barras por channel: resolver el padre en el front
/// obligaría a cruzar el árbol de categorías en cada render, y la regla ya está
/// escrita en SQL.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollupCelda {
    pub date: String,
    pub category_id: Option<i64>,
    /// Categoría raíz (`parent_id ?? id`). `None` si la tarea no tiene channel.
    pub context_id: Option<i64>,
    pub seconds: i64,
}

/// Los totales de un día de la semana.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollupDia {
    pub date: String,
    /// Trabajado, atribuido por `time_entries.started_at` (Regla 2).
    pub seconds: i64,
    /// Planificado, por `scheduled_date`. La asimetría con `seconds` es
    /// deliberada: ver SPECS §4.15.
    pub planned_minutes: i64,
    /// Cuántas se completaron ese día (por `completed_at` local).
    pub hechas: i64,
    /// Tareas del día sin estimación: se avisan, no se rellenan con un número.
    pub sin_estimar: i64,
}

/// El rollup de una semana, listo para graficar.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyRollup {
    /// Lunes de la semana ISO, `YYYY-MM-DD`.
    pub week_start: String,
    /// Siempre 7 filas, lunes→domingo, incluso las vacías.
    pub dias: Vec<RollupDia>,
    pub celdas: Vec<RollupCelda>,
    /// Las tareas cerradas en la semana, en orden de cierre.
    pub completadas: Vec<Task>,
    pub total_seconds: i64,
    pub planned_minutes: i64,
    pub sin_estimar: i64,
}

/// Un tramo del timeline de un día: en qué se trabajó, cuánto y desde cuándo.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TramoDelDia {
    pub task_id: i64,
    pub title: String,
    pub seconds: i64,
    /// La corrida sigue abierta: sus segundos los suma el front desde el
    /// taxímetro, igual que en el rail.
    pub running: bool,
}

/// Una tarea cerrada en un día.
///
/// `note` distingue **tres** cosas, no dos: `None` = no la incluiste en la
/// bitácora; `Some("")` = la incluiste y todavía no escribiste nada; `Some(texto)`
/// = incluida y con tus palabras. Aplanarlo a dos perdería el estado "incluida
/// sin resumen", que es justo el que deja el campo abierto para escribir.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HechaDelDia {
    pub task: Task,
    pub note: Option<String>,
}

/// Un día de la bitácora. **Se arma solo**, con o sin shutdown.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaDeBitacora {
    pub date: String,
    /// El cierre "con mis palabras". `None` si nunca se escribió.
    pub note: Option<String>,
    /// `None` ⇒ borrador: está en la bitácora, pero nadie lo cerró.
    pub closed_at: Option<String>,
    /// Cómo estuvo el día, en un emoji.
    pub mood: Option<String>,
    pub worked_seconds: i64,
    pub planned_minutes: i64,
    pub sin_estimar: i64,
    pub hechas: Vec<HechaDelDia>,
    pub timeline: Vec<TramoDelDia>,
    /// Lo trabajado del día por categoría, para el donut. Misma forma que las
    /// celdas de la weekly review, porque sale del mismo núcleo.
    pub celdas: Vec<RollupCelda>,
}

impl TimeEntry {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(TimeEntry {
            id: r.get("id")?,
            task_id: r.get("task_id")?,
            started_at: r.get("started_at")?,
            ended_at: r.get("ended_at")?,
            seconds: r.get("seconds")?,
        })
    }
}

/// Timer en curso (entrada abierta) con su tarea.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveTimer {
    pub entry_id: i64,
    pub task_id: i64,
    pub title: String,
    pub started_at: String,
    /// Segundos ya acumulados en entradas cerradas (sin contar la actual).
    pub base_seconds: i64,
    pub estimated_minutes: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub id: i64,
    pub task_id: i64,
    #[serde(rename = "type")]
    pub kind: String,
    pub from_date: Option<String>,
    pub to_date: Option<String>,
    pub at: String,
}

impl TaskEvent {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(TaskEvent {
            id: r.get("id")?,
            task_id: r.get("task_id")?,
            kind: r.get("type")?,
            from_date: r.get("from_date")?,
            to_date: r.get("to_date")?,
            at: r.get("at")?,
        })
    }

    #[cfg(test)]
    pub fn type_field(&self) -> &str {
        &self.kind
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub notes: Option<String>,
    pub category_id: Option<i64>,
    pub objective_id: Option<i64>,
    pub scheduled_date: Option<String>,
    pub scheduled_time: Option<String>,
    pub position: i64,
    pub estimated_minutes: Option<i64>,
    pub actual_seconds: i64,
    pub status: String,
    pub completed_at: Option<String>,
    pub source: String,
    pub source_state: String,
    pub feed_id: Option<i64>,
    pub calendar_uid: Option<String>,
    pub event_start: Option<String>,
    pub event_end: Option<String>,
    /// Link de la videollamada, si el evento traía uno.
    pub meeting_url: Option<String>,
    /// Descripción del evento tal como viene del calendario. Separada de
    /// `notes`, que son del usuario.
    pub event_description: Option<String>,
    /// Invitados a la reunión. Vacío si el evento no los trae.
    pub attendees: Vec<Participante>,
    pub created_at: String,
    pub updated_at: String,
}

impl Task {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(Task {
            id: r.get("id")?,
            title: r.get("title")?,
            notes: r.get("notes")?,
            category_id: r.get("category_id")?,
            objective_id: r.get("objective_id")?,
            scheduled_date: r.get("scheduled_date")?,
            scheduled_time: r.get("scheduled_time")?,
            position: r.get("position")?,
            estimated_minutes: r.get("estimated_minutes")?,
            actual_seconds: r.get("actual_seconds")?,
            status: r.get("status")?,
            completed_at: r.get("completed_at")?,
            source: r.get("source")?,
            source_state: r.get("source_state")?,
            feed_id: r.get("feed_id")?,
            calendar_uid: r.get("calendar_uid")?,
            event_start: r.get("event_start")?,
            event_end: r.get("event_end")?,
            meeting_url: r.get("meeting_url")?,
            event_description: r.get("event_description")?,
            // JSON ilegible => sin participantes, en vez de tumbar la lectura de
            // la tarea entera por un campo decorativo.
            attendees: r
                .get::<_, Option<String>>("attendees")?
                .and_then(|j| serde_json::from_str(&j).ok())
                .unwrap_or_default(),
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
        })
    }
}

/// Feed ICS configurado por el usuario.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarFeed {
    pub id: i64,
    pub name: String,
    pub ics_url: String,
    pub default_category_id: Option<i64>,
    pub import_as_tasks: bool,
    pub poll_minutes: i64,
    pub last_synced_at: Option<String>,
    /// Por qué falló la última sincronización, o `None` si salió bien. Se
    /// muestra en Configs: un feed roto tiene que decirlo, no quedarse quieto.
    pub last_error: Option<String>,
}

impl CalendarFeed {
    pub fn from_row(r: &Row) -> rusqlite::Result<Self> {
        Ok(CalendarFeed {
            id: r.get("id")?,
            name: r.get("name")?,
            ics_url: r.get("ics_url")?,
            default_category_id: r.get("default_category_id")?,
            import_as_tasks: r.get::<_, i64>("import_as_tasks")? != 0,
            poll_minutes: r.get("poll_minutes")?,
            last_synced_at: r.get("last_synced_at")?,
            last_error: r.get("last_error")?,
        })
    }
}

/// Un invitado a una reunión del calendario.
///
/// Solo lectura: sale del feed y no se edita desde la app.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Participante {
    /// Nombre visible, si el evento lo trae (`CN`).
    pub nombre: Option<String>,
    /// Correo, ya sin el `mailto:`.
    pub email: Option<String>,
    /// `PARTSTAT` en MAYÚSCULAS: `ACCEPTED`, `DECLINED`, `TENTATIVE`,
    /// `NEEDS-ACTION`. `None` si el evento no lo declara.
    pub estado: Option<String>,
    /// Si es quien organiza (viene de `ORGANIZER`, no de `ATTENDEE`).
    pub organizador: bool,
}

/// Un archivo de respaldo en la carpeta configurada.
///
/// No sale de la base: sale de leer el directorio. `created_at` se deduce del
/// **nombre** y no de la metadata del sistema de archivos, porque un `rsync`, un
/// `cp` o la sincronización de un Drive reescriben la fecha del archivo y
/// dejarían los respaldos ordenados por cuándo se copiaron, no por cuándo se
/// hicieron.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchivoDeBackup {
    /// `sunrise-20260817-200315.zip`.
    pub name: String,
    /// Ruta absoluta, para poder restaurarlo sin volver a abrir el selector.
    pub path: String,
    pub bytes: u64,
    /// `YYYY-MM-DDTHH:MM:SS` en hora local (sin zona: el nombre no la guarda).
    pub created_at: String,
}

/// Resultado de una restauración.
///
/// Lo que trae es exactamente lo que hace falta para cerrar una acción
/// irreversible: **qué momento quedó vivo** (para saber cuánto se perdió), **con
/// qué datos** (para darse cuenta si era el zip equivocado) y **cómo deshacerlo**.
/// Nada más: el tamaño del archivo o el número de esquema no le sirven a nadie
/// para decidir algo.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Restauracion {
    /// El zip que se restauró.
    pub desde: String,
    /// Dónde quedó la copia de seguridad de la base que se pisó. Es el deshacer.
    pub copia_de_seguridad: String,
    /// Momento exacto del snapshot, del manifest, **con offset de zona**. Es más
    /// preciso que la fecha del nombre del archivo, que no la guarda. `None` en un
    /// respaldo sin manifest.
    pub creado_en: Option<String>,
    /// Versión de la app que escribió el respaldo, si el manifest la trae.
    pub version_del_respaldo: Option<String>,
    /// La de esta app. La vista solo la muestra **cuando difiere**: decir
    /// "0.1.0 → 0.1.0" es ruido; decir que el respaldo venía de otra versión
    /// explica por qué hubo migración.
    pub version_actual: String,
    /// Cuántas tareas quedaron vivas. Es la comprobación de que se restauró lo
    /// que se quería.
    pub tareas: i64,
    /// Lo último que se trabajó según la base restaurada (RFC3339 en UTC), o
    /// `None` si no hay tiempo registrado.
    pub ultima_actividad: Option<String>,
}

/// Perfil de compilación de la ventana que pregunta, con el archivo de base que
/// está usando.
///
/// Existe porque `pnpm tauri dev` y el `.dmg` instalado comparten el directorio de
/// datos y se ven exactamente iguales: sin esto, dos ventanas abiertas no se
/// distinguen y no hay forma de saber cuál está tocando tus datos de verdad.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Perfil {
    /// `true` en `pnpm tauri dev` (y en un `tauri build --debug`).
    pub dev: bool,
    /// Nombre del archivo SQLite en uso, para poder mostrarlo tal cual.
    pub base: String,
}
