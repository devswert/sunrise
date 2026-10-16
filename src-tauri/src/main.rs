// Evita abrir una consola extra en Windows en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Con `--mcp` el mismo binario es el servidor MCP (§4.32) y nunca construye
    // Tauri: ni ventana, ni icono en el Dock, ni base migrada.
    if std::env::args().skip(1).any(|a| a == sunrise_lib::mcp::FLAG) {
        if let Err(e) = sunrise_lib::mcp::run() {
            eprintln!("[sunrise-mcp] {e:#}");
            std::process::exit(1);
        }
        return;
    }
    sunrise_lib::run()
}
