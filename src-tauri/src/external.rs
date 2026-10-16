//! Avisa al front cuando **otro proceso** escribió en la base (§4.32, §5.2).
//!
//! El servidor MCP escribe en el mismo archivo con su propia conexión, y la app no
//! tiene eventos de datos desde Rust (§5.1): sin esto, una tarea creada desde
//! Claude no aparecería hasta el próximo click que recargue.
//!
//! Se usa `PRAGMA data_version`, que cambia **solo cuando hace commit otra
//! conexión**. Lo que escribe la propia app no lo mueve, así que el aviso no puede
//! hacer eco (el ping-pong de §5.3). Va en Rust por I6: un sondeo en un webview
//! que no se ve no corre.

use std::time::Duration;

use rusqlite::Connection;
use tauri::{AppHandle, Emitter, Manager};

use crate::db::Db;

/// Cada cuánto se mira. Es un `PRAGMA` que no toca disco, y dos segundos es lo
/// que tarda uno en volver de Claude Desktop a la app.
const INTERVAL: Duration = Duration::from_secs(2);

/// El contador de commits ajenos de esta conexión.
pub fn data_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row("PRAGMA data_version", [], |r| r.get(0))
}

pub fn start_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Sin línea base hasta la primera lectura: lo que haya pasado antes de
        // abrir la app ya lo trae la carga inicial.
        let mut last: Option<i64> = None;
        loop {
            tokio::time::sleep(INTERVAL).await;
            let now = {
                let db = app.state::<Db>();
                let Ok(conn) = db.0.lock() else { continue };
                data_version(&conn).ok()
            };
            // Restaurar un respaldo cambia la conexión, y con ella el contador:
            // eso da un aviso de más, que solo recarga lo que ya se iba a recargar.
            if let (Some(prev), Some(now)) = (last, now) {
                if prev != now {
                    // Una línea por aviso: es la única forma de saber, mirando el
                    // log, si una tarea que no aparece se escribió o no.
                    eprintln!("[sunrise] otro proceso escribió en la base; recargo las vistas");
                    let _ = app.emit(crate::DATA_CHANGED, ());
                }
            }
            if now.is_some() {
                last = now;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    /// Dos conexiones a un archivo, porque es el único caso en que el contador se
    /// mueve: en memoria cada conexión es una base distinta.
    fn two_connections() -> (tempfile::TempDir, Connection, Connection) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("base.sqlite");
        let app = db::open(&path).unwrap();
        db::migrate(&app).unwrap();
        let other = db::open(&path).unwrap();
        (dir, app, other)
    }

    #[test]
    fn el_contador_se_mueve_cuando_escribe_otro_proceso() {
        let (_dir, app, mcp) = two_connections();
        let before = data_version(&app).unwrap();
        mcp.execute(
            "INSERT INTO tasks (title, position, created_at, updated_at)
             VALUES ('desde Claude', 0, 'x', 'x')",
            [],
        )
        .unwrap();
        assert_ne!(data_version(&app).unwrap(), before);
    }

    #[test]
    fn lo_que_escribe_la_app_no_dispara_el_aviso() {
        // Es lo que hace imposible el eco: si la propia escritura moviera el
        // contador, cada cambio en la app se avisaría a sí misma.
        let (_dir, app, _mcp) = two_connections();
        let before = data_version(&app).unwrap();
        app.execute(
            "INSERT INTO tasks (title, position, created_at, updated_at)
             VALUES ('desde la app', 0, 'x', 'x')",
            [],
        )
        .unwrap();
        assert_eq!(data_version(&app).unwrap(), before);
    }
}
