//! Feeds de calendario (ICS).
//!
//! Tres capas, y la separación es deliberada:
//!
//! - `fetch`  — descarga. Lo único que toca la red.
//! - `ics`    — interpreta el texto a `IcsEvent`. Puro: sin red ni base, así
//!              que todo lo raro de un calendario real (zonas, series,
//!              cancelados) se prueba con fixtures.
//! - `repo::import_events` — escribe. Puro sobre `&Connection`.
//!
//! El pegamento vive en `commands::sync_feed`, que no decide nada: descarga,
//! parsea, importa y sella el resultado.

pub mod fetch;
pub mod ics;

use std::time::Duration;

use chrono::{DateTime, Utc};
use tauri::{AppHandle, Manager};

use crate::db::Db;
use crate::models::CalendarFeed;
use crate::repo::{self, ImportableEvent};

/// Cada cuánto despierta el poller a preguntar si algún feed ya toca.
///
/// No es el intervalo de sincronización: eso lo decide cada feed con su
/// `poll_minutes`. Este es el pulso del reloj, y el mínimo de `poll_minutes`
/// (5 min) es lo que hace que uno de un minuto no tenga sentido.
const PULSO: Duration = Duration::from_secs(60);

/// Sincroniza un feed de punta a punta.
///
/// Es el único lugar donde se juntan las tres capas, y no decide nada: baja,
/// interpreta, importa y sella. Cualquier regla que aparezca acá está en la capa
/// equivocada.
pub async fn sync_one_feed(app: &AppHandle, id: i64) -> Result<usize, String> {
    let feed = read_feed(app, id)?.ok_or_else(|| "ese feed ya no existe".to_string())?;
    sync_feeds(app, &feed).await
}

async fn sync_feeds(app: &AppHandle, feed: &CalendarFeed) -> Result<usize, String> {
    let result = try_sync(app, feed).await;

    // El sello va pase lo que pase: `last_synced_at` es "cuándo lo intenté",
    // que es lo que necesita el poller para no reintentar en bucle contra un
    // feed caído, y `last_error` es lo que distingue el resultado.
    let error = result.as_ref().err().map(String::as_str);
    if let Err(e) = stamp_sync(app, feed.id, error) {
        eprintln!("[sunrise] calendario: no pude sellar el feed {}: {e}", feed.name);
    }

    if let Err(e) = &result {
        // Nunca en silencio. Un fallo de sync que no deja rastro es exactamente
        // la forma del bug del permiso de `cursorPosition`: una promesa
        // rechazada que nadie ve. El nombre y no la URL: la URL es la credencial.
        eprintln!("[sunrise] calendario: falló la sync de «{}»: {e}", feed.name);
    }
    result
}

async fn try_sync(app: &AppHandle, feed: &CalendarFeed) -> Result<usize, String> {
    let text = fetch::download(&feed.ics_url).await?;

    // Con el toggle apagado el feed se baja igual (así el error de una URL
    // revocada se ve) pero no se escribe nada. Es lo que va a alimentar el rail
    // de calendario de M3.3 sin llenar el tablero de tareas.
    if !feed.import_as_tasks {
        return Ok(0);
    }

    // La zona del usuario, resuelta acá y pasada al parser. El bloque acota el
    // `MutexGuard` para no cargarlo durante el parseo, que no lo necesita.
    let tz = {
        let db = app.state::<Db>();
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        repo::zone(&conn)
    };

    let (from_date, to_date) = ics::window(ics::today_in(tz));
    let events = ics::parse_events(tz, &text, from_date, to_date)?;
    let importable: Vec<ImportableEvent> = events
        .into_iter()
        .map(|e| ImportableEvent {
            uid: e.uid,
            title: e.title,
            date: e.date,
            hour: e.hour,
            start: e.start,
            end: e.end,
            minutes: e.minutes,
            link: e.link,
            description: e.description,
            attendees: e.attendees,
        })
        .collect();

    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let seen = repo::import_events(&conn, feed.id, &importable, feed.default_category_id)
        .map_err(|e| e.to_string())?;

    // Lo que dejó de venir en el feed. Va después del import y con los UIDs que
    // este acaba de ver, para que un evento movido dentro de la ventana no
    // parezca borrado.
    let today = ics::today_in(tz).format("%Y-%m-%d").to_string();
    let hecho = repo::reconcile_feed(&conn, feed.id, &seen, &today).map_err(|e| e.to_string())?;

    // **Con nombres, no solo cuántas.** Un "3 borradas" a secas no se puede
    // reconstruir después: las filas ya no están. Y lo que desaparece del feed
    // casi nunca es un evento borrado —Google parte series, cambia UIDs, mueve
    // instancias—, así que el log es lo único que queda para entender qué pasó.
    if hecho.hubo_cambios() {
        let lista = |que: &[repo::Afectada]| {
            que.iter().map(|a| a.to_string()).collect::<Vec<_>>().join(", ")
        };
        eprintln!("[sunrise] calendario «{}»: el feed dejó de traer", feed.name);
        if !hecho.deleted.is_empty() {
            eprintln!("  borradas ({}): {}", hecho.deleted.len(), lista(&hecho.deleted));
        }
        if !hecho.released.is_empty() {
            eprintln!(
                "  liberadas del feed, se quedan con su tiempo ({}): {}",
                hecho.released.len(),
                lista(&hecho.released)
            );
        }
        if !hecho.orphaned.is_empty() {
            eprintln!(
                "  ORPHANED, nunca se trabajaron ({}): {}",
                hecho.orphaned.len(),
                lista(&hecho.orphaned)
            );
        }
    }

    Ok(seen.len())
}

fn read_feed(app: &AppHandle, id: i64) -> Result<Option<CalendarFeed>, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repo::get_calendar_feed(&conn, id).map_err(|e| e.to_string())
}

fn list_feeds(app: &AppHandle) -> Result<Vec<CalendarFeed>, String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repo::list_calendar_feeds(&conn).map_err(|e| e.to_string())
}

fn stamp_sync(app: &AppHandle, id: i64, error: Option<&str>) -> Result<(), String> {
    let db = app.state::<Db>();
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    repo::stamp_feed_sync(&conn, id, error).map_err(|e| e.to_string())
}

/// ¿A este feed ya le toca?
///
/// Función aparte y pura para poder razonarla: sin `last_synced_at` toca
/// siempre (nunca se sincronizó), y una marca ilegible cuenta como "nunca" en
/// vez de dejar el feed congelado para siempre.
pub fn is_due(feed: &CalendarFeed, now: DateTime<Utc>) -> bool {
    let Some(stamp) = feed.last_synced_at.as_deref() else {
        return true;
    };
    let Ok(last) = DateTime::parse_from_rfc3339(stamp) else {
        return true;
    };
    let elapsed = now.signed_duration_since(last.with_timezone(&Utc));
    elapsed.num_minutes() >= feed.poll_minutes
}

/// Sincroniza los feeds a los que ya les toca. Devuelve cuántos se
/// sincronizaron bien.
///
/// Con `forzar` va contra todos sin mirar el reloj, que es lo que hace el botón
/// "Sincronizar ahora".
pub async fn sync_pending(app: &AppHandle, force: bool) -> usize {
    let feeds = match list_feeds(app) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("[sunrise] calendario: no pude leer los feeds: {e}");
            return 0;
        }
    };

    let now = Utc::now();
    let mut ok = 0;
    for feed in feeds {
        if !force && !is_due(&feed, now) {
            continue;
        }
        // En serie y no en paralelo: comparten una sola `Connection` bajo
        // `Mutex`, así que el paralelismo solo movería la espera de lugar.
        if sync_feeds(app, &feed).await.is_ok() {
            ok += 1;
        }
    }
    ok
}

/// Arranca el poller. Se llama una vez, desde `setup`.
///
/// Usa el runtime que Tauri ya tiene (`async_runtime::spawn`) en vez de levantar
/// uno propio. Cuando escribe algo, avisa por evento de Tauri: llega a las dos
/// ventanas de una, y cada una invalida lo suyo con `markDataStale()`. Hacerlo
/// con el canal de `localStorage` obligaría a que alguna ventana escriba, que es
/// justo el ping-pong que `useDataSync` vino a evitar.
pub fn start_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let n = sync_pending(&app, false).await;
            if n > 0 {
                let _ = tauri::Emitter::emit(&app, crate::CALENDAR_SYNCED, ());
            }
            tokio::time::sleep(PULSO).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(last: Option<&str>, poll: i64) -> CalendarFeed {
        CalendarFeed {
            id: 1,
            name: "Trabajo".into(),
            ics_url: "https://x/y.ics".into(),
            default_category_id: None,
            import_as_tasks: true,
            poll_minutes: poll,
            last_synced_at: last.map(str::to_string),
            last_error: None,
        }
    }

    fn t(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn un_feed_recien_creado_toca_de_inmediato() {
        assert!(is_due(&feed(None, 15), t("2026-08-13T10:00:00Z")));
    }

    #[test]
    fn respeta_el_intervalo_del_feed() {
        let f = feed(Some("2026-08-13T10:00:00Z"), 15);
        assert!(!is_due(&f, t("2026-08-13T10:14:00Z")));
        assert!(is_due(&f, t("2026-08-13T10:15:00Z")));
    }

    #[test]
    fn una_marca_ilegible_no_congela_el_feed() {
        // Si la marca no se entiende, lo seguro es reintentar: dar por hecho
        // que ya se sincronizó dejaría el feed muerto hasta que alguien edite
        // la base a mano.
        assert!(is_due(&feed(Some("ayer por la tarde"), 15), t("2026-08-13T10:00:00Z")));
    }

    #[test]
    fn un_reloj_que_retrocede_no_adelanta_la_sync() {
        // Cambio de hora o ajuste de NTP: la resta da negativo y no debe contar
        // como "ya pasó el intervalo".
        let f = feed(Some("2026-08-13T10:00:00Z"), 15);
        assert!(!is_due(&f, t("2026-08-13T09:50:00Z")));
    }
}
