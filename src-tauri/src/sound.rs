//! Campana de fin de tiempo.
//!
//! Prioriza un **archivo de audio real** si existe (`bell.wav|mp3|ogg|flac` en
//! el directorio de datos de la app): así puedes usar una grabación de cuenco
//! tibetano propia. Si no hay archivo, cae a una síntesis suave (sin
//! saturación) que aproxima el timbre.

use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::time::Duration;

use rodio::source::Source;
use rodio::{Decoder, OutputStream, Sink};

/// Extensiones de audio que sabemos decodificar.
const AUDIO_EXTS: [&str; 5] = ["wav", "mp3", "ogg", "flac", "m4a"];

/// Nombres preferidos (si hay varios audios, gana el primero de esta lista).
const PREFERRED_STEMS: [&str; 3] = ["bell", "timeout", "campana"];

/// Busca el sonido propio en `dir`.
///
/// Acepta **cualquier** archivo de audio de la carpeta (no un nombre fijo):
/// así basta con dejar el mp3 ahí. Si hay varios, prioriza los nombres
/// conocidos (`bell`, `timeout`, `campana`) y si no, va en orden alfabético.
pub fn find_bell_file(dir: &Path) -> Option<PathBuf> {
    let mut audios: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.is_file())
        .filter(|p| {
            p.extension()
                .and_then(|e| e.to_str())
                .map(|e| AUDIO_EXTS.contains(&e.to_lowercase().as_str()))
                .unwrap_or(false)
        })
        .collect();

    audios.sort();

    let rank = |p: &PathBuf| -> usize {
        let stem = p
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        PREFERRED_STEMS
            .iter()
            .position(|pref| stem == *pref)
            .unwrap_or(PREFERRED_STEMS.len())
    };
    audios.sort_by_key(rank);

    audios.into_iter().next()
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

    #[test]
    fn find_bell_file_acepta_cualquier_audio_de_la_carpeta() {
        let dir = std::env::temp_dir().join("sunrise-bell-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        assert!(find_bell_file(&dir).is_none(), "sin audio debe ser None");

        // Archivos que no son audio se ignoran (p. ej. la propia base de datos).
        std::fs::write(dir.join("sunrise.sqlite"), b"db").unwrap();
        assert!(find_bell_file(&dir).is_none());

        // Un mp3 con cualquier nombre sirve.
        let timeout = dir.join("timeout.mp3");
        std::fs::write(&timeout, b"fake").unwrap();
        assert_eq!(find_bell_file(&dir), Some(timeout));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn find_bell_file_prefiere_bell_si_hay_varios() {
        let dir = std::env::temp_dir().join("sunrise-bell-pref");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();

        std::fs::write(dir.join("otro.mp3"), b"x").unwrap();
        std::fs::write(dir.join("timeout.mp3"), b"x").unwrap();
        let bell = dir.join("bell.wav");
        std::fs::write(&bell, b"x").unwrap();

        assert_eq!(find_bell_file(&dir), Some(bell));

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
