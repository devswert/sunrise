//! Si el ejecutable en disco sigue siendo el que corre este proceso (§4.32).
//!
//! Claude Desktop lanza `sunrise --mcp` una vez y lo deja vivo. Si sunrise se
//! actualiza entretanto, el `.app` se reemplaza en disco pero este proceso sigue
//! corriendo el binario viejo en memoria, y la app migra la base a un esquema que
//! él no conoce. Para distinguir ese caso del de un binario de verdad viejo se
//! compara el ejecutable de ahora con el del arranque.

use std::path::Path;
use std::time::SystemTime;

/// La identidad de un archivo: su inode y su fecha de modificación.
///
/// El inode cubre el reemplazo del `.app` entero (archivo nuevo); la fecha, una
/// compilación que reescribe `target/debug/sunrise` en su lugar.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ExeStamp {
    inode: u64,
    modified: Option<SystemTime>,
}

/// La identidad del archivo en `path`, o `None` si no se puede leer.
pub fn stamp(path: &Path) -> Option<ExeStamp> {
    use std::os::unix::fs::MetadataExt;
    let meta = std::fs::metadata(path).ok()?;
    Some(ExeStamp {
        inode: meta.ino(),
        modified: meta.modified().ok(),
    })
}

/// Si el ejecutable cambió desde el arranque.
///
/// Sin identidad del arranque no se puede afirmar nada, y la respuesta es `false`:
/// reiniciar sin saber podría repetirse en cada llamada. Si al arranque existía y
/// ahora no, está siendo reemplazado, y eso sí cuenta como cambio.
pub fn replaced(at_start: Option<ExeStamp>, now: Option<ExeStamp>) -> bool {
    match (at_start, now) {
        (Some(before), Some(after)) => before != after,
        (Some(_), None) => true,
        (None, _) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn el_mismo_archivo_no_cuenta_como_reemplazo() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sunrise");
        std::fs::write(&path, "v1").unwrap();
        let start = stamp(&path);
        assert!(start.is_some());
        assert!(!replaced(start, stamp(&path)));
    }

    #[test]
    fn un_archivo_nuevo_en_la_misma_ruta_cuenta_como_reemplazo() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sunrise");
        std::fs::write(&path, "v1").unwrap();
        let start = stamp(&path);
        // Lo que hace el updater: escribe el nuevo aparte y lo mueve encima.
        let next = dir.path().join("sunrise.new");
        std::fs::write(&next, "v2").unwrap();
        std::fs::rename(&next, &path).unwrap();
        assert!(replaced(start, stamp(&path)));
    }

    #[test]
    fn reescribir_el_archivo_en_su_lugar_cuenta_como_reemplazo() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sunrise");
        std::fs::write(&path, "v1").unwrap();
        let start = stamp(&path);
        let file = std::fs::File::options().write(true).open(&path).unwrap();
        file.set_modified(SystemTime::now() + Duration::from_secs(60))
            .unwrap();
        assert!(replaced(start, stamp(&path)));
    }

    #[test]
    fn un_ejecutable_que_desaparecio_cuenta_como_reemplazo() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sunrise");
        std::fs::write(&path, "v1").unwrap();
        let start = stamp(&path);
        std::fs::remove_file(&path).unwrap();
        assert!(replaced(start, stamp(&path)));
    }

    #[test]
    fn sin_identidad_del_arranque_nunca_se_reinicia() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sunrise");
        std::fs::write(&path, "v1").unwrap();
        assert!(!replaced(None, stamp(&path)));
        assert!(!replaced(None, None));
    }
}
