//! Las dos piezas del updater que no son un comando: el progreso de la descarga
//! y el "vuelve al frente" del arranque de después.

use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, Manager};

/// Avance de la descarga del paquete. Lo escucha el aviso del sidebar para
/// dibujar la barra (ver `useUpdateProgress` en el front).
pub const UPDATE_PROGRESS: &str = "sunrise://update-progress";

/// La marca que `install_update` deja justo antes de reiniciar, y que el arranque
/// siguiente consume para levantar la ventana.
///
/// Es un archivo y no un ajuste por lo mismo que la marca de versión vista
/// (§4.23): describe **este reinicio**, no tus datos, y no tiene que viajar en un
/// respaldo. Vive en el directorio de datos de la app, que es lo que sobrevive a
/// que el updater reemplace el `.app`.
///
/// **Sin separar dev de producción, a diferencia de la base y los respaldos**
/// (§4.20): las dos builds comparten el directorio, pero el updater de dev nunca
/// instala nada —apunta al Release de producción y el `.app` que reemplazaría no
/// existe—, así que nadie más la escribe. Y si un arranque de dev llegara a
/// consumir la de producción, lo único que pasa es que una ventana se levanta.
const MARCA: &str = "pending-update-focus";

/// Cuánto se espera entre intentos de levantar la ventana, en milisegundos.
///
/// Son cuatro y no uno porque el proceso viejo todavía está muriendo cuando el
/// nuevo dibuja su ventana: el primer `set_focus` compite con una app que sigue
/// al frente y se pierde. Cada intento **comprueba primero si el anterior
/// funcionó** y corta ahí, así que en el caso normal se hace uno y se descarta el
/// segundo. Comprobar justo después de pedir el foco no sirve: `set_focus` en macOS
/// despacha al hilo principal y vuelve antes de que la activación haya pasado, o
/// sea que siempre daría "todavía no" y los cuatro intentos correrían igual —el
/// último a casi tres segundos, arrebatándole el foco a quien ya se cambió de app.
const INTENTOS_MS: [u64; 4] = [0, 250, 800, 1800];

/// El progreso que viaja al front. `total` es `Option` porque el servidor puede
/// no mandar `Content-Length`: ahí la barra va indeterminada, no en cero.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    /// La descarga terminó y empezó el reemplazo del `.app`, que no reporta
    /// avance. Es lo que deja al aviso decir "instalando" en vez de dejar la
    /// barra clavada en el 100 %.
    pub installing: bool,
}

fn ruta_marca(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join(MARCA))
}

/// Deja la marca para que el arranque siguiente traiga la ventana al frente.
///
/// Se llama **después** de que la descarga y la instalación salieron bien, no
/// antes: una descarga que falla no reinicia nada, y una marca colgada haría que
/// el próximo arranque —que es el del inicio automático (§4.18)— le robe el foco a
/// lo que estés haciendo, que es justo lo que ese arranque evita.
pub fn arm_focus_after_restart(app: &tauri::AppHandle) {
    if let Some(p) = ruta_marca(app) {
        let _ = std::fs::write(&p, b"1");
    }
}

/// ¿Este arranque viene de un update? Consume la marca al leerla.
///
/// Se borra **antes** de intentar el foco y no después: si algo falla en el medio,
/// la marca no puede quedar armada para el arranque siguiente.
pub fn came_from_update(app: &tauri::AppHandle) -> bool {
    ruta_marca(app).is_some_and(|p| consumir_marca(&p))
}

fn consumir_marca(p: &std::path::Path) -> bool {
    if !p.exists() {
        return false;
    }
    let _ = std::fs::remove_file(p);
    true
}

/// Trae la ventana `main` al frente, insistiendo hasta que quede con el foco.
///
/// **El problema que arregla.** `app.restart()` lanza el proceso nuevo y mata el
/// viejo, y macOS no activa a nadie por eso: la ventana nueva aparece detrás de la
/// app que quedó al frente. Desde afuera la app "nunca se reinició" —el síntoma es
/// exactamente ese— cuando en realidad ya está corriendo la versión nueva.
///
/// Solo `main`: el taxímetro no se levanta nunca por su cuenta.
///
/// `set_focus` de tao no hace nada si la ventana está minimizada o escondida, así
/// que el orden `unminimize` → `show` → `set_focus` importa.
pub fn raise_main_window(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        for espera in INTENTOS_MS {
            if espera > 0 {
                tokio::time::sleep(Duration::from_millis(espera)).await;
            }
            let Some(main) = app.get_webview_window("main") else {
                continue;
            };
            if main.is_focused().unwrap_or(false) {
                return;
            }
            let _ = main.unminimize();
            let _ = main.show();
            let _ = main.set_focus();
        }
    });
}

/// Manda el avance de la descarga a las ventanas.
pub fn emit_progress(app: &tauri::AppHandle, progress: UpdateProgress) {
    let _ = app.emit(UPDATE_PROGRESS, progress);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La marca se consume al leerla: dos arranques seguidos no pueden levantar la
    /// ventana dos veces, y un fallo en el medio no la deja armada.
    #[test]
    fn la_marca_del_reinicio_se_lee_una_sola_vez() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(MARCA);
        std::fs::write(&p, b"1").unwrap();

        assert!(consumir_marca(&p));
        assert!(!consumir_marca(&p));
    }
}
