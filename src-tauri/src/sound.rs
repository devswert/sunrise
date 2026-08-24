//! Campana de fin de tiempo.
//!
//! Suena la **síntesis interna** —un cuenco tibetano aproximado, sin saturación—
//! salvo que hayas elegido un archivo propio en Configs → Apariencia, que la app
//! copia a su carpeta `sounds`.
//!
//! Quién manda es `bell_sound` de `settings`, y no la presencia del archivo: antes
//! bastaba con dejar un audio en el directorio de datos, y eso hacía imposible
//! volver a la campana de la app sin ir a borrarlo (§4.28).

use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rodio::source::Source;
use rodio::{Decoder, OutputStream, Sink};

/// Extensiones de audio que sabemos decodificar.
const AUDIO_EXTS: [&str; 5] = ["wav", "mp3", "ogg", "flac", "m4a"];

/// El valor de `bell_sound` que significa "la campana de la app".
///
/// Enum en MAYÚSCULAS como el resto (§ convención), y **no** una clave vacía: un
/// vacío no distingue "elegí la de sunrise" de "nunca elegí nada", y las dos tienen
/// que sonar igual pero solo una es una decisión.
pub const SUNRISE_BELL: &str = "SUNRISE";

/// Si la extensión es una de las que sabemos decodificar.
fn is_audio(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// El archivo de campana que corresponde tocar, según el ajuste.
///
/// `None` significa "la síntesis". Son tres casos y los tres caen ahí a propósito:
/// el ajuste dice `SUNRISE`, no dice nada, o **nombra un archivo que ya no está**
/// (se puede borrar por fuera, y quedarse en silencio sería peor que sonar la de la
/// app).
pub fn bell_file(dir: &Path, setting: Option<&str>) -> Option<PathBuf> {
    let name = setting.map(str::trim).filter(|v| !v.is_empty())?;
    if name == SUNRISE_BELL {
        return None;
    }
    // Solo el nombre: un ajuste con `../` no puede salir de la carpeta.
    let name = Path::new(name).file_name()?;
    let path = dir.join(name);
    path.is_file().then_some(path)
}

/// Copia un audio elegido por el usuario a la carpeta de sonidos y devuelve su
/// nombre, que es lo que se guarda en `bell_sound`.
///
/// **Valida decodificando, no solo por la extensión**, y esa es la decisión que
/// importa: `play_bell` cae a la síntesis cuando el decoder falla —en silencio,
/// porque una campana que revienta no puede tumbar el timer—, así que un archivo
/// que rodio no entiende se traduciría en "elegí mi mp3 y sigue sonando el de la
/// app". El error tiene que llegar acá, cuando la persona está mirando el diálogo.
///
/// **Deja uno solo.** Los audios que había se borran: la carpeta es de la app, la
/// campana es una, y acumular los descartados sería basura que nadie va a limpiar.
pub fn install_bell(dir: &Path, src: &Path) -> anyhow::Result<String> {
    if !is_audio(src) {
        anyhow::bail!(
            "solo sirven archivos de audio ({})",
            AUDIO_EXTS.join(", ")
        );
    }
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| anyhow::anyhow!("ese archivo no tiene nombre"))?
        .to_string();

    let file = File::open(src)?;
    Decoder::new(BufReader::new(file))
        .map_err(|e| anyhow::anyhow!("no pude leer ese audio: {e}"))?;

    std::fs::create_dir_all(dir)?;
    if let Ok(entries) = std::fs::read_dir(dir) {
        for path in entries.filter_map(|e| e.ok().map(|e| e.path())) {
            if path.is_file() && is_audio(&path) {
                let _ = std::fs::remove_file(path);
            }
        }
    }
    std::fs::copy(src, dir.join(&name))?;
    Ok(name)
}

// ---------------------------------------------------------------------------
// Síntesis de respaldo (cuenco tibetano aproximado)
// ---------------------------------------------------------------------------

const FUNDAMENTAL: f32 = 214.0;

/// Parciales inarmónicos: (razón, amplitud, decaimiento en s).
const PARTIALS: [(f32, f32, f32); 5] = [
    (1.0, 1.00, 0.45),
    (2.75, 0.38, 0.70),
    (5.38, 0.16, 1.10),
    (8.94, 0.07, 1.60),
    (13.34, 0.03, 2.20),
];

const BEAT_DETUNE: f32 = 1.2;

/// Ganancia calculada para que la suma de parciales nunca sature.
/// (La saturación anterior venía de sumar amplitudes sin normalizar.)
const GAIN: f32 = {
    // 1.0 + 0.38 + 0.16 + 0.07 + 0.03 + 0.35 (par desafinado) ≈ 1.99
    0.35 / 1.99
};

struct SingingBowl {
    sample_rate: u32,
    index: usize,
    total: usize,
}

impl SingingBowl {
    fn new(sample_rate: u32, secs: f32) -> Self {
        SingingBowl {
            sample_rate,
            index: 0,
            total: (sample_rate as f32 * secs) as usize,
        }
    }
}

impl Iterator for SingingBowl {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        if self.index >= self.total {
            return None;
        }
        let t = self.index as f32 / self.sample_rate as f32;
        self.index += 1;

        let tau = 2.0 * std::f32::consts::PI;
        let mut sample = 0.0;

        for (ratio, amp, decay) in PARTIALS {
            let freq = FUNDAMENTAL * ratio;
            sample += (tau * freq * t).sin() * amp * (-t / decay).exp();
        }

        // Par desafinado: batido lento característico del cuenco.
        sample += (tau * (FUNDAMENTAL + BEAT_DETUNE) * t).sin() * 0.35 * (-t / 0.45).exp();

        // Ataque suave (~30 ms) para que no suene a golpe seco.
        let attack = (t / 0.030).min(1.0);

        Some(sample * attack * GAIN)
    }
}

impl Source for SingingBowl {
    fn current_frame_len(&self) -> Option<usize> {
        None
    }
    fn channels(&self) -> u16 {
        1
    }
    fn sample_rate(&self) -> u32 {
        self.sample_rate
    }
    fn total_duration(&self) -> Option<Duration> {
        None
    }
}

/// Reproduce la campanada en un hilo aparte (no bloquea la UI).
///
/// `bell_file`: ruta a un audio propio; si es `None` o falla la decodificación,
/// usa la síntesis de respaldo.
pub fn play_bell(bell_file: Option<PathBuf>) -> anyhow::Result<()> {
    std::thread::spawn(move || {
        // Sin dispositivo de audio, se ignora en silencio.
        let Ok((_stream, handle)) = OutputStream::try_default() else {
            return;
        };
        let Ok(sink) = Sink::try_new(&handle) else {
            return;
        };

        let decoded = bell_file
            .and_then(|p| File::open(p).ok())
            .and_then(|f| Decoder::new(BufReader::new(f)).ok());

        match decoded {
            Some(source) => sink.append(source),
            None => sink.append(SingingBowl::new(44_100, 5.0)),
        }
        sink.sleep_until_end();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn play_bell_no_falla_sin_dispositivo_ni_archivo() {
        assert!(play_bell(None).is_ok());
    }

    /// Una carpeta de prueba propia por test: corren en paralelo y `install_bell`
    /// borra lo que encuentra, así que compartirla las haría pisarse.
    fn carpeta(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("sunrise-bell-{nombre}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sin_ajuste_o_con_sunrise_suena_la_sintesis() {
        let dir = carpeta("sintesis");
        // Un audio en la carpeta **no** alcanza: manda el ajuste. Antes bastaba con
        // dejarlo ahí, y eso hacía imposible volver a la campana de la app.
        std::fs::write(dir.join("cuenco.mp3"), b"x").unwrap();

        assert!(bell_file(&dir, None).is_none());
        assert!(bell_file(&dir, Some("")).is_none());
        assert!(bell_file(&dir, Some("  ")).is_none());
        assert!(bell_file(&dir, Some(SUNRISE_BELL)).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn el_ajuste_nombra_el_archivo_y_si_no_esta_cae_a_la_sintesis() {
        let dir = carpeta("nombrado");
        let cuenco = dir.join("cuenco.mp3");
        std::fs::write(&cuenco, b"x").unwrap();

        assert_eq!(bell_file(&dir, Some("cuenco.mp3")), Some(cuenco));
        // Borrado por fuera: quedarse en silencio sería peor que sonar la de la app.
        assert!(bell_file(&dir, Some("el-que-borre.mp3")).is_none());
        // Y un ajuste editado a mano no puede salir de la carpeta.
        assert!(bell_file(&dir, Some("../sunrise.sqlite")).is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn instalar_rechaza_lo_que_no_es_audio_antes_de_copiar_nada() {
        let dir = carpeta("rechazo");
        let origen = dir.join("apuntes.txt");
        std::fs::write(&origen, b"no soy audio").unwrap();

        assert!(install_bell(&dir, &origen).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    /// **El caso que justifica validar decodificando.** `play_bell` cae a la
    /// síntesis cuando el decoder falla, y en silencio: sin este chequeo, elegir un
    /// archivo roto se vive como "el selector no hace nada".
    #[test]
    fn instalar_rechaza_un_audio_que_no_se_puede_decodificar() {
        let dir = carpeta("roto");
        let origen = dir.join("mentira.mp3");
        std::fs::write(&origen, b"esto no es un mp3").unwrap();

        let err = install_bell(&dir, &origen).unwrap_err().to_string();
        assert!(err.contains("no pude leer"), "el error tiene que explicarse: {err}");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn la_sintesis_no_satura() {
        let samples: Vec<f32> = SingingBowl::new(44_100, 5.0).collect();
        // Margen de sobra respecto de 1.0: era esto lo que faltaba antes.
        let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!(peak <= 0.6, "pico demasiado alto ({peak}): saturaría");
        assert!(peak > 0.05, "demasiado bajo, no se oiría ({peak})");
    }

    #[test]
    fn ataque_suave_y_cola_larga() {
        let sr = 44_100usize;
        let samples: Vec<f32> = SingingBowl::new(sr as u32, 5.0).collect();
        assert!(samples[0].abs() < 0.01, "el ataque no debe ser un golpe seco");

        let peak = |from: usize, to: usize| {
            samples[from..to].iter().fold(0.0f32, |m, s| m.max(s.abs()))
        };
        let start = peak(3_000, 12_000);
        let late = peak(3 * sr, 3 * sr + 10_000);
        assert!(late > 0.0, "a los 3s debe seguir sonando");
        assert!(late < start, "debe decaer: {late} < {start}");
    }

    #[test]
    fn tiene_parciales_inarmonicos() {
        for (ratio, _, _) in PARTIALS.iter().skip(1) {
            assert!(
                (ratio - ratio.round()).abs() > 0.05,
                "el parcial {ratio} es armónico y sonaría a campana común",
            );
        }
    }
}
