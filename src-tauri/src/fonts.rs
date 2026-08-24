//! Las tipografías instaladas en el sistema, para el selector de Apariencia.
//!
//! **La lista la da Core Text, no la carpeta de fuentes**, y esa es la decisión de
//! este módulo: el nombre que necesita el CSS es el de la **familia** (`Helvetica
//! Neue`), y el del archivo no lo es (`HelveticaNeue.ttc`). Sacarlo del nombre de
//! archivo obligaría a parsear las tablas de cada fuente para llegar a lo que el
//! sistema ya sabe.

/// Familias que **no** se ofrecen, aunque el sistema las liste.
///
/// Las de puntitos son las internas de macOS (`.AppleSystemUIFont`,
/// `.LastResort`): no se pueden pedir por nombre desde CSS y solo ensucian la
/// lista. Las de símbolos y emoji sí se pueden pedir, y ese es el problema — con
/// una de ellas puesta, **cada letra de la app sale como un cuadrito o un dibujo**,
/// y volver atrás habría que hacerlo a ciegas. Un selector que ofrece una fuente
/// capaz de dejar la app ilegible es peor que una lista corta.
const OCULTAS: [&str; 5] = ["Apple Braille", "Apple Color Emoji", "Symbol", "Apple Symbols", "GB18030 Bitmap"];

/// Y las familias de dingbats, que vienen numeradas (`Wingdings 2`, `Wingdings 3`),
/// así que se van por prefijo o por palabra y no por nombre exacto: la lista exacta
/// se queda corta con la siguiente versión de macOS.
const OCULTAS_PARCIAL: [&str; 3] = ["Wingdings", "Dingbats", "Ornaments"];

/// Filtra y ordena lo que devuelve el sistema. Pura, para poder probarla.
pub fn usable_families(names: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = names
        .into_iter()
        .filter(|n| !n.starts_with('.'))
        .filter(|n| !OCULTAS.contains(&n.as_str()))
        .filter(|n| !OCULTAS_PARCIAL.iter().any(|p| n.contains(p)))
        .filter(|n| !n.trim().is_empty())
        .collect();
    // Sin distinguir mayúsculas: es una lista para leer, no para ordenar bytes.
    out.sort_by_key(|n| n.to_lowercase());
    out.dedup();
    out
}

/// Las familias instaladas, ya filtradas.
#[cfg(target_os = "macos")]
pub fn system_families() -> Vec<String> {
    let names = core_text::font_collection::get_family_names();
    usable_families(names.iter().map(|n| n.to_string()).collect())
}

#[cfg(not(target_os = "macos"))]
pub fn system_families() -> Vec<String> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn se_van_las_internas_las_de_simbolos_y_los_repetidos() {
        let crudo = vec![
            "Sora".to_string(),
            ".AppleSystemUIFont".to_string(),
            // Numeradas: por eso el filtro es por palabra y no por nombre exacto.
            "Wingdings 3".to_string(),
            "Zapf Dingbats".to_string(),
            "Symbol".to_string(),
            "helvetica".to_string(),
            "Sora".to_string(),
            "  ".to_string(),
        ];
        assert_eq!(usable_families(crudo), vec!["helvetica", "Sora"]);
    }

    /// Que la lista de verdad no venga vacía: si Core Text cambiara de API o el
    /// filtro se pasara de estricto, el selector quedaría con una sola opción y eso
    /// se ve como "no hay fuentes instaladas", no como un error.
    #[test]
    #[cfg(target_os = "macos")]
    fn el_sistema_ofrece_familias_de_verdad() {
        let familias = system_families();
        assert!(familias.len() > 20, "salieron {} familias", familias.len());
        assert!(familias.iter().all(|f| !f.starts_with('.')));
    }
}

