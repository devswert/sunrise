//! Lógica de datos de sunrise (funciones puras sobre `&Connection`), testeable
//! sin el runtime de Tauri. Los comandos en `commands.rs` son wrappers delgados.

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Deserialize;

/// Lee un campo `Option<Option<T>>` **distinguiendo `null` de ausente**.
///
/// Con el derive pelado no se distinguen: un `null` entra por el visitor del
/// `Option` de afuera, cae en `visit_none()` y llega como `None`, igual que un
/// campo que no vino. O sea que los tres estados de `TaskPatch` (§4.1) eran dos
/// en la práctica, y **"Sin canal" / "Sin objetivo" nunca borraron nada dentro de
/// Tauri** — fuera sí, porque `mockDb` recibe el objeto de JS y ahí `null` y
/// `undefined` sí son distintos. Ese es exactamente el modo de falla que la skill
/// de la capa de datos describe: el mock y el front de acuerdo, los dos
/// equivocados, y ninguna de las dos suites enterada.
///
/// El `#[serde(default)]` sigue haciendo falta: es lo que cubre el campo ausente.
fn double_option<'de, D, T>(de: D) -> std::result::Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(de).map(Some)
}

use crate::models::{
    ActiveTimer, CalendarFeed, Category, LogDay, DoneTask, Objective, ObjectiveWork, Attendee,
    Rescue, RollupCell, RollupDay, Task, TaskEvent, TimeEntry, DayWork, DaySegment,
    WeeklyRollup,
};

pub type Result<T> = rusqlite::Result<T>;

fn now() -> String {
    Utc::now().to_rfc3339()
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTask {
    pub title: String,
    #[serde(default)]
    pub category_id: Option<i64>,
    #[serde(default)]
    pub objective_id: Option<i64>,
    #[serde(default)]
    pub scheduled_date: Option<String>,
    #[serde(default)]
    pub scheduled_time: Option<String>,
    #[serde(default)]
    pub estimated_minutes: Option<i64>,
    #[serde(default)]
    pub notes: Option<String>,
}

/// Campos editables de una tarea. `None` => no tocar.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "double_option")]
    pub category_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub objective_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "double_option")]
    pub scheduled_time: Option<Option<String>>,
    #[serde(default, deserialize_with = "double_option")]
    pub estimated_minutes: Option<Option<i64>>,
    #[serde(default)]
    pub actual_seconds: Option<i64>,
}

const TASK_COLS: &str = "id, title, notes, category_id, objective_id, scheduled_date, \
    scheduled_time, position, estimated_minutes, actual_seconds, status, completed_at, \
    source, source_state, feed_id, calendar_uid, event_start, event_end, meeting_url, \
    event_description, attendees, rail_only, created_at, updated_at";

pub fn get_task(conn: &Connection, id: i64) -> Result<Option<Task>> {
    conn.query_row(
        &format!("SELECT {TASK_COLS} FROM tasks WHERE id = ?1"),
        [id],
        Task::from_row,
    )
    .optional()
}

/// Siguiente posición (al final) para una fecha (o backlog si `date` es None).
fn next_position(conn: &Connection, date: Option<&str>) -> Result<i64> {
    let max: Option<i64> = match date {
        Some(d) => conn.query_row(
            "SELECT MAX(position) FROM tasks WHERE scheduled_date = ?1",
            [d],
            |r| r.get(0),
        )?,
        None => conn.query_row(
            "SELECT MAX(position) FROM tasks WHERE scheduled_date IS NULL",
            [],
            |r| r.get(0),
        )?,
    };
    Ok(max.map(|m| m + 1).unwrap_or(0))
}

pub fn create_task(conn: &Connection, input: NewTask) -> Result<Task> {
    let ts = now();
    let position = next_position(conn, input.scheduled_date.as_deref())?;
    conn.execute(
        "INSERT INTO tasks
            (title, notes, category_id, objective_id, scheduled_date, scheduled_time,
             position, estimated_minutes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            input.title,
            input.notes,
            input.category_id,
            input.objective_id,
            input.scheduled_date,
            input.scheduled_time,
            position,
            input.estimated_minutes,
            ts,
        ],
    )?;
    let id = conn.last_insert_rowid();

    // Historial: creación (y set de fecha si nació agendada).
    log_event(conn, id, "CREATED", None, input.scheduled_date.as_deref())?;
    if let Some(d) = input.scheduled_date.as_deref() {
        log_event(conn, id, "START_DATE_SET", None, Some(d))?;
    }

    Ok(get_task(conn, id)?.expect("tarea recién creada"))
}

pub fn update_task(conn: &Connection, id: i64, patch: TaskPatch) -> Result<Option<Task>> {
    let Some(mut t) = get_task(conn, id)? else {
        return Ok(None);
    };
    if let Some(v) = patch.title {
        t.title = v;
    }
    if let Some(v) = patch.notes {
        t.notes = Some(v);
    }
    if let Some(v) = patch.category_id {
        t.category_id = v;
    }
    if let Some(v) = patch.objective_id {
        t.objective_id = v;
    }
    if let Some(v) = patch.scheduled_time {
        t.scheduled_time = v;
    }
    if let Some(v) = patch.estimated_minutes {
        t.estimated_minutes = v;
    }
    // `actual_seconds` NO se escribe aquí: pasa por `set_actual_seconds`, que
    // además registra el ajuste como entrada (ver más abajo).
    let current_manual = patch.actual_seconds;
    conn.execute(
        "UPDATE tasks SET title=?2, notes=?3, category_id=?4, objective_id=?5,
            scheduled_time=?6, estimated_minutes=?7, actual_seconds=?8, updated_at=?9
         WHERE id=?1",
        params![
            id,
            t.title,
            t.notes,
            t.category_id,
            t.objective_id,
            t.scheduled_time,
            t.estimated_minutes,
            t.actual_seconds,
            now(),
        ],
    )?;
    if let Some(v) = current_manual {
        return set_actual_seconds(conn, id, v);
    }
    get_task(conn, id)
}

pub fn delete_task(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
    Ok(())
}

/// Marca estado TODO/DONE (sella `completed_at`).
///
/// Si se completa la tarea que tiene el timer corriendo, **lo detiene**: así el
/// tiempo trabajado queda registrado y no sigue corriendo una tarea ya cerrada.
/// Se hace aquí (y no en cada vista) para que valga desde cualquier lugar:
/// semana, Today, Focus, el modal o el taxímetro.
pub fn set_task_status(conn: &Connection, id: i64, status: &str) -> Result<Option<Task>> {
    if status == "DONE" {
        if let Some(active) = get_active_timer(conn)? {
            if active.task_id == id {
                stop_timer(conn)?;
            }
        }
    }

    let completed_at = if status == "DONE" { Some(now()) } else { None };
    conn.execute(
        "UPDATE tasks SET status=?2, completed_at=?3, updated_at=?4 WHERE id=?1",
        params![id, status, completed_at, now()],
    )?;
    get_task(conn, id)
}

/// Mueve una tarea a `date` (None = backlog) en la posición `position`,
/// corriendo el resto del día destino y registrando el evento de historial.
pub fn move_task(
    conn: &Connection,
    id: i64,
    date: Option<&str>,
    position: i64,
) -> Result<Option<Task>> {
    move_task_as(conn, id, date, position, None)
}

/// Igual que `move_task`, pero deja registrar el evento con otro tipo.
///
/// Existe por el carry-over: mover la tarea es la misma operación, pero en el
/// historial no puede verse igual que un arrastre hecho a mano. Quien la mueve
/// no fue el usuario.
fn move_task_as(
    conn: &Connection,
    id: i64,
    date: Option<&str>,
    position: i64,
    event_kind: Option<&str>,
) -> Result<Option<Task>> {
    let Some(t) = get_task(conn, id)? else {
        return Ok(None);
    };
    let old = t.scheduled_date.clone();

    if old.as_deref() != date {
        let kind = event_kind
            .unwrap_or(if old.is_none() { "START_DATE_SET" } else { "MOVED" });
        log_event(conn, id, kind, old.as_deref(), date)?;
    }

    // El destino se **renumera entero**, en vez de correr +1 las que están de
    // `position` para abajo. Ese atajo funcionaba mientras la tarea viniera de
    // otro día, y se equivocaba en uno al reordenar dentro del mismo: la tarea
    // que se mueve deja libre su lugar, así que las de abajo no tienen que
    // correrse todas. Arrastrar una card hacia abajo la dejaba un lugar antes de
    // donde se soltó, y al recargar parecía que había vuelto sola.
    //
    // `position` es **el índice final**, contando que la tarea ya salió de la
    // lista. Es lo que se ve mientras se arrastra, que es con lo que el
    // resultado tiene que coincidir.
    //
    // La renumeración toma **todas** las filas del destino, incluidas las
    // `ORPHANED`, para que no queden dos con la misma `position`. Pero el índice
    // que llega se cuenta contra la lista que se ve, que sí las filtra (§4.1),
    // así que hay que traducirlo: `at` es el primer punto que deja `position`
    // filas visibles detrás.
    let orden: Vec<(i64, bool)> = {
        // El booleano es "se ve en la columna": lo que la vista contó para
        // mandar su índice. Además de las `ORPHANED`, **los bloques de agenda no
        // se ven** (§4.12): sin descontarlos, una card soltada debajo del
        // almuerzo aterrizaba un lugar más abajo de donde la dejaste.
        let mapa = |r: &rusqlite::Row| -> rusqlite::Result<(i64, bool)> {
            Ok((
                r.get(0)?,
                r.get::<_, String>(1)? == "ACTIVE" && !r.get::<_, bool>(2)?,
            ))
        };
        match date {
            Some(d) => conn
                .prepare(
                    "SELECT id, source_state, rail_only FROM tasks
                     WHERE scheduled_date = ?1 AND id <> ?2 ORDER BY position, id",
                )?
                .query_map(params![d, id], mapa)?
                .collect::<Result<Vec<_>>>()?,
            None => conn
                .prepare(
                    "SELECT id, source_state, rail_only FROM tasks
                     WHERE scheduled_date IS NULL AND id <> ?1 ORDER BY position, id",
                )?
                .query_map(params![id], mapa)?
                .collect::<Result<Vec<_>>>()?,
        }
    };

    // Un índice fuera de rango es "al final", y uno negativo no significa nada:
    // la vista manda el largo de su propia lista cuando sueltas en la columna.
    let visibles = orden.iter().filter(|(_, activa)| *activa).count();
    let delante = position.clamp(0, visibles as i64) as usize;
    let mut at = orden.len();
    if delante == 0 {
        at = 0;
    } else {
        let mut vistas = 0usize;
        for (i, (_, activa)) in orden.iter().enumerate() {
            if *activa {
                vistas += 1;
                if vistas == delante {
                    at = i + 1;
                    break;
                }
            }
        }
    }

    // En una sola transacción: son N escrituras donde antes eran dos, y a la
    // mitad el día quedaría con posiciones repetidas.
    let tx = conn.unchecked_transaction()?;

    // Se escribe solo lo que cambia (`position <> ?2`): renumerar el día entero
    // en cada arrastre marcaría como tocadas filas que nadie movió.
    for (i, (otra, _)) in orden.iter().enumerate() {
        let nueva = if i < at { i } else { i + 1 } as i64;
        tx.execute(
            "UPDATE tasks SET position = ?2 WHERE id = ?1 AND position <> ?2",
            params![otra, nueva],
        )?;
    }

    tx.execute(
        "UPDATE tasks SET scheduled_date=?2, position=?3, updated_at=?4 WHERE id=?1",
        params![id, date, at as i64, now()],
    )?;
    tx.commit()?;
    get_task(conn, id)
}

/// El último día **anterior a `before`** que todavía tiene tareas.
///
/// Es la frontera del ritual: ese día se preserva tal cual quedó para poder
/// repasarlo, y todo lo anterior se degrada al backlog. No es "ayer" a secas
/// porque un lunes ayer es domingo y está vacío: lo que hay que repasar es el
/// viernes.
pub fn last_day_with_tasks(conn: &Connection, before: &str) -> Result<Option<String>> {
    conn.query_row(
        "SELECT MAX(scheduled_date) FROM tasks
          WHERE source_state = 'ACTIVE'
            AND rail_only = 0
            AND scheduled_date IS NOT NULL
            AND scheduled_date < ?1",
        [before],
        |r| r.get(0),
    )
}

/// Manda al backlog lo que quedó pendiente en días **anteriores al último con
/// actividad**, en primera posición. Devuelve cuántas movió.
///
/// Reemplazó al carry-over, que arrastraba todo a hoy y decidía por el usuario
/// antes de que viera nada. Ahora:
///
/// - el **último día con tareas** se preserva intacto: es el que repasa el paso
///   1 del ritual, con sus botones de traer a hoy o mandar al backlog;
/// - lo **anterior** baja al backlog en `position = 0`, que es lo que le da la
///   prioridad de arriba. Volver de vacaciones deja lo viejo ordenado en un solo
///   lugar en vez de desperdigado por días muertos.
///
/// Sigue corriendo sola una vez al día: el ritual es la oportunidad de rescate,
/// no un trámite obligatorio. Si nunca entras, el backlog es la red.
///
/// **No toca las de calendario**: una reunión pasada es el registro de algo que
/// ocurrió ese día, y mandarla al backlog sería mentir sobre cuándo fue.
pub fn demote_pending(conn: &Connection, today: &str) -> Result<u32> {
    let Some(live_day) = last_day_with_tasks(conn, today)? else {
        return Ok(0);
    };

    let mut stmt = conn.prepare(
        "SELECT id FROM tasks
          WHERE source = 'MANUAL' AND status = 'TODO' AND source_state = 'ACTIVE'
            AND scheduled_date IS NOT NULL AND scheduled_date < ?1
          ORDER BY scheduled_date DESC, position DESC",
    )?;
    let ids: Vec<i64> = stmt
        .query_map([&live_day], |r| r.get(0))?
        .collect::<Result<Vec<_>>>()?;

    let mut moved = 0u32;
    for id in ids {
        // Todas a la posición 0, de la más nueva a la más vieja: la última en
        // entrar queda arriba, así que arriba del backlog termina lo más
        // antiguo, que es lo que más tiempo lleva esperando.
        move_task_as(conn, id, None, 0, Some("MOVED"))?;
        moved += 1;
    }
    Ok(moved)
}

/// Qué tareas del backlog **venían de un día**, y de cuál.
///
/// Sale del historial (`MOVED` con `to_date` nulo), que ya se registra tanto
/// cuando la degradación las baja como cuando las mandas tú: las dos cosas son
/// "esto venía de un día", así que no hace falta un evento nuevo ni una columna.
pub fn rescued_from_backlog(conn: &Connection) -> Result<Vec<Rescue>> {
    let mut stmt = conn.prepare(
        "SELECT t.id AS task_id,
                (SELECT e.from_date FROM task_events e
                  WHERE e.task_id = t.id AND e.type = 'MOVED' AND e.to_date IS NULL
                  ORDER BY e.id DESC LIMIT 1) AS desde
           FROM tasks t
          WHERE t.source_state = 'ACTIVE'
            AND t.status = 'TODO'
            AND t.scheduled_date IS NULL
          ORDER BY t.position, t.id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(Rescue {
            task_id: r.get("task_id")?,
            from_date: r.get::<_, Option<String>>("desde")?.unwrap_or_default(),
        })
    })?;
    // Las que nunca tuvieron día no son rescates: nacieron en el backlog.
    Ok(rows
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .filter(|x: &Rescue| !x.from_date.is_empty())
        .collect())
}

pub fn list_tasks_for_range(conn: &Connection, start: &str, end: &str) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLS} FROM tasks
         WHERE source_state = 'ACTIVE'
           AND scheduled_date IS NOT NULL AND scheduled_date BETWEEN ?1 AND ?2
         ORDER BY scheduled_date, position, id"
    ))?;
    let rows = stmt.query_map([start, end], Task::from_row)?.collect();
    rows
}

pub fn list_tasks_for_date(conn: &Connection, date: &str) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLS} FROM tasks
         WHERE source_state = 'ACTIVE' AND scheduled_date = ?1
         ORDER BY position, id"
    ))?;
    let rows = stmt.query_map([date], Task::from_row)?.collect();
    rows
}

/// Cola de Focus para `date`: tareas TODO del día.
///
/// Orden: las que tienen hora (meets importadas) van en su horario y el resto
/// por `position`. Para no "adelantar" una meet de la tarde estando en la
/// mañana, las tareas con hora posterior a `now_hhmm` se posponen al final.
pub fn focus_queue(conn: &Connection, date: &str, now_hhmm: &str) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLS} FROM tasks
         WHERE source_state = 'ACTIVE' AND status = 'TODO' AND scheduled_date = ?1
           -- Un bloque de agenda se ignora por completo (§4.12): no es trabajo,
           -- así que no tiene nada que hacer en la cola de Focus.
           AND rail_only = 0
         ORDER BY
            -- 0: sin hora o ya empezada; 1: agendada más tarde
            CASE WHEN scheduled_time IS NULL OR scheduled_time <= ?2 THEN 0 ELSE 1 END,
            COALESCE(scheduled_time, '99:99') = '99:99',  -- con hora primero dentro del grupo
            scheduled_time,
            position,
            id"
    ))?;
    let rows = stmt.query_map([date, now_hhmm], Task::from_row)?.collect();
    rows
}

/// Una reunión del día que todavía no empezó, para el aviso de próxima reunión.
///
/// Es un tipo propio y no `Task` porque `notified_for` **no viaja al front**: es
/// estado del vigilante y nadie más lo necesita. Meterlo en `TASK_COLS` lo pondría
/// en todos los listados para nada.
#[derive(Debug, Clone, PartialEq)]
pub struct Meeting {
    pub task_id: i64,
    pub title: String,
    /// `HH:mm` local, de `scheduled_time`.
    pub time: String,
    /// La hora sobre la que ya se avisó, si se avisó.
    pub notified_for: Option<String>,
}

/// Las reuniones de un día que **tienen hora y siguen pendientes**, de la más
/// temprana a la más tarde.
///
/// `source = 'CALENDAR'` a propósito: hoy **nada de la UI escribe
/// `scheduled_time`** —solo lo llena el import del calendario—, así que el aviso
/// es de reuniones sincronizadas y no de tareas en general. El día que exista un
/// selector de hora para una tarea manual, este filtro es lo que hay que aflojar.
pub fn meetings_for_date(conn: &Connection, date: &str) -> Result<Vec<Meeting>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, scheduled_time, notified_for FROM tasks
         WHERE source_state = 'ACTIVE' AND status = 'TODO' AND source = 'CALENDAR'
           AND scheduled_date = ?1 AND scheduled_time IS NOT NULL
           -- Un bloque de agenda no avisa: ignorarlo por completo incluye no
           -- interrumpir para anunciar el almuerzo (§4.12).
           AND rail_only = 0
         ORDER BY scheduled_time, id",
    )?;
    let rows = stmt.query_map([date], |r| {
        Ok(Meeting {
            task_id: r.get(0)?,
            title: r.get(1)?,
            time: r.get(2)?,
            notified_for: r.get(3)?,
        })
    })?;
    rows.collect()
}

/// Deja anotado que se avisó de esta reunión **a esta hora**.
pub fn mark_notified(conn: &Connection, task_id: i64, time: &str) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET notified_for = ?2 WHERE id = ?1",
        params![task_id, time],
    )?;
    Ok(())
}

pub fn list_backlog(conn: &Connection) -> Result<Vec<Task>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLS} FROM tasks
         WHERE source_state = 'ACTIVE' AND scheduled_date IS NULL AND status = 'TODO'
         ORDER BY category_id, position, id"
    ))?;
    let rows = stmt.query_map([], Task::from_row)?.collect();
    rows
}

// ---------------------------------------------------------------------------
// time_entries (timer / taxímetro)
// ---------------------------------------------------------------------------

/// Medianoche local de hoy, en UTC (para comparar con `started_at`).
///
/// La usan dos cosas que **tienen que coincidir**: el `SUM` de los segundos ya
/// registrados hoy y el recorte de la entrada abierta que hace la campana
/// (`bell::elapsed_today`). Si cada una calculara su propio "hoy", el contador y
/// la campana hablarían de días distintos.
pub(crate) fn start_of_today() -> DateTime<Utc> {
    let now = chrono::Local::now();
    now.date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|naive| now.timezone().from_local_datetime(&naive).single())
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(Utc::now)
}

/// Segundos ya registrados **hoy** para una tarea (entradas cerradas).
///
/// El contador del taxímetro se apoya en esto: si una tarea se arrastra al día
/// siguiente, arranca de nuevo en 0 aunque su total acumulado sea mayor.
pub fn seconds_today(conn: &Connection, task_id: i64) -> Result<i64> {
    // `MAX(0, …)` como red de seguridad. Un ajuste manual hacia abajo se guarda
    // como una entrada con delta **negativo** (ver `set_actual_seconds`), y si
    // ese recorte es mayor que lo trackeado hoy la suma se va a negativo. Eso
    // llegaba como `base_seconds` al taxímetro y se veía un contador en negativo
    // ("-14:-17:-39"). Un tiempo trabajado negativo no es correcto nunca, así
    // que el piso va acá y no en quien lo muestra.
    conn.query_row(
        "SELECT MAX(0, COALESCE(SUM(seconds), 0)) FROM time_entries
         WHERE task_id = ?1 AND ended_at IS NOT NULL AND started_at >= ?2",
        params![task_id, start_of_today().to_rfc3339()],
        |r| r.get(0),
    )
}

/// Devuelve el timer en curso (entrada sin `ended_at`), si existe.
pub fn get_active_timer(conn: &Connection) -> Result<Option<ActiveTimer>> {
    let row = conn
        .query_row(
            "SELECT e.id AS entry_id, e.task_id, e.started_at, t.title, t.estimated_minutes
             FROM time_entries e
             JOIN tasks t ON t.id = e.task_id
             WHERE e.ended_at IS NULL
             ORDER BY e.id DESC LIMIT 1",
            [],
            |r| {
                Ok((
                    r.get::<_, i64>("entry_id")?,
                    r.get::<_, i64>("task_id")?,
                    r.get::<_, String>("title")?,
                    r.get::<_, String>("started_at")?,
                    r.get::<_, Option<i64>>("estimated_minutes")?,
                ))
            },
        )
        .optional()?;

    let Some((entry_id, task_id, title, started_at, estimated_minutes)) = row else {
        return Ok(None);
    };

    Ok(Some(ActiveTimer {
        entry_id,
        task_id,
        title,
        started_at,
        base_seconds: seconds_today(conn, task_id)?,
        estimated_minutes,
    }))
}

/// Inicia el timer en `task_id`. Solo puede haber uno activo: si había otro
/// corriendo, lo cierra antes.
///
/// Si la tarea estaba completada, **la reabre**: volver a trabajar en algo es
/// decir que no estaba terminado. Sin esto quedaría acumulando tiempo una tarea
/// marcada como cerrada, y encima fuera de la cola de Focus mientras se trabaja
/// en ella. Es la regla simétrica de `set_task_status`, que detiene el timer al
/// completar, y vive acá por el mismo motivo: para que valga desde la semana,
/// Today, Focus, el modal y el taxímetro sin repetirla en cada vista.
pub fn start_timer(conn: &Connection, task_id: i64) -> Result<ActiveTimer> {
    stop_timer(conn)?;
    // El `AND status = 'DONE'` evita tocar `updated_at` de una tarea que ya
    // estaba pendiente.
    conn.execute(
        "UPDATE tasks SET status = 'TODO', completed_at = NULL, updated_at = ?2
         WHERE id = ?1 AND status = 'DONE'",
        params![task_id, now()],
    )?;
    conn.execute(
        "INSERT INTO time_entries (task_id, started_at, seconds) VALUES (?1, ?2, 0)",
        params![task_id, now()],
    )?;
    Ok(get_active_timer(conn)?.expect("timer recién iniciado"))
}

/// Cierra el timer activo (si hay) y acumula su duración en la tarea.
/// Devuelve `(task_id, seconds)` de lo registrado.
pub fn stop_timer(conn: &Connection) -> Result<Option<(i64, i64)>> {
    let Some(active) = get_active_timer(conn)? else {
        return Ok(None);
    };
    let ended = now();
    let seconds = elapsed_seconds(&active.started_at, &ended);

    // Si la corrida cruzó una medianoche local, se guarda partida por día: la
    // fila abierta se cierra en el primer corte y los tramos siguientes entran
    // como filas nuevas. Así el tiempo queda acreditado al día en que se
    // trabajó. Ver `segments_by_local_day`.
    let rfc = |s: &str| {
        chrono::DateTime::parse_from_rfc3339(s).ok().map(|d| d.with_timezone(&Utc))
    };
    let segments = match (rfc(&active.started_at), rfc(&ended)) {
        (Some(a), Some(b)) => segments_by_local_day(a, b),
        _ => Vec::new(),
    };

    if segments.len() > 1 {
        // El último tramo absorbe el resto para que la suma de las filas dé
        // exactamente lo mismo que `seconds`: truncar cada tramo por separado
        // perdería hasta un segundo por corte, y el total de la tarea dejaría de
        // cuadrar con sus entradas.
        let mut spread = 0i64;
        for (i, (start, end)) in segments.iter().enumerate() {
            let last = i == segments.len() - 1;
            let secs = if last {
                seconds - spread
            } else {
                (*end - *start).num_seconds().max(0)
            };
            spread += secs;

            if i == 0 {
                conn.execute(
                    "UPDATE time_entries SET ended_at = ?2, seconds = ?3 WHERE id = ?1",
                    params![active.entry_id, end.to_rfc3339(), secs],
                )?;
            } else {
                conn.execute(
                    "INSERT INTO time_entries (task_id, started_at, ended_at, seconds)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![active.task_id, start.to_rfc3339(), end.to_rfc3339(), secs],
                )?;
            }
        }
    } else {
        conn.execute(
            "UPDATE time_entries SET ended_at = ?2, seconds = ?3 WHERE id = ?1",
            params![active.entry_id, ended, seconds],
        )?;
    }
    // El total de la tarea ACUMULA lo trabajado. No se recalcula desde las
    // entradas: eso pisaría los ajustes manuales de tiempo.
    conn.execute(
        "UPDATE tasks SET actual_seconds = actual_seconds + ?2, updated_at = ?3 WHERE id = ?1",
        params![active.task_id, seconds, now()],
    )?;
    Ok(Some((active.task_id, seconds)))
}

/// Parte un intervalo en tramos, uno por cada día **local** que toca.
///
/// Un intervalo que no cruza ninguna medianoche devuelve un solo tramo idéntico
/// al de entrada, así que el caso normal no cambia en nada.
///
/// Existe porque el tiempo se atribuye por `time_entries.started_at`: una fila
/// que empieza a las 21:52 y termina a las 13:17 del día siguiente le acredita
/// sus 15 horas al primer día y cero al segundo. Eso ya rompía el contador del
/// taxímetro y va a romper igual el rollup diario de M3, que agrupa por día
/// leyendo esta tabla. Partir las filas deja correcto cualquier
/// `GROUP BY date(started_at)`, sin que quien lo escriba tenga que saber nada de
/// esto.
fn segments_by_local_day(
    start: chrono::DateTime<Utc>,
    end: chrono::DateTime<Utc>,
) -> Vec<(chrono::DateTime<Utc>, chrono::DateTime<Utc>)> {
    if end <= start {
        return vec![(start, end)];
    }

    let mut segments = Vec::new();
    let mut cursor = start;
    // Tope de seguridad: un timer olvidado un año no debe colgar el cierre.
    for _ in 0..400 {
        match next_local_midnight(cursor) {
            Some(cutoff) if cutoff < end => {
                segments.push((cursor, cutoff));
                cursor = cutoff;
            }
            _ => break,
        }
    }
    segments.push((cursor, end));
    segments
}

/// Primera medianoche local **estrictamente posterior** a `t`.
fn next_local_midnight(t: chrono::DateTime<Utc>) -> Option<chrono::DateTime<Utc>> {
    let local = t.with_timezone(&chrono::Local);
    let tomorrow = local.date_naive().succ_opt()?.and_hms_opt(0, 0, 0)?;
    // `single()` no alcanza: en el salto de horario de verano la medianoche local
    // puede no existir o existir dos veces, y ahí `earliest()` da un corte
    // válido en vez de abandonar el partido.
    let split = chrono::Local
        .from_local_datetime(&tomorrow)
        .single()
        .or_else(|| chrono::Local.from_local_datetime(&tomorrow).earliest())?;
    Some(split.with_timezone(&Utc))
}

/// Segundos entre dos timestamps RFC3339 (0 si no parsean o el orden es inverso).
fn elapsed_seconds(start: &str, end: &str) -> i64 {
    let parse = |s: &str| chrono::DateTime::parse_from_rfc3339(s).ok();
    match (parse(start), parse(end)) {
        (Some(a), Some(b)) => (b - a).num_seconds().max(0),
        _ => 0,
    }
}

/// Fija el tiempo real total de una tarea (ajuste manual).
///
/// Además de guardar el total, registra la diferencia como entradas cerradas: así
/// el rollup semanal sigue cuadrando y el contador del día refleja el ajuste
/// (p. ej. cuando olvidaste encender el taxímetro).
///
/// **Subir es una entrada; recortar pueden ser varias**, y eso no es simetría
/// perdida sino la única forma de que el reparto por día quede bien: ver
/// `spread_cut`.
pub fn set_actual_seconds(conn: &Connection, task_id: i64, seconds: i64) -> Result<Option<Task>> {
    let seconds = seconds.max(0);
    let fila: Option<(i64, Option<String>, Option<String>)> = conn
        .query_row(
            "SELECT actual_seconds, scheduled_date, scheduled_time FROM tasks WHERE id = ?1",
            [task_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let (current, date, time) = fila.unwrap_or((0, None, None));

    let delta = seconds - current;
    let stamp = adjustment_stamp(date.as_deref(), time.as_deref());
    let filas: Vec<(String, i64)> = match delta {
        0 => Vec::new(),
        d if d > 0 => vec![(stamp, d)],
        d => spread_cut(conn, task_id, -d, &stamp)?
            .into_iter()
            .map(|(ts, cut)| (ts, -cut))
            .collect(),
    };
    for (ts, amount) in filas {
        conn.execute(
            "INSERT INTO time_entries (task_id, started_at, ended_at, seconds)
             VALUES (?1, ?2, ?2, ?3)",
            params![task_id, ts, amount],
        )?;
    }

    conn.execute(
        "UPDATE tasks SET actual_seconds = ?2, updated_at = ?3 WHERE id = ?1",
        params![task_id, seconds, now()],
    )?;
    get_task(conn, task_id)
}

/// Reparte un recorte de tiempo entre los días que la tarea tiene trabajados, sin
/// dejar ninguno en negativo. Devuelve `(started_at, segundos a restar)`, siempre
/// positivos.
///
/// **Por qué no alcanza una sola fila.** El recorte se sella con el día de la
/// tarea (Mej.14), pero el trabajo puede estar repartido en varios días: un timer
/// que se quedó prendido cruza la medianoche y `stop_timer` lo parte en un tramo
/// por día local. Un recorte de 21 horas fechado el domingo contra un domingo que
/// solo tiene 14 dejaba ese día en −7 horas, y el piso en 0 de todo lo que agrupa
/// por día (`work_by_day`, `seconds_today`) se comía el sobrante en silencio: el
/// total de la tarea quedaba bien y el lunes seguía mostrando las horas del timer
/// olvidado. Era el rollup semanal contando 15 horas de una tarea de 3.
///
/// **El orden importa y es una decisión, no un detalle.** No hay dato que diga
/// qué horas fueron reales —un timer olvidado no deja evidencia—, así que:
///
/// 1. **Primero el día de la tarea**, que es el que el ajuste dice corregir. Es la
///    regla de Mej.14 extendida al caso en que el recorte desborda.
/// 2. **Después el resto, del más reciente al más viejo**: el trabajo de la punta
///    es el candidato más probable a ser el que sobra.
///
/// Con eso, lo que queda vivo después del recorte se concentra en el trabajo más
/// antiguo, y el día de la tarea muestra lo mismo que la card.
///
/// **Si el recorte supera todo lo que hay repartido, el sobrante se descarta.**
/// Pasa en una base vieja donde `actual_seconds` dice más de lo que suman las
/// entradas. Es tentador escribirlo igual para que la suma cuadre con el total,
/// pero eso es literalmente el bug de arriba: una fila negativa sin saldo que la
/// respalde deja el día bajo cero. Y no hace falta, porque `actual_seconds` es el
/// total de la tarea por derecho propio —no se recalcula desde las entradas, que
/// es lo que protege `ajuste_manual_del_tiempo_sobrevive_a_start_stop`—; las
/// entradas responden otra pregunta, **qué día se trabajó**, y ahí no hay día que
/// pueda hacerse cargo de horas que nunca se registraron.
fn spread_cut(conn: &Connection, task_id: i64, cut: i64, stamp: &str) -> Result<Vec<(String, i64)>> {
    use std::collections::HashMap;

    /// El día local de un timestamp UTC, o `None` si no parsea.
    fn local_day(s: &str) -> Option<String> {
        to_utc(s).map(|t| t.with_timezone(&chrono::Local).date_naive().to_string())
    }

    // Saldo por día local, y con qué timestamp sellar el recorte de ese día: el
    // último de sus tramos, que está dentro del día por construcción. Fabricar
    // una medianoche sería pedirle una hora al calendario que en el cambio de
    // horario puede no existir.
    let mut stmt = conn.prepare(
        "SELECT started_at, seconds FROM time_entries
         WHERE task_id = ?1 AND ended_at IS NOT NULL ORDER BY started_at",
    )?;
    let rows = stmt.query_map([task_id], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
    })?;
    let mut balances: HashMap<String, (String, i64)> = HashMap::new();
    for row in rows {
        let (started_at, seconds) = row?;
        let Some(day) = local_day(&started_at) else { continue };
        let cell = balances.entry(day).or_insert((started_at.clone(), 0));
        cell.0 = started_at;
        cell.1 += seconds;
    }

    let target = local_day(stamp);
    let mut order: Vec<String> = balances
        .keys()
        .filter(|d| Some(*d) != target.as_ref())
        .cloned()
        .collect();
    order.sort_by(|a, b| b.cmp(a));
    if let Some(day) = target.clone() {
        order.insert(0, day);
    }

    let mut left = cut;
    let mut out = Vec::new();
    for day in order {
        if left <= 0 {
            break;
        }
        let Some((ts, balance)) = balances.get(&day) else { continue };
        let take = left.min((*balance).max(0));
        if take > 0 {
            out.push((ts.clone(), take));
            left -= take;
        }
    }
    // `left > 0` acá es el sobrante sin día: se descarta a propósito (ver arriba).
    Ok(out)
}

/// Cuándo se acredita un ajuste manual de tiempo: **el día de la tarea**, no el
/// día en que abriste el modal.
///
/// El ajuste se guarda como una entrada de `time_entries` (es lo que hace que el
/// total siempre salga de las entradas y no de un campo suelto), y todo lo que
/// agrupa por día lo hace por `started_at` en hora local: el rail (`day_work`) y
/// el rollup semanal (Regla 2, §4.15). Sellarlo con `now()` metía las horas en el
/// día en que las escribiste: corregir el lunes una reunión del sábado dejaba el
/// rail del sábado sin verlas y, si el ajuste cruzaba el domingo, el rollup las
/// contaba en la semana equivocada.
///
/// Tres detalles que no son adorno:
///
/// - **Mediodía y no medianoche.** Chile cambia la hora, y en el salto de
///   primavera la medianoche local **no existe**: la conversión devuelve `None` y
///   habría que decidir algo ahí. El mediodía existe todos los días del año.
/// - **Si la tarea tiene hora, se usa esa.** Es el caso que motiva la corrección
///   —una reunión— y así el bloque del rail cae donde ocurrió en vez de a
///   mediodía. Cuando la tarea ya tiene entradas reales de ese día no cambia
///   nada: `day_work` dibuja desde `MIN(started_at)`.
/// - **Una tarea futura se acredita a hoy.** Mañana no se trabajó, y fechar ahí
///   dejaría horas "trabajadas" adelante del reloj sumando en un rollup futuro.
///
/// Consecuencia asumida: un ajuste sobre una tarea de otro día **ya no cuenta en
/// el contador del taxímetro**, que mide `started_at >= start_of_today()`. Es lo
/// correcto —ese contador es el de la sesión de hoy— pero antes sí aparecía ahí.
fn adjustment_stamp(date: Option<&str>, time: Option<&str>) -> String {
    let Some(day) = date.and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok()) else {
        return now();
    };
    if day > chrono::Local::now().date_naive() {
        return now();
    }

    let hhmm = time.and_then(|t| {
        let (h, m) = t.split_once(':')?;
        Some((h.trim().parse::<u32>().ok()?, m.trim().parse::<u32>().ok()?))
    });
    // El mediodía es el respaldo de las dos ramas: sin hora, y con una hora que
    // esa fecha no tuvo (el salto de DST se come una hora entera).
    let local = hhmm
        .and_then(|(h, m)| day.and_hms_opt(h, m, 0))
        .and_then(|naive| chrono::Local.from_local_datetime(&naive).earliest())
        .or_else(|| {
            day.and_hms_opt(12, 0, 0)
                .and_then(|naive| chrono::Local.from_local_datetime(&naive).earliest())
        });

    match local {
        Some(dt) => dt.with_timezone(&Utc).to_rfc3339(),
        None => now(),
    }
}

pub fn list_time_entries(conn: &Connection, task_id: i64) -> Result<Vec<TimeEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, started_at, ended_at, seconds
         FROM time_entries WHERE task_id = ?1 ORDER BY started_at, id",
    )?;
    let rows = stmt.query_map([task_id], TimeEntry::from_row)?.collect();
    rows
}

/// Qué se trabajó en un día local, por tarea.
///
/// El rail de calendario lo usa para dibujar **lo que pasó** en vez de lo
/// planificado: una reunión de 15 minutos que terminó durando 18 y arrancó 46
/// minutos tarde tiene que verse donde ocurrió, no donde decía el calendario.
///
/// El día se acota en **hora local**, y no cortando el `started_at` por los
/// primeros 10 caracteres: los timestamps están en UTC, así que en Chile todo lo
/// trabajado después de las 20:00 se iría al día siguiente. Es la misma trampa
/// que ya se pagó en `completeAndAdvance` y en `timeByDay`.
///
/// Cada entrada cerrada cae entera dentro de un día porque `stop_timer` las
/// parte en la medianoche local (ver `segments_by_local_day`), así que agrupar
/// por `started_at` alcanza y no hay que volver a partir nada acá.
///
/// **`tracked_at` sale solo de las corridas del taxímetro, no de los ajustes a
/// mano.** Un ajuste se guarda como una entrada con `ended_at = started_at`
/// sellada al mediodía local de la tarea (`adjustment_stamp`): ese sello es
/// contable, no es la hora en que pasó algo. Con un `MIN(started_at)` sobre todo,
/// una tarea trabajada a las 15:41 y corregida después a mano se dibujaba a las
/// 12:00, y un día con varias correcciones apilaba todas sus tareas en la misma
/// hora inventada. `seconds` sí suma los ajustes: el total es correcto, lo que no
/// se sabe es a qué hora ocurrió.
pub fn day_work(conn: &Connection, date: &str) -> Result<Vec<DayWork>> {
    let (from_date, to_date) = utc_range_of_day(date);
    let mut stmt = conn.prepare(
        "SELECT task_id,
                MIN(CASE WHEN ended_at IS NULL OR ended_at <> started_at
                         THEN started_at END) AS tracked_at,
                COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN seconds ELSE 0 END), 0) AS seconds,
                MAX(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS running
         FROM time_entries
         WHERE started_at >= ?1 AND started_at < ?2
         GROUP BY task_id
         ORDER BY MIN(started_at)",
    )?;
    let rows = stmt.query_map(params![from_date, to_date], |r| {
        Ok(DayWork {
            task_id: r.get("task_id")?,
            tracked_at: r.get("tracked_at")?,
            // Piso en 0 por lo mismo que `seconds_today`: un ajuste manual hacia
            // abajo se guarda como delta negativo y podría dejar la suma bajo 0.
            seconds: std::cmp::max(0, r.get::<_, i64>("seconds")?),
            running: r.get::<_, i64>("running")? == 1,
        })
    })?;
    rows.collect()
}

/// `'2026-08-15'` → el par `[00:00, 24:00)` de ese día **local**, en UTC.
fn utc_range_of_day(date: &str) -> (String, String) {
    let day = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d");
    let midnight = day.ok().and_then(|d| {
        let naive = d.and_hms_opt(0, 0, 0)?;
        chrono::Local.from_local_datetime(&naive).single()
    });
    match midnight {
        Some(start) => (
            start.with_timezone(&Utc).to_rfc3339(),
            (start + chrono::Duration::days(1))
                .with_timezone(&Utc)
                .to_rfc3339(),
        ),
        // Fecha ilegible: un rango vacío devuelve cero filas en vez de todas.
        None => (String::new(), String::new()),
    }
}

// ---------------------------------------------------------------------------
// Rollup semanal (weekly review)
// ---------------------------------------------------------------------------

/// RFC 3339 → `DateTime<Utc>`, o `None` si no parsea.
fn to_utc(s: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// `n` días desde `desde`, cada uno con su ventana `[00:00, 24:00)` **local**
/// expresada en UTC.
///
/// Es el corazón de la Regla 2: `started_at` está en UTC, así que agrupar con
/// `date(started_at)` o `substr(started_at,1,10)` manda al día siguiente todo lo
/// trabajado después de las 20:00 en Chile. La misma trampa que ya se pagó en
/// `day_work`, `completeAndAdvance` y `timeByDay`.
fn local_days(
    from_date: &str,
    n: i64,
) -> Vec<(String, chrono::DateTime<Utc>, chrono::DateTime<Utc>)> {
    let Ok(first) = chrono::NaiveDate::parse_from_str(from_date, "%Y-%m-%d") else {
        return Vec::new();
    };
    let midnight = |d: chrono::NaiveDate| -> Option<chrono::DateTime<Utc>> {
        let naive = d.and_hms_opt(0, 0, 0)?;
        // `single()` no alcanza en el salto de horario: ver `next_local_midnight`.
        chrono::Local
            .from_local_datetime(&naive)
            .single()
            .or_else(|| chrono::Local.from_local_datetime(&naive).earliest())
            .map(|dt| dt.with_timezone(&Utc))
    };

    (0..n)
        .filter_map(|i| {
            let day = first.checked_add_signed(chrono::Duration::days(i))?;
            let next = day.succ_opt()?;
            Some((
                day.format("%Y-%m-%d").to_string(),
                midnight(day)?,
                midnight(next)?,
            ))
        })
        .collect()
}

type Semana = [(String, chrono::DateTime<Utc>, chrono::DateTime<Utc>)];

/// En qué día de la semana cae un instante, o `None` si queda fuera.
fn day_index(week: &Semana, t: chrono::DateTime<Utc>) -> Option<usize> {
    week.iter().position(|(_, start, end)| t >= *start && t < *end)
}

/// El rollup de una semana: trabajado por día y categoría, planificado, y lo que
/// se cerró.
///
/// Tres reglas lo definen, y las tres son fáciles de romper sin que nada falle:
///
/// - **Regla 2 — el tiempo se atribuye por `time_entries.started_at`**, nunca por
///   `scheduled_date`. Mover una tarea a otra semana no puede cambiar las horas
///   de una semana pasada: ya ocurrieron.
/// - **Regla 3 — las reuniones sin `time_entries` cuentan su duración de
///   evento.** Estuviste ahí aunque no encendieras el taxímetro. Las entradas
///   reales priman: basta una para que la reunión deje de usar el respaldo.
/// - **Acá NO se filtra `source_state = 'ACTIVE'` para el tiempo.** Es el único
///   listado del proyecto que quiere las `ORPHANED`: existen justamente para el
///   historial y la review, y filtrarlas borraría horas reales de semanas
///   pasadas.
///
/// Lo planificado sí sale de `scheduled_date`, así que **planificado y trabajado
/// no se mueven juntos**: replanificar una tarea cambia su barra de plan pero no
/// la de horas. Es correcto, no un bug (SPECS §4.15).
/// Una fila de trabajo: qué tarea, en qué día del rango, cuánto y desde cuándo.
struct TrabajoFila {
    day: usize,
    task_id: i64,
    title: String,
    category_id: Option<i64>,
    context_id: Option<i64>,
    /// El objetivo del que cuelga la tarea, para el corte objetivos/resto de la
    /// review. Va en las **dos** consultas de abajo: si solo estuviera en la de
    /// `time_entries`, una reunión de calendario nunca contaría como trabajo de
    /// objetivo.
    objective_id: Option<i64>,
    /// Segundos de las entradas **cerradas**, con piso en 0.
    seconds: i64,
    /// Hay una corrida abierta de ese día: sus segundos los suma el front desde
    /// el taxímetro.
    running: bool,
    /// El primer inicio del día, para ordenar el timeline.
    start: String,
}

/// El trabajo de un rango de días, bucketeado por día **local** y por tarea.
///
/// **Es el único lugar donde viven las partes frágiles de todo rollup**, y por
/// eso lo comparten la weekly review y la bitácora en vez de tener cada una su
/// consulta:
///
/// - **El día es local.** Nunca `date(started_at)`: los timestamps son UTC y en
///   Chile todo lo trabajado después de las 20:00 se iría al día siguiente.
/// - **Regla 2**: se atribuye por `started_at`, no por `scheduled_date`.
/// - **Regla 3**: una reunión sin **ninguna** entrada cuenta su duración de
///   evento, acreditada al día local de `event_start` y solo si ya empezó.
/// - **No filtra `source_state`**: las `ORPHANED` son historial (I7).
/// - **El piso en 0 va por tarea y por día**, porque un ajuste manual hacia
///   abajo se guarda como una entrada con delta negativo.
fn work_by_day(conn: &Connection, days: &Semana) -> Result<Vec<TrabajoFila>> {
    use std::collections::HashMap;

    if days.is_empty() {
        return Ok(Vec::new());
    }
    let from_date = days[0].1.to_rfc3339();
    let to_date = days[days.len() - 1].2.to_rfc3339();
    let mut acc: HashMap<(usize, i64), TrabajoFila> = HashMap::new();

    let mut stmt = conn.prepare(
        "SELECT e.task_id, e.started_at, e.ended_at, e.seconds,
                t.title AS title,
                t.category_id AS category_id,
                t.objective_id AS objective_id,
                COALESCE(c.parent_id, c.id) AS context_id
           FROM time_entries e
           JOIN tasks t ON t.id = e.task_id
           LEFT JOIN categories c ON c.id = t.category_id
          WHERE e.started_at >= ?1 AND e.started_at < ?2",
    )?;
    let rows = stmt.query_map(params![from_date, to_date], |r| {
        Ok((
            r.get::<_, i64>("task_id")?,
            r.get::<_, String>("started_at")?,
            r.get::<_, Option<String>>("ended_at")?,
            r.get::<_, i64>("seconds")?,
            r.get::<_, String>("title")?,
            r.get::<_, Option<i64>>("category_id")?,
            r.get::<_, Option<i64>>("objective_id")?,
            r.get::<_, Option<i64>>("context_id")?,
        ))
    })?;
    for row in rows {
        let (task_id, started_at, ended_at, seconds, title, category_id, objective_id, context_id) =
            row?;
        let Some(t) = to_utc(&started_at) else { continue };
        let Some(i) = day_index(days, t) else { continue };
        let entry = acc.entry((i, task_id)).or_insert(TrabajoFila {
            day: i,
            task_id,
            title,
            category_id,
            context_id,
            objective_id,
            seconds: 0,
            running: false,
            start: started_at.clone(),
        });
        if started_at < entry.start {
            entry.start = started_at;
        }
        match ended_at {
            Some(_) => entry.seconds += seconds,
            None => entry.running = true,
        }
    }

    // Regla 3. Va acá y no en la consulta de arriba porque depende de que la
    // tarea no tenga **ninguna** entrada: basta una para que ese respaldo
    // sobre, o la reunión contaría dos veces.
    let now = Utc::now();
    let mut stmt = conn.prepare(
        "SELECT t.id, t.title AS title, t.event_start, t.event_end,
                t.category_id AS category_id,
                t.objective_id AS objective_id,
                COALESCE(c.parent_id, c.id) AS context_id
           FROM tasks t
           LEFT JOIN categories c ON c.id = t.category_id
          WHERE t.source = 'CALENDAR' AND t.source_state = 'ACTIVE'
            AND t.rail_only = 0
            AND t.event_start IS NOT NULL AND t.event_end IS NOT NULL
            AND t.event_start >= ?1 AND t.event_start < ?2
            AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id = t.id)",
    )?;
    let meetings = stmt.query_map(params![from_date, to_date], |r| {
        Ok((
            r.get::<_, i64>("id")?,
            r.get::<_, String>("title")?,
            r.get::<_, String>("event_start")?,
            r.get::<_, String>("event_end")?,
            r.get::<_, Option<i64>>("category_id")?,
            r.get::<_, Option<i64>>("objective_id")?,
            r.get::<_, Option<i64>>("context_id")?,
        ))
    })?;
    for row in meetings {
        let (id, title, start, end, category_id, objective_id, context_id) = row?;
        let (Some(a), Some(b)) = (to_utc(&start), to_utc(&end)) else { continue };
        if a > now {
            continue;
        }
        let Some(i) = day_index(days, a) else { continue };
        acc.insert(
            (i, id),
            TrabajoFila {
                day: i,
                task_id: id,
                title,
                category_id,
                context_id,
                objective_id,
                seconds: (b - a).num_seconds().max(0),
                running: false,
                start: start,
            },
        );
    }

    let mut rows: Vec<TrabajoFila> = acc
        .into_values()
        .map(|mut f| {
            f.seconds = f.seconds.max(0);
            f
        })
        .collect();
    // Orden estable: el HashMap no lo tiene, y el timeline se lee en el orden en
    // que se tomó el trabajo.
    rows.sort_by(|x, y| (x.day, &x.start, x.task_id).cmp(&(y.day, &y.start, y.task_id)));
    Ok(rows)
}

/// Lo planificado y lo sin estimar de cada día del rango, por `scheduled_date`.
fn plan_by_day(conn: &Connection, days: &Semana) -> Result<Vec<(i64, i64)>> {
    let mut plan = vec![(0i64, 0i64); days.len()];
    if days.is_empty() {
        return Ok(plan);
    }
    let mut stmt = conn.prepare(
        "SELECT scheduled_date, estimated_minutes, source, event_start, event_end
           FROM tasks
          WHERE source_state = 'ACTIVE' AND rail_only = 0
            AND scheduled_date >= ?1 AND scheduled_date <= ?2",
    )?;
    let plans = stmt.query_map(params![days[0].0, days[days.len() - 1].0], |r| {
        Ok((
            r.get::<_, String>("scheduled_date")?,
            r.get::<_, Option<i64>>("estimated_minutes")?,
            r.get::<_, String>("source")?,
            r.get::<_, Option<String>>("event_start")?,
            r.get::<_, Option<String>>("event_end")?,
        ))
    })?;
    for row in plans {
        let (date, estimated, source, start, end) = row?;
        let Some(i) = days.iter().position(|(d, _, _)| *d == date) else { continue };
        // Una reunión sin estimar dura lo que dura: eso ya está planificado por
        // el calendario. Una tarea manual sin estimar **se cuenta y se avisa**,
        // no se rellena con un número inventado (misma regla que el semáforo).
        let minutes = estimated.or_else(|| {
            if source != "CALENDAR" {
                return None;
            }
            let (a, b) = (to_utc(start.as_deref()?)?, to_utc(end.as_deref()?)?);
            Some((b - a).num_minutes().max(0))
        });
        match minutes {
            Some(m) => plan[i].0 += m,
            None => plan[i].1 += 1,
        }
    }
    Ok(plan)
}

/// El rollup de una semana: trabajado por día y categoría, planificado, y lo que
/// se cerró.
///
/// Las reglas del rollup viven en `work_by_day`, que comparte con la
/// bitácora. Lo propio de acá es la vuelta a **celdas día × categoría** para los
/// gráficos.
///
/// Toma su semana **literal**: son los 7 días desde `week_start`, sin encajar al
/// lunes ISO. El gemelo de `mockDb.ts` hace lo mismo.
///
/// Lo planificado sale de `scheduled_date`, así que **planificado y trabajado no
/// se mueven juntos**: replanificar una tarea cambia su barra de plan pero no la
/// de horas. Es correcto, no un bug (SPECS §4.15).
pub fn weekly_rollup(conn: &Connection, week_start: &str) -> Result<WeeklyRollup> {
    use std::collections::HashMap;

    let week = local_days(week_start, 7);
    if week.is_empty() {
        return Ok(WeeklyRollup {
            week_start: week_start.to_string(),
            days: Vec::new(),
            cells: Vec::new(),
            completed_tasks: Vec::new(),
            total_seconds: 0,
            planned_minutes: 0,
            unestimated: 0,
            objective_seconds: 0,
            by_objective: Vec::new(),
        });
    }

    // (día, categoría) → segundos, con el piso por tarea ya aplicado.
    let mut accumulated: HashMap<(usize, Option<i64>), (Option<i64>, i64)> = HashMap::new();
    // objetivo → segundos. Se llena en la misma pasada para no escribir una
    // segunda consulta del trabajo: las reglas de atribución viven en
    // `work_by_day` y duplicarlas es cómo se separan.
    let mut per_objective: HashMap<i64, i64> = HashMap::new();
    for f in work_by_day(conn, &week)? {
        let entry = accumulated
            .entry((f.day, f.category_id))
            .or_insert((f.context_id, 0));
        entry.1 += f.seconds;
        if let Some(objective_id) = f.objective_id {
            *per_objective.entry(objective_id).or_insert(0) += f.seconds;
        }
    }

    let mut by_objective: Vec<ObjectiveWork> = per_objective
        .into_iter()
        .filter(|(_, seconds)| *seconds > 0)
        .map(|(objective_id, seconds)| ObjectiveWork {
            objective_id,
            seconds,
        })
        .collect();
    // Orden estable: el más trabajado primero, y el id desempata para que la
    // lista no cambie de orden entre recargas.
    by_objective.sort_by(|a, b| {
        b.seconds
            .cmp(&a.seconds)
            .then(a.objective_id.cmp(&b.objective_id))
    });
    let objective_seconds: i64 = by_objective.iter().map(|o| o.seconds).sum();

    let mut cells: Vec<RollupCell> = accumulated
        .into_iter()
        .filter(|(_, (_, seconds))| *seconds > 0)
        .map(|((i, category_id), (context_id, seconds))| RollupCell {
            date: week[i].0.clone(),
            category_id,
            context_id,
            seconds,
        })
        .collect();
    // Orden estable: sin esto las barras apiladas cambian de orden entre
    // recargas.
    cells.sort_by(|a, b| {
        (&a.date, a.category_id.unwrap_or(0)).cmp(&(&b.date, b.category_id.unwrap_or(0)))
    });

    let plan = plan_by_day(conn, &week)?;
    let completed_tasks = completed_in_range(conn, &week)?;

    let mut done = vec![0i64; week.len()];
    for t in &completed_tasks {
        if let Some(i) = t
            .completed_at
            .as_deref()
            .and_then(to_utc)
            .and_then(|c| day_index(&week, c))
        {
            done[i] += 1;
        }
    }

    let days: Vec<RollupDay> = week
        .iter()
        .enumerate()
        .map(|(i, (date, _, _))| RollupDay {
            date: date.clone(),
            seconds: cells.iter().filter(|c| c.date == *date).map(|c| c.seconds).sum(),
            planned_minutes: plan[i].0,
            done: done[i],
            unestimated: plan[i].1,
        })
        .collect();

    Ok(WeeklyRollup {
        week_start: week_start.to_string(),
        total_seconds: days.iter().map(|d| d.seconds).sum(),
        planned_minutes: days.iter().map(|d| d.planned_minutes).sum(),
        unestimated: days.iter().map(|d| d.unestimated).sum(),
        objective_seconds,
        by_objective,
        days,
        cells,
        completed_tasks,
    })
}

/// Lo que se cerró dentro del rango, en orden de cierre.
fn completed_in_range(conn: &Connection, days: &Semana) -> Result<Vec<Task>> {
    if days.is_empty() {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLS} FROM tasks
          WHERE status = 'DONE' AND completed_at >= ?1 AND completed_at < ?2
          ORDER BY completed_at, id"
    ))?;
    let from_date = days[0].1.to_rfc3339();
    let to_date = days[days.len() - 1].2.to_rfc3339();
    let rows = stmt.query_map(params![from_date, to_date], Task::from_row)?.collect();
    rows
}

// ---------------------------------------------------------------------------
// Bitácora y cierre del día (daily highlights / shutdown)
// ---------------------------------------------------------------------------

/// Los `dias` días que **terminan** en `hasta`, del más nuevo al más viejo.
///
/// La bitácora **se arma sola**: sale del trabajo y de las tareas cerradas, no de
/// haber pasado por el shutdown. `day_entries` solo aporta la nota y el cierre,
/// así que un día sin fila igual aparece —como borrador— y los días anteriores a
/// que existiera la tabla también.
pub fn daily_log(conn: &Connection, to_date: &str, days: i64) -> Result<Vec<LogDay>> {
    use std::collections::HashMap;

    let days = days.clamp(1, 90);
    let Ok(end) = chrono::NaiveDate::parse_from_str(to_date, "%Y-%m-%d") else {
        return Ok(Vec::new());
    };
    let Some(start) = end.checked_sub_signed(chrono::Duration::days(days - 1)) else {
        return Ok(Vec::new());
    };
    let range = local_days(&start.format("%Y-%m-%d").to_string(), days);
    if range.is_empty() {
        return Ok(Vec::new());
    }
    let (first, last) = (range[0].0.clone(), range[range.len() - 1].0.clone());

    // Un timeline por día, ya en el orden en que se tomó el trabajo.
    let mut timeline: HashMap<usize, Vec<DaySegment>> = HashMap::new();
    let mut worked = vec![0i64; range.len()];
    // (día, categoría) → segundos, para el donut. Se agrega por tarea antes de
    // sumar a la categoría por lo mismo que en la review: el piso en 0 va a esa
    // granularidad.
    let mut by_category: HashMap<(usize, Option<i64>), (Option<i64>, i64)> = HashMap::new();
    for f in work_by_day(conn, &range)? {
        worked[f.day] += f.seconds;
        let cell = by_category
            .entry((f.day, f.category_id))
            .or_insert((f.context_id, 0));
        cell.1 += f.seconds;
        // Una corrida abierta todavía no sumó segundos, pero el tramo tiene que
        // estar: es justamente la tarea en la que se está trabajando ahora.
        if f.seconds == 0 && !f.running {
            continue;
        }
        timeline.entry(f.day).or_default().push(DaySegment {
            task_id: f.task_id,
            title: f.title,
            seconds: f.seconds,
            running: f.running,
        });
    }

    let mut cells: HashMap<usize, Vec<RollupCell>> = HashMap::new();
    for ((i, category_id), (context_id, seconds)) in by_category {
        if seconds <= 0 {
            continue;
        }
        cells.entry(i).or_default().push(RollupCell {
            date: range[i].0.clone(),
            category_id,
            context_id,
            seconds,
        });
    }
    // Orden estable: el HashMap no lo tiene y el donut cambiaría de orden entre
    // recargas.
    for list in cells.values_mut() {
        list.sort_by_key(|c| c.category_id.unwrap_or(0));
    }

    let plan = plan_by_day(conn, &range)?;

    let mut notes: HashMap<(String, i64), String> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT date, task_id, note FROM day_task_notes WHERE date >= ?1 AND date <= ?2",
    )?;
    for row in stmt.query_map(params![first, last], |r| {
        Ok((
            r.get::<_, String>("date")?,
            r.get::<_, i64>("task_id")?,
            r.get::<_, String>("note")?,
        ))
    })? {
        let (date, task_id, note) = row?;
        notes.insert((date, task_id), note);
    }

    type Entrada = (Option<String>, Option<String>, Option<String>);
    let mut entries: HashMap<String, Entrada> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT date, note, closed_at, mood FROM day_entries WHERE date >= ?1 AND date <= ?2",
    )?;
    for row in stmt.query_map(params![first, last], |r| {
        Ok((
            r.get::<_, String>("date")?,
            r.get::<_, Option<String>>("note")?,
            r.get::<_, Option<String>>("closed_at")?,
            r.get::<_, Option<String>>("mood")?,
        ))
    })? {
        let (date, note, closed_at, mood) = row?;
        entries.insert(date, (note, closed_at, mood));
    }

    // Lo cerrado se agrupa por el día en que se cerró, no por `scheduled_date`:
    // la bitácora responde "qué terminé ese día".
    let mut done: HashMap<usize, Vec<DoneTask>> = HashMap::new();
    for t in completed_in_range(conn, &range)? {
        let Some(i) = t
            .completed_at
            .as_deref()
            .and_then(to_utc)
            .and_then(|c| day_index(&range, c))
        else {
            continue;
        };
        let note = notes.get(&(range[i].0.clone(), t.id)).cloned();
        done.entry(i).or_default().push(DoneTask { task: t, note });
    }

    let mut out: Vec<LogDay> = range
        .iter()
        .enumerate()
        .map(|(i, (date, _, _))| {
            let (note, closed_at, mood) = entries.remove(date).unwrap_or((None, None, None));
            LogDay {
                date: date.clone(),
                note,
                closed_at,
                mood,
                worked_seconds: worked[i],
                planned_minutes: plan[i].0,
                unestimated: plan[i].1,
                done: done.remove(&i).unwrap_or_default(),
                timeline: timeline.remove(&i).unwrap_or_default(),
                cells: cells.remove(&i).unwrap_or_default(),
            }
        })
        .collect();
    // Del más nuevo al más viejo: la bitácora se lee hacia atrás.
    out.reverse();
    Ok(out)
}

/// Escribe (o borra) la reflexión de un día, **sin cerrarlo**.
///
/// El autosave de la vista pasa por acá: escribir no es cerrar. Si fuera lo
/// mismo, teclear una letra en el shutdown ya daría el día por terminado.
pub fn set_day_note(conn: &Connection, date: &str, note: Option<&str>) -> Result<()> {
    let clean = note.map(str::trim).filter(|s| !s.is_empty());
    conn.execute(
        "INSERT INTO day_entries (date, note) VALUES (?1, ?2)
         ON CONFLICT(date) DO UPDATE SET note = excluded.note",
        params![date, clean],
    )?;
    Ok(())
}

/// Cómo estuvo el día, en un emoji. `None` lo borra.
pub fn set_day_mood(conn: &Connection, date: &str, mood: Option<&str>) -> Result<()> {
    let clean = mood.map(str::trim).filter(|s| !s.is_empty());
    conn.execute(
        "INSERT INTO day_entries (date, mood) VALUES (?1, ?2)
         ON CONFLICT(date) DO UPDATE SET mood = excluded.mood",
        params![date, clean],
    )?;
    Ok(())
}

/// Escribe el resumen de una tarea de ese día.
///
/// **Vaciarlo no la quita de la bitácora.** La fila es lo que significa "esta
/// tarea está incluida", así que borrar el texto deja la tarea incluida y sin
/// resumen —el estado normal justo después de apretar "Incluir"—. Sacarla es un
/// gesto aparte (`remove_from_log`), porque incluir y escribir son dos cosas
/// distintas y confundirlas hacía desaparecer la tarea al borrar una palabra.
pub fn set_day_task_note(conn: &Connection, date: &str, task_id: i64, note: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO day_task_notes (date, task_id, note) VALUES (?1, ?2, ?3)
         ON CONFLICT(date, task_id) DO UPDATE SET note = excluded.note",
        params![date, task_id, note.trim()],
    )?;
    Ok(())
}

/// Sube una tarea a la bitácora del día, sin resumen todavía.
///
/// Idempotente: incluir dos veces no pisa lo que ya habías escrito.
pub fn include_in_log(conn: &Connection, date: &str, task_id: i64) -> Result<()> {
    conn.execute(
        "INSERT INTO day_task_notes (date, task_id, note) VALUES (?1, ?2, '')
         ON CONFLICT(date, task_id) DO NOTHING",
        params![date, task_id],
    )?;
    Ok(())
}

/// La saca de la bitácora del día, resumen incluido.
pub fn remove_from_log(conn: &Connection, date: &str, task_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM day_task_notes WHERE date = ?1 AND task_id = ?2",
        params![date, task_id],
    )?;
    Ok(())
}

/// Marca el día como cerrado por el usuario. Devuelve el `closed_at`.
///
/// Es **idempotente y no vuelve a sellar**: si el día ya estaba cerrado se
/// conserva la hora original, porque es el dato interesante ("a qué hora cerré").
pub fn close_day(conn: &Connection, date: &str) -> Result<String> {
    conn.execute(
        "INSERT INTO day_entries (date, closed_at) VALUES (?1, ?2)
         ON CONFLICT(date) DO UPDATE SET closed_at = COALESCE(day_entries.closed_at, excluded.closed_at)",
        params![date, now()],
    )?;
    conn.query_row(
        "SELECT closed_at FROM day_entries WHERE date = ?1",
        [date],
        |r| r.get(0),
    )
}

/// Reabre un día cerrado: vuelve a borrador sin tocar las notas.
pub fn reopen_day(conn: &Connection, date: &str) -> Result<()> {
    conn.execute(
        "UPDATE day_entries SET closed_at = NULL WHERE date = ?1",
        [date],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// task_events (historial de re-planificación)
// ---------------------------------------------------------------------------

fn log_event(
    conn: &Connection,
    task_id: i64,
    kind: &str,
    from_date: Option<&str>,
    to_date: Option<&str>,
) -> Result<()> {
    conn.execute(
        "INSERT INTO task_events (task_id, type, from_date, to_date, at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![task_id, kind, from_date, to_date, now()],
    )?;
    Ok(())
}

pub fn list_task_events(conn: &Connection, task_id: i64) -> Result<Vec<TaskEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, task_id, type, from_date, to_date, at
         FROM task_events WHERE task_id = ?1 ORDER BY at, id",
    )?;
    let rows = stmt.query_map([task_id], TaskEvent::from_row)?.collect();
    rows
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

pub fn list_categories(conn: &Connection) -> Result<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT id, parent_id, name, color, position, archived FROM categories
         WHERE archived = 0 ORDER BY COALESCE(parent_id, id), position, id",
    )?;
    let rows = stmt.query_map([], Category::from_row)?.collect();
    rows
}

pub fn create_category(
    conn: &Connection,
    parent_id: Option<i64>,
    name: &str,
    color: &str,
) -> Result<Category> {
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM categories
             WHERE parent_id IS ?1",
            params![parent_id],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO categories (parent_id, name, color, position) VALUES (?1, ?2, ?3, ?4)",
        params![parent_id, name, color, position],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        "SELECT id, parent_id, name, color, position, archived FROM categories WHERE id=?1",
        [id],
        Category::from_row,
    )
}

pub fn update_category(conn: &Connection, id: i64, name: &str, color: &str) -> Result<()> {
    conn.execute(
        "UPDATE categories SET name=?2, color=?3 WHERE id=?1",
        params![id, name, color],
    )?;
    Ok(())
}

pub fn delete_category(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM categories WHERE id=?1", [id])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------------

const OBJECTIVE_COLS: &str = "id, iso_week, title, position, completed, category_id";

/// Patch de edición, con la misma semántica de tres estados que `TaskPatch`:
/// ausente = no tocar · `null` = poner a NULL · valor = escribir. Sin eso no
/// habría forma de **sacarle** el channel a un objetivo.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectivePatch {
    #[serde(default)]
    pub title: Option<String>,
    /// Mover el objetivo a otra semana ISO. Lo usa "traer a esta semana" desde el
    /// planning de una semana pasada.
    #[serde(default)]
    pub iso_week: Option<String>,
    #[serde(default)]
    pub completed: Option<bool>,
    #[serde(default, deserialize_with = "double_option")]
    pub category_id: Option<Option<i64>>,
}

pub fn list_objectives(conn: &Connection, iso_week: &str) -> Result<Vec<Objective>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {OBJECTIVE_COLS} FROM objectives WHERE iso_week = ?1 ORDER BY position, id"
    ))?;
    let rows = stmt.query_map([iso_week], Objective::from_row)?.collect();
    rows
}

/// Los objetivos de un rango de semanas ISO, inclusivo por los dos lados.
///
/// El `BETWEEN` compara strings y funciona porque `iso_week` es siempre
/// `YYYY-Www` con la semana en dos dígitos (`isoWeekId` en el front la rellena):
/// sin el cero a la izquierda, `2026-W9` caería después de `2026-W10`.
pub fn list_objectives_range(
    conn: &Connection,
    from_week: &str,
    to_week: &str,
) -> Result<Vec<Objective>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {OBJECTIVE_COLS} FROM objectives
         WHERE iso_week BETWEEN ?1 AND ?2 ORDER BY iso_week, position, id"
    ))?;
    let rows = stmt
        .query_map(params![from_week, to_week], Objective::from_row)?
        .collect();
    rows
}

pub fn create_objective(
    conn: &Connection,
    iso_week: &str,
    title: &str,
    category_id: Option<i64>,
) -> Result<Objective> {
    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM objectives WHERE iso_week = ?1",
            [iso_week],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO objectives (iso_week, title, position, category_id) VALUES (?1, ?2, ?3, ?4)",
        params![iso_week, title, position, category_id],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        &format!("SELECT {OBJECTIVE_COLS} FROM objectives WHERE id=?1"),
        [id],
        Objective::from_row,
    )
}

pub fn update_objective(conn: &Connection, id: i64, patch: ObjectivePatch) -> Result<()> {
    if let Some(week) = patch.iso_week {
        // Se **reposiciona al final** de la semana destino. Arrastrar el
        // `position` viejo lo dejaría empatado con un objetivo que ya está ahí, y
        // el `ORDER BY position, id` de `list_objectives` desempataría por id: el
        // recién llegado se metería en medio de la lista sin que nadie lo pida.
        let position: i64 = conn
            .query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM objectives WHERE iso_week = ?1",
                [&week],
                |r| r.get(0),
            )
            .unwrap_or(0);
        conn.execute(
            "UPDATE objectives SET iso_week=?2, position=?3 WHERE id=?1",
            params![id, week, position],
        )?;
    }
    if let Some(t) = patch.title {
        conn.execute("UPDATE objectives SET title=?2 WHERE id=?1", params![id, t])?;
    }
    if let Some(c) = patch.completed {
        conn.execute(
            "UPDATE objectives SET completed=?2 WHERE id=?1",
            params![id, c as i64],
        )?;
    }
    if let Some(cat) = patch.category_id {
        conn.execute(
            "UPDATE objectives SET category_id=?2 WHERE id=?1",
            params![id, cat],
        )?;
    }
    Ok(())
}

pub fn delete_objective(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM objectives WHERE id=?1", [id])?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// Todos los ajustes como pares clave/valor. Son pocos (los siembra la
/// migración 2), así que el front los carga de una y no de a uno.
///
/// Los valores son TEXT: quien los consume se encarga de interpretarlos y de
/// tener un default si la clave falta o trae basura.
pub fn list_settings(conn: &Connection) -> Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT key, value FROM settings ORDER BY key")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>("key")?, r.get::<_, String>("value")?)))?
        .collect();
    rows
}

/// Un ajuste puntual, para el código Rust que necesita uno sin traerse todos.
///
/// Devuelve `None` también cuando el valor está vacío: para todas las claves que
/// existen hoy, "" y "no configurado" significan lo mismo, y así el consumidor
/// no tiene que distinguirlos.
pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?;
    Ok(value.filter(|v| !v.trim().is_empty()))
}

/// Escribe un ajuste (lo crea si no existía).
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Calendar feeds
// ---------------------------------------------------------------------------

pub fn list_calendar_feeds(conn: &Connection) -> Result<Vec<CalendarFeed>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, ics_url, default_category_id, import_as_tasks,
                poll_minutes, last_synced_at, last_error
         FROM calendar_feeds ORDER BY id",
    )?;
    let rows = stmt.query_map([], CalendarFeed::from_row)?.collect();
    rows
}

pub fn get_calendar_feed(conn: &Connection, id: i64) -> Result<Option<CalendarFeed>> {
    conn.query_row(
        "SELECT id, name, ics_url, default_category_id, import_as_tasks,
                poll_minutes, last_synced_at, last_error
         FROM calendar_feeds WHERE id = ?1",
        [id],
        CalendarFeed::from_row,
    )
    .optional()
}

/// Piso del intervalo de sondeo, en minutos.
///
/// Google **no documenta** ningún límite para el endpoint `.ics` —ni la página
/// de cuotas de la API ni la de "use limits" lo mencionan— pero sí dice que
/// throttlea acciones repetidas sin publicar los números. 2 minutos deja margen
/// para forzar cuando hace falta sin quedar a 1440 requests diarios por feed, que
/// está muy por encima de cualquier cliente normal. Lo que de verdad hace que se
/// sienta al día no es el intervalo sino sincronizar al volver a la ventana.
const POLL_MINIMO: i64 = 2;

pub fn create_calendar_feed(
    conn: &Connection,
    name: &str,
    ics_url: &str,
    default_category_id: Option<i64>,
    poll_minutes: i64,
) -> Result<CalendarFeed> {
    conn.execute(
        "INSERT INTO calendar_feeds (name, ics_url, default_category_id, poll_minutes)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            name,
            ics_url.trim(),
            default_category_id,
            poll_minutes.max(POLL_MINIMO)
        ],
    )?;
    let id = conn.last_insert_rowid();
    Ok(get_calendar_feed(conn, id)?.expect("feed recién creado"))
}

pub fn update_calendar_feed(
    conn: &Connection,
    id: i64,
    name: &str,
    ics_url: &str,
    default_category_id: Option<i64>,
    import_as_tasks: bool,
    poll_minutes: i64,
) -> Result<Option<CalendarFeed>> {
    conn.execute(
        "UPDATE calendar_feeds
         SET name = ?2, ics_url = ?3, default_category_id = ?4,
             import_as_tasks = ?5, poll_minutes = ?6
         WHERE id = ?1",
        params![
            id,
            name,
            ics_url.trim(),
            default_category_id,
            import_as_tasks as i64,
            poll_minutes.max(POLL_MINIMO)
        ],
    )?;
    if let Some(cat) = default_category_id {
        apply_default_channel(conn, id, cat)?;
    }
    get_calendar_feed(conn, id)
}

/// Le pone el canal del feed a las reuniones que **todavía no tienen uno**.
///
/// Sin esto, elegir el canal por defecto solo servía para lo que entrara
/// después: las reuniones ya importadas se quedaban sin tag y había que
/// etiquetarlas a mano una por una, que es justo el trabajo que el canal por
/// defecto viene a evitar.
///
/// **Solo toca las que tienen `category_id IS NULL`.** Una reunión que moviste a
/// otro canal a mano no se pisa: esa elección le gana al default del feed, igual
/// que en el upsert de la sincronización.
///
/// Devuelve cuántas cambió.
pub fn apply_default_channel(
    conn: &Connection,
    feed_id: i64,
    category_id: i64,
) -> Result<usize> {
    conn.execute(
        "UPDATE tasks SET category_id = ?2, updated_at = ?3
         WHERE feed_id = ?1 AND category_id IS NULL",
        params![feed_id, category_id, now()],
    )
}

/// Borra el feed. Las tareas importadas **se quedan**: `feed_id` es
/// `ON DELETE SET NULL`, así que pasan a comportarse como tareas normales en vez
/// de desaparecer con el tiempo que tengan trackeado encima.
pub fn delete_calendar_feed(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM calendar_feeds WHERE id = ?1", [id])?;
    Ok(())
}

/// Deja registrado cómo salió la última sincronización.
///
/// `last_synced_at` se sella **siempre**, también cuando falla: es "cuándo lo
/// intenté por última vez", y es lo que necesita el poller para no reintentar en
/// bucle contra un feed caído. Lo que distingue el resultado es `last_error`.
pub fn stamp_feed_sync(conn: &Connection, id: i64, error: Option<&str>) -> Result<()> {
    conn.execute(
        "UPDATE calendar_feeds SET last_synced_at = ?2, last_error = ?3 WHERE id = ?1",
        params![id, now(), error],
    )?;
    Ok(())
}

/// Los participantes como JSON, o `None` si no hay ninguno.
///
/// `None` y no `"[]"`: una lista vacía y "el feed no trae participantes" son lo
/// mismo para quien lee, y `NULL` deja la columna limpia. Un evento de un
/// calendario compartido ocultando detalles cae siempre acá.
fn attendees_json(ps: &[Attendee]) -> Option<String> {
    if ps.is_empty() {
        return None;
    }
    serde_json::to_string(ps).ok()
}

/// Qué hacer con las tareas de un feed que **ya no vienen en él**.
///
/// Es la regla de diseño más delicada del calendario, y es asimétrica a
/// propósito: **borrar es barato de equivocarse y caro de deshacer.**
///
/// **Una tarea con el taxímetro corriendo queda intocada**, ni borrada ni
/// `ORPHANED`: estás trabajando en ella ahora mismo, y sacarla de los listados
/// deja el timer contando sobre algo que ya no puedes ver ni detener desde el
/// tablero.
///
/// Del resto, se borra solo lo que está **intacto y por venir**:
///
/// - **Sin `time_entries`.** Si le pusiste el taxímetro, ese tiempo es tuyo y no
///   lo borra el hecho de que alguien haya cancelado la reunión en Google.
/// - **No completada.** Si la marcaste hecha, es historia y la review la
///   necesita.
/// - **Solo del futuro** (`scheduled_date >= hoy`). Esto no es un detalle: la
///   ventana de import arranca **hoy**, así que cada día las reuniones de ayer
///   dejan de venir en el feed. Sin este filtro, la primera sincronización de
///   cada mañana borraría toda tu historia de reuniones pasadas.
///
/// Lo que no se puede borrar se reparte en dos, según si llegaste a trabajarlo:
///
/// - **Con tiempo trackeado o completada ⇒ se libera del feed**
///   (`feed_id = NULL`, `calendar_uid = NULL`) y **sigue `ACTIVE`**. Dejó de ser
///   del calendario y pasó a ser tuya: la trabajaste. Marcarla `ORPHANED` la
///   sacaba de todos los listados, así que una reunión que hiciste y completaste
///   desaparecía del tablero y del rail al día siguiente —la ventana de import
///   arranca hoy, así que basta con que pase la medianoche. Hay precedente:
///   borrar un feed entero ya deja sus tareas así, vía `ON DELETE SET NULL`.
/// - **Sin trabajar ⇒ queda `ORPHANED`**, como antes. Nunca fue tuya, y sale de
///   los listados sin borrarse.
///
/// Con eso `ORPHANED` significa **una sola cosa**: "nunca se trabajó y no se
/// puede borrar". Antes significaba a la vez "no la planifiques" y "no la
/// muestres", y esas dos no siempre van juntas.
///
/// Devuelve `(borradas, liberadas_o_huerfanas)`.
pub fn reconcile_feed(
    conn: &Connection,
    feed_id: i64,
    seen: &[String],
    today: &str,
) -> Result<Reconciled> {
    // Las que están en la base para este feed y no aparecieron en esta pasada.
    let mut stmt = conn.prepare(
        "SELECT id, calendar_uid, scheduled_date, status, title,
                (SELECT COUNT(*) FROM time_entries e WHERE e.task_id = t.id) AS entradas,
                (SELECT COUNT(*) FROM time_entries e
                  WHERE e.task_id = t.id AND e.ended_at IS NULL) AS corriendo
         FROM tasks t
         WHERE feed_id = ?1 AND calendar_uid IS NOT NULL AND source_state = 'ACTIVE'",
    )?;
    let rows: Vec<(i64, String, Option<String>, String, String, i64, i64)> = stmt
        .query_map([feed_id], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
            ))
        })?
        .collect::<Result<Vec<_>>>()?;

    let seen: std::collections::HashSet<&str> = seen.iter().map(String::as_str).collect();
    let mut out = Reconciled::default();

    for (id, uid, date, status, title, entries, running) in rows {
        if seen.contains(uid.as_str()) {
            continue;
        }
        // **Con el taxímetro corriendo no se toca, ni siquiera para marcarla
        // `ORPHANED`.** Estás trabajando en ella ahora mismo: sacarla de los
        // listados deja el timer contando sobre una tarea que ya no puedes ver
        // ni detener desde el tablero. Cuando la pauses, la próxima
        // sincronización la resolverá como cualquier otra.
        if running > 0 {
            continue;
        }
        let future = date.as_deref().map(|f| f >= today).unwrap_or(false);
        let worked = entries > 0 || status == "DONE";
        let intact = !worked;

        let quien = Afectada {
            title,
            date: date.clone(),
        };

        if future && intact {
            conn.execute("DELETE FROM tasks WHERE id = ?1", [id])?;
            out.deleted.push(quien);
        } else if worked {
            // Se suelta del feed y se queda en el tablero: es tuya. **Y deja
            // de ser un bloque de agenda**: la marca dice "esto lo pone el
            // calendario, no lo planifiques", y una tarea sin feed que la
            // conservara quedaría invisible en el tablero sin forma de
            // recuperarla desde ahí.
            conn.execute(
                "UPDATE tasks SET feed_id = NULL, calendar_uid = NULL, rail_only = 0,
                        updated_at = ?2
                 WHERE id = ?1",
                params![id, now()],
            )?;
            out.released.push(quien);
        } else {
            conn.execute(
                "UPDATE tasks SET source_state = 'ORPHANED', updated_at = ?2 WHERE id = ?1",
                params![id, now()],
            )?;
            out.orphaned.push(quien);
        }
    }

    Ok(out)
}

/// Una tarea que el reconciler tocó, con lo justo para poder nombrarla en el log.
#[derive(Debug, Clone)]
pub struct Afectada {
    pub title: String,
    pub date: Option<String>,
}

impl std::fmt::Display for Afectada {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match &self.date {
            Some(d) => write!(f, "«{}» del {d}", self.title),
            None => write!(f, "«{}»", self.title),
        }
    }
}

/// Qué hizo el reconciler, **con nombres**.
///
/// Antes devolvía solo dos números, y eso alcanzaba hasta el día en que el log
/// dijo "3 borradas" y no había forma de saber cuáles: las filas ya no existen,
/// así que la información se pierde para siempre si no se emite en el momento.
/// Un evento que desaparece del feed casi nunca es un evento borrado —Google
/// parte series, cambia UIDs, mueve instancias—, así que el log tiene que
/// permitir reconstruir qué pasó.
#[derive(Debug, Default, Clone)]
pub struct Reconciled {
    pub deleted: Vec<Afectada>,
    pub released: Vec<Afectada>,
    pub orphaned: Vec<Afectada>,
}

impl Reconciled {
    /// `(borradas, retiradas)`, que es lo que se mira para saber si hubo cambios.
    pub fn totals(&self) -> (usize, usize) {
        (
            self.deleted.len(),
            self.orphaned.len() + self.released.len(),
        )
    }

    pub fn hubo_cambios(&self) -> bool {
        let (a, b) = self.totals();
        a + b > 0
    }
}

/// Lleva la tarea al lugar que le toca **por su hora** dentro de su día.
///
/// El orden de una columna es el del tablero (`position`), y las reuniones
/// entraban al final: llegan del feed en el orden que se le antoja a Google, así
/// que la semana quedaba con la agenda desordenada mientras el rail —que ordena
/// por hora— mostraba otra cosa. Ordenar solo al dibujar no servía: el índice
/// que escribe un arrastre se cuenta contra la lista que se ve, y con las dos
/// listas distintas el arrastre movía la card a un lugar que no era el que
/// soltaste.
///
/// **Solo ordena entre las que tienen hora, y no toca a las demás.** Esa es la
/// mitad del punto: la columna del día es el plan del día, y dónde va una tarea
/// a mano entre dos reuniones lo decides arrastrando. El rail proyecta lo sin
/// hora en ese mismo orden, así que la columna y el rail cuentan la misma
/// historia. Un orden "reuniones primero, tareas después" impuesto por la app
/// haría imposible planificar el día con las cards, que es para lo que están.
///
/// La tarea entra **justo delante del primer evento posterior a su hora**, y si
/// no hay ninguno, al final. Dicho de otro modo: un evento nuevo se abre paso
/// entre otros eventos y **nunca desplaza una tarea tuya**. Entre reuniones el
/// resultado es el mismo que ordenarlas por hora; la diferencia aparece cuando
/// arrastraste algo a un hueco, y ahí gana lo que arrastraste. Un evento de día
/// completo no tiene reloj y va arriba, que es donde el rail lo dibuja (una
/// franja sobre la grilla, no un bloque).
///
/// Se llama solo al importar y al mover un evento de hora o de día: después de
/// eso la columna es tuya y un arrastre no se deshace en la próxima
/// sincronización.
fn place_by_time(conn: &Connection, id: i64, date: &str, hour: Option<&str>) -> Result<()> {
    // El índice se cuenta contra la lista **que se ve**, que es lo que espera
    // `move_task`: las `ORPHANED` y los bloques de agenda no están en pantalla.
    let mut stmt = conn.prepare(
        "SELECT scheduled_time, feed_id FROM tasks
         WHERE scheduled_date = ?1 AND id <> ?2 AND source_state = 'ACTIVE'
               AND rail_only = 0
         ORDER BY position, id",
    )?;
    let otras: Vec<(Option<String>, Option<i64>)> = stmt
        .query_map(params![date, id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<Vec<_>>>()?;

    // Un evento de día completo no compite por hora con nadie: es la franja de
    // arriba. Cuenta como "va antes" de cualquier cosa con reloj, y los de día
    // completo se agrupan entre ellos.
    let todo_el_dia =
        |(hour, feed): &(Option<String>, Option<i64>)| hour.is_none() && feed.is_some();

    let at = match hour {
        // Día completo: detrás de los otros de día completo y arriba de todo lo
        // demás, que es donde el rail lo dibuja.
        None => otras.iter().take_while(|o| todo_el_dia(o)).count() as i64,
        // Delante del primer evento más tarde que este. Si no hay ninguno, al
        // final: así el evento nuevo no se mete por encima de nada que hayas
        // puesto vos.
        Some(h) => otras
            .iter()
            .position(|otra| otra.0.as_deref().is_some_and(|otra| otra > h))
            .map(|i| i as i64)
            .unwrap_or(otras.len() as i64),
    };

    move_task(conn, id, Some(date), at)?;
    Ok(())
}

/// El UID de la serie: lo que va **antes** del `#` en un `calendar_uid`.
///
/// Es el inverso exacto de la clave que arma `ics::parse_events`
/// (`format!("{uid}#{stamp}")`, y el sello no contiene `#`). Un evento suelto
/// no lleva sufijo, así que su serie es él mismo.
fn series_uid(calendar_uid: &str) -> &str {
    match calendar_uid.rsplit_once('#') {
        Some((base, _)) => base,
        None => calendar_uid,
    }
}

/// ¿La serie de este `calendar_uid` está marcada como bloque de agenda?
fn series_rail_only(conn: &Connection, feed_id: i64, calendar_uid: &str) -> Result<bool> {
    let marked: Option<bool> = conn
        .query_row(
            "SELECT rail_only FROM calendar_series_prefs
             WHERE feed_id = ?1 AND series_uid = ?2",
            params![feed_id, series_uid(calendar_uid)],
            |r| r.get(0),
        )
        .optional()?;
    Ok(marked.unwrap_or(false))
}

/// Marca (o desmarca) **toda la serie** de una tarea de calendario como bloque
/// de agenda: sigue en el rail, deja de ser tarjeta y deja de sumar carga.
///
/// Se guarda en dos lugares a propósito, y los dos hacen falta:
///
/// - `calendar_series_prefs` es la decisión, y es lo que heredan las
///   repeticiones que todavía no existen. El almuerzo es semanal: sin la
///   preferencia habría que volver a marcarlo cada semana.
/// - `tasks.rail_only` es la lectura, y se actualiza para las repeticiones que
///   ya están en la base. Solo con la preferencia, marcar el almuerzo de hoy no
///   cambiaría nada de lo ya importado.
///
/// **Al marcar, no toca las repeticiones que ya trabajaste** —con `time_entries`
/// o `DONE`—. Son dos problemas de una sola regla, y las dos mitades ya tenían
/// precedente en este archivo:
///
/// - `reconcile_feed` no toca una tarea con el taxímetro corriendo, porque
///   sacarla de los listados deja el timer contando sobre algo que no puedes ver
///   ni detener. Ignorar hace eso y más (también la saca de Focus), así que la
///   trampa es la misma; y una corrida abierta **es** una `time_entry`, así que
///   este filtro la cubre sin necesitar un caso aparte.
/// - Una repetición trabajada que se esconde de la columna deja su tiempo
///   contado en la review: el estado partido del que salió la migración 6. Ese
///   tiempo es tuyo, igual que en `reconcile_feed`.
///
/// Al **desmarcar** sí se tocan todas: si no, una repetición podría quedarse
/// ignorada para siempre.
///
/// Devuelve cuántas tareas cambió. Una tarea que no viene del calendario no
/// tiene serie que marcar y devuelve error: la marca no significa nada en una
/// tarea a mano, que ya está donde el usuario la puso.
pub fn set_series_rail_only(conn: &Connection, task_id: i64, rail_only: bool) -> Result<usize> {
    let row: Option<(Option<i64>, Option<String>)> = conn
        .query_row(
            "SELECT feed_id, calendar_uid FROM tasks WHERE id = ?1",
            [task_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((Some(feed_id), Some(uid))) = row else {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    };
    let serie = series_uid(&uid);

    conn.execute(
        "INSERT INTO calendar_series_prefs (feed_id, series_uid, rail_only)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(feed_id, series_uid) DO UPDATE SET rail_only = ?3",
        params![feed_id, serie, rail_only],
    )?;

    // `series_uid || '#'` acota el LIKE a las repeticiones de ESTA serie: sin el
    // separador, un UID que sea prefijo de otro se llevaría las dos.
    //
    // El `AND` final es el filtro de arriba: al marcar se saltean las que ya
    // trabajaste. Va en la consulta y no en un bucle para que sea una sola
    // escritura y no pueda quedar a medias.
    let trabajadas = if rail_only {
        " AND status <> 'DONE'
          AND NOT EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id = tasks.id)"
    } else {
        ""
    };
    conn.execute(
        &format!(
            "UPDATE tasks SET rail_only = ?3, updated_at = ?4
             WHERE feed_id = ?1 AND (calendar_uid = ?2 OR calendar_uid LIKE ?2 || '#%')
             {trabajadas}"
        ),
        params![feed_id, serie, rail_only, now()],
    )
}

/// Un evento ya interpretado, listo para escribirse como tarea.
///
/// Espeja `calendar::ics::IcsEvent`, pero vive acá para que `repo` no dependa
/// del crate de ICS: la importación se testea armando estos structs a mano.
#[derive(Debug, Clone)]
pub struct ImportableEvent {
    pub uid: String,
    pub title: String,
    pub date: String,
    pub hour: Option<String>,
    pub start: Option<String>,
    pub end: Option<String>,
    pub minutes: Option<i64>,
    /// Link de la videollamada. Va en su **propia columna** y no en `notes`
    /// porque las notas son del usuario: la sync las pisaría cada 15 minutos.
    pub link: Option<String>,
    /// Descripción del evento, por la misma razón que `link`.
    pub description: Option<String>,
    /// Organizador e invitados. Vacío si el feed no los trae.
    pub attendees: Vec<Attendee>,
}

/// Crea o actualiza las tareas de un feed y devuelve **los UIDs que vio**.
///
/// Ese `Vec` de vuelta no es decorativo: es lo que el reconciler (M3.2) necesita
/// para calcular "está en la base pero ya no en el feed" sin volver a parsear.
///
/// Qué respeta el update, y por qué no es un `INSERT OR REPLACE`:
///
/// - **No pisa el estado ni el tiempo.** Una reunión que completaste y
///   cronometraste sigue completada después de la sync.
/// - **No pisa `position`.** Si la ordenaste dentro del día, se queda donde la
///   dejaste.
/// - **No pisa `category_id`.** La categoría por defecto del feed es un valor
///   inicial, no una imposición: si la cambiaste a mano, manda la tuya.
/// - **No pisa `notes`.** Son tuyas; por eso el link de la reunión tiene su
///   propia columna.
/// - **Sí actualiza** título, fecha, hora, horario del evento y el link de la
///   videollamada: es justo lo que cambia cuando alguien mueve o rearma la
///   reunión, y de ese lado el dueño del dato es el feed.
pub fn import_events(
    conn: &Connection,
    feed_id: i64,
    events: &[ImportableEvent],
    default_category_id: Option<i64>,
) -> Result<Vec<String>> {
    let ts = now();
    let mut seen = Vec::with_capacity(events.len());

    for ev in events {
        // La fecha y la hora de antes se leen **junto al id**: son lo que dice si
        // el evento se movió, y por lo tanto si hay que volver a ubicarlo en la
        // columna (ver `place_by_time`). Después del UPDATE ya no se pueden
        // consultar.
        let existing: Option<(i64, Option<String>, Option<String>, bool)> = conn
            .query_row(
                "SELECT id, scheduled_date, scheduled_time, rail_only FROM tasks
                 WHERE feed_id = ?1 AND calendar_uid = ?2",
                params![feed_id, ev.uid],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;

        match existing {
            Some((id, antes_date, antes_hour, rail_only)) => {
                conn.execute(
                    "UPDATE tasks
                     SET title = ?2, scheduled_date = ?3, scheduled_time = ?4,
                         event_start = ?5, event_end = ?6, estimated_minutes = ?7,
                         meeting_url = ?8, event_description = ?9, attendees = ?10,
                         source_state = 'ACTIVE', updated_at = ?11
                     WHERE id = ?1",
                    params![
                        id,
                        ev.title,
                        ev.date,
                        ev.hour,
                        ev.start,
                        ev.end,
                        ev.minutes,
                        ev.link,
                        ev.description,
                        attendees_json(&ev.attendees),
                        ts
                    ],
                )?;
                // Se movió de día o de hora: vuelve a su lugar en la columna. Si
                // no cambió nada de eso, no se toca — la columna es del usuario y
                // reubicar en cada pasada del poller borraría cualquier arrastre.
                // Un bloque de agenda no está en la columna, así que no hay lugar
                // que darle: su orden lo pone el rail, por hora.
                if !rail_only
                    && (antes_date.as_deref() != Some(ev.date.as_str())
                        || antes_hour.as_deref() != ev.hour.as_deref())
                {
                    place_by_time(conn, id, &ev.date, ev.hour.as_deref())?;
                }
            }
            None => {
                let position = next_position(conn, Some(&ev.date))?;
                // La repetición nueva de una serie marcada como bloque de agenda
                // nace marcada. Sin esto, poner la marca en el almuerzo del lunes
                // no valdría para el del martes y habría que repetirla para
                // siempre.
                let rail_only = series_rail_only(conn, feed_id, &ev.uid)?;
                conn.execute(
                    "INSERT INTO tasks
                        (title, category_id, scheduled_date, scheduled_time, position,
                         estimated_minutes, source, source_state, feed_id, calendar_uid,
                         event_start, event_end, meeting_url, event_description, attendees,
                         rail_only, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'CALENDAR', 'ACTIVE', ?7, ?8, ?9, ?10, ?11,
                             ?12, ?13, ?15, ?14, ?14)",
                    params![
                        ev.title,
                        default_category_id,
                        ev.date,
                        ev.hour,
                        position,
                        ev.minutes,
                        feed_id,
                        ev.uid,
                        ev.start,
                        ev.end,
                        ev.link,
                        ev.description,
                        attendees_json(&ev.attendees),
                        ts,
                        rail_only
                    ],
                )?;
                let id = conn.last_insert_rowid();
                // Mismo historial que una tarea a mano, para que el modal no
                // quede en blanco. El sujeto de la línea lo pone el front.
                log_event(conn, id, "CREATED", None, Some(&ev.date))?;
                // Entra en su lugar por hora, no al final: el feed llega en el
                // orden que Google quiera. Un bloque de agenda no va a la
                // columna, así que se queda donde cayó.
                if !rail_only {
                    place_by_time(conn, id, &ev.date, ev.hour.as_deref())?;
                }
            }
        }
        seen.push(ev.uid.clone());
    }

    Ok(seen)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    // Para leer hora/minuto de un `DateTime` en las aserciones de los tramos, y
    // el día de la semana en las del rollup.
    use chrono::{Datelike, Timelike};

    fn conn() -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c
    }

    fn new_task(title: &str, date: Option<&str>) -> NewTask {
        NewTask {
            title: title.into(),
            category_id: None,
            objective_id: None,
            scheduled_date: date.map(|s| s.to_string()),
            scheduled_time: None,
            estimated_minutes: Some(30),
            notes: None,
        }
    }

    #[test]
    fn crear_tarea_agendada_registra_created_y_start_date() {
        let c = conn();
        let t = create_task(&c, new_task("demo", Some("2026-08-10"))).unwrap();
        assert_eq!(t.status, "TODO");
        assert_eq!(t.source, "MANUAL");
        let ev = list_task_events(&c, t.id).unwrap();
        let kinds: Vec<_> = ev.iter().map(|e| e.type_field()).collect();
        assert!(kinds.contains(&"CREATED"));
        assert!(kinds.contains(&"START_DATE_SET"));
    }

    #[test]
    fn mover_entre_dias_registra_moved_y_reordena() {
        let c = conn();
        let a = create_task(&c, new_task("a", Some("2026-08-10"))).unwrap();
        let _b = create_task(&c, new_task("b", Some("2026-08-11"))).unwrap();
        let _c2 = create_task(&c, new_task("c", Some("2026-08-11"))).unwrap();

        // Mueve 'a' al 11 en la posición 0 (debe empujar a b y c).
        move_task(&c, a.id, Some("2026-08-11"), 0).unwrap();

        let day = list_tasks_for_date(&c, "2026-08-11").unwrap();
        let order: Vec<_> = day.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(order, vec!["a", "b", "c"]);

        let ev = list_task_events(&c, a.id).unwrap();
        assert!(ev.iter().any(|e| e.type_field() == "MOVED"));
        // b conserva su relación pero corrió de posición
        assert!(day.iter().find(|t| t.title == "b").unwrap().position >= 1);
    }

    /// El caso que faltaba: reordenar **dentro de un mismo día**. Los tests de
    /// `move_task` cubrían el cruce entre días, donde el destino no contiene a la
    /// tarea que se mueve y por eso la aritmética es más fácil.
    #[test]
    fn reordenar_dentro_del_mismo_dia_respeta_el_indice_final() {
        let c = conn();
        let dia = "2026-08-10";
        let a = create_task(&c, new_task("a", Some(dia))).unwrap();
        let b = create_task(&c, new_task("b", Some(dia))).unwrap();
        let _c2 = create_task(&c, new_task("c", Some(dia))).unwrap();
        let d = create_task(&c, new_task("d", Some(dia))).unwrap();

        let orden = |c: &Connection| -> Vec<String> {
            list_tasks_for_date(c, dia)
                .unwrap()
                .iter()
                .map(|t| t.title.clone())
                .collect()
        };
        assert_eq!(orden(&c), vec!["a", "b", "c", "d"]);

        // Hacia arriba: 'd' del índice 3 al 1.
        move_task(&c, d.id, Some(dia), 1).unwrap();
        assert_eq!(orden(&c), vec!["a", "d", "b", "c"]);

        // Y hacia abajo, que es donde el índice significa otra cosa: 'd' vuelve
        // del 1 al 3. La posición que llega es la **final**, contando que la
        // tarea ya salió de la lista, así que 'd' tiene que quedar última.
        move_task(&c, d.id, Some(dia), 3).unwrap();
        assert_eq!(orden(&c), vec!["a", "b", "c", "d"]);

        // Y un caso corto que no toca los bordes: 'b' del 1 al 2.
        move_task(&c, b.id, Some(dia), 2).unwrap();
        assert_eq!(orden(&c), vec!["a", "c", "b", "d"]);

        // Las posiciones quedan sin huecos ni empates: dos tareas con la misma
        // `position` ordenan por el desempate y el arrastre siguiente vuelve a
        // salir corrido.
        let posiciones: Vec<i64> = list_tasks_for_date(&c, dia)
            .unwrap()
            .iter()
            .map(|t| t.position)
            .collect();
        assert_eq!(posiciones, vec![0, 1, 2, 3]);
        let _ = a;
    }

    /// Las `ORPHANED` no salen en los listados (I7) pero siguen ocupando su fila
    /// en el día. El índice que manda la vista cuenta contra lo que se ve, así
    /// que una escondida en el medio no puede correr la card de lugar.
    #[test]
    fn una_orphaned_en_el_medio_no_corre_el_indice() {
        let c = conn();
        let dia = "2026-08-10";
        let a = create_task(&c, new_task("a", Some(dia))).unwrap();
        let x = create_task(&c, new_task("x", Some(dia))).unwrap();
        let _b = create_task(&c, new_task("b", Some(dia))).unwrap();
        let _cc = create_task(&c, new_task("c", Some(dia))).unwrap();
        c.execute(
            "UPDATE tasks SET source_state = 'ORPHANED' WHERE id = ?1",
            params![x.id],
        )
        .unwrap();

        let visible = |c: &Connection| -> Vec<String> {
            list_tasks_for_date(c, dia)
                .unwrap()
                .iter()
                .map(|t| t.title.clone())
                .collect()
        };
        assert_eq!(visible(&c), vec!["a", "b", "c"]);

        // 'a' al final de lo visible: el índice 2 lo manda una lista de tres que
        // no cuenta a 'x'.
        move_task(&c, a.id, Some(dia), 2).unwrap();
        assert_eq!(visible(&c), vec!["b", "c", "a"]);

        // Y la escondida sigue ahí, con su lugar propio y sin empatar con nadie.
        let todas: Vec<(String, i64)> = c
            .prepare("SELECT title, position FROM tasks WHERE scheduled_date = ?1 ORDER BY position")
            .unwrap()
            .query_map(params![dia], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>>>()
            .unwrap();
        let posiciones: Vec<i64> = todas.iter().map(|(_, p)| *p).collect();
        assert_eq!(posiciones, vec![0, 1, 2, 3]);
        assert!(todas.iter().any(|(t, _)| t == "x"));
    }

    #[test]
    fn degradar_preserva_el_ultimo_dia_y_baja_lo_anterior() {
        let c = conn();
        // El último día con tareas se preserva entero: es el que repasa el
        // ritual, y decidir por el usuario antes de que lo vea era justamente el
        // problema del carry-over.
        let from_yesterday = create_task(&c, new_task("de ayer", Some("2026-08-09"))).unwrap();
        let old = create_task(&c, new_task("de la semana pasada", Some("2026-08-03"))).unwrap();

        let moved = demote_pending(&c, "2026-08-10").unwrap();
        assert_eq!(moved, 1);

        assert_eq!(
            get_task(&c, from_yesterday.id).unwrap().unwrap().scheduled_date,
            Some("2026-08-09".into()),
            "el último día con tareas no se toca"
        );
        assert_eq!(
            get_task(&c, old.id).unwrap().unwrap().scheduled_date,
            None,
            "lo anterior baja al backlog"
        );
    }

    #[test]
    fn degradar_deja_lo_rescatado_arriba_del_backlog() {
        let c = conn();
        // Primera prioridad: lo que viene de un día entra en 0 y empuja al resto.
        let saved = create_task(&c, new_task("guardada hace tiempo", None)).unwrap();
        create_task(&c, new_task("ancla", Some("2026-08-09"))).unwrap();
        let failure = create_task(&c, new_task("se cayó el lunes", Some("2026-08-03"))).unwrap();

        demote_pending(&c, "2026-08-10").unwrap();

        let backlog = list_backlog(&c).unwrap();
        let order: Vec<_> = backlog.iter().map(|t| t.id).collect();
        assert_eq!(order, vec![failure.id, saved.id]);
    }

    #[test]
    fn degradar_no_toca_calendario_ni_completadas() {
        let c = conn();
        create_task(&c, new_task("ancla", Some("2026-08-09"))).unwrap();
        let done = create_task(&c, new_task("hecha", Some("2026-08-03"))).unwrap();
        set_task_status(&c, done.id, "DONE").unwrap();
        // Una reunión pasada es el registro de algo que ocurrió ese día.
        c.execute(
            "INSERT INTO tasks (id, title, position, status, source, scheduled_date, created_at, updated_at)
             VALUES (900, 'meet', 0, 'TODO', 'CALENDAR', '2026-08-03', '2026-08-03', '2026-08-03')",
            [],
        )
        .unwrap();

        assert_eq!(demote_pending(&c, "2026-08-10").unwrap(), 0);
        assert_eq!(
            get_task(&c, done.id).unwrap().unwrap().scheduled_date,
            Some("2026-08-03".into())
        );
        assert_eq!(
            get_task(&c, 900).unwrap().unwrap().scheduled_date,
            Some("2026-08-03".into())
        );
    }

    #[test]
    fn degradar_sin_dias_anteriores_no_hace_nada() {
        let c = conn();
        create_task(&c, new_task("de hoy", Some("2026-08-10"))).unwrap();
        assert_eq!(demote_pending(&c, "2026-08-10").unwrap(), 0);
    }

    #[test]
    fn rescatadas_distingue_lo_que_venia_de_un_dia_de_lo_que_naci_ahi() {
        let c = conn();
        let born = create_task(&c, new_task("nació en el backlog", None)).unwrap();
        create_task(&c, new_task("ancla", Some("2026-08-09"))).unwrap();
        let failure = create_task(&c, new_task("se cayó", Some("2026-08-03"))).unwrap();

        demote_pending(&c, "2026-08-10").unwrap();

        let r = rescued_from_backlog(&c).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].task_id, failure.id);
        assert_eq!(r[0].from_date, "2026-08-03");
        assert!(!r.iter().any(|x| x.task_id == born.id));
    }

    #[test]
    fn rescatadas_tambien_cuenta_las_que_mandaste_a_mano() {
        let c = conn();
        // Bajarla tú y que la baje la app son lo mismo: "esto venía de un día".
        let t = create_task(&c, new_task("la mandé yo", Some("2026-08-09"))).unwrap();
        move_task(&c, t.id, None, 0).unwrap();

        let r = rescued_from_backlog(&c).unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].from_date, "2026-08-09");
    }

    #[test]
    fn ultimo_dia_con_tareas_ignora_hoy_y_el_futuro() {
        let c = conn();
        create_task(&c, new_task("futura", Some("2026-08-20"))).unwrap();
        create_task(&c, new_task("de hoy", Some("2026-08-10"))).unwrap();
        create_task(&c, new_task("del viernes", Some("2026-08-07"))).unwrap();
        create_task(&c, new_task("más vieja", Some("2026-08-03"))).unwrap();

        assert_eq!(
            last_day_with_tasks(&c, "2026-08-10").unwrap(),
            Some("2026-08-07".into())
        );
    }

    #[test]
    fn mover_a_mano_sigue_siendo_moved() {
        let c = conn();
        let t = create_task(&c, new_task("tarea", Some("2026-08-05"))).unwrap();

        move_task(&c, t.id, Some("2026-08-06"), 0).unwrap();

        let ev = list_task_events(&c, t.id).unwrap();
        assert!(ev.iter().any(|e| e.type_field() == "MOVED"));
        assert!(!ev.iter().any(|e| e.type_field() == "CARRIED_OVER"));
    }

    #[test]
    fn update_y_status_persisten() {
        let c = conn();
        let t = create_task(&c, new_task("x", Some("2026-08-10"))).unwrap();
        let patch = TaskPatch {
            actual_seconds: Some(120),
            estimated_minutes: Some(Some(45)),
            ..Default::default()
        };
        let up = update_task(&c, t.id, patch).unwrap().unwrap();
        assert_eq!(up.actual_seconds, 120);
        assert_eq!(up.estimated_minutes, Some(45));

        let done = set_task_status(&c, t.id, "DONE").unwrap().unwrap();
        assert_eq!(done.status, "DONE");
        assert!(done.completed_at.is_some());
    }

    #[test]
    fn start_y_stop_timer_acumulan_en_la_tarea() {
        let c = conn();
        let t = create_task(&c, new_task("con timer", Some("2026-08-10"))).unwrap();

        let active = start_timer(&c, t.id).unwrap();
        assert_eq!(active.task_id, t.id);
        assert_eq!(active.base_seconds, 0);
        assert!(get_active_timer(&c).unwrap().is_some());

        // Simula 90s de trabajo retrocediendo el inicio de la entrada abierta.
        c.execute(
            "UPDATE time_entries SET started_at = datetime('now', '-90 seconds') || 'Z'
             WHERE id = ?1",
            [active.entry_id],
        )
        .unwrap();

        let (task_id, seconds) = stop_timer(&c).unwrap().unwrap();
        assert_eq!(task_id, t.id);
        assert!(seconds >= 89, "esperaba ~90s, obtuve {seconds}");

        // Sin timer activo y el tiempo quedó en la tarea.
        assert!(get_active_timer(&c).unwrap().is_none());
        let updated = get_task(&c, t.id).unwrap().unwrap();
        assert_eq!(updated.actual_seconds, seconds);

        // No se afirma "una sola entrada": si el test corre en el primer minuto
        // del día, esos 90 segundos cruzan la medianoche local de verdad y
        // `stop_timer` los parte en dos, que es exactamente lo que debe hacer
        // (lo cubre `stop_timer_parte_la_corrida_que_cruza_la_medianoche`). Lo
        // que sí tiene que valer siempre: ninguna queda abierta, y la suma de
        // las filas es el total que se le acreditó a la tarea.
        let entries = list_time_entries(&c, t.id).unwrap();
        assert!(!entries.is_empty());
        assert!(entries.iter().all(|e| e.ended_at.is_some()));
        assert_eq!(entries.iter().map(|e| e.seconds).sum::<i64>(), seconds);
    }

    #[test]
    fn ajuste_manual_del_tiempo_sobrevive_a_start_stop() {
        // Regresión: editar el tiempo real y luego dar play reanudaba desde el
        // valor viejo, porque el total se recalculaba desde las entradas.
        //
        // La tarea es **de hoy** y eso ahora importa: desde Mej.14 el ajuste
        // manual se acredita al día de la tarea, y `base_seconds` es el contador
        // del taxímetro, que mide solo hoy. Con una tarea de otro día el ajuste
        // queda fuera de ese contador a propósito (lo cubre
        // `un_ajuste_de_otro_dia_ya_no_cuenta_en_el_contador_del_taximetro`), así
        // que lo que este caso protege —que el total no se recalcule desde las
        // entradas— se ve con la tarea en el día en curso.
        let c = conn();
        let hoy = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        let t = create_task(&c, new_task("larga", Some(&hoy))).unwrap();

        // Simula 2h ya trabajadas.
        set_actual_seconds(&c, t.id, 2 * 3600).unwrap();
        assert_eq!(get_task(&c, t.id).unwrap().unwrap().actual_seconds, 7200);

        // El usuario la corrige a 30 min.
        set_actual_seconds(&c, t.id, 30 * 60).unwrap();
        assert_eq!(get_task(&c, t.id).unwrap().unwrap().actual_seconds, 1800);

        // Al reanudar, el contador del día parte del ajuste, no de las 2h.
        let active = start_timer(&c, t.id).unwrap();
        assert_eq!(active.base_seconds, 1800, "debe respetar el último ajuste");

        stop_timer(&c).unwrap();
        let after = get_task(&c, t.id).unwrap().unwrap();
        assert!(
            (1800..1805).contains(&after.actual_seconds),
            "el total acumula, no se recalcula: {}",
            after.actual_seconds
        );
    }

    #[test]
    fn tramos_por_dia_no_parte_lo_que_cabe_en_un_dia() {
        let a = chrono::Local
            .with_ymd_and_hms(2026, 8, 12, 9, 0, 0)
            .unwrap()
            .with_timezone(&Utc);
        let b = a + chrono::Duration::hours(3);

        let segments = segments_by_local_day(a, b);
        assert_eq!(segments.len(), 1, "el caso normal no debe tocarse");
        assert_eq!(segments[0], (a, b));
    }

    #[test]
    fn tramos_por_dia_parte_en_cada_medianoche_local() {
        // 22:00 del día 12 → 13:00 del día 14: tres tramos.
        let a = chrono::Local
            .with_ymd_and_hms(2026, 8, 12, 22, 0, 0)
            .unwrap()
            .with_timezone(&Utc);
        let b = chrono::Local
            .with_ymd_and_hms(2026, 8, 14, 13, 0, 0)
            .unwrap()
            .with_timezone(&Utc);

        let segments = segments_by_local_day(a, b);
        assert_eq!(segments.len(), 3);
        // Encadenados y sin huecos: el fin de uno es el inicio del siguiente.
        assert_eq!(segments[0].0, a);
        assert_eq!(segments[0].1, segments[1].0);
        assert_eq!(segments[1].1, segments[2].0);
        assert_eq!(segments[2].1, b);
        // Y cada corte cae en una medianoche local.
        for (_, end) in &segments[..2] {
            let local = end.with_timezone(&chrono::Local);
            assert_eq!(
                (local.hour(), local.minute(), local.second()),
                (0, 0, 0),
                "el corte tiene que ser la medianoche local"
            );
        }
    }

    #[test]
    fn stop_timer_parte_la_corrida_que_cruza_la_medianoche() {
        // El caso real: el timer queda corriendo de noche. Antes toda la
        // duración se acreditaba al día en que empezó, y el día siguiente
        // quedaba en cero pese a haberse trabajado.
        let c = conn();
        let t = create_task(&c, new_task("nocturna", Some("2026-08-12"))).unwrap();

        // Anclado a la medianoche local y no a "hace 20 horas": esto último
        // cruza el día solo si el test corre antes de las 20:00, así que de
        // noche fallaba sin que nada estuviera roto. Una hora antes de la
        // medianoche de hoy siempre cae ayer.
        let yesterday = (chrono::Local::now()
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .unwrap()
            - chrono::Duration::hours(1))
        .with_timezone(&Utc)
        .to_rfc3339();
        c.execute(
            "INSERT INTO time_entries (task_id, started_at, ended_at, seconds)
             VALUES (?1, ?2, NULL, 0)",
            params![t.id, yesterday],
        )
        .unwrap();

        let (_, total) = stop_timer(&c).unwrap().unwrap();

        let entries = list_time_entries(&c, t.id).unwrap();
        assert_eq!(entries.len(), 2, "una corrida de 20h tiene que quedar partida");
        // La suma de las filas es exactamente el total: si no, el
        // `actual_seconds` de la tarea deja de cuadrar con sus entradas.
        assert_eq!(entries.iter().map(|e| e.seconds).sum::<i64>(), total);
        // Y lo trabajado hoy ya no es cero.
        assert!(
            seconds_today(&c, t.id).unwrap() > 0,
            "el tramo de hoy tiene que contar para hoy"
        );
    }

    /// Inserta una entrada cerrada en una hora **local** concreta del día dado.
    fn local_entry(c: &Connection, task_id: i64, day: &str, hour: u32, min: u32, secs: i64) {
        let start = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d")
            .unwrap()
            .and_hms_opt(hour, min, 0)
            .unwrap();
        let start = chrono::Local.from_local_datetime(&start).unwrap();
        let end = start + chrono::Duration::seconds(secs);
        c.execute(
            "INSERT INTO time_entries (task_id, started_at, ended_at, seconds)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                task_id,
                start.with_timezone(&Utc).to_rfc3339(),
                end.with_timezone(&Utc).to_rfc3339(),
                secs
            ],
        )
        .unwrap();
    }

    #[test]
    fn trabajo_del_dia_agrupa_por_tarea_con_su_primer_inicio() {
        let c = conn();
        let t = create_task(&c, new_task("reunión", Some("2026-08-12"))).unwrap();

        // Dos ratos el mismo día: 9:00 (15') y 11:00 (18').
        local_entry(&c, t.id, "2026-08-12", 9, 0, 900);
        local_entry(&c, t.id, "2026-08-12", 11, 0, 1080);

        let rows = day_work(&c, "2026-08-12").unwrap();
        assert_eq!(rows.len(), 1, "una fila por tarea, no por entrada");
        assert_eq!(rows[0].task_id, t.id);
        assert_eq!(rows[0].seconds, 900 + 1080);
        assert!(!rows[0].running);
        // El inicio es el primero del día, no el último.
        let start = chrono::DateTime::parse_from_rfc3339(rows[0].tracked_at.as_ref().unwrap())
            .unwrap()
            .with_timezone(&chrono::Local);
        assert_eq!(start.hour(), 9);
    }

    #[test]
    fn trabajo_del_dia_acota_el_dia_en_hora_local() {
        // El caso que rompe cortar el timestamp por los primeros 10 caracteres:
        // las 22:00 locales de Chile ya son el día siguiente en UTC.
        let c = conn();
        let t = create_task(&c, new_task("nocturna", Some("2026-08-12"))).unwrap();
        local_entry(&c, t.id, "2026-08-12", 22, 0, 600);

        assert_eq!(day_work(&c, "2026-08-12").unwrap().len(), 1);
        assert!(
            day_work(&c, "2026-08-13").unwrap().is_empty(),
            "no puede acreditarse al día siguiente"
        );
    }

    #[test]
    fn trabajo_del_dia_marca_la_corrida_en_curso_sin_contarle_segundos() {
        // Una entrada abierta trae `seconds = 0`: los que lleva corriendo los
        // pone el front desde el taxímetro, igual que `timeByDay`.
        let c = conn();
        let t = create_task(&c, new_task("en curso", None)).unwrap();
        start_timer(&c, t.id).unwrap();

        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let rows = day_work(&c, &today).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].running);
        assert_eq!(rows[0].seconds, 0);
    }

    #[test]
    fn trabajo_del_dia_ignora_los_otros_dias_y_la_fecha_ilegible() {
        let c = conn();
        let t = create_task(&c, new_task("ayer", Some("2026-08-11"))).unwrap();
        local_entry(&c, t.id, "2026-08-11", 10, 0, 600);

        assert!(day_work(&c, "2026-08-12").unwrap().is_empty());
        // Una fecha que no se puede interpretar devuelve vacío, no todo.
        assert!(day_work(&c, "no-es-fecha").unwrap().is_empty());
    }

    #[test]
    fn el_contador_del_dia_nunca_es_negativo() {
        // Un recorte manual mayor que lo trackeado hoy dejaba `base_seconds` en
        // negativo, y el taxímetro mostraba "-14:-17:-39".
        let c = conn();
        let t = create_task(&c, new_task("corregida", Some("2026-08-13"))).unwrap();

        // Simula el arrastre: 15h que vienen de una corrida anterior.
        c.execute(
            "UPDATE tasks SET actual_seconds = 54000 WHERE id = ?1",
            [t.id],
        )
        .unwrap();
        // Y la corrección a 40 min, que graba un delta de -51600 con fecha de hoy.
        set_actual_seconds(&c, t.id, 40 * 60).unwrap();

        assert_eq!(seconds_today(&c, t.id).unwrap(), 0);
        let active = start_timer(&c, t.id).unwrap();
        assert_eq!(active.base_seconds, 0, "el contador no puede arrancar en negativo");
    }

    #[test]
    fn el_contador_del_dia_ignora_lo_trabajado_ayer() {
        // Una tarea arrastrada al día siguiente parte en 0, pero su total suma.
        let c = conn();
        let t = create_task(&c, new_task("arrastrada", Some("2026-08-10"))).unwrap();

        // Entrada de AYER: 45 min.
        c.execute(
            "INSERT INTO time_entries (task_id, started_at, ended_at, seconds)
             VALUES (?1, datetime('now', '-1 day') || 'Z', datetime('now', '-1 day') || 'Z', 2700)",
            [t.id],
        )
        .unwrap();
        c.execute(
            "UPDATE tasks SET actual_seconds = 2700 WHERE id = ?1",
            [t.id],
        )
        .unwrap();

        // Hoy el contador arranca en 0 pese a las 45 min de ayer.
        assert_eq!(seconds_today(&c, t.id).unwrap(), 0);
        let active = start_timer(&c, t.id).unwrap();
        assert_eq!(active.base_seconds, 0, "el día nuevo parte en 0");

        stop_timer(&c).unwrap();

        // El total de la tarea sigue acumulando ambos días.
        let total = get_task(&c, t.id).unwrap().unwrap().actual_seconds;
        assert!(total >= 2700, "el total debe sumar ambos días: {total}");
    }

    #[test]
    fn solo_un_timer_activo_a_la_vez() {
        let c = conn();
        let a = create_task(&c, new_task("a", Some("2026-08-10"))).unwrap();
        let b = create_task(&c, new_task("b", Some("2026-08-10"))).unwrap();

        start_timer(&c, a.id).unwrap();
        let second = start_timer(&c, b.id).unwrap();

        // El de 'a' se cerró automáticamente al iniciar el de 'b'.
        assert_eq!(second.task_id, b.id);
        let open_entries: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM time_entries WHERE ended_at IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(open_entries, 1);
        let closed_of_a: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM time_entries WHERE task_id = ?1 AND ended_at IS NOT NULL",
                [a.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(closed_of_a, 1);
    }

    #[test]
    fn completar_una_tarea_detiene_su_timer() {
        let c = conn();
        let t = create_task(&c, new_task("en curso", Some("2026-08-11"))).unwrap();
        start_timer(&c, t.id).unwrap();
        assert!(get_active_timer(&c).unwrap().is_some());

        set_task_status(&c, t.id, "DONE").unwrap();

        assert!(
            get_active_timer(&c).unwrap().is_none(),
            "al completar, el timer debe detenerse"
        );
        // El tramo trabajado quedó registrado (entrada cerrada).
        let closed_entries: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM time_entries WHERE task_id = ?1 AND ended_at IS NOT NULL",
                [t.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(closed_entries, 1);
    }

    #[test]
    fn darle_play_a_una_tarea_completada_la_reabre() {
        let c = conn();
        let t = create_task(&c, new_task("cerrada", Some("2026-08-11"))).unwrap();

        let done = set_task_status(&c, t.id, "DONE").unwrap().unwrap();
        assert_eq!(done.status, "DONE");
        assert!(done.completed_at.is_some());

        // Volver a trabajar en algo es decir que no estaba terminado.
        start_timer(&c, t.id).unwrap();

        let reopened = get_task(&c, t.id).unwrap().unwrap();
        assert_eq!(reopened.status, "TODO");
        assert!(reopened.completed_at.is_none());
        // Y el timer efectivamente quedó corriendo en ella.
        assert_eq!(get_active_timer(&c).unwrap().unwrap().task_id, t.id);
    }

    #[test]
    fn la_tarea_reabierta_vuelve_a_la_cola_de_focus() {
        let c = conn();
        let t = create_task(&c, new_task("cerrada", Some("2026-08-11"))).unwrap();
        set_task_status(&c, t.id, "DONE").unwrap();
        assert!(focus_queue(&c, "2026-08-11", "10:00").unwrap().is_empty());

        start_timer(&c, t.id).unwrap();

        let queue = focus_queue(&c, "2026-08-11", "10:00").unwrap();
        assert_eq!(queue.len(), 1);
        assert_eq!(queue[0].id, t.id);
    }

    #[test]
    fn darle_play_a_una_tarea_pendiente_no_la_toca() {
        let c = conn();
        let t = create_task(&c, new_task("pendiente", Some("2026-08-11"))).unwrap();

        start_timer(&c, t.id).unwrap();

        let after = get_task(&c, t.id).unwrap().unwrap();
        assert_eq!(after.status, "TODO");
        assert!(after.completed_at.is_none());
        // No se le movió la fecha ni la posición por arrancar el timer.
        assert_eq!(after.scheduled_date.as_deref(), Some("2026-08-11"));
        assert_eq!(after.position, t.position);
    }

    #[test]
    fn completar_otra_tarea_no_detiene_el_timer_en_curso() {
        let c = conn();
        let running = create_task(&c, new_task("corriendo", Some("2026-08-11"))).unwrap();
        let other = create_task(&c, new_task("otra", Some("2026-08-11"))).unwrap();
        start_timer(&c, running.id).unwrap();

        set_task_status(&c, other.id, "DONE").unwrap();

        let active = get_active_timer(&c).unwrap();
        assert_eq!(
            active.map(|a| a.task_id),
            Some(running.id),
            "completar otra tarea no debe tocar el timer"
        );
    }

    #[test]
    fn stop_sin_timer_activo_no_falla() {
        let c = conn();
        assert!(stop_timer(&c).unwrap().is_none());
    }

    #[test]
    fn focus_queue_pospone_meets_futuras_y_omite_completadas() {
        let c = conn();
        let date = "2026-08-10";
        // Manual sin hora
        let manual = create_task(&c, new_task("manual", Some(date))).unwrap();
        // Meet de la mañana (ya empezada a las 09:30)
        c.execute(
            "INSERT INTO tasks (title, position, scheduled_date, scheduled_time, source,
                                created_at, updated_at)
             VALUES ('meet mañana', 1, ?1, '09:00', 'CALENDAR', ?2, ?2)",
            params![date, "2026-08-10T08:00:00Z"],
        )
        .unwrap();
        // Meet de la tarde (aún no empieza)
        c.execute(
            "INSERT INTO tasks (title, position, scheduled_date, scheduled_time, source,
                                created_at, updated_at)
             VALUES ('meet tarde', 2, ?1, '15:00', 'CALENDAR', ?2, ?2)",
            params![date, "2026-08-10T08:00:00Z"],
        )
        .unwrap();
        // Completada: no debe aparecer
        let done = create_task(&c, new_task("hecha", Some(date))).unwrap();
        set_task_status(&c, done.id, "DONE").unwrap();

        let q = focus_queue(&c, date, "09:30").unwrap();
        let titles: Vec<_> = q.iter().map(|t| t.title.as_str()).collect();

        assert!(!titles.contains(&"hecha"), "no debe incluir completadas");
        // La meet de la mañana va primero (ya empezada); la de la tarde al final.
        assert_eq!(titles.first(), Some(&"meet mañana"));
        assert_eq!(titles.last(), Some(&"meet tarde"));
        assert!(titles.contains(&"manual"));
        assert_eq!(q.len(), 3);
        let _ = manual;
    }

    #[test]
    fn los_settings_traen_los_valores_sembrados() {
        let c = conn();
        let s = list_settings(&c).unwrap();
        let cap = s.iter().find(|(k, _)| k == "daily_capacity_minutes").unwrap();
        assert_eq!(cap.1, "480");
        let warn = s.iter().find(|(k, _)| k == "capacity_warn_ratio").unwrap();
        assert_eq!(warn.1, "0.85");
    }

    #[test]
    fn set_setting_sobrescribe_y_crea() {
        let c = conn();

        // Sobrescribe una clave sembrada.
        set_setting(&c, "daily_capacity_minutes", "300").unwrap();
        let s = list_settings(&c).unwrap();
        assert_eq!(
            s.iter().find(|(k, _)| k == "daily_capacity_minutes").unwrap().1,
            "300"
        );
        // Sin duplicar la fila.
        assert_eq!(s.iter().filter(|(k, _)| k == "daily_capacity_minutes").count(), 1);

        // Y crea una que no existía.
        set_setting(&c, "clave_nueva", "hola").unwrap();
        let s = list_settings(&c).unwrap();
        assert_eq!(s.iter().find(|(k, _)| k == "clave_nueva").unwrap().1, "hola");
    }

    #[test]
    fn backlog_lista_sin_fecha() {
        let c = conn();
        create_task(&c, new_task("agendada", Some("2026-08-10"))).unwrap();
        create_task(&c, new_task("suelta", None)).unwrap();
        let bl = list_backlog(&c).unwrap();
        assert_eq!(bl.len(), 1);
        assert_eq!(bl[0].title, "suelta");
    }

    // -----------------------------------------------------------------------
    // Calendar feeds
    // -----------------------------------------------------------------------

    fn event(uid: &str, title: &str, date: &str) -> ImportableEvent {
        ImportableEvent {
            uid: uid.into(),
            title: title.into(),
            date: date.into(),
            hour: Some("09:00".into()),
            start: Some("2026-08-10T12:00:00+00:00".into()),
            end: Some("2026-08-10T13:00:00+00:00".into()),
            minutes: Some(60),
            link: None,
            description: None,
            attendees: Vec::new(),
        }
    }

    fn feed(c: &Connection) -> CalendarFeed {
        create_calendar_feed(c, "Trabajo", "https://cal.example/secreto.ics", None, 15).unwrap()
    }

    #[test]
    fn el_feed_se_crea_con_sus_defaults() {
        let c = conn();
        let f = feed(&c);
        assert_eq!(f.name, "Trabajo");
        assert!(f.import_as_tasks, "por defecto importa");
        assert_eq!(f.poll_minutes, 15);
        assert!(f.last_synced_at.is_none());
        assert!(f.last_error.is_none());
    }

    #[test]
    fn el_intervalo_de_sondeo_tiene_piso() {
        // Un feed cada 0 minutos es un bucle contra el servidor del calendario.
        let c = conn();
        let f = create_calendar_feed(&c, "Ansioso", "https://x/y.ics", None, 0).unwrap();
        assert_eq!(f.poll_minutes, POLL_MINIMO);
    }

    #[test]
    fn importar_crea_las_tareas_con_la_categoria_del_feed() {
        let c = conn();
        let f = feed(&c);
        let seen = import_events(
            &c,
            f.id,
            &[event("a@x", "Daily", "2026-08-10")],
            Some(7),
        )
        .unwrap();

        assert_eq!(seen, vec!["a@x".to_string()]);
        let t = &list_tasks_for_date(&c, "2026-08-10").unwrap()[0];
        assert_eq!(t.title, "Daily");
        assert_eq!(t.source, "CALENDAR");
        assert_eq!(t.source_state, "ACTIVE");
        assert_eq!(t.feed_id, Some(f.id));
        assert_eq!(t.calendar_uid, Some("a@x".to_string()));
        assert_eq!(t.category_id, Some(7));
        assert_eq!(t.estimated_minutes, Some(60));
        assert_eq!(t.scheduled_time, Some("09:00".to_string()));
    }

    /// Un evento con hora, pero sin `event` genérico: hace falta controlar la
    /// hora para probar el orden.
    fn event_at(uid: &str, title: &str, date: &str, hour: Option<&str>) -> ImportableEvent {
        ImportableEvent {
            hour: hour.map(str::to_string),
            minutes: hour.map(|_| 60),
            ..event(uid, title, date)
        }
    }

    fn titulos(c: &Connection, date: &str) -> Vec<String> {
        list_tasks_for_date(c, date)
            .unwrap()
            .into_iter()
            .map(|t| t.title)
            .collect()
    }

    #[test]
    fn las_reuniones_entran_ordenadas_por_hora() {
        // El feed las entrega en el orden que se le antoja a Google, y entrando
        // al final de la columna la semana quedaba desordenada mientras el rail
        // —que ordena por hora— mostraba otra cosa.
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[
                event_at("c@x", "tarde", "2026-08-10", Some("16:00")),
                event_at("a@x", "mañana", "2026-08-10", Some("09:00")),
                event_at("b@x", "mediodía", "2026-08-10", Some("13:00")),
            ],
            None,
        )
        .unwrap();
        assert_eq!(titulos(&c, "2026-08-10"), ["mañana", "mediodía", "tarde"]);
    }

    #[test]
    fn el_dia_completo_va_arriba() {
        // Mismo criterio que el rail: un feriado no tiene dónde caer en la
        // escala de horas, así que va como franja arriba de la grilla. En la
        // columna, arriba de todo.
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[
                event_at("b@x", "reunión", "2026-08-10", Some("09:00")),
                event_at("a@x", "feriado", "2026-08-10", None),
            ],
            None,
        )
        .unwrap();
        assert_eq!(titulos(&c, "2026-08-10"), ["feriado", "reunión"]);

        // Y también cuando el día ya tiene cosas: un feriado que entra hoy no
        // queda colgado en la mitad de la columna.
        create_task(&c, new_task("a mano", Some("2026-08-11"))).unwrap();
        import_events(
            &c,
            f.id,
            &[event_at("c@x", "reunión", "2026-08-11", Some("09:00"))],
            None,
        )
        .unwrap();
        import_events(
            &c,
            f.id,
            &[event_at("d@x", "otro feriado", "2026-08-11", None)],
            None,
        )
        .unwrap();
        // La reunión entró **detrás** de la tarea a mano: ya estaba ahí y un
        // evento nuevo no desplaza nada tuyo. El feriado sí va arriba de todo.
        assert_eq!(
            titulos(&c, "2026-08-11"),
            ["otro feriado", "a mano", "reunión"]
        );
    }

    #[test]
    fn una_tarea_a_mano_entre_dos_reuniones_se_queda_donde_la_dejaste() {
        // La columna del día **es** el plan del día: si arrastraste una tarea al
        // hueco entre dos reuniones, ahí es donde pensabas hacerla, y ahí es
        // donde el rail la proyecta. Un orden "reuniones primero, tareas
        // después" impuesto por la app haría imposible planificar con las cards.
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[
                event_at("a@x", "09:00", "2026-08-10", Some("09:00")),
                event_at("c@x", "16:00", "2026-08-10", Some("16:00")),
            ],
            None,
        )
        .unwrap();
        let t = create_task(&c, new_task("a mano", Some("2026-08-10"))).unwrap();
        move_task(&c, t.id, Some("2026-08-10"), 1).unwrap();
        assert_eq!(titulos(&c, "2026-08-10"), ["09:00", "a mano", "16:00"]);

        // Entra una reunión nueva a mediodía: se ubica por hora sin sacar la
        // tarea de su hueco.
        import_events(
            &c,
            f.id,
            &[event_at("b@x", "12:00", "2026-08-10", Some("12:00"))],
            None,
        )
        .unwrap();
        assert_eq!(
            titulos(&c, "2026-08-10"),
            ["09:00", "a mano", "12:00", "16:00"],
            "la nueva entra detrás de la última reunión anterior a su hora"
        );

        // Y una pasada que no mueve nada tampoco la toca.
        import_events(
            &c,
            f.id,
            &[event_at("a@x", "09:00", "2026-08-10", Some("09:00"))],
            None,
        )
        .unwrap();
        assert_eq!(
            titulos(&c, "2026-08-10"),
            ["09:00", "a mano", "12:00", "16:00"]
        );
    }

    #[test]
    fn una_tanda_desordenada_entra_ordenada_sin_pisar_las_tareas_a_mano() {
        // El caso que corre de verdad cada cinco minutos: la columna ya tiene
        // tareas a mano y llega un puñado de eventos nuevos en cualquier orden.
        // Cada ubicación renumera el día, así que lo que hay que fijar es que la
        // anterior no se deshace.
        let c = conn();
        let f = feed(&c);
        let a = create_task(&c, new_task("a mano 1", Some("2026-08-10"))).unwrap();
        let b = create_task(&c, new_task("a mano 2", Some("2026-08-10"))).unwrap();
        import_events(
            &c,
            f.id,
            &[
                event_at("d@x", "16:00", "2026-08-10", Some("16:00")),
                event_at("a@x", "feriado", "2026-08-10", None),
                event_at("c@x", "13:00", "2026-08-10", Some("13:00")),
                event_at("b@x", "09:00", "2026-08-10", Some("09:00")),
            ],
            None,
        )
        .unwrap();
        assert_eq!(
            titulos(&c, "2026-08-10"),
            ["feriado", "a mano 1", "a mano 2", "09:00", "13:00", "16:00"],
            "los eventos quedan en orden de reloj y las de a mano no se mueven"
        );

        // Y ubicar dentro del mismo día no es "mover": el historial de una tarea
        // a mano que nadie tocó tiene que quedar limpio.
        for t in [a.id, b.id] {
            let tipos: Vec<String> = list_task_events(&c, t)
                .unwrap()
                .into_iter()
                .map(|e| e.type_field().to_string())
                .collect();
            assert!(
                !tipos.iter().any(|k| k == "MOVED"),
                "la renumeración no puede registrarse como un movimiento: {tipos:?}"
            );
        }
    }

    #[test]
    fn un_evento_que_cambia_de_hora_se_reubica() {
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[
                event_at("a@x", "primera", "2026-08-10", Some("09:00")),
                event_at("b@x", "segunda", "2026-08-10", Some("13:00")),
            ],
            None,
        )
        .unwrap();
        // La segunda se mueve a las 8: pasa a ir primero.
        import_events(
            &c,
            f.id,
            &[event_at("b@x", "segunda", "2026-08-10", Some("08:00"))],
            None,
        )
        .unwrap();
        assert_eq!(titulos(&c, "2026-08-10"), ["segunda", "primera"]);
    }

    #[test]
    fn una_sincronizacion_que_no_mueve_nada_respeta_el_orden_del_tablero() {
        // La columna es del usuario: si arrastró una tarea a mano arriba de la
        // reunión, el poller no puede deshacerlo cada cinco minutos.
        let c = conn();
        let f = feed(&c);
        let t = create_task(&c, new_task("a mano", Some("2026-08-10"))).unwrap();
        import_events(
            &c,
            f.id,
            &[event_at("a@x", "reunión", "2026-08-10", Some("09:00"))],
            None,
        )
        .unwrap();
        move_task(&c, t.id, Some("2026-08-10"), 0).unwrap();
        assert_eq!(titulos(&c, "2026-08-10"), ["a mano", "reunión"]);

        import_events(
            &c,
            f.id,
            &[event_at("a@x", "reunión", "2026-08-10", Some("09:00"))],
            None,
        )
        .unwrap();
        assert_eq!(
            titulos(&c, "2026-08-10"),
            ["a mano", "reunión"],
            "el arrastre sobrevive a la sincronización"
        );
    }

    #[test]
    fn la_marca_de_agenda_vale_para_toda_la_serie() {
        // El almuerzo es semanal: marcar el del lunes tiene que marcar el del
        // martes, o habría que repetir la marca para siempre.
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[
                event("lunch@x#20260810T131500", "Lunch", "2026-08-10"),
                event("lunch@x#20260811T131500", "Lunch", "2026-08-11"),
                event("otra@x", "Daily", "2026-08-10"),
            ],
            None,
        )
        .unwrap();
        let lunes = list_tasks_for_date(&c, "2026-08-10").unwrap();
        let almuerzo = lunes.iter().find(|t| t.title == "Lunch").unwrap();
        assert!(!almuerzo.rail_only, "nace como tarjeta normal");

        set_series_rail_only(&c, almuerzo.id, true).unwrap();

        let lunes = list_tasks_for_date(&c, "2026-08-10").unwrap();
        assert!(lunes.iter().find(|t| t.title == "Lunch").unwrap().rail_only);
        assert!(
            !lunes.iter().find(|t| t.title == "Daily").unwrap().rail_only,
            "otra serie no se lleva la marca"
        );
        assert!(
            list_tasks_for_date(&c, "2026-08-11").unwrap()[0].rail_only,
            "la repetición del martes también"
        );
    }

    #[test]
    fn un_bloque_de_agenda_no_cuenta_al_reordenar_la_columna() {
        // El índice que manda la vista se cuenta contra las cards que se ven, y
        // un bloque de agenda no es una de ellas: sin descontarlo, la card
        // soltada al final aterrizaba antes del almuerzo.
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[event_at("lunch@x#1", "Lunch", "2026-08-10", Some("13:15"))],
            None,
        )
        .unwrap();
        let lunch = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;
        set_series_rail_only(&c, lunch, true).unwrap();

        let a = create_task(&c, new_task("a", Some("2026-08-10"))).unwrap();
        let b = create_task(&c, new_task("b", Some("2026-08-10"))).unwrap();

        // "b" al final de una columna que la vista ve con dos cards.
        move_task(&c, b.id, Some("2026-08-10"), 2).unwrap();
        let vistas: Vec<String> = list_tasks_for_date(&c, "2026-08-10")
            .unwrap()
            .into_iter()
            .filter(|t| !t.rail_only)
            .map(|t| t.title)
            .collect();
        assert_eq!(vistas, ["a", "b"]);
        assert_eq!(a.title, "a", "la primera sigue siendo la primera");
    }

    #[test]
    fn ignorar_no_toca_la_repeticion_que_ya_trabajaste() {
        // Dos trampas de una sola regla. La del taxímetro es la misma que
        // documenta `reconcile_feed`: ignorar la saca del tablero **y** de Focus,
        // así que dejaría el timer corriendo sobre algo que no podés ver ni
        // detener. Y una trabajada que se esconde deja su tiempo contado en la
        // review: el estado partido de la migración 6.
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[
                event_at("lunch@x#1", "Lunch", "2026-08-10", Some("13:15")),
                event_at("lunch@x#2", "Lunch", "2026-08-11", Some("13:15")),
                event_at("lunch@x#3", "Lunch", "2026-08-12", Some("13:15")),
            ],
            None,
        )
        .unwrap();
        let corriendo = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;
        let hecha = list_tasks_for_date(&c, "2026-08-11").unwrap()[0].id;
        let intacta = list_tasks_for_date(&c, "2026-08-12").unwrap()[0].id;
        start_timer(&c, corriendo).unwrap();
        set_task_status(&c, hecha, "DONE").unwrap();

        set_series_rail_only(&c, intacta, true).unwrap();

        assert!(
            !get_task(&c, corriendo).unwrap().unwrap().rail_only,
            "con el taxímetro corriendo se queda como tarjeta, para poder pararlo"
        );
        assert!(
            !get_task(&c, hecha).unwrap().unwrap().rail_only,
            "la que completaste es historia y sigue en la review"
        );
        assert!(get_task(&c, intacta).unwrap().unwrap().rail_only);

        // Y desmarcar sí las toca todas: si no, una podría quedarse ignorada
        // para siempre.
        set_series_rail_only(&c, intacta, false).unwrap();
        for id in [corriendo, hecha, intacta] {
            assert!(!get_task(&c, id).unwrap().unwrap().rail_only);
        }
    }

    #[test]
    fn un_bloque_de_agenda_lo_ignora_todo_menos_el_rail() {
        // "Ignorarlo" es literal: la única lectura que lo sigue viendo es la que
        // dibuja el rail (`list_tasks_for_date`, que el front filtra para la
        // columna). Todo lo demás lo trata como si no estuviera.
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[event_at("lunch@x#1", "Lunch", "2026-08-10", Some("13:15"))],
            None,
        )
        .unwrap();
        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;

        // Antes de marcarlo está en todas.
        assert_eq!(focus_queue(&c, "2026-08-10", "09:00").unwrap().len(), 1);
        assert_eq!(meetings_for_date(&c, "2026-08-10").unwrap().len(), 1);
        assert_eq!(last_day_with_tasks(&c, "2026-08-11").unwrap().as_deref(), Some("2026-08-10"));
        let antes = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(antes.planned_minutes, 60);
        assert!(antes.total_seconds > 0, "la regla 3 cuenta la reunión sin trackear");

        set_series_rail_only(&c, id, true).unwrap();

        assert!(focus_queue(&c, "2026-08-10", "09:00").unwrap().is_empty());
        assert!(
            meetings_for_date(&c, "2026-08-10").unwrap().is_empty(),
            "tampoco avisa antes de empezar"
        );
        assert_eq!(last_day_with_tasks(&c, "2026-08-11").unwrap(), None);
        let despues = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(despues.planned_minutes, 0);
        assert_eq!(despues.total_seconds, 0, "no cuenta como tiempo trabajado");

        // Pero el rail lo sigue viendo, que es todo el punto.
        assert_eq!(list_tasks_for_date(&c, "2026-08-10").unwrap().len(), 1);
    }

    #[test]
    fn una_repeticion_nueva_de_una_serie_marcada_nace_marcada() {
        // Lo que hace que la marca no haya que renovarla cada semana: la
        // preferencia vive por serie y la hereda lo que todavía no existe.
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[event("lunch@x#20260810T131500", "Lunch", "2026-08-10")],
            None,
        )
        .unwrap();
        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;
        set_series_rail_only(&c, id, true).unwrap();

        import_events(
            &c,
            f.id,
            &[event("lunch@x#20260901T131500", "Lunch", "2026-09-01")],
            None,
        )
        .unwrap();
        assert!(list_tasks_for_date(&c, "2026-09-01").unwrap()[0].rail_only);
    }

    #[test]
    fn desmarcar_la_serie_la_devuelve_al_tablero() {
        let c = conn();
        let f = feed(&c);
        import_events(
            &c,
            f.id,
            &[event("lunch@x#20260810T131500", "Lunch", "2026-08-10")],
            None,
        )
        .unwrap();
        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;
        set_series_rail_only(&c, id, true).unwrap();
        set_series_rail_only(&c, id, false).unwrap();
        assert!(!list_tasks_for_date(&c, "2026-08-10").unwrap()[0].rail_only);

        // Y la repetición nueva ya no la hereda.
        import_events(
            &c,
            f.id,
            &[event("lunch@x#20260901T131500", "Lunch", "2026-09-01")],
            None,
        )
        .unwrap();
        assert!(!list_tasks_for_date(&c, "2026-09-01").unwrap()[0].rail_only);
    }

    #[test]
    fn una_tarea_a_mano_no_se_puede_marcar_como_bloque_de_agenda() {
        // No tiene serie que marcar, y la marca no significa nada en algo que el
        // usuario ya puso donde quería.
        let c = conn();
        let t = create_task(&c, new_task("a mano", Some("2026-08-10"))).unwrap();
        assert!(set_series_rail_only(&c, t.id, true).is_err());
    }

    #[test]
    fn importar_dos_veces_el_mismo_uid_no_duplica_y_actualiza() {
        // Es el caso normal: el poller vuelve a pasar cada 15 minutos. Sin
        // upsert, cada sincronización llenaría el día de copias.
        let c = conn();
        let f = feed(&c);
        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], None).unwrap();

        let mut moved = event("a@x", "Daily (movido)", "2026-08-11");
        moved.hour = Some("15:30".into());
        import_events(&c, f.id, &[moved], None).unwrap();

        assert!(list_tasks_for_date(&c, "2026-08-10").unwrap().is_empty());
        let del_11 = list_tasks_for_date(&c, "2026-08-11").unwrap();
        assert_eq!(del_11.len(), 1, "una sola fila, no dos");
        assert_eq!(del_11[0].title, "Daily (movido)");
        assert_eq!(del_11[0].scheduled_time, Some("15:30".to_string()));
    }

    #[test]
    fn la_sincronizacion_no_pisa_lo_que_tocaste_a_mano() {
        // Lo más importante del upsert: una reunión que completaste, que
        // cronometraste o que recategorizaste tiene que sobrevivir a la próxima
        // pasada del poller. Si no, trabajar sobre una tarea de calendario es
        // tirar el trabajo a la basura cada 15 minutos.
        let c = conn();
        let f = feed(&c);
        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], Some(7)).unwrap();
        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;

        set_task_status(&c, id, "DONE").unwrap();
        set_actual_seconds(&c, id, 1800).unwrap();
        update_task(
            &c,
            id,
            TaskPatch {
                category_id: Some(Some(3)),
                ..Default::default()
            },
        )
        .unwrap();

        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], Some(7)).unwrap();

        let t = get_task(&c, id).unwrap().unwrap();
        assert_eq!(t.status, "DONE", "no revive una reunión completada");
        assert_eq!(t.actual_seconds, 1800, "no borra el tiempo trackeado");
        assert_eq!(t.category_id, Some(3), "la categoría a mano le gana al feed");
    }

    #[test]
    fn el_link_de_la_reunion_se_guarda_y_se_actualiza() {
        // El link vive en su propia columna justamente para poder actualizarlo:
        // si estuviera dentro de `notes`, refrescarlo pisaría lo que el usuario
        // escribió ahí.
        let c = conn();
        let f = feed(&c);
        let mut ev = event("a@x", "Daily", "2026-08-10");
        ev.link = Some("https://meet.google.com/abc-defg-hij".into());
        import_events(&c, f.id, &[ev.clone()], None).unwrap();

        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;
        assert_eq!(
            get_task(&c, id).unwrap().unwrap().meeting_url.as_deref(),
            Some("https://meet.google.com/abc-defg-hij")
        );

        ev.link = Some("https://meet.google.com/nuevo-link-xyz".into());
        import_events(&c, f.id, &[ev], None).unwrap();
        assert_eq!(
            get_task(&c, id).unwrap().unwrap().meeting_url.as_deref(),
            Some("https://meet.google.com/nuevo-link-xyz")
        );
    }

    #[test]
    fn la_sync_no_toca_las_notas() {
        // Corolario de tener columna propia para el link: las notas son del
        // usuario y ninguna sincronización las pisa.
        let c = conn();
        let f = feed(&c);
        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], None).unwrap();
        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;

        update_task(
            &c,
            id,
            TaskPatch {
                notes: Some("preguntar por el presupuesto".into()),
                ..Default::default()
            },
        )
        .unwrap();
        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], None).unwrap();

        assert_eq!(
            get_task(&c, id).unwrap().unwrap().notes.as_deref(),
            Some("preguntar por el presupuesto")
        );
    }

    #[test]
    fn importar_devuelve_los_uids_vistos() {
        // El reconciler (M3.2) los necesita para saber qué dejó de venir en el
        // feed. Se devuelven ya, para no cambiarle la firma después.
        let c = conn();
        let f = feed(&c);
        let seen = import_events(
            &c,
            f.id,
            &[
                event("a@x", "Uno", "2026-08-10"),
                event("b@x", "Dos", "2026-08-11"),
            ],
            None,
        )
        .unwrap();
        assert_eq!(seen, vec!["a@x".to_string(), "b@x".to_string()]);
    }

    #[test]
    fn dos_feeds_pueden_traer_el_mismo_uid() {
        // El UNIQUE es (feed_id, calendar_uid): el mismo evento invitado a dos
        // calendarios distintos no puede tumbar la importación.
        let c = conn();
        let a = feed(&c);
        let b = create_calendar_feed(&c, "Personal", "https://otro.ics", None, 15).unwrap();
        import_events(&c, a.id, &[event("compartido@x", "Reunión", "2026-08-10")], None).unwrap();
        import_events(&c, b.id, &[event("compartido@x", "Reunión", "2026-08-10")], None).unwrap();
        assert_eq!(list_tasks_for_date(&c, "2026-08-10").unwrap().len(), 2);
    }

    #[test]
    fn elegir_el_canal_tambien_etiqueta_lo_ya_importado() {
        // El punto del canal por defecto es no etiquetar a mano. Si solo valiera
        // para lo que entra después, quedarían todas las reuniones ya
        // importadas sin tag y habría que hacerlo una por una.
        let c = conn();
        let f = feed(&c);
        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], None).unwrap();
        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;
        assert_eq!(get_task(&c, id).unwrap().unwrap().category_id, None);

        update_calendar_feed(&c, f.id, "Trabajo", "https://x/y.ics", Some(7), true, 15).unwrap();

        assert_eq!(get_task(&c, id).unwrap().unwrap().category_id, Some(7));
    }

    #[test]
    fn cambiar_el_canal_del_feed_no_pisa_el_que_pusiste_a_mano() {
        // Corolario del anterior, y la parte que lo hace seguro: tu elección
        // manual le gana al default del feed, igual que en el upsert.
        let c = conn();
        let f = feed(&c);
        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], None).unwrap();
        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;
        update_task(
            &c,
            id,
            TaskPatch {
                category_id: Some(Some(3)),
                ..Default::default()
            },
        )
        .unwrap();

        update_calendar_feed(&c, f.id, "Trabajo", "https://x/y.ics", Some(7), true, 15).unwrap();

        assert_eq!(get_task(&c, id).unwrap().unwrap().category_id, Some(3));
    }

    #[test]
    fn el_canal_por_defecto_no_toca_otros_feeds() {
        let c = conn();
        let a = feed(&c);
        let b = create_calendar_feed(&c, "Personal", "https://otro.ics", None, 15).unwrap();
        import_events(&c, b.id, &[event("b@x", "Otra", "2026-08-10")], None).unwrap();
        let id_b = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;

        update_calendar_feed(&c, a.id, "Trabajo", "https://x/y.ics", Some(7), true, 15).unwrap();

        assert_eq!(get_task(&c, id_b).unwrap().unwrap().category_id, None);
    }

    /// Crea una tarea de calendario y devuelve su id.
    fn imported(c: &Connection, feed_id: i64, uid: &str, date: &str) -> i64 {
        let mut ev = event(uid, "Reunión", date);
        ev.date = date.into();
        import_events(c, feed_id, &[ev], None).unwrap();
        list_tasks_for_date(c, date).unwrap().last().unwrap().id
    }

    #[test]
    fn borra_la_reunion_futura_que_desaparecio_del_feed() {
        // El caso del usuario: borró el evento en Google y la tarea seguía viva.
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "a@x", "2026-08-20");

        let (deleted, orphaned) = reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap().totals();

        assert_eq!((deleted, orphaned), (1, 0));
        assert!(get_task(&c, id).unwrap().is_none());
    }

    #[test]
    fn el_reconciler_dice_cuales_toco_y_no_solo_cuantas() {
        // Un "3 borradas" a secas no se puede reconstruir después: las filas ya
        // no existen. Y lo que desaparece del feed casi nunca es un evento
        // borrado —Google parte series y cambia UIDs—, así que el nombre es lo
        // único que deja entender qué pasó.
        let c = conn();
        let f = feed(&c);
        let futura = imported(&c, f.id, "futura@x", "2026-08-20");
        let trabajada = imported(&c, f.id, "trabajada@x", "2026-08-20");
        let vieja = imported(&c, f.id, "vieja@x", "2026-08-01");
        start_timer(&c, trabajada).unwrap();
        stop_timer(&c).unwrap();
        for (id, titulo) in [
            (futura, "Kaio"),
            (trabajada, "Weekly"),
            (vieja, "Retro"),
        ] {
            c.execute("UPDATE tasks SET title = ?2 WHERE id = ?1", params![id, titulo])
                .unwrap();
        }

        let hecho = reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap();

        assert_eq!(hecho.totals(), (1, 2));
        assert_eq!(hecho.deleted.len(), 1);
        assert_eq!(hecho.deleted[0].to_string(), "«Kaio» del 2026-08-20");
        assert_eq!(hecho.released[0].to_string(), "«Weekly» del 2026-08-20");
        assert_eq!(hecho.orphaned[0].to_string(), "«Retro» del 2026-08-01");
        assert!(hecho.hubo_cambios());
    }

    #[test]
    fn la_reunion_trabajada_se_suelta_del_feed_y_sigue_visible() {
        // Ese tiempo es tuyo: que alguien cancele la reunión en Google no puede
        // borrar una hora que ya trabajaste. Y marcarla `ORPHANED` la sacaba de
        // TODOS los listados, así que una reunión hecha desaparecía del tablero
        // y del rail. Se suelta del feed y se queda: dejó de ser del calendario.
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "a@x", "2026-08-20");
        start_timer(&c, id).unwrap();
        stop_timer(&c).unwrap();

        let (deleted, touched) = reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap().totals();

        assert_eq!((deleted, touched), (0, 1));
        let t = get_task(&c, id).unwrap().unwrap();
        assert_eq!(t.source_state, "ACTIVE", "tiene que seguir en los listados");
        assert_eq!(t.feed_id, None);
        // `calendar_uid` también se limpia: si el evento vuelve, entra como una
        // tarea nueva en vez de chocar con el `UNIQUE(feed_id, calendar_uid)`.
        assert_eq!(t.calendar_uid, None);
        assert!(t.actual_seconds >= 0);
    }

    #[test]
    fn al_soltarse_del_feed_deja_de_ser_bloque_de_agenda() {
        // Un bloque de agenda no es tarjeta del tablero. Si al liberarse del
        // feed conservara la marca, quedaría una tarea con tiempo trackeado
        // encima que ya no se ve en ninguna columna y sin forma de recuperarla
        // desde ahí.
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "lunch@x#20260820T131500", "2026-08-20");
        set_series_rail_only(&c, id, true).unwrap();
        start_timer(&c, id).unwrap();
        stop_timer(&c).unwrap();

        reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap();

        let t = get_task(&c, id).unwrap().unwrap();
        assert_eq!(t.feed_id, None);
        assert!(!t.rail_only, "vuelve al tablero como una tarea cualquiera");
    }

    #[test]
    fn no_toca_la_reunion_con_el_taximetro_corriendo() {
        // Ni borrarla ni marcarla ORPHANED: las dos la sacan del tablero, y con
        // el timer corriendo eso deja la cuenta andando sobre algo invisible que
        // ya no se puede detener desde ahí.
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "a@x", "2026-08-20");
        start_timer(&c, id).unwrap(); // queda una entrada ABIERTA

        let (deleted, orphaned) = reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap().totals();

        assert_eq!((deleted, orphaned), (0, 0));
        assert_eq!(get_task(&c, id).unwrap().unwrap().source_state, "ACTIVE");
        assert!(get_active_timer(&c).unwrap().is_some());
    }

    #[test]
    fn al_pausar_el_timer_la_reunion_ya_se_puede_resolver() {
        // La protección es solo mientras corre: pausada, la reunión vuelve a las
        // reglas normales y queda ORPHANED por tener tiempo trackeado.
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "a@x", "2026-08-20");
        start_timer(&c, id).unwrap();
        stop_timer(&c).unwrap();

        let (deleted, orphaned) = reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap().totals();

        assert_eq!((deleted, orphaned), (0, 1));
    }

    #[test]
    fn la_reunion_completada_tampoco_se_borra_y_se_suelta_del_feed() {
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "a@x", "2026-08-20");
        set_task_status(&c, id, "DONE").unwrap();

        let (deleted, touched) = reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap().totals();

        assert_eq!((deleted, touched), (0, 1));
        let t = get_task(&c, id).unwrap().unwrap();
        assert_eq!(t.source_state, "ACTIVE");
        assert_eq!(t.feed_id, None);
    }

    #[test]
    fn la_reunion_pasada_que_nunca_se_trabajo_sigue_quedando_orphaned() {
        // La otra mitad de la regla: sin tiempo ni completar, nunca fue tuya.
        // Soltarla la haría reaparecer para siempre en su día, sin nada que la
        // saque de ahí (el carry-over no toca las de calendario).
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "a@x", "2026-08-01");

        reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap();

        let t = get_task(&c, id).unwrap().unwrap();
        assert_eq!(t.source_state, "ORPHANED");
        assert_eq!(t.feed_id, Some(f.id), "sigue siendo del feed");
    }

    #[test]
    fn no_borra_las_reuniones_pasadas() {
        // Esto no es un detalle: la ventana de import arranca HOY, así que cada
        // mañana las reuniones de ayer dejan de venir en el feed. Sin el filtro,
        // la primera sync del día borraría toda la historia de reuniones.
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "a@x", "2026-08-01");

        let (deleted, orphaned) = reconcile_feed(&c, f.id, &[], "2026-08-13").unwrap().totals();

        assert_eq!(deleted, 0, "una reunión pasada nunca se borra sola");
        assert_eq!(orphaned, 1);
        assert!(get_task(&c, id).unwrap().is_some());
    }

    #[test]
    fn no_toca_las_que_siguen_en_el_feed() {
        let c = conn();
        let f = feed(&c);
        let id = imported(&c, f.id, "a@x", "2026-08-20");

        let (deleted, orphaned) = reconcile_feed(&c, f.id, &["a@x".to_string()], "2026-08-13")
            .unwrap()
            .totals();

        assert_eq!((deleted, orphaned), (0, 0));
        assert_eq!(get_task(&c, id).unwrap().unwrap().source_state, "ACTIVE");
    }

    #[test]
    fn no_toca_las_tareas_de_otro_feed_ni_las_escritas_a_mano() {
        let c = conn();
        let a = feed(&c);
        let b = create_calendar_feed(&c, "Personal", "https://otro.ics", None, 15).unwrap();
        let de_b = imported(&c, b.id, "b@x", "2026-08-20");
        let a_mano = create_task(&c, new_task("mía", Some("2026-08-20"))).unwrap().id;

        reconcile_feed(&c, a.id, &[], "2026-08-13").unwrap();

        assert!(get_task(&c, de_b).unwrap().is_some());
        assert!(get_task(&c, a_mano).unwrap().is_some());
    }

    #[test]
    fn el_sello_de_sync_guarda_el_error_y_lo_limpia() {
        let c = conn();
        let f = feed(&c);

        stamp_feed_sync(&c, f.id, Some("el feed no existe (404)")).unwrap();
        let broken = get_calendar_feed(&c, f.id).unwrap().unwrap();
        assert!(broken.last_synced_at.is_some(), "el intento se sella igual");
        assert_eq!(broken.last_error.as_deref(), Some("el feed no existe (404)"));

        stamp_feed_sync(&c, f.id, None).unwrap();
        let healthy = get_calendar_feed(&c, f.id).unwrap().unwrap();
        assert!(healthy.last_error.is_none(), "una sync buena limpia el error");
    }

    #[test]
    fn borrar_el_feed_deja_vivas_sus_tareas() {
        // Con ON DELETE CASCADE, borrar un feed se llevaría reuniones ya
        // completadas y con tiempo encima. Pasan a ser tareas normales.
        let c = conn();
        let f = feed(&c);
        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], None).unwrap();

        delete_calendar_feed(&c, f.id).unwrap();

        let t = &list_tasks_for_date(&c, "2026-08-10").unwrap()[0];
        assert_eq!(t.title, "Daily");
        assert_eq!(t.feed_id, None);
        assert!(list_calendar_feeds(&c).unwrap().is_empty());
    }

    #[test]
    fn la_tarea_importada_arranca_con_historial() {
        // Si no, el modal de una reunión muestra el historial vacío y parece
        // que la tarea apareció de la nada.
        let c = conn();
        let f = feed(&c);
        import_events(&c, f.id, &[event("a@x", "Daily", "2026-08-10")], None).unwrap();
        let id = list_tasks_for_date(&c, "2026-08-10").unwrap()[0].id;
        let evs = list_task_events(&c, id).unwrap();
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, "CREATED");
    }

    // -----------------------------------------------------------------------
    // Rollup semanal
    // -----------------------------------------------------------------------

    /// `'2026-08-10'` + hora local → RFC 3339 UTC. Los tests **no pueden**
    /// escribir la hora en UTC a mano: la atribución es por día local, así que
    /// un literal fijo cae en un día u otro según la zona de quien corra el test.
    fn local(date: &str, hour: u32) -> String {
        let d = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
        chrono::Local
            .from_local_datetime(&d.and_hms_opt(hour, 0, 0).unwrap())
            .single()
            .unwrap()
            .with_timezone(&Utc)
            .to_rfc3339()
    }

    /// Una entrada cerrada de `seconds` segundos, empezada a esa hora local.
    fn entry(c: &Connection, task_id: i64, date: &str, hour: u32, seconds: i64) {
        let start = local(date, hour);
        c.execute(
            "INSERT INTO time_entries (task_id, started_at, ended_at, seconds)
             VALUES (?1, ?2, ?2, ?3)",
            params![task_id, start, seconds],
        )
        .unwrap();
    }

    fn seconds_of_day(r: &WeeklyRollup, date: &str) -> i64 {
        r.days.iter().find(|d| d.date == date).unwrap().seconds
    }

    #[test]
    fn el_tiempo_se_atribuye_a_la_semana_en_que_ocurrio() {
        // Regla 2: mover la tarea a otra semana no puede mover sus horas.
        let c = conn();
        let t = create_task(&c, new_task("análisis", Some("2026-08-10"))).unwrap();
        entry(&c, t.id, "2026-08-11", 10, 3600);
        move_task(&c, t.id, Some("2026-08-19"), 0).unwrap();

        let esta = weekly_rollup(&c, "2026-08-10").unwrap();
        let next = weekly_rollup(&c, "2026-08-17").unwrap();
        assert_eq!(esta.total_seconds, 3600);
        assert_eq!(seconds_of_day(&esta, "2026-08-11"), 3600);
        assert_eq!(next.total_seconds, 0);
        // Lo planificado sí se fue con ella: la asimetría es a propósito.
        assert_eq!(next.planned_minutes, 30);
        assert_eq!(esta.planned_minutes, 0);
    }

    #[test]
    fn el_trabajo_de_la_noche_no_se_va_al_dia_siguiente() {
        // `started_at` está en UTC: agrupar por sus 10 primeros caracteres manda
        // al día siguiente todo lo trabajado de tarde en Chile.
        let c = conn();
        let t = create_task(&c, new_task("nocturna", Some("2026-08-12"))).unwrap();
        entry(&c, t.id, "2026-08-12", 22, 1800);

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(seconds_of_day(&r, "2026-08-12"), 1800);
        assert_eq!(seconds_of_day(&r, "2026-08-13"), 0);
    }

    #[test]
    fn una_reunion_sin_entradas_cuenta_su_duracion_de_evento() {
        // Regla 3: estuviste ahí aunque no encendieras el taxímetro.
        let c = conn();
        let f = feed(&c);
        let mut ev = event("a@x", "Daily", "2026-08-11");
        ev.start = Some(local("2026-08-11", 9));
        ev.end = Some(local("2026-08-11", 10));
        import_events(&c, f.id, &[ev], None).unwrap();

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(seconds_of_day(&r, "2026-08-11"), 3600);
    }

    #[test]
    fn las_entradas_reales_priman_sobre_la_duracion_del_evento() {
        // Basta una entrada para que la reunión deje de usar el respaldo: si no,
        // una reunión trackeada contaría dos veces.
        let c = conn();
        let f = feed(&c);
        let mut ev = event("a@x", "Daily", "2026-08-11");
        ev.start = Some(local("2026-08-11", 9));
        ev.end = Some(local("2026-08-11", 10));
        import_events(&c, f.id, &[ev], None).unwrap();
        let id = list_tasks_for_date(&c, "2026-08-11").unwrap()[0].id;
        entry(&c, id, "2026-08-11", 9, 900);

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(seconds_of_day(&r, "2026-08-11"), 900);
    }

    #[test]
    fn una_reunion_que_todavia_no_empieza_no_cuenta_como_trabajada() {
        let c = conn();
        let f = feed(&c);
        let tomorrow = (chrono::Local::now() + chrono::Duration::days(1)).date_naive();
        let monday = tomorrow - chrono::Duration::days(tomorrow.weekday().num_days_from_monday() as i64);
        let date = tomorrow.format("%Y-%m-%d").to_string();
        let mut ev = event("futura@x", "Kickoff", &date);
        ev.start = Some(local(&date, 9));
        ev.end = Some(local(&date, 10));
        import_events(&c, f.id, &[ev], None).unwrap();

        let r = weekly_rollup(&c, &monday.format("%Y-%m-%d").to_string()).unwrap();
        assert_eq!(r.total_seconds, 0);
        // Pero sí está planificada: es tiempo comprometido, no trabajado.
        assert!(r.planned_minutes > 0);
    }

    #[test]
    fn agrega_por_categoria_y_por_contexto_padre() {
        let c = conn();
        let work = create_category(&c, None, "Trabajo", "sky").unwrap();
        let dev = create_category(&c, Some(work.id), "Dev", "mint").unwrap();
        let support = create_category(&c, Some(work.id), "Soporte", "lavender").unwrap();

        let mk = |title: &str, cat: i64| {
            let mut n = new_task(title, Some("2026-08-11"));
            n.category_id = Some(cat);
            create_task(&c, n).unwrap().id
        };
        let a = mk("feature", dev.id);
        let b = mk("ticket", support.id);
        entry(&c, a, "2026-08-11", 9, 3600);
        entry(&c, b, "2026-08-11", 11, 1800);

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        // Por channel: dos celdas distintas.
        let de = |cat: i64| {
            r.cells
                .iter()
                .filter(|x| x.category_id == Some(cat))
                .map(|x| x.seconds)
                .sum::<i64>()
        };
        assert_eq!(de(dev.id), 3600);
        assert_eq!(de(support.id), 1800);
        // Por contexto: las dos cuelgan de Trabajo.
        let ctx: i64 = r
            .cells
            .iter()
            .filter(|x| x.context_id == Some(work.id))
            .map(|x| x.seconds)
            .sum();
        assert_eq!(ctx, 5400);
    }

    #[test]
    fn el_patch_distingue_null_de_ausente_como_lo_manda_el_front() {
        // El test de abajo construye el patch en Rust, así que **no cruza serde**,
        // que es justo el lado donde el front escribe `null`. Sin este, un `null`
        // que colapse a "no tocar" dejaría "Sin canal" mudo solo dentro de Tauri,
        // con las dos suites en verde (van contra `mockDb`).
        let sacar: ObjectivePatch = serde_json::from_str(r#"{"categoryId": null}"#).unwrap();
        assert!(
            matches!(sacar.category_id, Some(None)),
            "null tiene que llegar como «sácaselo»"
        );
        let no_tocar: ObjectivePatch = serde_json::from_str(r#"{"title": "x"}"#).unwrap();
        assert!(matches!(no_tocar.category_id, None));

        // Lo mismo para `TaskPatch`, que es de donde salió la regla: si acá se
        // cae, "Sin objetivo" y "Sin canal" del detalle de tarea nunca borraron
        // nada en la app real.
        let tarea: TaskPatch = serde_json::from_str(r#"{"objectiveId": null}"#).unwrap();
        assert!(matches!(tarea.objective_id, Some(None)));
    }

    #[test]
    fn el_channel_de_un_objetivo_se_puede_poner_y_sacar() {
        // Es la razón de que `ObjectivePatch.category_id` sea `Option<Option<i64>>`:
        // aplanado a `Option<i64>` no habría forma de expresar "sácaselo".
        let c = conn();
        let cat = create_category(&c, None, "Producto", "sky").unwrap();
        let o = create_objective(&c, "2026-W33", "cerrar Mej.15", Some(cat.id)).unwrap();
        assert_eq!(o.category_id, Some(cat.id));

        // Tildarlo no toca el channel: el campo ausente es "no tocar".
        update_objective(
            &c,
            o.id,
            ObjectivePatch {
                completed: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let leido = &list_objectives(&c, "2026-W33").unwrap()[0];
        assert!(leido.completed);
        assert_eq!(leido.category_id, Some(cat.id));

        // `null` explícito sí lo borra.
        update_objective(
            &c,
            o.id,
            ObjectivePatch {
                category_id: Some(None),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(list_objectives(&c, "2026-W33").unwrap()[0].category_id, None);
    }

    #[test]
    fn traer_un_objetivo_a_otra_semana_lo_manda_al_final_de_esa_lista() {
        // Arrastrar el `position` viejo lo dejaría empatado con uno que ya está
        // ahí, y el recién llegado se metería en medio de la lista.
        let c = conn();
        let primero = create_objective(&c, "2026-W34", "el que ya estaba", None).unwrap();
        let rezagado = create_objective(&c, "2026-W33", "el que quedó atrás", None).unwrap();
        assert_eq!(rezagado.position, 0);

        update_objective(
            &c,
            rezagado.id,
            ObjectivePatch {
                iso_week: Some("2026-W34".into()),
                ..Default::default()
            },
        )
        .unwrap();

        assert!(list_objectives(&c, "2026-W33").unwrap().is_empty());
        let destino = list_objectives(&c, "2026-W34").unwrap();
        let ids: Vec<i64> = destino.iter().map(|o| o.id).collect();
        assert_eq!(ids, vec![primero.id, rezagado.id]);
        assert_eq!(destino[1].position, 1);
    }

    #[test]
    fn traer_un_objetivo_no_le_mueve_las_tareas() {
        // Reagendar lo que ya está en el calendario de otra semana es el error del
        // carry-over (DECISIONES §6): el objetivo llega con su historia atrás.
        let c = conn();
        let o = create_objective(&c, "2026-W33", "arrastrado", None).unwrap();
        let t = create_task(&c, new_task("hecha la semana pasada", Some("2026-08-11"))).unwrap();
        update_task(
            &c,
            t.id,
            TaskPatch {
                objective_id: Some(Some(o.id)),
                ..Default::default()
            },
        )
        .unwrap();

        update_objective(
            &c,
            o.id,
            ObjectivePatch {
                iso_week: Some("2026-W34".into()),
                ..Default::default()
            },
        )
        .unwrap();

        let leida = get_task(&c, t.id).unwrap().unwrap();
        assert_eq!(leida.scheduled_date.as_deref(), Some("2026-08-11"));
        assert_eq!(leida.objective_id, Some(o.id));
    }

    #[test]
    fn el_rango_de_objetivos_ordena_por_semana_y_no_se_confunde_con_la_w9() {
        // El `BETWEEN` compara strings: sin el cero a la izquierda de `isoWeekId`
        // la semana 9 caería después de la 10 y el histórico saldría barajado.
        let c = conn();
        create_objective(&c, "2026-W09", "nueve", None).unwrap();
        create_objective(&c, "2026-W10", "diez", None).unwrap();
        create_objective(&c, "2026-W11", "once", None).unwrap();
        create_objective(&c, "2026-W12", "doce", None).unwrap();

        let r = list_objectives_range(&c, "2026-W09", "2026-W11").unwrap();
        let semanas: Vec<&str> = r.iter().map(|o| o.iso_week.as_str()).collect();
        assert_eq!(semanas, vec!["2026-W09", "2026-W10", "2026-W11"]);
    }

    #[test]
    fn el_rollup_separa_el_tiempo_de_objetivos_del_resto() {
        let c = conn();
        let o = create_objective(&c, "2026-W33", "cerrar Mej.15", None).unwrap();
        let ligada = create_task(&c, new_task("ligada", Some("2026-08-11"))).unwrap();
        update_task(
            &c,
            ligada.id,
            TaskPatch {
                objective_id: Some(Some(o.id)),
                ..Default::default()
            },
        )
        .unwrap();
        let suelta = create_task(&c, new_task("suelta", Some("2026-08-11"))).unwrap();
        entry(&c, ligada.id, "2026-08-11", 9, 600);
        entry(&c, suelta.id, "2026-08-11", 11, 900);

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(r.total_seconds, 1500);
        assert_eq!(r.objective_seconds, 600);
        assert_eq!(r.by_objective.len(), 1);
        assert_eq!(r.by_objective[0].objective_id, o.id);
        assert_eq!(r.by_objective[0].seconds, 600);
    }

    #[test]
    fn una_reunion_sin_entradas_tambien_cuenta_para_su_objetivo() {
        // La Regla 3 vive en una segunda consulta: si `objective_id` faltara ahí,
        // el tiempo de objetivo se perdería justo en las reuniones.
        let c = conn();
        let o = create_objective(&c, "2026-W33", "comité", None).unwrap();
        let t = create_task(&c, new_task("reunión", Some("2026-08-11"))).unwrap();
        c.execute(
            "UPDATE tasks SET source = 'CALENDAR', objective_id = ?2,
                 event_start = ?3, event_end = ?4 WHERE id = ?1",
            params![t.id, o.id, local("2026-08-11", 9), local("2026-08-11", 10)],
        )
        .unwrap();

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(r.objective_seconds, 3600);
    }

    #[test]
    fn una_tarea_sin_channel_tiene_su_propio_grupo() {
        // Un JOIN interno la dejaría fuera y el donut no sumaría el total.
        let c = conn();
        let t = create_task(&c, new_task("suelta", Some("2026-08-11"))).unwrap();
        entry(&c, t.id, "2026-08-11", 9, 600);

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(r.total_seconds, 600);
        assert!(r.cells.iter().any(|x| x.category_id.is_none() && x.seconds == 600));
    }

    #[test]
    fn la_review_sí_cuenta_las_huerfanas() {
        // Es el único listado del proyecto que no filtra `source_state`: las
        // `ORPHANED` existen justamente para el historial y la review.
        let c = conn();
        let t = create_task(&c, new_task("cancelada", Some("2026-08-11"))).unwrap();
        entry(&c, t.id, "2026-08-11", 9, 1200);
        c.execute(
            "UPDATE tasks SET source_state = 'ORPHANED' WHERE id = ?1",
            [t.id],
        )
        .unwrap();

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(r.total_seconds, 1200);
    }

    #[test]
    fn un_ajuste_negativo_no_deja_segundos_bajo_cero() {
        // `set_actual_seconds` guarda el delta, y hacia abajo es negativo.
        let c = conn();
        let t = create_task(&c, new_task("ajustada", Some("2026-08-11"))).unwrap();
        entry(&c, t.id, "2026-08-11", 9, 600);
        entry(&c, t.id, "2026-08-11", 10, -900);

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(r.total_seconds, 0);
        assert!(r.cells.iter().all(|x| x.seconds > 0));
    }

    #[test]
    fn lo_planificado_avisa_las_tareas_sin_estimar() {
        let c = conn();
        let mut sin = new_task("sin estimar", Some("2026-08-12"));
        sin.estimated_minutes = None;
        create_task(&c, sin).unwrap();
        create_task(&c, new_task("estimada", Some("2026-08-12"))).unwrap();

        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        let day = r.days.iter().find(|d| d.date == "2026-08-12").unwrap();
        assert_eq!(day.planned_minutes, 30);
        assert_eq!(day.unestimated, 1);
        assert_eq!(r.unestimated, 1);
    }

    #[test]
    fn lo_completado_se_agrupa_por_el_dia_en_que_se_cerro() {
        let c = conn();
        let t = create_task(&c, new_task("cerrada", Some("2026-08-10"))).unwrap();
        set_task_status(&c, t.id, "DONE").unwrap();
        // Se cerró hoy, no el día en que estaba agendada.
        let today = chrono::Local::now().date_naive();
        let monday = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);

        let r = weekly_rollup(&c, &monday.format("%Y-%m-%d").to_string()).unwrap();
        assert_eq!(r.completed_tasks.len(), 1);
        assert_eq!(r.completed_tasks[0].title, "cerrada");
        let day = r
            .days
            .iter()
            .find(|d| d.date == today.format("%Y-%m-%d").to_string())
            .unwrap();
        assert_eq!(day.done, 1);
    }

    // -----------------------------------------------------------------------
    // Bitácora / cierre del día
    // -----------------------------------------------------------------------

    /// Hace `n` días, en fecha local.
    fn hace(n: i64) -> String {
        (chrono::Local::now().date_naive() - chrono::Duration::days(n))
            .format("%Y-%m-%d")
            .to_string()
    }

    fn day<'a>(b: &'a [LogDay], date: &str) -> &'a LogDay {
        b.iter().find(|d| d.date == date).unwrap()
    }

    #[test]
    fn la_bitacora_se_arma_sola_sin_pasar_por_el_shutdown() {
        // Es la regla que la define: el día se llena del trabajo y de lo
        // cerrado, no de que hayas entrado a cerrarlo.
        let c = conn();
        let t = create_task(&c, new_task("lo de ayer", Some(&hace(1)))).unwrap();
        entry(&c, t.id, &hace(1), 10, 1800);
        set_task_status(&c, t.id, "DONE").unwrap();
        // El cierre se acredita a hoy, así que la tarea sale en el día de hoy.
        c.execute(
            "UPDATE tasks SET completed_at = ?2 WHERE id = ?1",
            params![t.id, local(&hace(1), 11)],
        )
        .unwrap();

        let b = daily_log(&c, &hace(0), 7).unwrap();
        let yesterday = day(&b, &hace(1));
        assert_eq!(yesterday.worked_seconds, 1800);
        assert_eq!(yesterday.done.len(), 1);
        assert_eq!(yesterday.timeline.len(), 1);
        assert_eq!(yesterday.timeline[0].title, "lo de ayer");
        // Y sigue siendo un borrador: nadie lo cerró.
        assert!(yesterday.closed_at.is_none());
        assert!(yesterday.note.is_none());
    }

    #[test]
    fn la_bitacora_va_del_dia_mas_nuevo_al_mas_viejo() {
        let c = conn();
        let b = daily_log(&c, &hace(0), 5).unwrap();
        assert_eq!(b.len(), 5);
        assert_eq!(b[0].date, hace(0));
        assert_eq!(b[4].date, hace(4));
    }

    #[test]
    fn escribir_la_nota_no_cierra_el_dia() {
        // Si escribir cerrara, teclear una letra en el shutdown daría el día por
        // terminado.
        let c = conn();
        set_day_note(&c, "2026-08-12", Some("día raro")).unwrap();

        let b = daily_log(&c, "2026-08-12", 1).unwrap();
        assert_eq!(b[0].note.as_deref(), Some("día raro"));
        assert!(b[0].closed_at.is_none());
    }

    #[test]
    fn una_nota_en_blanco_se_borra_en_vez_de_guardarse() {
        let c = conn();
        set_day_note(&c, "2026-08-12", Some("algo")).unwrap();
        set_day_note(&c, "2026-08-12", Some("   ")).unwrap();

        assert!(daily_log(&c, "2026-08-12", 1).unwrap()[0].note.is_none());
    }

    #[test]
    fn cerrar_el_dia_no_vuelve_a_sellar_la_hora() {
        // "A qué hora cerré" es el dato interesante: volver a entrar no puede
        // reescribirlo.
        let c = conn();
        let first = close_day(&c, "2026-08-12").unwrap();
        let second = close_day(&c, "2026-08-12").unwrap();
        assert_eq!(first, second);

        reopen_day(&c, "2026-08-12").unwrap();
        assert!(daily_log(&c, "2026-08-12", 1).unwrap()[0].closed_at.is_none());
    }

    #[test]
    fn la_nota_de_una_tarea_es_del_dia_en_que_se_trabajo() {
        // No es `tasks.notes`: la misma tarea puede tener una reflexión distinta
        // cada día que la tocas.
        let c = conn();
        let t = create_task(&c, new_task("larga", Some("2026-08-12"))).unwrap();
        set_day_task_note(&c, "2026-08-12", t.id, "arranqué perdido").unwrap();
        set_day_task_note(&c, "2026-08-13", t.id, "salió").unwrap();
        set_task_status(&c, t.id, "DONE").unwrap();
        c.execute(
            "UPDATE tasks SET completed_at = ?2 WHERE id = ?1",
            params![t.id, local("2026-08-13", 15)],
        )
        .unwrap();

        let b = daily_log(&c, "2026-08-13", 2).unwrap();
        assert_eq!(day(&b, "2026-08-13").done[0].note.as_deref(), Some("salió"));
        // La del 12 existe en la tabla, pero la tarea no se cerró ese día.
        assert!(day(&b, "2026-08-12").done.is_empty());

        // Vaciar el resumen **no** la saca de la bitácora: queda incluida y sin
        // texto, que es el estado normal después de apretar "Incluir".
        set_day_task_note(&c, "2026-08-13", t.id, "  ").unwrap();
        let b = daily_log(&c, "2026-08-13", 1).unwrap();
        assert_eq!(b[0].done[0].note.as_deref(), Some(""));
    }

    #[test]
    fn incluir_y_quitar_son_gestos_aparte_de_escribir() {
        // La fila es lo que significa "incluida": si vaciar el texto la borrara,
        // la tarea desaparecería al borrar una palabra.
        let c = conn();
        let t = create_task(&c, new_task("subida", Some("2026-08-12"))).unwrap();
        set_task_status(&c, t.id, "DONE").unwrap();
        c.execute(
            "UPDATE tasks SET completed_at = ?2 WHERE id = ?1",
            params![t.id, local("2026-08-12", 15)],
        )
        .unwrap();

        // Sin incluir: no tiene fila.
        assert!(daily_log(&c, "2026-08-12", 1).unwrap()[0].done[0].note.is_none());

        include_in_log(&c, "2026-08-12", t.id).unwrap();
        assert_eq!(
            daily_log(&c, "2026-08-12", 1).unwrap()[0].done[0].note.as_deref(),
            Some("")
        );

        // Incluir de nuevo no pisa lo escrito.
        set_day_task_note(&c, "2026-08-12", t.id, "quedó lista").unwrap();
        include_in_log(&c, "2026-08-12", t.id).unwrap();
        assert_eq!(
            daily_log(&c, "2026-08-12", 1).unwrap()[0].done[0].note.as_deref(),
            Some("quedó lista")
        );

        remove_from_log(&c, "2026-08-12", t.id).unwrap();
        assert!(daily_log(&c, "2026-08-12", 1).unwrap()[0].done[0].note.is_none());
    }

    #[test]
    fn el_dia_trae_sus_celdas_por_categoria_para_el_donut() {
        let c = conn();
        let cat = create_category(&c, None, "Trabajo", "sky").unwrap();
        let mut n = new_task("con channel", Some("2026-08-12"));
        n.category_id = Some(cat.id);
        let t = create_task(&c, n).unwrap();
        entry(&c, t.id, "2026-08-12", 10, 1200);

        let b = daily_log(&c, "2026-08-12", 1).unwrap();
        assert_eq!(b[0].cells.len(), 1);
        assert_eq!(b[0].cells[0].category_id, Some(cat.id));
        assert_eq!(b[0].cells[0].seconds, 1200);
    }

    #[test]
    fn el_mood_se_guarda_y_se_borra() {
        let c = conn();
        set_day_mood(&c, "2026-08-12", Some("🙂")).unwrap();
        assert_eq!(daily_log(&c, "2026-08-12", 1).unwrap()[0].mood.as_deref(), Some("🙂"));
        set_day_mood(&c, "2026-08-12", None).unwrap();
        assert!(daily_log(&c, "2026-08-12", 1).unwrap()[0].mood.is_none());
    }

    #[test]
    fn el_timeline_muestra_la_corrida_en_curso_aunque_no_haya_sumado() {
        // Es justamente la tarea en la que se está trabajando ahora: sacarla
        // dejaría el timeline sin la fila más relevante del día.
        let c = conn();
        let t = create_task(&c, new_task("en curso", Some(&hace(0)))).unwrap();
        start_timer(&c, t.id).unwrap();

        let b = daily_log(&c, &hace(0), 1).unwrap();
        assert_eq!(b[0].timeline.len(), 1);
        assert!(b[0].timeline[0].running);
        assert_eq!(b[0].timeline[0].seconds, 0);
    }

    #[test]
    fn el_timeline_va_en_el_orden_en_que_se_tomo_el_trabajo() {
        let c = conn();
        let a = create_task(&c, new_task("segunda", Some("2026-08-12"))).unwrap();
        let b_ = create_task(&c, new_task("primera", Some("2026-08-12"))).unwrap();
        entry(&c, a.id, "2026-08-12", 15, 600);
        entry(&c, b_.id, "2026-08-12", 9, 600);

        let b = daily_log(&c, "2026-08-12", 1).unwrap();
        assert_eq!(
            b[0].timeline.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(),
            vec!["primera", "segunda"]
        );
    }

    #[test]
    fn una_fecha_ilegible_da_una_bitacora_vacia() {
        let c = conn();
        assert!(daily_log(&c, "no-es-fecha", 7).unwrap().is_empty());
    }

    #[test]
    fn el_rollup_toma_su_semana_literal_desde_el_dia_que_le_dan() {
        // No encaja al lunes ISO: el contrato es "7 días desde acá", y el mock
        // de `mockDb.ts` tiene que hacer exactamente lo mismo.
        let c = conn();
        let r = weekly_rollup(&c, "2026-08-12").unwrap();
        assert_eq!(r.days[0].date, "2026-08-12");
        assert_eq!(r.days[6].date, "2026-08-18");
    }

    #[test]
    fn la_semana_siempre_trae_sus_siete_dias() {
        let c = conn();
        let r = weekly_rollup(&c, "2026-08-10").unwrap();
        assert_eq!(r.days.len(), 7);
        assert_eq!(r.days[0].date, "2026-08-10");
        assert_eq!(r.days[6].date, "2026-08-16");
        assert_eq!(r.total_seconds, 0);
    }
    // --- Ajuste manual de tiempo: a qué día se acredita (Mej.14) -------------

    #[test]
    fn un_ajuste_manual_se_acredita_al_dia_de_la_tarea_y_no_a_hoy() {
        // El caso del reporte: el lunes corriges las horas de una reunión del
        // sábado. Antes esas horas entraban en el lunes, así que el rail del
        // sábado no las veía y el rollup las contaba en la otra semana.
        let c = conn();
        let sabado = hace(3);
        let t = create_task(&c, new_task("reunión del sábado", Some(&sabado))).unwrap();

        set_actual_seconds(&c, t.id, 1800).unwrap();

        let ese_dia = day_work(&c, &sabado).unwrap();
        assert_eq!(ese_dia.len(), 1);
        assert_eq!(ese_dia[0].seconds, 1800);
        let hoy = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        assert!(
            day_work(&c, &hoy).unwrap().is_empty(),
            "el día en que se escribió el ajuste no debería registrar trabajo"
        );
    }

    /// La hora local del sello de la única entrada de una tarea.
    fn hora_del_sello(c: &Connection, task_id: i64) -> chrono::DateTime<chrono::Local> {
        let e = list_time_entries(c, task_id).unwrap();
        chrono::DateTime::parse_from_rfc3339(&e[0].started_at)
            .unwrap()
            .with_timezone(&chrono::Local)
    }

    #[test]
    fn el_ajuste_cae_en_la_hora_de_la_tarea_cuando_la_tiene() {
        // Una reunión tiene hora, así que el ajuste se acredita ahí en vez de a
        // mediodía. Se mira la entrada y no `day_work`: el rail no dibuja desde
        // el sello (ver el test de abajo), pero el sello sigue siendo el que
        // atribuye el día y la hora.
        let c = conn();
        let dia = hace(2);
        let mut input = new_task("reunión de las 15:30", Some(&dia));
        input.scheduled_time = Some("15:30".into());
        let t = create_task(&c, input).unwrap();

        set_actual_seconds(&c, t.id, 600).unwrap();

        let local = hora_del_sello(&c, t.id);
        assert_eq!((local.hour(), local.minute()), (15, 30));
    }

    #[test]
    fn sin_hora_el_ajuste_cae_al_mediodia_de_ese_dia() {
        // Mediodía y no medianoche: en el salto de primavera la medianoche local
        // no existe y la conversión se queda sin respuesta.
        let c = conn();
        let dia = hace(4);
        let t = create_task(&c, new_task("sin hora", Some(&dia))).unwrap();

        set_actual_seconds(&c, t.id, 300).unwrap();

        let local = hora_del_sello(&c, t.id);
        assert_eq!(local.hour(), 12);
        assert_eq!(local.date_naive().format("%Y-%m-%d").to_string(), dia);
        // Y el día sí queda atribuido: hay trabajo ese día, con sus segundos.
        let filas = day_work(&c, &dia).unwrap();
        assert_eq!(filas[0].seconds, 300);
    }

    #[test]
    fn un_ajuste_a_mano_no_le_da_hora_al_rail() {
        // El sello del ajuste es contable, no la hora en que pasó algo. Con
        // `tracked_at` en `None` el rail no dibuja un bloque a esa hora — que era
        // lo que apilaba media columna al mediodía en un día con varias
        // correcciones. Los segundos sí están.
        let c = conn();
        let dia = hace(3);
        let t = create_task(&c, new_task("solo corregida a mano", Some(&dia))).unwrap();

        set_actual_seconds(&c, t.id, 900).unwrap();

        let filas = day_work(&c, &dia).unwrap();
        assert_eq!(filas.len(), 1);
        assert!(filas[0].tracked_at.is_none(), "un ajuste no es una corrida");
        assert_eq!(filas[0].seconds, 900);
    }

    #[test]
    fn una_corrida_real_le_gana_al_sello_del_ajuste() {
        // El caso del reporte: se trabajó a las 15:41 y después se corrigió el
        // total a mano. Con el mínimo sobre todas las entradas el bloque se iba a
        // las 12:00 —el sello, más temprano que la corrida— y la tarea se dibujaba
        // horas antes de cuando ocurrió.
        let c = conn();
        let dia = hace(5);
        let t = create_task(&c, new_task("trabajada y después corregida", Some(&dia))).unwrap();

        // Una corrida de verdad a las 15:00, y después una corrección a mano de
        // 10 minutos, que se sella al mediodía por no tener hora la tarea.
        local_entry(&c, t.id, &dia, 15, 0, 3600);
        set_seconds_directo(&c, t.id, 3600);
        set_actual_seconds(&c, t.id, 3600 + 600).unwrap();

        let filas = day_work(&c, &dia).unwrap();
        let local = chrono::DateTime::parse_from_rfc3339(filas[0].tracked_at.as_ref().unwrap())
            .unwrap()
            .with_timezone(&chrono::Local);
        assert_eq!(local.hour(), 15, "el bloque va donde corrió el taxímetro");
        assert_eq!(filas[0].seconds, 4200, "los minutos sí son los dos juntos");
    }

    #[test]
    fn una_tarea_del_backlog_o_futura_se_acredita_a_hoy() {
        // Sin fecha no hay día al que acreditar, y mañana no se trabajó: fechar
        // ahí dejaría horas adelante del reloj sumando en un rollup futuro.
        let c = conn();
        let hoy = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        let manana = (chrono::Local::now().date_naive() + chrono::Duration::days(1))
            .format("%Y-%m-%d")
            .to_string();

        let bl = create_task(&c, new_task("del backlog", None)).unwrap();
        let fut = create_task(&c, new_task("de mañana", Some(&manana))).unwrap();
        set_actual_seconds(&c, bl.id, 60).unwrap();
        set_actual_seconds(&c, fut.id, 120).unwrap();

        let de_hoy = day_work(&c, &hoy).unwrap();
        assert_eq!(de_hoy.len(), 2);
        assert!(day_work(&c, &manana).unwrap().is_empty());
    }

    // --- Un recorte que desborda el día de la tarea -------------------------

    /// Una entrada cerrada a una hora **local** de un día, como la que deja el
    /// taxímetro. Las horas importan: agrupar por día local es justamente lo que
    /// se está probando.
    fn entrada(c: &Connection, task_id: i64, dia: &str, hora: u32, segundos: i64) {
        let naive = chrono::NaiveDate::parse_from_str(dia, "%Y-%m-%d")
            .unwrap()
            .and_hms_opt(hora, 0, 0)
            .unwrap();
        let ts = chrono::Local
            .from_local_datetime(&naive)
            .earliest()
            .unwrap()
            .with_timezone(&Utc)
            .to_rfc3339();
        c.execute(
            "INSERT INTO time_entries (task_id, started_at, ended_at, seconds)
             VALUES (?1, ?2, ?2, ?3)",
            params![task_id, ts, segundos],
        )
        .unwrap();
    }

    /// El total de la tarea sin pasar por `set_actual_seconds`: es lo que deja
    /// montar el estado previo a un ajuste sin escribir entradas de ajuste.
    fn set_seconds_directo(c: &Connection, task_id: i64, seconds: i64) {
        c.execute(
            "UPDATE tasks SET actual_seconds = ?2 WHERE id = ?1",
            params![task_id, seconds],
        )
        .unwrap();
    }

    /// Lo que suma un día local para una tarea, **sin el piso en 0** de
    /// `day_work`: es el único modo de ver si quedó en negativo.
    fn saldo(c: &Connection, task_id: i64, dia: &str) -> i64 {
        let (start, end) = {
            let d = local_days(dia, 1);
            (d[0].1.to_rfc3339(), d[0].2.to_rfc3339())
        };
        c.query_row(
            "SELECT COALESCE(SUM(seconds), 0) FROM time_entries
             WHERE task_id = ?1 AND started_at >= ?2 AND started_at < ?3",
            params![task_id, start, end],
            |r| r.get(0),
        )
        .unwrap()
    }

    #[test]
    fn un_recorte_que_desborda_el_dia_de_la_tarea_sale_del_otro_dia() {
        // El caso del reporte: el timer se quedó prendido y cruzó la medianoche,
        // así que `stop_timer` partió el trabajo en dos días. Bajar el total a
        // mano metía **una** fila negativa en el día de la tarea, ese día se iba
        // a −7 horas, el piso en 0 del rollup se comía el sobrante y el día
        // siguiente seguía mostrando las horas del timer olvidado.
        let c = conn();
        let ayer = hace(1);
        let hoy = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        let t = create_task(&c, new_task("timer olvidado", Some(&ayer))).unwrap();
        entrada(&c, t.id, &ayer, 14, 50_000);
        entrada(&c, t.id, &hoy, 2, 37_000);
        set_seconds_directo(&c, t.id, 87_000);

        set_actual_seconds(&c, t.id, 10_800).unwrap();

        // Ningún día en negativo, y el total repartido es el que se pidió.
        assert_eq!(saldo(&c, t.id, &ayer), 0);
        assert_eq!(saldo(&c, t.id, &hoy), 10_800);
        assert_eq!(get_task(&c, t.id).unwrap().unwrap().actual_seconds, 10_800);
    }

    #[test]
    fn el_recorte_empieza_por_el_dia_de_la_tarea_aunque_no_sea_el_ultimo() {
        // La regla de Mej.14 extendida: el ajuste corrige **el día de la tarea**,
        // así que ese día es el primero en absorberlo. Acá el recorte cabe entero
        // ahí, y el otro día no se toca.
        let c = conn();
        let ayer = hace(1);
        let hoy = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        let t = create_task(&c, new_task("dos días", Some(&ayer))).unwrap();
        entrada(&c, t.id, &ayer, 14, 3_600);
        entrada(&c, t.id, &hoy, 2, 3_600);
        set_seconds_directo(&c, t.id, 7_200);

        set_actual_seconds(&c, t.id, 5_400).unwrap();

        assert_eq!(saldo(&c, t.id, &ayer), 1_800);
        assert_eq!(saldo(&c, t.id, &hoy), 3_600);
    }

    #[test]
    fn un_recorte_mayor_que_todo_lo_trabajado_descarta_el_sobrante() {
        // Base vieja: `actual_seconds` dice más de lo que suman las entradas.
        // Escribir el sobrante igual, para que la suma cuadre, es exactamente el
        // bug de arriba: una fila negativa que ningún día puede respaldar. El
        // total de la tarea lo manda `actual_seconds`, no las entradas.
        let c = conn();
        let ayer = hace(1);
        let t = create_task(&c, new_task("descuadrada", Some(&ayer))).unwrap();
        entrada(&c, t.id, &ayer, 14, 1_000);
        set_seconds_directo(&c, t.id, 9_000);

        set_actual_seconds(&c, t.id, 0).unwrap();

        assert_eq!(saldo(&c, t.id, &ayer), 0);
        assert_eq!(get_task(&c, t.id).unwrap().unwrap().actual_seconds, 0);
    }

    #[test]
    fn subir_el_tiempo_sigue_siendo_una_sola_entrada() {
        // El reparto es cosa del recorte. Sumar tiempo se acredita entero al día
        // de la tarea, como siempre.
        let c = conn();
        let ayer = hace(1);
        let t = create_task(&c, new_task("sumar", Some(&ayer))).unwrap();
        entrada(&c, t.id, &ayer, 14, 600);
        set_seconds_directo(&c, t.id, 600);

        set_actual_seconds(&c, t.id, 1_800).unwrap();

        assert_eq!(list_time_entries(&c, t.id).unwrap().len(), 2);
        assert_eq!(saldo(&c, t.id, &ayer), 1_800);
    }

    #[test]
    fn un_ajuste_de_otro_dia_ya_no_cuenta_en_el_contador_del_taximetro() {
        // Consecuencia asumida del cambio, no un descuido: `seconds_today` mide
        // la sesión de hoy (`started_at >= start_of_today`), y un ajuste fechado
        // en otro día queda fuera. Antes aparecía ahí, que era justamente el bug.
        let c = conn();
        let ayer = hace(1);
        let t = create_task(&c, new_task("de ayer", Some(&ayer))).unwrap();

        set_actual_seconds(&c, t.id, 900).unwrap();

        assert_eq!(seconds_today(&c, t.id).unwrap(), 0);
        // Pero el total de la tarea sí lo tiene: no se perdió, cambió de día.
        assert_eq!(get_task(&c, t.id).unwrap().unwrap().actual_seconds, 900);
    }
}
