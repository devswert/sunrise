//! Dónde está la base y cómo se abre desde el proceso del MCP (§4.32).
//!
//! La app resuelve su directorio con `app.path().app_data_dir()`, que necesita un
//! `AppHandle`. El MCP nunca construye Tauri, así que arma la misma ruta a mano:
//! en macOS es `~/Library/Application Support/<identifier>`. El identifier queda
//! copiado acá, y un test lo compara contra `tauri.conf.json` para que no diverjan.

use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::db;

/// El `identifier` de `tauri.conf.json`. Es el nombre del directorio de datos.
pub const IDENTIFIER: &str = "app.sunrise.desktop";

/// La base que le corresponde a **este** binario.
///
/// El nombre del archivo sale de `db::file_name()`, igual que en la app: el `.app`
/// instalado abre la de producción y `target/debug/sunrise` la de dev. Así el perfil
/// del binario que se registra en Claude Desktop decide la base, sin otra
/// configuración que pueda quedar desalineada.
pub fn db_path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .ok_or("No sé cuál es la carpeta del usuario: falta la variable HOME.")?;
    Ok(PathBuf::from(home)
        .join("Library/Application Support")
        .join(IDENTIFIER)
        .join(db::file_name()))
}

/// Abre la base para **una** llamada.
///
/// Una conexión por llamada y nunca una larga: restaurar un respaldo reemplaza el
/// archivo (§4.17), y una conexión abierta desde antes seguiría escribiendo en el
/// archivo viejo, que ya no es el de nadie.
///
/// Si el archivo no existe **no lo crea**: una base vacía nacida acá no tendría
/// esquema, y la app la encontraría como suya al abrir.
pub fn open(path: &Path) -> Result<Connection, String> {
    if !path.exists() {
        return Err(format!(
            "No encontré la base de sunrise en {}. Abre sunrise una vez para crearla.",
            path.display()
        ));
    }
    let conn = db::open(path).map_err(|e| format!("No pude abrir la base de sunrise: {e}"))?;
    check_schema(&conn)?;
    Ok(conn)
}

/// Rechaza una base cuyo esquema no es el que este binario conoce.
///
/// **El MCP nunca migra.** Migrar es cosa de la app, que además respalda y avisa;
/// hacerlo desde un proceso que nadie mira dejaría una migración a medio escribir
/// sin testigos. Los dos desfases son reales: la app se actualiza sola y Claude
/// Desktop puede seguir apuntando a un binario viejo, o al revés.
pub fn check_schema(conn: &Connection) -> Result<(), String> {
    let found: Option<i64> = conn
        .query_row("SELECT MAX(version) FROM _migrations", [], |r| r.get(0))
        .map_err(|e| format!("La base no tiene el formato de sunrise: {e}"))?;
    let expected = db::migrations::MIGRATIONS
        .last()
        .map(|(v, _)| *v)
        .unwrap_or_default();
    match found.unwrap_or_default() {
        v if v == expected => Ok(()),
        v if v < expected => Err(
            "La base es de una versión anterior de sunrise. Abre la app para que la \
             actualice y vuelve a intentarlo."
                .into(),
        ),
        _ => Err(
            "La base es de una versión más nueva que este servidor. Actualiza sunrise o \
             revisa la ruta configurada en Claude Desktop."
                .into(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_identifier_es_el_de_tauri_conf() {
        // Si alguien cambia el identifier de la app y no este, el MCP buscaría la
        // base en una carpeta que ya no existe.
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(conf["identifier"].as_str(), Some(IDENTIFIER));
    }

    #[test]
    fn la_ruta_usa_el_archivo_del_perfil() {
        let path = db_path().unwrap();
        assert!(path.ends_with(format!("{IDENTIFIER}/{}", db::file_name())));
    }

    #[test]
    fn acepta_una_base_al_dia() {
        let conn = db::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        assert!(check_schema(&conn).is_ok());
    }

    #[test]
    fn rechaza_una_base_atrasada_sin_migrarla() {
        let conn = db::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        let last = db::migrations::MIGRATIONS.last().unwrap().0;
        conn.execute("DELETE FROM _migrations WHERE version = ?1", [last])
            .unwrap();

        let err = check_schema(&conn).unwrap_err();
        assert!(err.contains("anterior"), "{err}");
        let after: i64 = conn
            .query_row("SELECT MAX(version) FROM _migrations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(after, last - 1, "el MCP no puede migrar por su cuenta");
    }

    #[test]
    fn rechaza_una_base_mas_nueva() {
        let conn = db::open_in_memory().unwrap();
        db::migrate(&conn).unwrap();
        conn.execute("INSERT INTO _migrations (version) VALUES (100000)", [])
            .unwrap();
        assert!(check_schema(&conn).unwrap_err().contains("más nueva"));
    }

    #[test]
    fn no_crea_una_base_que_no_existe() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("no-existe.sqlite");
        assert!(open(&path).is_err());
        assert!(!path.exists(), "abrir no puede dejar un archivo vacío");
    }
}
