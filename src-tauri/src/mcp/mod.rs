//! El servidor MCP de sunrise (§4.32): Claude Desktop lanza `sunrise --mcp` y le
//! habla por stdin/stdout. No hay puerto ni ventana; el proceso vive mientras
//! Claude Desktop lo tenga abierto.
//!
//! **Por stdout sale solo el protocolo.** Un `println!` en cualquier camino que
//! corra acá corrompe el stream y Claude Desktop corta la conexión. Los mensajes
//! para humanos van a stderr, que Claude Desktop guarda en su log.

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
        let service = server::SunriseServer::new(db_path)
            .serve(rmcp::transport::stdio())
            .await?;
        service.waiting().await?;
        anyhow::Ok(())
    })
}
