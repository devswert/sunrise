//! Registrar el servidor MCP en Claude Desktop desde Configs (§4.32).
//!
//! Lee y edita `~/Library/Application Support/Claude/claude_desktop_config.json`.
//! El archivo es **de otra app** y puede tener otros servidores y ajustes, así que
//! las reglas son de no romper nada:
//!
//! - **Solo agrega.** Si ya hay una entrada con nuestro nombre apuntando a otro
//!   lado, no la toca: avisa y deja que la persona decida (puede ser una que
//!   puso a mano con argumentos propios).
//! - **Un JSON que no se entiende no se reescribe.** Escribir encima borraría lo
//!   que la persona tenía, aunque estuviera mal formado.
//! - **Copia antes de escribir** (`.sunrise-bak` al lado) y escribe con un
//!   archivo temporal más rename, para que un corte a mitad no lo deje vacío.
//! - **Conserva el orden de las claves** (`preserve_order` de serde_json): el
//!   archivo lo edita gente a mano, y verlo reordenado entero parece un daño.
//!
//! Todo lo que decide es puro sobre texto; lo que toca disco son `read` y `connect`.

use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Map, Value};

/// Estado de la conexión, espejado en `enums.ts` (`ClaudeStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Status {
    /// No hay carpeta de Claude Desktop: no está instalado o nunca se abrió.
    NoClaude,
    /// Claude Desktop existe pero sunrise no está registrado.
    NotConnected,
    /// Registrado y apuntando a este binario.
    Connected,
    /// Hay una entrada con nuestro nombre que apunta a otro binario.
    Elsewhere,
    /// El archivo existe y no es JSON válido, o no tiene la forma esperada.
    Invalid,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopInfo {
    pub status: Status,
    /// El nombre de la entrada: `sunrise`, o `sunrise-dev` en dev para que las dos
    /// puedan convivir registradas, cada una con su base.
    pub server_name: String,
    /// La ruta de este binario, que es lo que se registra.
    pub command: String,
    pub config_path: String,
    /// El bloque para pegar a mano.
    pub snippet: String,
    /// El comando para registrarlo en Claude Code.
    pub cli_command: String,
    /// A dónde apunta la entrada que ya existe, si es `Elsewhere`.
    pub current_command: Option<String>,
    /// Por qué no se puede conectar desde acá, si hay un motivo.
    pub problem: Option<String>,
}

/// El nombre con que se registra este perfil.
pub fn server_name() -> &'static str {
    if crate::db::is_dev() {
        "sunrise-dev"
    } else {
        "sunrise"
    }
}

/// `~/Library/Application Support/Claude/claude_desktop_config.json`.
pub fn config_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").filter(|h| !h.is_empty())?;
    Some(
        PathBuf::from(home)
            .join("Library/Application Support/Claude")
            .join("claude_desktop_config.json"),
    )
}

fn entry(command: &str) -> Value {
    json!({ "command": command, "args": [crate::mcp::FLAG] })
}

/// Una ruta desde la que registrar sería un error: la imagen del `.dmg` montada,
/// que desaparece al expulsarla, o la copia aleatoria donde macOS ejecuta una app
/// en cuarentena. Las dos funcionan hoy y dejan de existir mañana.
pub fn unstable_location(command: &str) -> Option<String> {
    if command.starts_with("/Volumes/") {
        return Some(
            "sunrise está corriendo desde el instalador. Muévela a Aplicaciones y ábrela desde ahí."
                .into(),
        );
    }
    if command.contains("/AppTranslocation/") {
        return Some(
            "macOS está ejecutando una copia temporal de sunrise. Quítale la cuarentena \
             (README → Instalar) y ábrela de nuevo."
                .into(),
        );
    }
    None
}

/// Cita una ruta para la terminal si hace falta.
fn shell_quote(s: &str) -> String {
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-".contains(c)) {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// Lee el estado a partir del contenido del archivo (`None` si no existe).
pub fn status_of(text: Option<&str>, name: &str, command: &str) -> (Status, Option<String>) {
    let Some(text) = text else {
        return (Status::NotConnected, None);
    };
    if text.trim().is_empty() {
        return (Status::NotConnected, None);
    }
    let Ok(root) = serde_json::from_str::<Value>(text) else {
        return (Status::Invalid, None);
    };
    let Some(obj) = root.as_object() else {
        return (Status::Invalid, None);
    };
    let servers = match obj.get("mcpServers") {
        None => return (Status::NotConnected, None),
        Some(Value::Object(s)) => s,
        Some(_) => return (Status::Invalid, None),
    };
    if servers.values().any(|v| *v == entry(command)) {
        return (Status::Connected, None);
    }
    match servers.get(name) {
        None => (Status::NotConnected, None),
        Some(existing) => (
            Status::Elsewhere,
            existing
                .get("command")
                .and_then(Value::as_str)
                .map(str::to_string),
        ),
    }
}

/// El contenido nuevo del archivo con la entrada agregada.
///
/// `Ok(None)` si ya estaba y no hay nada que escribir. Un error si el archivo no
/// se entiende o si la entrada ya existe apuntando a otro lado: en los dos casos
/// escribir significaría pisar algo de la persona.
pub fn with_entry(text: Option<&str>, name: &str, command: &str) -> Result<Option<String>, String> {
    let mut root = match text.map(str::trim).filter(|t| !t.is_empty()) {
        None => Value::Object(Map::new()),
        Some(t) => serde_json::from_str::<Value>(t).map_err(|e| {
            format!("La configuración de Claude no es JSON válido ({e}); no la toqué.")
        })?,
    };
    let obj = root
        .as_object_mut()
        .ok_or("La configuración de Claude no tiene la forma esperada; no la toqué.")?;
    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("En la configuración de Claude, «mcpServers» no tiene la forma esperada; no la toqué.")?;
    // Ya registrado, con este nombre o con otro que alguien puso a mano: una
    // segunda entrada sería un segundo servidor sobre la misma base.
    if servers.values().any(|v| *v == entry(command)) {
        return Ok(None);
    }
    match servers.get(name) {
        Some(_) => {
            return Err(format!(
                "Ya hay un servidor «{name}» registrado apuntando a otro lado; no lo toqué."
            ))
        }
        None => {
            servers.insert(name.to_string(), entry(command));
        }
    }
    let mut out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    out.push('\n');
    Ok(Some(out))
}

fn current_exe() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("No sé dónde está el binario de sunrise: {e}"))
        .map(|p| p.to_string_lossy().into_owned())
}

/// Arma la info completa leyendo el archivo de verdad.
pub fn read() -> Result<ClaudeDesktopInfo, String> {
    let command = current_exe()?;
    let path = config_path().ok_or("Falta la variable HOME.")?;
    Ok(info_for(&path, &command, server_name()))
}

fn info_for(path: &Path, command: &str, name: &str) -> ClaudeDesktopInfo {
    let claude_dir_exists = path.parent().is_some_and(Path::is_dir);
    let text = std::fs::read_to_string(path).ok();
    let (mut status, current_command) = status_of(text.as_deref(), name, command);
    if !claude_dir_exists {
        status = Status::NoClaude;
    }
    let mut snippet_root = Map::new();
    let mut servers = Map::new();
    servers.insert(name.to_string(), entry(command));
    snippet_root.insert("mcpServers".into(), Value::Object(servers));
    ClaudeDesktopInfo {
        status,
        server_name: name.to_string(),
        command: command.to_string(),
        config_path: path.to_string_lossy().into_owned(),
        snippet: serde_json::to_string_pretty(&Value::Object(snippet_root)).unwrap_or_default(),
        cli_command: format!(
            "claude mcp add --scope user {name} -- {} {}",
            shell_quote(command),
            crate::mcp::FLAG
        ),
        current_command,
        problem: unstable_location(command),
    }
}

/// Agrega la entrada y devuelve el estado nuevo.
pub fn connect() -> Result<ClaudeDesktopInfo, String> {
    let command = current_exe()?;
    let path = config_path().ok_or("Falta la variable HOME.")?;
    connect_at(&path, &command, server_name())
}

fn connect_at(path: &Path, command: &str, name: &str) -> Result<ClaudeDesktopInfo, String> {
    if let Some(problem) = unstable_location(command) {
        return Err(problem);
    }
    let dir = path
        .parent()
        .filter(|d| d.is_dir())
        .ok_or("No encontré Claude Desktop en este Mac. Ábrelo una vez y vuelve a intentarlo.")?;
    let text = match std::fs::read_to_string(path) {
        Ok(t) => Some(t),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("No pude leer la configuración de Claude: {e}")),
    };
    if let Some(new_text) = with_entry(text.as_deref(), name, command)? {
        if text.is_some() {
            let backup = path.with_extension("json.sunrise-bak");
            std::fs::copy(path, &backup)
                .map_err(|e| format!("No pude guardar una copia antes de escribir: {e}"))?;
        }
        // Si el archivo es un symlink (un repo de dotfiles, por ejemplo), se
        // escribe en el destino: reemplazar el link por un archivo suelto lo
        // desconectaría de donde la persona lo mantiene. Y el temporal se lleva
        // los permisos del original, porque nace en 0600.
        let target = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let target_dir = target.parent().unwrap_or(dir);
        let write_err = |e: std::io::Error| format!("No pude escribir la configuración de Claude: {e}");
        let tmp = tempfile::NamedTempFile::new_in(target_dir).map_err(write_err)?;
        std::fs::write(tmp.path(), new_text).map_err(write_err)?;
        if let Ok(meta) = std::fs::metadata(&target) {
            std::fs::set_permissions(tmp.path(), meta.permissions()).map_err(write_err)?;
        }
        tmp.persist(&target).map_err(|e| write_err(e.error))?;
    }
    Ok(info_for(path, command, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    const BIN: &str = "/Applications/sunrise.app/Contents/MacOS/sunrise";

    #[test]
    fn agrega_la_entrada_sin_tocar_lo_que_ya_habia() {
        let before = r#"{
  "globalShortcut": "Alt+Space",
  "mcpServers": {
    "zeta": { "command": "npx", "args": ["-y", "zeta"] },
    "alfa": { "command": "uvx", "args": ["alfa"] }
  }
}"#;
        let after = with_entry(Some(before), "sunrise", BIN).unwrap().unwrap();
        let v: Value = serde_json::from_str(&after).unwrap();
        assert_eq!(v["globalShortcut"], "Alt+Space");
        assert_eq!(v["mcpServers"]["zeta"]["args"][1], "zeta");
        assert_eq!(v["mcpServers"]["sunrise"], entry(BIN));

        // El orden de las claves se conserva: el archivo lo edita gente a mano.
        let order: Vec<&String> = v["mcpServers"].as_object().unwrap().keys().collect();
        assert_eq!(order, ["zeta", "alfa", "sunrise"]);
        assert!(after.find("globalShortcut") < after.find("mcpServers"));
    }

    #[test]
    fn crea_el_archivo_si_no_existe() {
        let created = with_entry(None, "sunrise", BIN).unwrap().unwrap();
        let (status, _) = status_of(Some(&created), "sunrise", BIN);
        assert_eq!(status, Status::Connected);
    }

    #[test]
    fn si_ya_esta_no_reescribe_nada() {
        let existing = with_entry(None, "sunrise", BIN).unwrap().unwrap();
        assert_eq!(with_entry(Some(&existing), "sunrise", BIN).unwrap(), None);
    }

    #[test]
    fn una_entrada_que_apunta_a_otro_lado_no_se_pisa() {
        let other = r#"{"mcpServers":{"sunrise":{"command":"/other/path","args":["--mcp"]}}}"#;
        assert!(with_entry(Some(other), "sunrise", BIN).is_err());
        let (status, current) = status_of(Some(other), "sunrise", BIN);
        assert_eq!(status, Status::Elsewhere);
        assert_eq!(current.as_deref(), Some("/other/path"));
    }

    #[test]
    fn un_json_roto_no_se_reescribe() {
        let broken = r#"{"mcpServers": { "a": } "#;
        assert!(with_entry(Some(broken), "sunrise", BIN).is_err());
        assert_eq!(status_of(Some(broken), "sunrise", BIN).0, Status::Invalid);
        let odd = r#"{"mcpServers": []}"#;
        assert!(with_entry(Some(odd), "sunrise", BIN).is_err());
        assert_eq!(status_of(Some(odd), "sunrise", BIN).0, Status::Invalid);
    }

    #[test]
    fn dev_y_produccion_se_registran_con_nombres_distintos() {
        // Los tests corren en el lado dev.
        assert_eq!(server_name(), "sunrise-dev");
        let with_prod = with_entry(None, "sunrise", BIN).unwrap().unwrap();
        let (status, _) = status_of(Some(&with_prod), server_name(), "/repo/target/debug/sunrise");
        assert_eq!(status, Status::NotConnected, "dev no ve la entrada de producción como suya");
    }

    #[test]
    fn una_entrada_a_mano_con_otro_nombre_cuenta_como_conectada() {
        // El caso real: se registró a mano como «sunrise» apuntando al binario de
        // dev, y dev se llama «sunrise-dev». Sin esto el botón agregaba un
        // duplicado y Claude levantaba dos servidores sobre la misma base.
        let by_hand = format!(r#"{{"mcpServers":{{"sunrise":{{"command":"{BIN}","args":["--mcp"]}}}}}}"#);
        assert_eq!(status_of(Some(&by_hand), "sunrise-dev", BIN).0, Status::Connected);
        assert_eq!(with_entry(Some(&by_hand), "sunrise-dev", BIN).unwrap(), None);
    }

    #[test]
    fn no_registra_desde_una_ubicacion_que_va_a_desaparecer() {
        assert!(unstable_location("/Volumes/sunrise/sunrise.app/Contents/MacOS/sunrise").is_some());
        assert!(unstable_location(
            "/private/var/folders/x/AppTranslocation/ABC/d/sunrise.app/Contents/MacOS/sunrise"
        )
        .is_some());
        assert!(unstable_location(BIN).is_none());
    }

    #[test]
    fn el_comando_de_claude_code_cita_rutas_con_espacios() {
        assert_eq!(shell_quote(BIN), BIN);
        assert_eq!(shell_quote("/Users/a b/sunrise"), "'/Users/a b/sunrise'");
    }

    #[test]
    fn conectar_en_disco_guarda_una_copia_y_escribe_entero() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        std::fs::write(&path, r#"{"mcpServers":{"otro":{"command":"x"}}}"#).unwrap();

        let info = connect_at(&path, BIN, "sunrise").unwrap();
        assert_eq!(info.status, Status::Connected);
        let backup = std::fs::read_to_string(dir.path().join("claude_desktop_config.json.sunrise-bak"))
            .unwrap();
        assert!(!backup.contains("sunrise"), "la copia es la de antes");
        let now: Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(now["mcpServers"]["otro"]["command"], "x");
    }

    #[test]
    fn un_config_que_es_symlink_sigue_siendo_symlink() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("dotfiles.json");
        std::fs::write(&real, r#"{"mcpServers":{}}"#).unwrap();
        let claude = dir.path().join("Claude");
        std::fs::create_dir(&claude).unwrap();
        let link = claude.join("claude_desktop_config.json");
        std::os::unix::fs::symlink(&real, &link).unwrap();

        connect_at(&link, BIN, "sunrise").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert!(std::fs::read_to_string(&real).unwrap().contains(BIN));
    }

    #[test]
    fn escribir_conserva_los_permisos_del_original() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("claude_desktop_config.json");
        std::fs::write(&path, "{}").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();

        connect_at(&path, BIN, "sunrise").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o644);
    }

    #[test]
    fn sin_claude_desktop_no_crea_su_carpeta() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Claude/claude_desktop_config.json");
        assert!(connect_at(&path, BIN, "sunrise").is_err());
        assert!(!dir.path().join("Claude").exists());
        assert_eq!(info_for(&path, BIN, "sunrise").status, Status::NoClaude);
    }
}
