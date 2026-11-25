//! El servidor MCP de sunrise (§4.32): Claude Desktop lanza `sunrise --mcp` y le
//! habla por stdin/stdout. No hay puerto ni ventana; el proceso vive mientras
//! Claude Desktop lo tenga abierto.
//!
//! **Por stdout sale solo el protocolo.** Un `println!` en cualquier camino que
//! corra acá corrompe el stream y Claude Desktop corta la conexión. Los mensajes
//! para humanos van a stderr, que Claude Desktop guarda en su log.

mod exe;
mod server;
mod store;
mod tools;

use rmcp::ServiceExt;

/// El argumento con el que `main.rs` entra acá en vez de abrir la app.
pub const FLAG: &str = "--mcp";

/// Corre el servidor hasta que Claude Desktop cierre la conexión.
pub fn run() -> anyhow::Result<()> {
    let db_path = store::db_path().map_err(anyhow::Error::msg)?;
    eprintln!("[sunrise-mcp] base: {}", db_path.display());

    // Un runtime propio y de un hilo: acá no hay Tauri que lo traiga, y las
    // llamadas son de a una.
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    runtime.block_on(async {
        let server = server::SunriseServer::new(db_path);
        let restart = server.restart_signal();
        let service = server.serve(rmcp::transport::stdio()).await?;
        tokio::select! {
            r = service.waiting() => {
                r?;
            }
            // Este proceso quedó viejo tras una actualización (§4.32). La tool que lo
            // decidió todavía tiene que escribir su respuesta: el `send` de rmcp ya
            // hace flush, y el medio segundo es solo margen antes de salir. Claude
            // Desktop vuelve a lanzar el servidor, ya con el binario nuevo, en la
            // siguiente llamada.
            //
            // `exit` y no volver de `run`: soltar el runtime espera a la lectura
            // bloqueante de stdin, que no termina mientras Claude Desktop tenga la
            // conexión abierta, y el proceso quedaría vivo.
            _ = restart.notified() => {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                eprintln!("[sunrise-mcp] salgo para que Claude Desktop me relance");
                std::process::exit(0);
            }
        }
        anyhow::Ok(())
    })
}
