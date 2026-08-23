//! La campana del estimado: quién decide que suene, y cuándo.
//!
//! **Vive en Rust y no en el front, y esa es toda la razón de este módulo.**
//! Antes la decisión estaba en el `tick` de 1 s del webview de `main`, con el
//! taxímetro explícitamente excluido para que no sonaran dos copias. El problema
//! es cuál de las dos ventanas quedó a cargo: `main` es la que se tapa o se
//! minimiza, y **un webview que no se ve no corre sus timers** — macOS los
//! estrangula—, así que la campana no sonaba mientras estabas en una reunión y
//! recién sonaba cuando algo despertaba la página (un evento del poller de
//! calendario, por ejemplo, o sea hasta `poll_minutes` después). El taxímetro, que
//! sí estaba a la vista y contando bien, era justamente el que no tenía permiso
//! para sonar.
//!
//! Un proceso nativo no se estrangula. Poniéndolo acá, además, desaparece la
//! invariante de "una sola ventana toca la campana": no hay ventana que elegir.

use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use tauri::{AppHandle, Manager};
use tokio::sync::Notify;

use crate::db::Db;
use crate::models::ActiveTimer;
use crate::repo;

/// Lo más que se espera entre dos miradas al reloj.
///
/// **Es un techo, no el pulso**: normalmente se duerme justo hasta el momento en
/// que la campana tiene que sonar (`next_wake`). El techo existe porque **el
/// momento calculado no se puede dar por bueno**: entre que se calcula y que
/// llega, el estimado puede cambiar, puede entrar un ajuste manual de tiempo, o la
/// máquina puede dormirse —y los temporizadores no corren mientras duerme, así que
/// una espera larga despierta tarde en tiempo de reloj—. Volviendo a mirar cada
/// 30 s como máximo, cualquiera de esos casos se corrige solo.
///
/// Es la misma lección que `useDayWatcher` en el front, que compara **fechas** en
/// vez de contar tiempo transcurrido, y por esta razón exacta.
const MAX_ESPERA: Duration = Duration::from_secs(30);

/// Piso de espera, para que un estimado ya alcanzado no arme un loop caliente.
const MIN_ESPERA: Duration = Duration::from_secs(1);

/// Lo más que se espera **sin ningún timer corriendo**, si nadie avisa.
///
/// Sin timer no hay nada que calcular, así que el vigilante se queda esperando el
/// aviso de `Armed` en vez de mirar el reloj. El techo largo es la red: si algún
/// día un camino nuevo abre una entrada sin avisar, la campana llega tarde en vez
/// de no llegar nunca.
const ESPERA_DORMIDO: Duration = Duration::from_secs(300);

/// El timbre para despertar al vigilante: lo toca quien arranca un timer.
///
/// Existe para que **arrancar un timer arme la campana en el acto** sin que el
/// vigilante tenga que estar mirando el reloj mientras no hay nada que vigilar. Es
/// una optimización, **no** el mecanismo: si alguien abre una entrada sin tocarlo,
/// la campana sale con hasta `ESPERA_DORMIDO` de atraso, no se pierde. Esa es toda
/// la diferencia entre esto y colgar la decisión de un aviso.
#[derive(Clone)]
pub struct Armed(pub Arc<Notify>);

impl Armed {
    pub fn new() -> Self {
        Self(Arc::new(Notify::new()))
    }

    /// Avisa que algo pudo cambiar cuándo toca la campana.
    pub fn poke(app: &AppHandle) {
        if let Some(armed) = app.try_state::<Armed>() {
            armed.0.notify_one();
        }
    }
}

/// Segundos trabajados **hoy** en la tarea del timer, contando la entrada abierta.
///
/// Espeja `runSeconds` del front (`timerStore.ts`), y el detalle que hay que
/// respetar es el recorte a medianoche: `base_seconds` ya son solo las entradas
/// cerradas **de hoy**, así que una entrada abierta desde ayer no puede acreditar
/// lo de ayer o la campana sonaría al arrancar el día.
///
/// Una marca ilegible **no infla la cuenta**: se devuelve la base, igual que el
/// front, que con `NaN` devuelve 0 segundos de corrida.
pub fn elapsed_today(
    base_seconds: i64,
    started_at: &str,
    midnight: DateTime<Utc>,
    now: DateTime<Utc>,
) -> i64 {
    let Ok(start) = DateTime::parse_from_rfc3339(started_at) else {
        return base_seconds;
    };
    let from = start.with_timezone(&Utc).max(midnight);
    base_seconds + (now - from).num_seconds().max(0)
}

/// Por qué promesa ya sonó la campana: la entrada **y el estimado** que tenía.
///
/// El par y no solo el id, porque el estimado se edita con el timer corriendo.
/// Guardando solo el id, subir el estimado de 1 h a 2 h dejaba esa entrada muda
/// para siempre —ya había sonado—, que es justo lo que reportó el dev. Y la
/// campana no promete "avisé una vez por esta tarea" sino "avisé que alcanzaste
/// **este** tiempo": si el tiempo cambia, la promesa es otra.
pub type Rung = (i64, i64);

/// ¿Le toca campana a este timer?
///
/// Las reglas de producto son las que tenía el front (SPECS §4.6): sin estimado
/// —`None` o `<= 0`— **nunca** suena; suena al **alcanzar** el estimado, no al
/// pasarlo; y suena **una sola vez por entrada**, no por tarea, así que pausar y
/// reanudar la vuelve a armar — igual que cambiarle el estimado.
pub fn is_due(
    active: &ActiveTimer,
    midnight: DateTime<Utc>,
    now: DateTime<Utc>,
    rung: Option<Rung>,
) -> bool {
    let Some(estimated) = active.estimated_minutes.filter(|m| *m > 0) else {
        return false;
    };
    if rung == Some((active.entry_id, estimated)) {
        return false;
    }
    elapsed_today(active.base_seconds, &active.started_at, midnight, now) >= estimated * 60
}

/// Cuánto dormir antes de volver a mirar: lo que falta para la campana, acotado
/// entre `MIN_ESPERA` y `MAX_ESPERA`.
///
/// Sin timer, sin estimado, o con el estimado ya alcanzado, se espera el techo: no
/// hay ningún momento que valga la pena adivinar.
pub fn next_wake(
    active: Option<&ActiveTimer>,
    midnight: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Duration {
    let Some(active) = active else {
        return MAX_ESPERA;
    };
    let Some(estimated) = active.estimated_minutes.filter(|m| *m > 0) else {
        return MAX_ESPERA;
    };
    let falta =
        estimated * 60 - elapsed_today(active.base_seconds, &active.started_at, midnight, now);
    if falta <= 0 {
        return MAX_ESPERA;
    }
    Duration::from_secs(falta as u64).clamp(MIN_ESPERA, MAX_ESPERA)
}

/// El texto de la notificación de la campana, **y vive acá y solo acá**.
///
/// Misma razón que `notice::copy`: el que la manda es este vigilante, así que una
/// copia en el front acabaría probando un aviso que no existe. Dev Tools lo pide con
/// `preview_bell_notice`, así que su botón prueba **este**.
///
/// Misma forma que el aviso de reunión (§4.26): el título dice qué clase de cosa es,
/// el cuerpo cuál, y cierra con el mismo gesto para que se aprenda una vez.
pub fn copy(title: &str, estimated: i64) -> (String, String, String) {
    (
        "Se acabó el tiempo estimado".to_string(),
        format!("Llevas los {estimated} min de {title}. {}", crate::notice::HINT),
        "Ir a Focus".to_string(),
    )
}

/// Toca la campana: el audio propio si dejaste uno en el directorio de datos de
/// la app (`bell.wav|mp3|ogg|flac`), y si no la síntesis interna.
///
/// `sound::play_bell` levanta su propio hilo, así que esto no bloquea el runtime.
fn ring(app: &AppHandle) -> anyhow::Result<()> {
    let custom = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|dir| crate::sound::find_bell_file(&dir));
    crate::sound::play_bell(custom)
}

/// Lee el timer en curso y **suelta el lock antes de volver**.
///
/// Vive aparte del loop por eso mismo: sostener el `Mutex` de la DB mientras se
/// decide algo que no la necesita —y mientras suena la campana— es la forma de
/// trabar al resto de la app.
/// La clave de `settings` que agrega **una notificación** al sonido de la campana.
/// Espeja `SettingKey.NOTICE_BELL`.
const KEY_NOTICE: &str = "notice_bell";

/// Si además del sonido hay que mandar una notificación clickeable.
///
/// **Apagada por defecto**, al revés que los otros dos switches, y por la decisión
/// de M2: la campana **no** notifica —el sonido alcanza y una notificación por tarea
/// se apila (§4.6)—, así que esto es opt-in. Lo que gana quien la prende es que el
/// click lleva a Focus con la tarea que está corriendo.
///
/// **El sonido no depende de esto.** Es la campana, no el aviso: apagar la
/// notificación no puede dejar al timer sin su campanada, o el switch mentiría
/// sobre lo que apaga.
fn notice_enabled(conn: &rusqlite::Connection) -> bool {
    repo::get_setting(conn, KEY_NOTICE)
        .ok()
        .flatten()
        .map(|v| v.trim() == "1")
        .unwrap_or(false)
}

/// Si la notificación de la campana está encendida. Lock aparte y corto.
fn notice_on(app: &AppHandle) -> bool {
    let db = app.state::<Db>();
    let conn = match db.0.lock() {
        Ok(conn) => conn,
        Err(_) => return false,
    };
    notice_enabled(&conn)
}

fn read_active(app: &AppHandle) -> Option<ActiveTimer> {
    let db = app.state::<Db>();
    let conn = match db.0.lock() {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("[sunrise] campana: no pude leer el timer: {e}");
            return None;
        }
    };
    repo::get_active_timer(&conn).ok().flatten()
}

/// Arranca el vigilante. Se llama una vez, desde `setup`.
///
/// **Duerme hasta el momento en que la campana tiene que sonar** (`next_wake`),
/// con un techo de `MAX_ESPERA`, y **cada vuelta vuelve a leer la base**. Las dos
/// mitades son la misma decisión: dormir hasta el momento justo es lo que evita
/// despertar 720 veces por hora, y volver a leer es lo que evita tener que
/// invalidar nada. Un `sleep` calculado una sola vez sería una decisión cacheada,
/// y habría que acordarse de rearmarla al editar el estimado, al ajustar el tiempo
/// a mano, al pausar, al cambiar de tarea y al volver de dormir la máquina — cinco
/// lugares donde olvidarse deja la campana muda **sin ningún síntoma**, que es
/// exactamente el bug que este módulo vino a arreglar.
///
/// Lo que ya sonó se recuerda en una variable **del loop** y no en un estado
/// compartido: nadie más necesita ese dato. Se olvida cuando no hay timer, que es
/// lo que deja el caso raro —restaurar un respaldo y toparse con un id ya visto—
/// del lado de sonar.
pub fn start_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let armed = app.state::<Armed>().0.clone();
        let mut rung: Option<Rung> = None;
        loop {
            let activo = read_active(&app);
            let espera = match activo {
                None => ESPERA_DORMIDO,
                Some(ref a) => next_wake(Some(a), repo::start_of_today(), Utc::now()),
            };
            // El timbre corta la espera: darle play a algo arma la campana en el
            // acto, sin tener que estar mirando el reloj mientras no hay timer.
            tokio::select! {
                _ = tokio::time::sleep(espera) => {}
                _ = armed.notified() => {}
            }

            // Se relee después de dormir: lo que se leyó para calcular la espera
            // ya puede ser viejo, y esta es la lectura que decide.
            let Some(active) = read_active(&app) else {
                rung = None;
                continue;
            };
            let Some(estimated) = active.estimated_minutes.filter(|m| *m > 0) else {
                continue;
            };
            if !is_due(&active, repo::start_of_today(), Utc::now(), rung) {
                continue;
            }

            rung = Some((active.entry_id, estimated));
            // Se deja rastro, como el poller de calendario: es lo único que
            // permite saber después si sonó, y una campana que no suena no deja
            // ningún síntoma en pantalla.
            eprintln!(
                "[sunrise] campana: «{}» alcanzó sus {estimated} min (entrada {})",
                active.title, active.entry_id
            );
            if let Err(e) = ring(&app) {
                eprintln!("[sunrise] campana: no pudo sonar: {e}");
            }
            // Y la notificación, si la prendieron: el sonido dice "se acabó" y la
            // notificación dice **de qué tarea** y te lleva a ella.
            if notice_on(&app) {
                let (titulo, cuerpo, boton) = copy(&active.title, estimated);
                crate::commands::send_alert(
                    &app,
                    titulo,
                    cuerpo,
                    boton,
                    crate::commands::default_sound(),
                    Some(crate::commands::NoticeTarget {
                        route: "/focus".into(),
                        task_id: Some(active.task_id),
                    }),
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instante(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn timer(started_at: &str, base_seconds: i64, estimated_minutes: Option<i64>) -> ActiveTimer {
        ActiveTimer {
            entry_id: 7,
            task_id: 1,
            title: "Escribir".into(),
            started_at: started_at.into(),
            base_seconds,
            estimated_minutes,
        }
    }

    const MEDIANOCHE: &str = "2026-08-21T04:00:00+00:00";

    #[test]
    fn suena_al_alcanzar_el_estimado_y_no_antes() {
        let t = timer("2026-08-21T13:00:00+00:00", 0, Some(30));
        let medianoche = instante(MEDIANOCHE);

        assert!(!is_due(&t, medianoche, instante("2026-08-21T13:29:59+00:00"), None));
        assert!(is_due(&t, medianoche, instante("2026-08-21T13:30:00+00:00"), None));
    }

    #[test]
    fn el_tiempo_ya_registrado_hoy_cuenta() {
        // 25 minutos cerrados antes + 5 corriendo = el estimado de 30.
        let t = timer("2026-08-21T13:00:00+00:00", 25 * 60, Some(30));
        assert!(is_due(
            &t,
            instante(MEDIANOCHE),
            instante("2026-08-21T13:05:00+00:00"),
            None
        ));
    }

    #[test]
    fn no_suena_dos_veces_por_la_misma_entrada() {
        let t = timer("2026-08-21T13:00:00+00:00", 0, Some(30));
        let ahora = instante("2026-08-21T14:00:00+00:00");
        assert!(is_due(&t, instante(MEDIANOCHE), ahora, None));
        assert!(!is_due(&t, instante(MEDIANOCHE), ahora, Some((t.entry_id, 30))));
        // Otra entrada de la misma tarea sí: pausar y reanudar vuelve a armarla.
        assert!(is_due(&t, instante(MEDIANOCHE), ahora, Some((999, 30))));
    }

    #[test]
    fn subirle_el_estimado_vuelve_a_armar_la_campana() {
        // Lo reportó el dev: sonó a la hora, le sumó tiempo, y no volvió a sonar
        // nunca. Con la entrada como única llave, esa entrada quedaba muda para
        // siempre; la promesa es "alcanzaste ESTE tiempo", no "ya te avisé una vez".
        let t = timer("2026-08-21T13:00:00+00:00", 0, Some(120));
        let sono_a_los_60 = Some((t.entry_id, 60));

        // A las dos horas justas, con el estimado nuevo, suena de nuevo.
        assert!(is_due(
            &t,
            instante(MEDIANOCHE),
            instante("2026-08-21T15:00:00+00:00"),
            sono_a_los_60
        ));
        // Y antes de alcanzarlo, no.
        assert!(!is_due(
            &t,
            instante(MEDIANOCHE),
            instante("2026-08-21T14:30:00+00:00"),
            sono_a_los_60
        ));
    }

    #[test]
    fn se_duerme_justo_hasta_la_campana() {
        // 30 min de estimado, 5 corridos: quedan 25, pero el techo manda mientras
        // falte mucho. Ese techo es lo que hace que un estimado editado o una
        // máquina que despierta se corrijan solos.
        let t = timer("2026-08-21T13:00:00+00:00", 0, Some(30));
        let medianoche = instante(MEDIANOCHE);
        assert_eq!(
            next_wake(Some(&t), medianoche, instante("2026-08-21T13:05:00+00:00")),
            MAX_ESPERA
        );
        // Faltando menos que el techo, se duerme exactamente lo que falta.
        assert_eq!(
            next_wake(Some(&t), medianoche, instante("2026-08-21T13:29:48+00:00")),
            Duration::from_secs(12)
        );
    }

    #[test]
    fn sin_nada_que_esperar_se_duerme_el_techo() {
        let medianoche = instante(MEDIANOCHE);
        let ahora = instante("2026-08-21T14:00:00+00:00");
        // Sin timer.
        assert_eq!(next_wake(None, medianoche, ahora), MAX_ESPERA);
        // Con timer sin estimado.
        let sin = timer("2026-08-21T13:00:00+00:00", 0, None);
        assert_eq!(next_wake(Some(&sin), medianoche, ahora), MAX_ESPERA);
        // Y con el estimado ya alcanzado: no queda momento que adivinar, y sobre
        // todo no puede devolver cero y armar un loop caliente.
        let pasado = timer("2026-08-21T13:00:00+00:00", 0, Some(5));
        assert_eq!(next_wake(Some(&pasado), medianoche, ahora), MAX_ESPERA);
    }

    #[test]
    fn sin_estimado_no_suena_nunca() {
        let ahora = instante("2026-08-22T13:00:00+00:00");
        for estimado in [None, Some(0), Some(-5)] {
            let t = timer("2026-08-21T13:00:00+00:00", 0, estimado);
            assert!(!is_due(&t, instante(MEDIANOCHE), ahora, None));
        }
    }

    #[test]
    fn una_entrada_abierta_desde_ayer_no_acredita_lo_de_ayer() {
        // Sin el recorte a medianoche, un timer que quedó corriendo toda la noche
        // haría sonar la campana a las 00:00 de cualquier tarea con estimado.
        let t = timer("2026-08-20T18:00:00+00:00", 0, Some(30));
        let medianoche = instante(MEDIANOCHE);

        assert!(!is_due(&t, medianoche, instante("2026-08-21T04:10:00+00:00"), None));
        assert!(is_due(&t, medianoche, instante("2026-08-21T04:30:00+00:00"), None));
    }

    #[test]
    fn una_marca_ilegible_no_infla_la_cuenta() {
        let medianoche = instante(MEDIANOCHE);
        let ahora = instante("2026-08-21T13:00:00+00:00");
        assert_eq!(elapsed_today(600, "ayer por la tarde", medianoche, ahora), 600);
        assert!(!is_due(&timer("ayer", 600, Some(30)), medianoche, ahora, None));
    }

    #[test]
    fn el_texto_de_la_notificacion_tiene_la_misma_forma_que_el_de_la_reunion() {
        // Título: qué clase de cosa es. Cuerpo: cuál, y el mismo cierre. Si los dos
        // avisos se leyeran distinto, el gesto habría que aprenderlo dos veces.
        let (t, b, a) = copy("Weekly de equipo", 90);
        assert_eq!(t, "Se acabó el tiempo estimado");
        assert_eq!(b, "Llevas los 90 min de Weekly de equipo. Toca para verla.");
        assert_eq!(a, "Ir a Focus");
    }

    #[test]
    fn un_reloj_que_va_para_atras_no_resta_tiempo() {
        // `now` anterior al inicio solo puede venir de un ajuste de reloj; que
        // reste segundos dejaría el contador por debajo de lo ya registrado.
        let medianoche = instante(MEDIANOCHE);
        assert_eq!(
            elapsed_today(
                300,
                "2026-08-21T13:00:00+00:00",
                medianoche,
                instante("2026-08-21T12:00:00+00:00")
            ),
            300
        );
    }
}
