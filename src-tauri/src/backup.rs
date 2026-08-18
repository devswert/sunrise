//! Respaldos: snapshot de la base en un `.zip`, y restauración desde uno.
//!
//! ## Por qué `VACUUM INTO` y no copiar el archivo
//!
//! La base corre en modo WAL, así que `sunrise.sqlite` **no es la base**: los
//! últimos cambios viven en `sunrise.sqlite-wal` hasta que alguien hace
//! checkpoint. Copiar solo el archivo principal produce un respaldo con horas de
//! trabajo faltantes y sin ningún error a la vista. `VACUUM INTO` escribe una
//! base nueva, consistente y ya compactada, mientras la app sigue andando.
//!
//! ## Qué hay dentro del zip
//!
//! ```text
//! sunrise-20260817-200315.zip
//! ├── sunrise.sqlite   ← el snapshot
//! └── manifest.yml     ← de qué build salió
//! ```
//!
//! El manifest existe para el import futuro (que hoy no está hecho): sin la
//! versión de la app y del esquema, un zip de hace seis meses es un archivo del
//! que no se sabe si se puede leer. Ver SPECS §4.17.
//!
//! ## Lo peligroso
//!
//! Dos operaciones de este módulo borran cosas, y las dos están acotadas a
//! propósito:
//!
//! - **`purgar`** solo borra archivos cuyo nombre calza *exactamente* con el
//!   patrón que escribe `file_name`. La carpeta de respaldos es del
//!   usuario y lo más probable es que sea un Drive, un Dropbox o un iCloud
//!   compartido con el resto de su vida: un glob suelto ahí es pérdida de datos.
//!   No hay recursión y nunca se borra un directorio.
//! - **`restaurar`** pisa la base viva. Por eso guarda primero un snapshot de
//!   seguridad y solo hace el reemplazo cuando el zip ya pasó todas las
//!   validaciones (ver `extract_db`).

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Local};
use rusqlite::Connection;

use crate::models::BackupFile;

/// Versión de la app, fijada al compilar. Es la que Tauri usa para el `.dmg`
/// (ver el test `la_version_es_semver_y_coincide_en_los_tres_archivos`).
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Nombre del snapshot dentro del zip.
const DB_IN_ZIP: &str = "sunrise.sqlite";
/// Nombre del manifest dentro del zip.
const MANIFEST_IN_ZIP: &str = "manifest.yml";

/// `MAJOR.MINOR.PATCH`, con pre-release y build opcionales (semver 2.0.0).
///
/// Se valida a mano en vez de traer un crate: lo único que se necesita es no
/// dejar pasar un `v1.2` o un `1.2.3.4` al manifest, porque el import futuro va
/// a comparar estas cadenas y una versión mal formada no se puede ordenar.
///
/// Hoy su único consumidor es el test que vigila la versión del paquete, y con
/// eso cumple: es un guardia de compilación, no lógica de runtime.
#[cfg_attr(not(test), allow(dead_code))]
pub fn is_semver(v: &str) -> bool {
    // Se sacan primero build (`+`) y pre-release (`-`), en ese orden: el build
    // puede contener guiones y comérselos como pre-release sería un falso
    // negativo.
    let without_build = v.split_once('+').map_or(v, |(a, _)| a);
    let (nucleo, pre) = match without_build.split_once('-') {
        Some((a, b)) => (a, Some(b)),
        None => (without_build, None),
    };
    if pre == Some("") {
        return false;
    }

    let parts: Vec<&str> = nucleo.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts.iter().all(|p| {
        !p.is_empty()
            && p.bytes().all(|b| b.is_ascii_digit())
            // Sin ceros a la izquierda: semver los prohíbe, y "01" y "1"
            // ordenarían distinto según quién los lea.
            && (p.len() == 1 || !p.starts_with('0'))
    })
}

/// `sunrise-20260817-200315.zip`, en hora **local**.
///
/// Los segundos no son decoración: son lo que evita que dos respaldos del mismo
/// minuto se pisen. Y el orden alfabético del nombre es el cronológico, así que
/// la retención puede ordenar por nombre sin preguntarle nada al sistema de
/// archivos (cuya fecha de creación no es confiable después de un `rsync`).
pub fn file_name(now: DateTime<Local>) -> String {
    format!("sunrise-{}.zip", now.format("%Y%m%d-%H%M%S"))
}

/// Si el nombre es de un respaldo escrito por esta app.
///
/// **Es el único permiso para borrar** (ver `purgar`). Deliberadamente estricto:
/// exige el largo exacto y que todo lo que debe ser dígito lo sea. Un
/// `sunrise-respaldo-bueno.zip` puesto a mano por el usuario no calza, y eso es
/// lo que se quiere.
pub fn is_backup_name(name: &str) -> bool {
    let Some(medio) = name
        .strip_prefix("sunrise-")
        .and_then(|s| s.strip_suffix(".zip"))
    else {
        return false;
    };
    let bytes = medio.as_bytes();
    // `YYYYMMDD-HHMMSS`
    bytes.len() == 15
        && bytes[8] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| i == 8 || b.is_ascii_digit())
}

/// El `manifest.yml`. Se escribe a mano —son seis líneas— para no arrastrar un
/// serializador de YAML por esto.
fn manifest_yaml(version: &str, schema: i64, now: DateTime<Local>, bytes: u64) -> String {
    // Todos los valores van entre comillas: `created_at` trae `:` y una versión
    // como `1.10` se leería como número si no.
    format!(
        "app: sunrise\n\
         version: \"{version}\"\n\
         schema_version: {schema}\n\
         created_at: \"{}\"\n\
         db_file: \"{DB_IN_ZIP}\"\n\
         db_bytes: {bytes}\n",
        now.to_rfc3339()
    )
}

/// Lee una clave del manifest. Parser mínimo (`clave: valor`, comillas
/// opcionales), suficiente para lo único que hoy se consulta: `schema_version`.
fn manifest_value(yaml: &str, key: &str) -> Option<String> {
    yaml.lines().find_map(|l| {
        let (k, v) = l.split_once(':')?;
        if k.trim() != key {
            return None;
        }
        Some(v.trim().trim_matches('"').to_string())
    })
}

/// Lo que el `manifest.yml` de un respaldo dice de sí mismo.
///
/// Todo es opcional porque un respaldo de una versión anterior puede no traer
/// manifest, o traerlo sin alguna clave. Nada de esto condiciona la restauración
/// —salvo `schema_version`, que se compara en `extract_db`—: es para poder
/// **decirle al usuario qué acaba de restaurar**.
#[derive(Debug, Clone, Default)]
pub struct Manifest {
    /// Versión de la app que escribió el respaldo.
    pub version: Option<String>,
    /// Momento exacto del snapshot, con offset de zona (`to_rfc3339`). Es más
    /// preciso que la fecha del nombre del archivo, que no guarda la zona.
    pub created_at: Option<String>,
}

/// Lee el manifest de un zip. Un zip sin manifest devuelve todo en `None`.
pub fn read_manifest(zip_path: &Path) -> Manifest {
    let Ok(file) = fs::File::open(zip_path) else {
        return Manifest::default();
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return Manifest::default();
    };
    let Ok(txt) = read_from_zip(&mut zip, MANIFEST_IN_ZIP) else {
        return Manifest::default();
    };
    Manifest {
        version: manifest_value(&txt, "version"),
        created_at: manifest_value(&txt, "created_at"),
    }
}

/// La versión de esquema que esta app sabe leer.
fn current_schema(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT MAX(version) FROM _migrations", [], |r| r.get(0))?)
}

/// Escribe un respaldo nuevo en `dir` y devuelve el archivo creado.
///
/// **El zip se escribe con un nombre temporal y se renombra al final.** La
/// carpeta de respaldos suele estar sincronizada por Drive/Dropbox, que sube lo
/// que ve aparecer: con el nombre definitivo desde el principio, la nube
/// terminaría guardando un archivo a medio escribir que se ve como un respaldo
/// válido. El `rename` dentro del mismo volumen es atómico.
pub fn create(conn: &Connection, dir: &Path, now: DateTime<Local>) -> Result<BackupFile> {
    fs::create_dir_all(dir)
        .with_context(|| format!("no se pudo crear la carpeta de respaldos {}", dir.display()))?;

    let name = file_name(now);
    let target = dir.join(&name);
    // El temporal va en la carpeta destino y no en /tmp: el `rename` final tiene
    // que ser dentro del mismo volumen para ser atómico, y la carpeta puede
    // estar en un disco externo.
    let partial = dir.join(format!(".{name}.parcial"));

    let result = write_zip(conn, &partial, now);
    if result.is_err() {
        let _ = fs::remove_file(&partial);
    }
    let db_bytes = result?;

    fs::rename(&partial, &target).with_context(|| {
        format!(
            "el respaldo se escribió pero no se pudo renombrar a {}",
            target.display()
        )
    })?;

    Ok(BackupFile {
        name: name,
        path: target.to_string_lossy().to_string(),
        bytes: fs::metadata(&target).map(|m| m.len()).unwrap_or(db_bytes),
        created_at: now.to_rfc3339(),
    })
}

/// Arma el zip en `parcial`. Devuelve el tamaño del snapshot de la base.
fn write_zip(conn: &Connection, partial: &Path, now: DateTime<Local>) -> Result<u64> {
    let snapshot = temp_snapshot(conn)?;
    let db_bytes = fs::metadata(&snapshot)?.len();
    let schema = current_schema(conn)?;

    let file = fs::File::create(partial)
        .with_context(|| format!("no se pudo escribir en {}", partial.display()))?;
    let mut zip = zip::ZipWriter::new(file);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    zip.start_file(DB_IN_ZIP, options)?;
    // Se copia por partes: una base de varios MB no tiene por qué pasar entera
    // por memoria.
    let mut source_path = fs::File::open(&snapshot)?;
    std::io::copy(&mut source_path, &mut zip)?;

    zip.start_file(MANIFEST_IN_ZIP, options)?;
    zip.write_all(manifest_yaml(APP_VERSION, schema, now, db_bytes).as_bytes())?;

    zip.finish()?;
    Ok(db_bytes)
}

/// `VACUUM INTO` a un archivo temporal, que se borra al soltarse el `TempPath`.
///
/// `VACUUM INTO` exige que el destino **no exista**, así que no sirve el archivo
/// que `NamedTempFile` ya creó: se le pide solo la ruta.
fn temp_snapshot(conn: &Connection) -> Result<tempfile::TempPath> {
    let temp = tempfile::Builder::new()
        .prefix("sunrise-snapshot-")
        .suffix(".sqlite")
        .tempfile()?;
    let path = temp.into_temp_path();
    fs::remove_file(&path)?;

    // La ruta va como parámetro y no interpolada: un `'` en el nombre de usuario
    // rompería el SQL.
    conn.execute("VACUUM INTO ?1", [path.to_string_lossy().to_string()])
        .context("VACUUM INTO falló al escribir el snapshot")?;
    Ok(path)
}

/// Un respaldo nuevo **y** la poda de los que sobran, en un solo paso.
///
/// Es el único punto de entrada que debe usar un comando: así la retención no
/// depende de que quien respalda se acuerde de podar. Da lo mismo si el respaldo
/// lo pidió el reloj o el botón — siete clicks seguidos dejan `conservar`
/// archivos, no siete.
///
/// **El orden importa**: se poda después y solo si el respaldo salió. Al revés,
/// un fallo al escribir podaría respaldos buenos para hacerle espacio a uno que
/// no existe. Que la poda falle no invalida el respaldo, así que su error se
/// registra y no se propaga.
pub fn create_and_prune(
    conn: &Connection,
    dir: &Path,
    keep: usize,
    now: DateTime<Local>,
) -> Result<BackupFile> {
    let done = create(conn, dir, now)?;
    if let Err(err) = prune(dir, keep) {
        eprintln!("[sunrise] no se pudo podar respaldos viejos: {err}");
    }
    Ok(done)
}

/// Prueba que se pueda escribir en `dir`, creándola si hace falta.
///
/// Se llama al **guardar** la carpeta, no a la hora del respaldo. Un ajuste que
/// se acepta sin chistar y falla nueve horas después no da forma de saber qué se
/// escribió mal; y una carpeta puede ser perfectamente legible y no escribible
/// (un volumen montado de solo lectura, un Drive sin sesión), así que mirar si
/// existe no alcanza.
pub fn test_folder(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir)
        .with_context(|| format!("no se pudo crear la carpeta {}", dir.display()))?;
    let probe = dir.join(".sunrise-prueba-de-escritura");
    fs::write(&probe, b"sunrise")
        .with_context(|| format!("no se puede escribir en {}", dir.display()))?;
    fs::remove_file(&probe)?;
    Ok(())
}

/// Los respaldos que hay en `dir`, del más nuevo al más viejo.
///
/// Solo los que escribió esta app: los parciales (`.…parcial`) y cualquier otra
/// cosa que el usuario tenga en la carpeta no son asunto nuestro. Una carpeta
/// que no existe devuelve vacío en vez de error — es el estado normal antes del
/// primer respaldo.
pub fn list(dir: &Path) -> Result<Vec<BackupFile>> {
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !is_backup_name(&name) {
            continue;
        }
        let meta = entry.metadata()?;
        out.push(BackupFile {
            created_at: date_from_name(&name).unwrap_or_default(),
            name: name,
            path: entry.path().to_string_lossy().to_string(),
            bytes: meta.len(),
        });
    }
    // Por nombre, que es cronológico. La fecha del sistema de archivos cambia
    // con cualquier copia; el nombre no.
    out.sort_by(|a, b| b.name.cmp(&a.name));
    Ok(out)
}

/// `sunrise-20260817-200315.zip` → `2026-08-17T20:03:15`.
///
/// Sin zona horaria: el nombre se escribió en hora local, pero no dice cuál, y
/// el consumidor solo lo muestra.
fn date_from_name(name: &str) -> Option<String> {
    let medio = name
        .strip_prefix("sunrise-")?
        .strip_suffix(".zip")?
        .as_bytes();
    let s = |a: usize, b: usize| std::str::from_utf8(&medio[a..b]).ok();
    Some(format!(
        "{}-{}-{}T{}:{}:{}",
        s(0, 4)?,
        s(4, 6)?,
        s(6, 8)?,
        s(9, 11)?,
        s(11, 13)?,
        s(13, 15)?
    ))
}

/// Deja solo los `conservar` respaldos más nuevos y borra el resto.
///
/// Devuelve cuántos borró. **Corre siempre después de un respaldo exitoso**,
/// nunca antes ni cuando el nuevo falló: al revés, una carpeta llena de
/// respaldos buenos se podaría para dejar entrar uno que no llegó a existir.
///
/// `conservar == 0` no borra nada. Es a propósito: un cero por un ajuste vacío o
/// con basura no puede significar "borra todos mis respaldos".
pub fn prune(dir: &Path, keep: usize) -> Result<usize> {
    if keep == 0 {
        return Ok(0);
    }
    let files = list(dir)?;
    let mut deleted = 0;
    for old in files.into_iter().skip(keep) {
        // Doble llave: `listar` ya filtró por nombre, y esto lo vuelve a exigir
        // justo antes del borrado. Es la línea más peligrosa del módulo.
        if !is_backup_name(&old.name) {
            continue;
        }
        if fs::remove_file(&old.path).is_ok() {
            deleted += 1;
        }
    }
    Ok(deleted)
}

/// Saca la base de un zip a `destino` y la valida.
///
/// Tres controles, y ninguno es la validación de versión que quedó fuera de
/// alcance:
///
/// 1. **Que el zip traiga una base.** Se busca `sunrise.sqlite` y, si no está,
///    el primer `.sqlite` — un respaldo de otra versión puede haberla llamado
///    distinto.
/// 2. **Que sea una base de sunrise.** Se abre y se le pide la tabla `tasks`.
///    Sin esto, apuntar al zip equivocado reemplaza la base con cualquier cosa.
/// 3. **Que el esquema no sea del futuro.** Un respaldo de una versión más nueva
///    trae tablas y columnas que esta app no conoce; restaurarlo la deja a
///    medias. Al revés sí se puede: las migraciones lo suben (ver `restaurar`).
pub fn extract_db(zip_path: &Path, target: &Path, supported_schema: i64) -> Result<()> {
    let file = fs::File::open(zip_path)
        .with_context(|| format!("no se pudo abrir {}", zip_path.display()))?;
    let mut zip = zip::ZipArchive::new(file)
        .with_context(|| format!("{} no parece un .zip", zip_path.display()))?;

    // El manifest es opcional: un respaldo viejo puede no traerlo.
    let zip_schema = read_from_zip(&mut zip, MANIFEST_IN_ZIP)
        .ok()
        .and_then(|txt| manifest_value(&txt, "schema_version"))
        .and_then(|v| v.parse::<i64>().ok());
    if let Some(schema) = zip_schema {
        if schema > supported_schema {
            return Err(anyhow!(
                "el respaldo es de una versión más nueva de sunrise \
                 (esquema {schema}, esta app entiende hasta {supported_schema}). \
                 Actualiza la app antes de restaurarlo."
            ));
        }
    }

    let index = db_index(&mut zip)?;
    let mut dentro = zip.by_index(index)?;
    let mut output = fs::File::create(target)?;
    std::io::copy(&mut dentro, &mut output)?;
    output.sync_all()?;
    drop(output);

    validate_is_sunrise_db(target)?;
    Ok(())
}

/// Índice de la entrada que trae la base. Prefiere el nombre canónico.
fn db_index<R: Read + std::io::Seek>(zip: &mut zip::ZipArchive<R>) -> Result<usize> {
    let mut candidate = None;
    for i in 0..zip.len() {
        let entry = zip.by_index(i)?;
        if !entry.is_file() {
            continue;
        }
        let name = entry.name().to_string();
        if name == DB_IN_ZIP {
            return Ok(i);
        }
        if name.ends_with(".sqlite") && candidate.is_none() {
            candidate = Some(i);
        }
    }
    candidate.ok_or_else(|| anyhow!("el .zip no trae ninguna base de datos (.sqlite) adentro"))
}

fn read_from_zip<R: Read + std::io::Seek>(
    zip: &mut zip::ZipArchive<R>,
    name: &str,
) -> Result<String> {
    let mut entry = zip.by_name(name)?;
    let mut txt = String::new();
    entry.read_to_string(&mut txt)?;
    Ok(txt)
}

/// Que el archivo abra como SQLite y tenga la forma de una base de sunrise.
fn validate_is_sunrise_db(path: &Path) -> Result<()> {
    let conn = Connection::open(path).context("el archivo del respaldo no abre como SQLite")?;
    let tables: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master
              WHERE type = 'table' AND name IN ('tasks', 'settings', '_migrations')",
            [],
            |r| r.get(0),
        )
        .context("el archivo del respaldo no abre como SQLite")?;
    if tables < 3 {
        return Err(anyhow!(
            "el .zip trae una base que no es de sunrise (le faltan tablas)"
        ));
    }
    Ok(())
}

/// Deja en `destino` una base lista para reemplazar a la viva.
///
/// Extrae, valida **y migra**. Migrar acá y no después del reemplazo es lo que
/// hace que la restauración sea casi imposible de dejar a medias: un respaldo de
/// una versión anterior trae un esquema viejo, y si las migraciones fueran a
/// correr recién sobre el archivo ya copiado, un fallo dejaría la base viva
/// pisada y sin subir. Acá, si algo falla, la base viva todavía no se tocó.
pub fn prepare_restore(
    zip_path: &Path,
    target: &Path,
    supported_schema: i64,
) -> Result<()> {
    extract_db(zip_path, target, supported_schema)?;
    let conn = crate::db::open(target).context("el respaldo no se pudo abrir para migrarlo")?;
    crate::db::migrate(&conn)
        .context("las migraciones no corrieron sobre la base del respaldo")?;
    // Cerrar hace checkpoint del WAL: el archivo queda completo por sí solo, que
    // es lo que se va a copiar encima de la base viva.
    conn.close().map_err(|(_, err)| err)?;
    Ok(())
}

/// Guarda una copia de seguridad de la base viva antes de pisarla.
///
/// Va con nombre propio (`antes-de-restaurar-…`) y **no** con el patrón de
/// `file_name`: así la retención no la borra nunca. Es la única salida si
/// la restauración deja la base en un estado inesperado.
pub fn safety_snapshot(conn: &Connection, dir: &Path, now: DateTime<Local>) -> Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let target = dir.join(format!(
        "antes-de-restaurar-{}.sqlite",
        now.format("%Y%m%d-%H%M%S")
    ));
    if target.exists() {
        fs::remove_file(&target)?;
    }
    conn.execute("VACUUM INTO ?1", [target.to_string_lossy().to_string()])
        .context("no se pudo guardar la copia de seguridad previa")?;
    Ok(target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use chrono::TimeZone;

    fn migrated_conn() -> Connection {
        let c = db::open_in_memory().unwrap();
        db::migrate(&c).unwrap();
        c
    }

    fn now() -> DateTime<Local> {
        Local.timestamp_opt(1_787_000_000, 0).unwrap()
    }

    #[test]
    fn la_version_es_semver_y_coincide_en_los_tres_archivos() {
        assert!(
            is_semver(APP_VERSION),
            "la versión del paquete ({APP_VERSION}) tiene que ser semver"
        );

        // Tauri arma el `.dmg` con la versión de `tauri.conf.json`, pero
        // `APP_VERSION` sale de `Cargo.toml`: si divergen, el manifest del
        // respaldo miente sobre de qué build salió.
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            conf["version"].as_str(),
            Some(APP_VERSION),
            "tauri.conf.json y Cargo.toml tienen versiones distintas"
        );

        let pkg: serde_json::Value =
            serde_json::from_str(include_str!("../../package.json")).unwrap();
        assert_eq!(
            pkg["version"].as_str(),
            Some(APP_VERSION),
            "package.json y Cargo.toml tienen versiones distintas"
        );
    }

    /// **El nombre de la base dentro del zip no depende del perfil.** Si el zip
    /// guardara `sunrise-dev.sqlite` cuando lo hace dev, un respaldo tomado
    /// mientras probabas algo no se podría restaurar en producción —y al revés—,
    /// que es justo el puente entre las dos bases: respaldas en una y restauras en
    /// la otra. `extract_db` busca cualquier `.sqlite`, pero el que se escribe
    /// tiene que ser el de producción.
    #[test]
    fn el_zip_lleva_siempre_el_nombre_de_produccion() {
        assert_eq!(DB_IN_ZIP, crate::db::PROD_FILE);
        assert_ne!(
            DB_IN_ZIP,
            crate::db::file_name(),
            "estos tests corren en perfil dev: si coincidieran, el zip llevaría el \
             nombre del perfil y dejaría de cruzar entre bases"
        );
    }

    #[test]
    fn semver_acepta_lo_valido_y_rechaza_lo_que_no() {
        for ok in ["0.1.0", "1.2.3", "10.20.30", "1.0.0-beta.1", "1.0.0+build.5"] {
            assert!(is_semver(ok), "{ok} debería ser válido");
        }
        for bad in ["1.2", "1.2.3.4", "v1.2.3", "1.2.x", "01.2.3", "1.2.3-", ""] {
            assert!(!is_semver(bad), "{bad} no debería ser válido");
        }
    }

    #[test]
    fn el_nombre_es_cronologico_y_solo_el_propio_se_reconoce() {
        let n = file_name(now());
        assert!(is_backup_name(&n));
        // Ordenar por nombre = ordenar por fecha.
        let after = file_name(now() + chrono::Duration::seconds(1));
        assert!(after > n);

        // Nada de lo que el usuario pueda tener en su Drive califica para borrar.
        for foreign in [
            "sunrise.zip",
            "sunrise-respaldo-bueno.zip",
            "sunrise-20260817-200315.zip.bak",
            ".sunrise-20260817-200315.zip.parcial",
            "sunrise-2026081-200315.zip",
            "sunrise-20260817_200315.zip",
            "fotos.zip",
        ] {
            assert!(!is_backup_name(foreign), "{foreign} no es un respaldo");
        }
    }

    #[test]
    fn crear_deja_un_zip_con_la_base_y_el_manifest() {
        let c = migrated_conn();
        c.execute(
            "INSERT INTO tasks (title, position, created_at, updated_at)
             VALUES ('tarea del respaldo', 0, '2026-08-17', '2026-08-17')",
            [],
        )
        .unwrap();

        let dir = tempfile::tempdir().unwrap();
        let done = create(&c, dir.path(), now()).unwrap();

        assert!(done.bytes > 0);
        assert!(Path::new(&done.path).is_file());
        // Nada de temporales a medio escribir en la carpeta del usuario.
        assert_eq!(list(dir.path()).unwrap().len(), 1);
        assert!(fs::read_dir(dir.path())
            .unwrap()
            .all(|e| !e.unwrap().file_name().to_string_lossy().contains("parcial")));

        let mut zip = zip::ZipArchive::new(fs::File::open(&done.path).unwrap()).unwrap();
        let manifest = read_from_zip(&mut zip, MANIFEST_IN_ZIP).unwrap();
        assert_eq!(manifest_value(&manifest, "version").as_deref(), Some(APP_VERSION));
        assert_eq!(
            manifest_value(&manifest, "schema_version").as_deref(),
            Some(current_schema(&c).unwrap().to_string().as_str())
        );
        assert_eq!(manifest_value(&manifest, "app").as_deref(), Some("sunrise"));
    }

    /// La razón de ser de `VACUUM INTO`, y el único test que la comprueba de
    /// verdad: **la base tiene que estar en un archivo y en modo WAL**. Con una
    /// base en memoria no hay `-wal` que ignorar, así que un `fs::copy` del
    /// archivo principal pasaría igual y el test no probaría nada.
    ///
    /// Por eso se abre con `db::open` (que pone `journal_mode = WAL`) sobre un
    /// archivo, se escribe, y **no se hace checkpoint**: el snapshot tiene que
    /// traer lo escrito de todas formas. El test además verifica que el `-wal`
    /// exista y tenga contenido, que es lo que hace fallar a la alternativa
    /// ingenua.
    #[test]
    fn el_respaldo_trae_lo_que_estaba_sin_checkpoint() {
        let casa = tempfile::tempdir().unwrap();
        let db_path = casa.path().join("sunrise.sqlite");
        let c = db::open(&db_path).unwrap();
        db::migrate(&c).unwrap();
        c.execute(
            "INSERT INTO tasks (title, position, created_at, updated_at)
             VALUES ('recién escrita', 0, '2026-08-17', '2026-08-17')",
            [],
        )
        .unwrap();

        let wal = casa.path().join("sunrise.sqlite-wal");
        assert!(
            wal.is_file() && fs::metadata(&wal).unwrap().len() > 0,
            "el test no vale si la base no está en WAL con cambios sin checkpoint"
        );

        let dir = tempfile::tempdir().unwrap();
        let done = create(&c, dir.path(), now()).unwrap();

        // La alternativa ingenua —copiar el archivo principal— se lleva una base
        // sin lo recién escrito. Es exactamente lo que `VACUUM INTO` evita.
        let naive_copy = casa.path().join("copia-ingenua.sqlite");
        fs::copy(&db_path, &naive_copy).unwrap();
        let naive = Connection::open(&naive_copy).unwrap();
        // `unwrap_or(0)`: acá ni la tabla llegó a salir del WAL, así que la
        // consulta falla en vez de devolver cero. Las dos cosas significan lo
        // mismo para lo que se está probando —el archivo solo no es la base—, y
        // cuál de las dos pase depende de cuándo SQLite haya hecho checkpoint.
        let rows: i64 = naive
            .query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0))
            .unwrap_or(0);
        assert_eq!(rows, 0, "copiar el archivo se pierde lo que está en el WAL");

        let output = tempfile::tempdir().unwrap();
        let db = output.path().join("restaurada.sqlite");
        extract_db(Path::new(&done.path), &db, current_schema(&c).unwrap()).unwrap();

        let restored = Connection::open(&db).unwrap();
        let title: String = restored
            .query_row("SELECT title FROM tasks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "recién escrita");
    }

    #[test]
    fn purgar_conserva_los_mas_nuevos_y_no_toca_nada_ajeno() {
        let c = migrated_conn();
        let dir = tempfile::tempdir().unwrap();

        for i in 0..5 {
            create(&c, dir.path(), now() + chrono::Duration::seconds(i)).unwrap();
        }
        // Lo que el usuario ya tenía en su carpeta sincronizada.
        fs::write(dir.path().join("presupuesto.zip"), b"mio").unwrap();
        fs::write(dir.path().join("sunrise-a-mano.zip"), b"mio").unwrap();
        let subfolder = dir.path().join("otras cosas");
        fs::create_dir(&subfolder).unwrap();
        fs::write(subfolder.join("nada.txt"), b"mio").unwrap();

        assert_eq!(prune(dir.path(), 2).unwrap(), 3);

        let remaining = list(dir.path()).unwrap();
        assert_eq!(remaining.len(), 2);
        assert_eq!(
            remaining[0].name,
            file_name(now() + chrono::Duration::seconds(4)),
            "el que queda primero es el más nuevo"
        );
        assert!(dir.path().join("presupuesto.zip").exists());
        assert!(dir.path().join("sunrise-a-mano.zip").exists());
        assert!(subfolder.join("nada.txt").exists());
    }

    /// Apretar el botón siete veces no puede dejar siete archivos. La poda no
    /// puede depender de que el llamador se acuerde: va dentro de `create_and_prune`.
    #[test]
    fn siete_respaldos_seguidos_dejan_los_que_se_conservan() {
        let c = migrated_conn();
        let dir = tempfile::tempdir().unwrap();

        for i in 0..7 {
            create_and_prune(&c, dir.path(), 2, now() + chrono::Duration::seconds(i)).unwrap();
        }

        let remaining = list(dir.path()).unwrap();
        assert_eq!(remaining.len(), 2);
        assert_eq!(
            remaining[0].name,
            file_name(now() + chrono::Duration::seconds(6)),
            "el que queda primero es el último que se hizo"
        );
    }

    #[test]
    fn purgar_con_cero_no_borra_nada() {
        let c = migrated_conn();
        let dir = tempfile::tempdir().unwrap();
        create(&c, dir.path(), now()).unwrap();
        assert_eq!(prune(dir.path(), 0).unwrap(), 0);
        assert_eq!(list(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn listar_una_carpeta_que_no_existe_no_es_error() {
        assert!(list(Path::new("/no/existe/esta/carpeta")).unwrap().is_empty());
    }

    #[test]
    fn extraer_rechaza_un_zip_que_no_trae_base() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("vacio.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
            z.start_file("leeme.txt", zip::write::SimpleFileOptions::default())
                .unwrap();
            z.write_all(b"hola").unwrap();
            z.finish().unwrap();
        }
        let err = extract_db(&zip_path, &dir.path().join("out.sqlite"), 99).unwrap_err();
        assert!(err.to_string().contains("no trae ninguna base"), "{err}");
    }

    #[test]
    fn extraer_rechaza_un_sqlite_que_no_es_de_sunrise() {
        let dir = tempfile::tempdir().unwrap();
        let foreign = dir.path().join("ajena.sqlite");
        {
            let c = Connection::open(&foreign).unwrap();
            c.execute("CREATE TABLE cosas (id INTEGER)", []).unwrap();
        }
        let zip_path = dir.path().join("ajena.zip");
        {
            let mut z = zip::ZipWriter::new(fs::File::create(&zip_path).unwrap());
            z.start_file(DB_IN_ZIP, zip::write::SimpleFileOptions::default())
                .unwrap();
            z.write_all(&fs::read(&foreign).unwrap()).unwrap();
            z.finish().unwrap();
        }
        let err = extract_db(&zip_path, &dir.path().join("out.sqlite"), 99).unwrap_err();
        assert!(err.to_string().contains("no es de sunrise"), "{err}");
    }

    #[test]
    fn extraer_rechaza_un_respaldo_de_una_version_mas_nueva() {
        let c = migrated_conn();
        let dir = tempfile::tempdir().unwrap();
        let done = create(&c, dir.path(), now()).unwrap();

        let err = extract_db(Path::new(&done.path), &dir.path().join("out.sqlite"), 1)
            .unwrap_err();
        assert!(err.to_string().contains("más nueva"), "{err}");
    }

    #[test]
    fn el_snapshot_de_seguridad_no_lo_borra_la_retencion() {
        let c = migrated_conn();
        let dir = tempfile::tempdir().unwrap();
        let copy = safety_snapshot(&c, dir.path(), now()).unwrap();
        assert!(copy.is_file());

        // No calza el patrón, así que ni `listar` la ve ni `purgar` la toca.
        assert!(list(dir.path()).unwrap().is_empty());
        create(&c, dir.path(), now()).unwrap();
        prune(dir.path(), 1).unwrap();
        assert!(copy.is_file(), "la copia de seguridad tiene que sobrevivir");
    }

    #[test]
    fn la_fecha_sale_del_nombre_y_no_del_sistema_de_archivos() {
        assert_eq!(
            date_from_name("sunrise-20260817-200315.zip").as_deref(),
            Some("2026-08-17T20:03:15")
        );
    }
}
