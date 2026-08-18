//! Descarga del `.ics`. La única parte que toca la red.
//!
//! Está sola en su módulo para que la interpretación del calendario
//! (`calendar::ics`) y la escritura (`repo`) queden testeables sin salir a
//! internet. Acá no se parsea ni se guarda nada.

use std::time::Duration;

/// Tiempo máximo por feed. Un servidor colgado no debe dejar al poller esperando
/// para siempre y, con varios feeds, arrastrar a los demás.
const TIMEOUT: Duration = Duration::from_secs(20);

/// Trae el cuerpo del feed.
///
/// El error es un `String` legible y **nunca incluye la URL**: la de un
/// calendario privado es una credencial (el "secret address" de Google), y un
/// mensaje de error termina en logs y en pantalla.
pub async fn descargar(url: &str) -> Result<String, String> {
    let cliente = reqwest::Client::builder()
        .timeout(TIMEOUT)
        // Algunos proveedores responden distinto (o con 403) a un cliente sin
        // identificar.
        .user_agent("sunrise/0.1 (+calendar sync)")
        // Un ICS es texto repetitivo y comprime muchísimo: medido contra el feed
        // público de feriados de Google, 120 KB pasan a 12 KB. Es la única
        // palanca que hay para gastar menos en cada pasada del poller, porque el
        // endpoint **no emite `ETag` ni `Last-Modified`** y por lo tanto no
        // admite peticiones condicionales (verificado: un `If-Modified-Since`
        // con fecha futura devuelve 200 igual).
        .gzip(true)
        .build()
        .map_err(|e| format!("no pude preparar el cliente HTTP: {e}"))?;

    let resp = cliente
        .get(url)
        .send()
        .await
        .map_err(|e| format!("no pude conectar: {}", causa(&e)))?;

    let status = resp.status();
    if !status.is_success() {
        // El código dice más que el cuerpo, que suele ser una página de error.
        return Err(match status.as_u16() {
            401 | 403 => "el feed rechazó la credencial (401/403): revisa la URL secreta".into(),
            404 => "el feed no existe (404)".into(),
            otro => format!("el feed respondió {otro}"),
        });
    }

    resp.text()
        .await
        .map_err(|e| format!("no pude leer la respuesta: {e}"))
}

/// Mensaje de `reqwest` sin la URL, que `Display` incluye por defecto.
fn causa(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return format!("se pasó de {}s", TIMEOUT.as_secs());
    }
    if e.is_connect() {
        return "no hubo conexión".into();
    }
    match std::error::Error::source(e) {
        Some(s) => s.to_string(),
        None => "error de red".into(),
    }
}
