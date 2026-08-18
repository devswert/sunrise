//! Capa de acceso a SQLite: apertura, migraciones y estado compartido.

pub mod migrations;

use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;

/// Nombre del archivo de la base **de producción**.
///
/// No lo uses directo para abrir nada: usa [`archivo`]. Está público porque es
/// también el nombre con el que la base viaja dentro de un `.zip` de respaldo, y
/// eso **no** depende del perfil (ver `backup::DB_IN_ZIP`).
pub const PROD_FILE: &str = "sunrise.sqlite";

/// Nombre del archivo de la base según el perfil de compilación.
///
/// **`pnpm tauri dev` y el `.dmg` instalado comparten el directorio de datos**:
/// el identifier es el mismo, así que `app_data_dir()` resuelve al mismo lugar en
/// los dos. Antes eso significaba que probar un cambio escribía en la base de
/// verdad —sellar un día, correr una migración a medio escribir— sin ninguna
/// señal de que estaba pasando.
///
/// La separación es por **nombre de archivo y no por directorio** a propósito: el
/// directorio lo decide el identifier, y cambiar el identifier en dev arrastra el
/// permiso de notificaciones y la ruta del LaunchAgent del inicio automático a
/// otro lado. El nombre del archivo no arrastra nada.
///
/// `debug_assertions` es la condición porque es exactamente la que separa
/// `tauri dev` de `tauri build`. Un `tauri build --debug` también cae en dev, y
/// está bien: es un artefacto de desarrollo.
pub fn file_name() -> &'static str {
    if cfg!(debug_assertions) {
        "sunrise-dev.sqlite"
    } else {
        PROD_FILE
    }
}

/// Estado manejado por Tauri: la conexión SQLite protegida por Mutex.
///
/// **La conexión se puede reemplazar en caliente**: restaurar un respaldo pisa
/// el archivo, así que saca la conexión de acá, la cierra, copia y vuelve a
/// abrir (ver `commands::restore_backup`). Es la razón por la que el `Mutex`
/// envuelve la `Connection` y no solo la protege: quien tenga el lock es dueño
/// de la conexión y puede cambiarla.
pub struct Db(pub Mutex<Connection>);

/// Abre (o crea) la base en `path` y activa foreign keys.
pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// Abre una base en memoria (para tests).
#[cfg_attr(not(test), allow(dead_code))]
pub fn open_in_memory() -> rusqlite::Result<Connection> {
    let conn = Connection::open_in_memory()?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

/// Aplica migraciones pendientes.
pub fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    migrations::run(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated() -> Connection {
        let conn = open_in_memory().unwrap();
        migrate(&conn).unwrap();
        conn
    }

    /// Dev y producción **no pueden** apuntar al mismo archivo: comparten el
    /// directorio de datos, así que el nombre es lo único que las separa. Los
    /// tests corren con `debug_assertions`, o sea en el lado "dev".
    #[test]
    fn dev_y_produccion_usan_archivos_distintos() {
        assert_eq!(file_name(), "sunrise-dev.sqlite");
        assert_ne!(
            file_name(),
            PROD_FILE,
            "si los dos perfiles abren el mismo archivo, probar un cambio escribe \
             en la base de verdad"
        );
        // Los dos tienen que seguir siendo SQLite en la misma carpeta: la
        // restauración borra los sidecar `-wal`/`-shm` a partir de este nombre.
        assert!(file_name().ends_with(".sqlite"));
    }

    #[test]
    fn migraciones_aplican_limpio_desde_vacio() {
        let conn = migrated();
        let version: i64 = conn
            .query_row("SELECT MAX(version) FROM _migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, 8, "debe quedar en la última versión de migración");
    }

    /// La migración 6 rescata lo que quedó escondido antes del cambio de regla.
    /// Sin ella el arreglo solo valdría para las sincronizaciones futuras: la
    /// consulta del reconciler filtra `source_state = 'ACTIVE'`, así que jamás
    /// volvería a mirar una fila ya marcada `ORPHANED`.
    #[test]
    fn la_migracion_6_libera_las_orphaned_que_si_se_trabajaron() {
        let conn = migrated();
        conn.execute_batch(
            "INSERT INTO calendar_feeds (id, name, ics_url) VALUES (1, 'trabajo', 'https://x');
             INSERT INTO tasks (id, title, position, status, source, source_state, feed_id,
                                calendar_uid, created_at, updated_at)
             VALUES (901, 'reunión completada', 0, 'DONE', 'CALENDAR', 'ORPHANED', 1,
                     'uid-done', '2026-08-15', '2026-08-15'),
                    (902, 'reunión trabajada', 0, 'TODO', 'CALENDAR', 'ORPHANED', 1,
                     'uid-time', '2026-08-15', '2026-08-15'),
                    (903, 'reunión intacta', 0, 'TODO', 'CALENDAR', 'ORPHANED', 1,
                     'uid-nada', '2026-08-15', '2026-08-15');
             INSERT INTO time_entries (task_id, started_at, ended_at, seconds)
             VALUES (902, '2026-08-15T12:00:00Z', '2026-08-15T12:30:00Z', 1800);",
        )
        .unwrap();

        // Se re-aplica a mano: la migración ya corrió en `migrated()`.
        conn.execute_batch(
            "UPDATE tasks
                SET source_state = 'ACTIVE', feed_id = NULL, calendar_uid = NULL
              WHERE source_state = 'ORPHANED'
                AND (status = 'DONE'
                     OR EXISTS (SELECT 1 FROM time_entries e WHERE e.task_id = tasks.id));",
        )
        .unwrap();

        let status = |id: i64| -> (String, Option<i64>) {
            conn.query_row(
                "SELECT source_state, feed_id FROM tasks WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap()
        };
        assert_eq!(status(901), ("ACTIVE".into(), None), "completada: liberada");
        assert_eq!(status(902), ("ACTIVE".into(), None), "trabajada: liberada");
        // La que nunca se tocó se queda escondida: nunca fue tuya.
        assert_eq!(status(903).0, "ORPHANED");
    }

    #[test]
    fn crea_todas_las_tablas_esperadas() {
        let conn = migrated();
        for table in [
            "categories",
            "objectives",
            "calendar_feeds",
            "tasks",
            "task_events",
            "time_entries",
            "settings",
        ] {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                    [table],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 1, "falta la tabla {table}");
        }
    }

    #[test]
    fn migrar_es_idempotente() {
        let conn = migrated();
        // Correr de nuevo no debe fallar ni duplicar filas de settings.
        migrate(&conn).unwrap();
        let settings_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM settings", [], |r| r.get(0))
            .unwrap();
        assert_eq!(settings_count, 5);
    }

    #[test]
    fn siembra_categorias_padre_por_defecto() {
        let conn = migrated();
        let parents: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM categories WHERE parent_id IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(parents, 7);
    }

    #[test]
    fn defaults_de_enums_en_mayusculas() {
        let conn = migrated();
        let now = "2026-08-10T09:00:00Z";
        conn.execute(
            "INSERT INTO tasks (title, position, created_at, updated_at)
             VALUES ('demo', 0, ?1, ?1)",
            [now],
        )
        .unwrap();
        let (status, source, state): (String, String, String) = conn
            .query_row(
                "SELECT status, source, source_state FROM tasks WHERE title='demo'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(status, "TODO");
        assert_eq!(source, "MANUAL");
        assert_eq!(state, "ACTIVE");
    }
}
