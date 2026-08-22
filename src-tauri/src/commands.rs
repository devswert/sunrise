//! Comandos Tauri (`#[tauri::command]`) — wrappers delgados sobre `repo`.

use tauri::{Emitter, Manager, State};

use crate::backup;
use crate::db::Db;
use crate::models::{
    ActiveTimer, AppUpdate, BackupFile, CalendarFeed, Category, LogDay, Objective,
    Profile, Rescue, RestoreResult, Task, TaskEvent, TimeEntry, DayWork, WeeklyRollup,
};
use crate::repo::{self, NewTask, TaskPatch};

fn e<E: std::fmt::Display>(err: E) -> String {
    err.to_string()
}

#[tauri::command]
pub fn ping() -> String {
    "pong".into()
}

// --- Tasks ---

#[tauri::command]
pub fn create_task(db: State<'_, Db>, input: NewTask) -> Result<Task, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::create_task(&conn, input).map_err(e)
}

#[tauri::command]
pub fn update_task(db: State<'_, Db>, id: i64, patch: TaskPatch) -> Result<Option<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::update_task(&conn, id, patch).map_err(e)
}

#[tauri::command]
pub fn delete_task(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::delete_task(&conn, id).map_err(e)
}

#[tauri::command]
pub fn set_task_status(
    db: State<'_, Db>,
    id: i64,
    status: String,
) -> Result<Option<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::set_task_status(&conn, id, &status).map_err(e)
}

#[tauri::command]
pub fn move_task(
    db: State<'_, Db>,
    id: i64,
    date: Option<String>,
    position: i64,
) -> Result<Option<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::move_task(&conn, id, date.as_deref(), position).map_err(e)
}

#[tauri::command]
pub fn demote_pending(db: State<'_, Db>, today: String) -> Result<u32, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::demote_pending(&conn, &today).map_err(e)
}

#[tauri::command]
pub fn list_tasks_for_range(
    db: State<'_, Db>,
    start: String,
    end: String,
) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_tasks_for_range(&conn, &start, &end).map_err(e)
}

#[tauri::command]
pub fn list_tasks_for_date(db: State<'_, Db>, date: String) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_tasks_for_date(&conn, &date).map_err(e)
}

#[tauri::command]
pub fn list_backlog(db: State<'_, Db>) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_backlog(&conn).map_err(e)
}

#[tauri::command]
pub fn list_task_events(db: State<'_, Db>, task_id: i64) -> Result<Vec<TaskEvent>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_task_events(&conn, task_id).map_err(e)
}

// --- Timer / time_entries ---

/// Arranca el timer y **toca el timbre de la campana**.
///
/// Sin el timbre, el vigilante (`bell.rs`) tendría que estar mirando el reloj
/// mientras no hay ningún timer, solo para enterarse de que empezó uno. Es una
/// optimización y no el mecanismo: si esto no avisara, la campana saldría tarde,
/// no dejaría de salir.
#[tauri::command]
pub fn start_timer(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    task_id: i64,
) -> Result<ActiveTimer, String> {
    let active = {
        let conn = db.0.lock().map_err(e)?;
        repo::start_timer(&conn, task_id).map_err(e)?
    };
    crate::bell::Armed::poke(&app);
    Ok(active)
}

/// Cierra el timer activo. Devuelve `(task_id, seconds)` si había uno.
#[tauri::command]
pub fn stop_timer(db: State<'_, Db>) -> Result<Option<(i64, i64)>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::stop_timer(&conn).map_err(e)
}

#[tauri::command]
pub fn get_active_timer(db: State<'_, Db>) -> Result<Option<ActiveTimer>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::get_active_timer(&conn).map_err(e)
}

#[tauri::command]
pub fn list_time_entries(db: State<'_, Db>, task_id: i64) -> Result<Vec<TimeEntry>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_time_entries(&conn, task_id).map_err(e)
}

#[tauri::command]
pub fn rescued_from_backlog(db: State<'_, Db>) -> Result<Vec<Rescue>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::rescued_from_backlog(&conn).map_err(e)
}

#[tauri::command]
pub fn day_work(db: State<'_, Db>, date: String) -> Result<Vec<DayWork>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::day_work(&conn, &date).map_err(e)
}

#[tauri::command]
pub fn weekly_rollup(db: State<'_, Db>, week_start: String) -> Result<WeeklyRollup, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::weekly_rollup(&conn, &week_start).map_err(e)
}

#[tauri::command]
pub fn daily_log(db: State<'_, Db>, to_date: String, days: i64) -> Result<Vec<LogDay>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::daily_log(&conn, &to_date, days).map_err(e)
}

#[tauri::command]
pub fn set_day_note(db: State<'_, Db>, date: String, note: Option<String>) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::set_day_note(&conn, &date, note.as_deref()).map_err(e)
}

#[tauri::command]
pub fn set_day_task_note(
    db: State<'_, Db>,
    date: String,
    task_id: i64,
    note: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::set_day_task_note(&conn, &date, task_id, &note).map_err(e)
}

#[tauri::command]
pub fn set_day_mood(db: State<'_, Db>, date: String, mood: Option<String>) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::set_day_mood(&conn, &date, mood.as_deref()).map_err(e)
}

#[tauri::command]
pub fn include_in_log(db: State<'_, Db>, date: String, task_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::include_in_log(&conn, &date, task_id).map_err(e)
}

#[tauri::command]
pub fn remove_from_log(db: State<'_, Db>, date: String, task_id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::remove_from_log(&conn, &date, task_id).map_err(e)
}

#[tauri::command]
pub fn close_day(db: State<'_, Db>, date: String) -> Result<String, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::close_day(&conn, &date).map_err(e)
}

#[tauri::command]
pub fn reopen_day(db: State<'_, Db>, date: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::reopen_day(&conn, &date).map_err(e)
}

#[tauri::command]
pub fn focus_queue(
    db: State<'_, Db>,
    date: String,
    now_hhmm: String,
) -> Result<Vec<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::focus_queue(&conn, &date, &now_hhmm).map_err(e)
}

/// Muestra u oculta el taxímetro.
///
/// Se hace desde Rust a propósito: es el camino más directo (no depende de
/// permisos de la API de ventanas en el webview) y deja rastro en el log,
/// que es justo lo que faltaba cuando la ventana "no aparecía".
#[tauri::command]
pub fn set_taximeter_visible(
    app: tauri::AppHandle,
    visible: bool,
    // (x, y): última posición conocida en coordenadas físicas. Se aplica solo
    // si cae dentro de algún monitor; si no, la ventana va abajo a la derecha.
    x: Option<i32>,
    y: Option<i32>,
) -> Result<bool, String> {
    let Some(win) = app.get_webview_window("floating-timer") else {
        eprintln!("[sunrise] taxímetro: no existe la ventana 'floating-timer'");
        return Err("ventana no encontrada".into());
    };

    if visible {
        win.show().map_err(e)?;
        let _ = win.set_always_on_top(true);
        // Debe ir DESPUÉS de show/always-on-top: en macOS esas llamadas
        // reinician el "collection behavior" y la ventana dejaría de seguirte
        // al cambiar de escritorio (Space).
        let _ = win.set_visible_on_all_workspaces(true);
        if let (Some(x), Some(y)) = (x, y) {
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        }
        ensure_on_screen(&win);
    } else {
        win.hide().map_err(e)?;
    }

    let shown = win.is_visible().unwrap_or(false);
    if visible && !shown {
        eprintln!("[sunrise] taxímetro: pedí mostrarlo pero sigue oculto");
    }
    Ok(shown)
}

/// Reubica el taxímetro si quedó fuera de todos los monitores.
///
/// Ocurría al restaurar una posición guardada: al mezclar coordenadas físicas
/// y lógicas en pantallas Retina, la ventana terminaba en coordenadas absurdas
/// (visible para el sistema, invisible para el usuario).
fn ensure_on_screen(win: &tauri::WebviewWindow) {
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else {
        return;
    };
    let monitors = win.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return;
    }

    let w = size.width as i32;
    let h = size.height as i32;
    let visible_somewhere = monitors.iter().any(|m| {
        let mp = m.position();
        let ms = m.size();
        let (right, bottom) = (mp.x + ms.width as i32, mp.y + ms.height as i32);
        pos.x + w > mp.x + 20 && pos.x < right - 20 && pos.y + h > mp.y + 20 && pos.y < bottom - 20
    });
    if visible_somewhere {
        return;
    }

    // Abajo a la derecha del monitor principal (todo en coordenadas físicas).
    let target = win
        .primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.first().cloned());
    if let Some(m) = target {
        let mp = m.position();
        let ms = m.size();
        let margin = 24;
        let x = mp.x + ms.width as i32 - w - margin;
        let y = mp.y + ms.height as i32 - h - margin * 3;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        eprintln!("[sunrise] taxímetro reubicado a {x},{y} (estaba fuera de pantalla)");
    }
}

/// Ruta donde dejar un audio propio para la campana (se muestra en Settings).
#[tauri::command]
pub fn bell_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(e)?;
    Ok(dir.to_string_lossy().to_string())
}

/// Ajuste manual del tiempo real de una tarea.
#[tauri::command]
pub fn set_actual_seconds(
    db: State<'_, Db>,
    task_id: i64,
    seconds: i64,
) -> Result<Option<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::set_actual_seconds(&conn, task_id, seconds).map_err(e)
}

/// Una tarea por id (para refrescar snapshots, p. ej. el taxímetro).
#[tauri::command]
pub fn get_task(db: State<'_, Db>, id: i64) -> Result<Option<Task>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::get_task(&conn, id).map_err(e)
}

// --- Categories ---

#[tauri::command]
pub fn list_categories(db: State<'_, Db>) -> Result<Vec<Category>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_categories(&conn).map_err(e)
}

#[tauri::command]
pub fn create_category(
    db: State<'_, Db>,
    parent_id: Option<i64>,
    name: String,
    color: String,
) -> Result<Category, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::create_category(&conn, parent_id, &name, &color).map_err(e)
}

#[tauri::command]
pub fn update_category(
    db: State<'_, Db>,
    id: i64,
    name: String,
    color: String,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::update_category(&conn, id, &name, &color).map_err(e)
}

#[tauri::command]
pub fn delete_category(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::delete_category(&conn, id).map_err(e)
}

// --- Objectives ---

#[tauri::command]
pub fn list_objectives(db: State<'_, Db>, iso_week: String) -> Result<Vec<Objective>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_objectives(&conn, &iso_week).map_err(e)
}

#[tauri::command]
pub fn create_objective(
    db: State<'_, Db>,
    iso_week: String,
    title: String,
) -> Result<Objective, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::create_objective(&conn, &iso_week, &title).map_err(e)
}

#[tauri::command]
pub fn update_objective(
    db: State<'_, Db>,
    id: i64,
    title: Option<String>,
    completed: Option<bool>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::update_objective(&conn, id, title.as_deref(), completed).map_err(e)
}

#[tauri::command]
pub fn delete_objective(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::delete_objective(&conn, id).map_err(e)
}

// --- settings ---

#[tauri::command]
pub fn list_settings(db: State<'_, Db>) -> Result<Vec<(String, String)>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_settings(&conn).map_err(e)
}

#[tauri::command]
pub fn set_setting(db: State<'_, Db>, key: String, value: String) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::set_setting(&conn, &key, &value).map_err(e)
}

// --- feeds de calendario ---

#[tauri::command]
pub fn list_calendar_feeds(db: State<'_, Db>) -> Result<Vec<CalendarFeed>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::list_calendar_feeds(&conn).map_err(e)
}

#[tauri::command]
pub fn create_calendar_feed(
    db: State<'_, Db>,
    name: String,
    ics_url: String,
    default_category_id: Option<i64>,
    poll_minutes: i64,
) -> Result<CalendarFeed, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::create_calendar_feed(&conn, &name, &ics_url, default_category_id, poll_minutes).map_err(e)
}

#[tauri::command]
pub fn update_calendar_feed(
    db: State<'_, Db>,
    id: i64,
    name: String,
    ics_url: String,
    default_category_id: Option<i64>,
    import_as_tasks: bool,
    poll_minutes: i64,
) -> Result<Option<CalendarFeed>, String> {
    let conn = db.0.lock().map_err(e)?;
    repo::update_calendar_feed(
        &conn,
        id,
        &name,
        &ics_url,
        default_category_id,
        import_as_tasks,
        poll_minutes,
    )
    .map_err(e)
}

#[tauri::command]
pub fn delete_calendar_feed(db: State<'_, Db>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(e)?;
    repo::delete_calendar_feed(&conn, id).map_err(e)
}

/// Sincroniza un feed: descarga, interpreta e importa.
///
/// Devuelve cuántos eventos entraron. El error de un feed **no se traga**: se
/// guarda en `last_error` para que la UI lo muestre y además vuelve como `Err`.
#[tauri::command]
pub async fn sync_calendar_feed(app: tauri::AppHandle, id: i64) -> Result<usize, String> {
    let n = crate::calendar::sync_one_feed(&app, id).await?;
    let _ = app.emit(crate::CALENDAR_SYNCED, ());
    Ok(n)
}

/// Sincroniza todos los feeds que ya toca. La usa el poller y el botón de
/// "sincronizar ahora".
#[tauri::command]
pub async fn sync_calendar_feeds(app: tauri::AppHandle, force: bool) -> Result<usize, String> {
    Ok(crate::calendar::sync_pending(&app, force).await)
}

// --- ciclo de vida ---

/// Cierra la app de verdad, después de que el usuario confirmó en el diálogo.
///
/// **No detiene el timer**: dejar el taxímetro corriendo entre sesiones es el
/// comportamiento esperado, así que la entrada abierta se conserva tal cual.
///
/// `app.exit` emite `ExitRequested` con `code: Some(_)`, que es justo lo que
/// `lib.rs` usa para distinguir esta salida (ya confirmada) de un ⌘Q del
/// usuario, y dejarla pasar sin volver a preguntar.
#[tauri::command]
pub fn confirm_quit(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

// ---------------------------------------------------------------------------
// Respaldos
// ---------------------------------------------------------------------------

/// Claves de `settings` que usa el respaldo. **Espejo de `SettingKey` en
/// `src/lib/settings.ts`**: si cambia una acá, cambia allá.
const BACKUP_DIR: &str = "backup_dir";
const BACKUP_TIME: &str = "backup_time";
const BACKUP_KEEP: &str = "backup_keep";

/// Cuántos respaldos se conservan si el ajuste falta o trae basura.
/// **Espejo de `SETTING_DEFAULTS.backupKeep`** en el front.
const BACKUP_KEEP_DEFAULT: usize = 2;

/// La versión de la app, fijada al compilar. Es la misma que Tauri le pone al
/// `.dmg` y la que queda escrita en el `manifest.yml` de cada respaldo.
#[tauri::command]
pub fn app_version() -> String {
    backup::APP_VERSION.to_string()
}

/// En qué perfil corre esta ventana, y **sobre qué archivo de base**.
///
/// El front lo necesita para dos cosas concretas, las dos por el mismo motivo:
/// dev y producción se ven idénticas y usan datos distintos (ver `db::archivo`).
/// Sin esto, dos ventanas abiertas son indistinguibles.
#[tauri::command]
pub fn profile() -> Profile {
    Profile {
        dev: cfg!(debug_assertions),
        db_file: crate::db::file_name().to_string(),
    }
}

/// La carpeta de respaldos configurada, o un error explicando que no hay.
fn backup_dir_setting(conn: &rusqlite::Connection) -> Result<std::path::PathBuf, String> {
    let dir = repo::get_setting(conn, BACKUP_DIR)
        .map_err(e)?
        .ok_or("no hay carpeta de respaldos configurada (Configs → Respaldo)")?;
    Ok(std::path::PathBuf::from(dir))
}

/// Cuántos respaldos conservar, según el ajuste.
fn how_many_to_keep(conn: &rusqlite::Connection) -> Result<usize, String> {
    Ok(repo::get_setting(conn, BACKUP_KEEP)
        .map_err(e)?
        .and_then(|v| v.trim().parse::<usize>().ok())
        .unwrap_or(BACKUP_KEEP_DEFAULT))
}

/// Escribe un respaldo nuevo y poda los que sobran.
///
/// Es el mismo camino para el respaldo automático y para el botón: la poda vive
/// dentro de `create_and_prune`, así que no hay forma de respaldar sin podar.
#[tauri::command]
pub fn create_backup(db: State<'_, Db>) -> Result<BackupFile, String> {
    let conn = db.0.lock().map_err(e)?;
    let dir = backup_dir_setting(&conn)?;
    let keep = how_many_to_keep(&conn)?;
    backup::create_and_prune(&conn, &dir, keep, chrono::Local::now()).map_err(e)
}

/// Prueba que la carpeta elegida sirva, antes de guardarla como ajuste.
#[tauri::command]
pub fn test_backup_dir(dir: String) -> Result<(), String> {
    if dir.trim().is_empty() {
        return Err("elige una carpeta".into());
    }
    backup::test_folder(std::path::Path::new(dir.trim())).map_err(e)
}

/// Los respaldos que hay hoy en la carpeta, del más nuevo al más viejo.
#[tauri::command]
pub fn list_backups(db: State<'_, Db>) -> Result<Vec<BackupFile>, String> {
    let conn = db.0.lock().map_err(e)?;
    let Some(dir) = repo::get_setting(&conn, BACKUP_DIR).map_err(e)? else {
        return Ok(vec![]);
    };
    backup::list(std::path::Path::new(&dir)).map_err(e)
}

/// Reemplaza la base viva por la que trae un `.zip`.
///
/// El orden es lo único que importa acá, y está puesto para que **ningún fallo
/// deje la app sin base**:
///
/// 1. Se toma el lock y no se suelta: mientras corre esto, nadie más escribe.
/// 2. La base del zip se extrae, se valida y **se migra** en un temporal. Todo lo
///    que puede fallar por culpa del respaldo falla acá, con la base viva intacta.
/// 3. Se guarda una copia de seguridad de la base viva (`antes-de-restaurar-…`),
///    que la retención nunca borra.
/// 4. Recién entonces se cierra la conexión, se copia encima y se reabre.
///
/// Si el paso 4 falla igual, se intenta volver a la copia de seguridad, y el
/// error nombra el archivo para poder recuperarla a mano.
#[tauri::command]
pub fn restore_backup(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    zip_path: String,
) -> Result<RestoreResult, String> {
    let mut guard = db.0.lock().map_err(e)?;
    let db_path = app.path().app_data_dir().map_err(e)?.join(crate::db::file_name());
    let zip = std::path::Path::new(&zip_path);
    let now = chrono::Local::now();

    // Los ajustes de respaldo describen **esta máquina**, no los datos: sin
    // esto, restaurar un zip hecho antes de configurar la carpeta dejaría
    // `backup_dir` vacío y el respaldo automático se apagaría solo. Es
    // exactamente el fallo silencioso que `backup_last_error` existe para evitar.
    let of_this_machine: Vec<(String, String)> = [BACKUP_DIR, BACKUP_TIME, BACKUP_KEEP]
        .iter()
        .filter_map(|k| {
            repo::get_setting(&guard, k)
                .ok()
                .flatten()
                .map(|v| (k.to_string(), v))
        })
        .collect();

    let supported_schema: i64 = guard
        .query_row("SELECT MAX(version) FROM _migrations", [], |r| r.get(0))
        .map_err(e)?;

    // Se lee antes de tocar nada: después del reemplazo el zip sigue ahí, pero
    // esto es información del respaldo y no del resultado, y así el error de un
    // manifest ilegible no aparece a mitad de la operación.
    let manifest = backup::read_manifest(zip);

    // (2) Todo lo fallible que dependa del zip, antes de tocar la base viva.
    let prepared = tempfile::Builder::new()
        .prefix("sunrise-restaurar-")
        .suffix(".sqlite")
        .tempfile()
        .map_err(e)?
        .into_temp_path();
    std::fs::remove_file(&prepared).map_err(e)?;
    backup::prepare_restore(zip, &prepared, supported_schema).map_err(e)?;

    // (3) La red de seguridad. Va en la carpeta de respaldos si hay una, y si no
    // en el directorio de datos de la app: nunca en ninguna parte.
    let copy_dir = backup_dir_setting(&guard)
        .unwrap_or_else(|_| db_path.parent().map(|p| p.to_path_buf()).unwrap_or_default());
    let copy = backup::safety_snapshot(&guard, &copy_dir, now).map_err(e)?;

    // (4) Punto de no retorno.
    let old = std::mem::replace(
        &mut *guard,
        rusqlite::Connection::open_in_memory().map_err(e)?,
    );
    old.close().map_err(|(_, err)| e(err))?;

    let replacement = (|| -> anyhow::Result<rusqlite::Connection> {
        std::fs::copy(&prepared, &db_path)?;
        // El WAL y el shm que quedaron son de la base anterior: abrir con ellos
        // ahí sería pedirle a SQLite que recupere cambios de otra base.
        for suffix in ["-wal", "-shm"] {
            let sidecar = db_path.with_file_name(format!("{}{suffix}", crate::db::file_name()));
            if sidecar.exists() {
                std::fs::remove_file(&sidecar)?;
            }
        }
        let conn = crate::db::open(&db_path)?;
        crate::db::migrate(&conn)?;
        for (key, value) in &of_this_machine {
            repo::set_setting(&conn, key, value)?;
        }
        Ok(conn)
    })();

    match replacement {
        Ok(conn) => {
            // Se cuenta **sobre la base ya restaurada**: es lo que le permite al
            // usuario darse cuenta de que abrió el zip equivocado. Si la consulta
            // falla no se aborta nada —la restauración ya ocurrió—, solo se
            // informa menos.
            let tasks = conn
                .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
                .unwrap_or(0);
            let last_activity = conn
                .query_row("SELECT MAX(started_at) FROM time_entries", [], |r| r.get(0))
                .unwrap_or(None);
            *guard = conn;
            Ok(RestoreResult {
                from_date: zip_path,
                backup_copy: copy.to_string_lossy().to_string(),
                created_at: manifest.created_at,
                backup_version: manifest.version,
                current_version: backup::APP_VERSION.to_string(),
                tasks,
                last_activity,
            })
        }
        Err(err) => {
            // Último intento: volver a dejar la base como estaba.
            let rollback = (|| -> anyhow::Result<rusqlite::Connection> {
                std::fs::copy(&copy, &db_path)?;
                Ok(crate::db::open(&db_path)?)
            })();
            match rollback {
                Ok(conn) => {
                    let _ = crate::db::migrate(&conn);
                    *guard = conn;
                    Err(format!(
                        "no se pudo restaurar el respaldo ({err}). \
                         La base quedó como estaba antes."
                    ))
                }
                Err(err2) => Err(format!(
                    "no se pudo restaurar el respaldo ({err}) y tampoco volver atrás ({err2}). \
                     Tu base de antes está intacta en {}: cópiala sobre {} con la app cerrada.",
                    copy.display(),
                    db_path.display()
                )),
            }
        }
    }
}

// --- Inicio automático ---
//
// No vive en `settings` a propósito. La verdad la tiene el sistema operativo
// (en macOS, un LaunchAgent en `~/Library/LaunchAgents`), y el usuario lo puede
// desactivar desde Ajustes del sistema sin pasar por acá. Una copia en la tabla
// mentiría la primera vez que eso pase, y encima cruzaría los respaldos: el
// inicio automático describe **esta** máquina, no los datos.
//
// Para qué está: sunrise tiene tres cosas que corren a una hora —el aviso de
// cerrar el día (`work_end`), el respaldo automático (`backup_time`) y el poller
// de calendario— y las tres necesitan la app abierta. Un respaldo a las 20:00 no
// ocurre nunca el día que te olvidaste de abrirla.

#[tauri::command]
pub fn autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(e)
}

#[tauri::command]
pub fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let auto = app.autolaunch();
    // OJO en `pnpm tauri dev`: lo que se registra es la ruta del binario que está
    // corriendo, o sea `target/debug/sunrise`. Prenderlo en dev deja un
    // LaunchAgent apuntando a un binario de desarrollo que puede desaparecer con
    // un `cargo clean`. Se permite igual —es el único modo de probar el camino—
    // pero acuérdate de apagarlo antes de salir de dev.
    if enabled {
        auto.enable().map_err(e)
    } else {
        auto.disable().map_err(e)
    }
}

// --- Avisos con botón (alertas) ---
//
// El plugin de notificaciones **no puede hacer esto**, y no es una limitación de
// configuración: manda por `notify-rust`, cuyo backend de macOS pasa título,
// cuerpo, icono y sonido y nada más. Un aviso sin botón es un *banner*, que se va
// solo en unos segundos. Lo que lo convierte en *alerta* —queda en pantalla hasta
// que la saques o la acciones, como el aviso de reunión del Calendario— es tener
// un botón de acción, así que este camino habla directo con
// `mac-notification-sys`, que es la misma librería que el plugin usa por abajo.

/// La respuesta del usuario a una alerta. La escucha el front.
pub const NOTIFICATION_ACTION: &str = "sunrise://notification-action";

/// Identidad con la que salieron los avisos, para poder mostrarla.
#[cfg(target_os = "macos")]
static NOTIFICATION_IDENTITY: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// De quién son los avisos del sistema, decidido **una vez y al arrancar**.
///
/// Se intenta primero el identificador de la app (`app.sunrise.desktop`) y no la
/// Terminal, incluso en dev, y eso es lo que arregla dos cosas de una: el aviso
/// sale con el icono de sunrise, y —más importante— hereda **los ajustes de
/// notificación de sunrise**, que es donde el usuario elige si sus avisos son
/// alertas (se quedan) o banners (se van solos). Atribuido a la Terminal, el
/// ajuste que manda es el de la Terminal.
///
/// **Solo funciona si la app está instalada**, y no es un supuesto: la librería
/// hace `LSCopyApplicationURLsForBundleIdentifier` y devuelve `false` si
/// LaunchServices no conoce ese identificador. Sin `.dmg` instalado —una máquina
/// que solo corre `pnpm tauri dev`— se cae a la Terminal, que es lo que hace el
/// plugin de notificaciones por su cuenta.
///
/// **El precio, en dev**: el aviso pertenece a la app *instalada*, así que
/// apretar su botón puede activarla a ella y no a la de desarrollo. Es el
/// intercambio a cambio de poder probar el aviso de verdad.
///
/// Va antes de cualquier envío porque `set_application` es un `Once` de proceso
/// que el plugin también llama: gana el primero.
#[cfg(target_os = "macos")]
pub fn claim_notification_identity(identifier: &str) {
    let used = match mac_notification_sys::set_application(identifier) {
        Ok(()) => identifier.to_string(),
        Err(_) => {
            eprintln!(
                "[sunrise] macOS no conoce el identificador {identifier} (¿la app no está                  instalada?): los avisos van a salir como la Terminal"
            );
            let fallback = "com.apple.Terminal";
            let _ = mac_notification_sys::set_application(fallback);
            fallback.to_string()
        }
    };
    let _ = NOTIFICATION_IDENTITY.set(used);
}

/// Con qué identidad salen los avisos. Lo muestra Dev Tools: en dev, saber si el
/// aviso salió como sunrise o como la Terminal explica por qué se queda o no.
#[tauri::command]
pub fn notification_identity() -> String {
    #[cfg(target_os = "macos")]
    {
        NOTIFICATION_IDENTITY.get().cloned().unwrap_or_default()
    }
    #[cfg(not(target_os = "macos"))]
    {
        String::new()
    }
}

/// Abre el panel de Notificaciones de Ajustes del sistema.
///
/// **Desde Rust y no desde el front**, y eso salió de un incidente: para abrir un
/// `x-apple.systempreferences:` con el plugin del front hay que sumar ese esquema
/// a `opener:allow-open-url` en `capabilities/default.json`, y hacerlo dejó a la
/// app **sin ningún aviso del sistema** —ni banner ni alerta— hasta que se
/// revirtió. Acá el ACL no aplica (igual que el updater), así que no hay permiso
/// que tocar ni capability que romper.
#[tauri::command]
pub fn open_notification_settings(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(
            "x-apple.systempreferences:com.apple.preference.notifications",
            None::<&str>,
        )
        .map_err(e)
}

/// Los sonidos que macOS puede tocar en un aviso, por nombre y sin extensión.
///
/// Salen de las dos carpetas que el sistema mira: las del sistema y **las del
/// usuario** (`~/Library/Sounds`), que es la respuesta a "¿podemos usar uno
/// propio?": se deja el archivo ahí y aparece en esta lista. El nombre es lo que
/// viaja en el aviso, así que un `.aiff` llamado `Campana` se pide como
/// `"Campana"`.
#[tauri::command]
pub fn notice_sounds() -> Vec<String> {
    let mut dirs: Vec<std::path::PathBuf> = vec!["/System/Library/Sounds".into(), "/Library/Sounds".into()];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(std::path::Path::new(&home).join("Library/Sounds"));
    }

    let mut names: Vec<String> = dirs
        .iter()
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flatten()
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            entry
                .path()
                .file_stem()
                .and_then(|s| s.to_str())
                .map(str::to_string)
        })
        .collect();
    names.sort();
    names.dedup();
    names
}

/// Muestra una alerta con un botón y avisa qué apretó el usuario.
///
/// **No espera acá.** `send()` bloquea el hilo hasta que la persona hace algo
/// —eso es lo que significa que la alerta sea persistente—, así que esperar
/// dentro del comando congelaría la app hasta que alguien mirara la esquina de la
/// pantalla. Se manda en un hilo aparte y la respuesta vuelve por
/// `NOTIFICATION_ACTION`, que es un evento y llega a las dos ventanas.
#[tauri::command]
pub fn notify_alert(
    app: tauri::AppHandle,
    title: String,
    body: String,
    action: String,
    sound: String,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // La identidad ya la fijó el arranque (`claim_notification_identity`).

        std::thread::spawn(move || {
            use mac_notification_sys::{MainButton, Notification};

            let mut notification = Notification::new();
            notification
                .title(&title)
                .message(&body)
                .main_button(MainButton::SingleAction(&action))
                .close_button("Cerrar")
                .sound(sound.as_str());

            match notification.send() {
                Ok(response) => {
                    let _ = app.emit(NOTIFICATION_ACTION, response_label(&response));
                }
                Err(err) => eprintln!("[sunrise] no se pudo mostrar la alerta: {err}"),
            }
        });
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, title, body, action, sound);
        Err("las alertas con botón son solo de macOS".into())
    }
}

/// Qué apretó el usuario, como texto para el front. `action` es el botón nuestro;
/// el resto son las formas de sacarla de encima sin accionarla.
#[cfg(target_os = "macos")]
fn response_label(response: &mac_notification_sys::NotificationResponse) -> &'static str {
    use mac_notification_sys::NotificationResponse;
    match response {
        NotificationResponse::ActionButton(_) => "action",
        NotificationResponse::Click => "click",
        NotificationResponse::CloseButton(_) => "close",
        NotificationResponse::Reply(_) => "reply",
        NotificationResponse::None => "none",
    }
}

// --- Actualizaciones ---
//
// El updater vive **entero acá y no en el front**. El plugin tiene también una
// API de JavaScript, pero usarla obligaría a instalar el paquete npm y a abrirle
// permisos en `capabilities/default.json`, y sobre todo dejaría a `ipc.ts` sin ser
// la única puerta a la app: la regla del proyecto es que ningún componente hable
// con Tauri por su cuenta. Desde Rust el ACL no aplica, así que hay menos piezas.
//
// Lo que la app consulta es el `latest.json` que publica el Release de GitHub
// (`endpoints` en `tauri.conf.json`), firmado con la llave privada del updater —
// que no tiene nada que ver con la firma de Apple. Sin esa firma el paquete se
// rechaza, y por eso una actualización falsa no basta con servirla desde una URL.

/// Pregunta si hay versión nueva. `Ok(None)` es "estás al día", no un error.
///
/// Falla —con el mensaje del transporte— cuando no hay red o el Release todavía no
/// existe. Quien la llame tiene que tratar ese caso como información, no como algo
/// roto: es exactamente lo que pasa trabajando sin conexión.
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<Option<AppUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(e)?.check().await.map_err(e)?;
    Ok(update.map(|u| AppUpdate {
        version: u.version.clone(),
        current_version: u.current_version.clone(),
        notes: u.body.clone(),
        // Solo el día: la hora exacta de publicación no le sirve a nadie, y el
        // `Display` de `OffsetDateTime` trae el offset a cuestas.
        date: u.date.map(|d| d.date().to_string()),
    }))
}

/// Descarga e instala la versión nueva, y **reinicia la app**.
///
/// Vuelve a preguntar en vez de guardarse el `Update` de `check_for_update`:
/// mantenerlo vivo entre dos comandos obliga a un `State` con la mitad de una
/// operación de red adentro, y el costo real es una petición HTTP más.
///
/// Si no devuelve nunca es porque salió bien: `restart()` no retorna.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app.updater().map_err(e)?.check().await.map_err(e)?;
    let Some(update) = update else {
        // Alguien publicó y despublicó entremedio, o la app ya se actualizó en
        // otra ventana. No hay nada que instalar y tampoco nada roto.
        return Ok(());
    };
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(e)?;
    app.restart();
}

#[cfg(test)]
mod tests {
    /// El updater se apaga en silencio si le falta una pieza de config: sin
    /// `pubkey` el plugin no arranca, sin `endpoints` no tiene a quién preguntar,
    /// y sin `createUpdaterArtifacts` el Release sale con `.dmg` pero sin el
    /// `.app.tar.gz` ni el `latest.json` que la app va a buscar. Ninguna de las
    /// tres falla al compilar y las tres dan el mismo síntoma —"nunca hay
    /// actualizaciones"— que es indistinguible de estar al día.
    #[test]
    fn la_config_del_updater_esta_completa() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();

        let upd = &conf["plugins"]["updater"];
        assert!(
            upd["pubkey"].as_str().is_some_and(|k| !k.is_empty()),
            "falta la llave pública del updater en tauri.conf.json"
        );

        let endpoints = upd["endpoints"].as_array().expect("faltan los endpoints");
        assert!(!endpoints.is_empty(), "la lista de endpoints está vacía");
        for ep in endpoints {
            let url = ep.as_str().unwrap_or_default();
            assert!(
                url.starts_with("https://"),
                "el endpoint {url} no es https: el manifiesto va firmado, pero \
                 pedirlo en claro deja ver qué versión corre cada máquina"
            );
            assert!(
                url.ends_with("latest.json"),
                "el endpoint {url} tiene que apuntar al manifiesto, no al Release"
            );
        }

        assert_eq!(
            conf["bundle"]["createUpdaterArtifacts"].as_bool(),
            Some(true),
            "sin createUpdaterArtifacts el Release no lleva el .app.tar.gz firmado"
        );
    }
}
