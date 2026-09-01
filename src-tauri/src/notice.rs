//! El aviso de "se viene tu próxima reunión".
//!
//! **Vive en Rust por la invariante I6**, igual que la campana y el respaldo: lo
//! que depende del reloj y tiene que pasar aunque no mires no puede colgar de un
//! `setInterval` del webview, porque un webview que no se ve no corre sus timers.
//! Y acá el caso que importa es exactamente ese: el aviso sirve cuando **estás en
//! otra ventana** y se te viene el Meet encima.
//!
//! ## La espera es la de la campana, no la del respaldo
//!
//! Los tres vigilantes tienen la misma forma —leer, dormir, **releer**, decidir—
//! pero no la misma espera, y acá la diferencia importa por dos razones:
//!
//! - **El momento se mueve**: alguien te corre la reunión y la sincronización lo
//!   escribe. Así que se duerme hasta el cruce y se relee al despertar, sin cachear
//!   la decisión.
//! - **Y no se pone al día.** El respaldo puede llegar tarde y sigue sirviendo; un
//!   aviso de "en 5 minutos" a las 09:30 para una reunión de 09:00 es basura. Por
//!   eso `due` exige que la reunión **todavía no haya empezado**, que además es lo
//!   que evita que un Mac recién despertado vomite seis avisos viejos de golpe.
//!
//! ## Lo que no se puede resolver acá
//!
//! **Que la alerta se quede en pantalla no lo decide la app.** El botón de acción
//! es necesario y no suficiente: manda el estilo de notificación que el usuario
//! tenga en Ajustes del sistema, y no hay API para leerlo ni escribirlo (SPECS
//! §4.25). Lo único que se puede hacer es decírselo una vez, y eso lo hace la
//! sección de Notificaciones de Configs.

use std::time::Duration;

use chrono::Utc;
use tauri::{AppHandle, Manager};

use crate::db::Db;
use crate::repo::{self, Meeting};

/// Lo más que se espera entre dos miradas al reloj.
///
/// Techo y no pulso: normalmente se duerme hasta el próximo cruce. Existe por lo
/// mismo que en `bell.rs` — entre que se calcula el momento y que llega, la
/// sincronización puede mover la reunión, se puede prender el aviso desde Configs,
/// o la máquina puede dormirse (y los temporizadores no corren mientras duerme,
/// así que una espera larga despierta tarde en tiempo de reloj).
const MAX_ESPERA: Duration = Duration::from_secs(60);

/// Piso, para que un cruce ya alcanzado no arme un loop caliente.
const MIN_ESPERA: Duration = Duration::from_secs(2);

/// Cuántos minutos antes avisar, si el ajuste falta o trae basura.
/// **Espejo de `SETTING_DEFAULTS.noticeMeetingMinutes`** en el front.
pub const DEFAULT_LEAD: i64 = 5;

/// La clave de `settings`. Espeja `SettingKey.NOTICE_MEETING_MINUTES`.
pub const KEY_LEAD: &str = "notice_meeting_minutes";

/// Minutos desde medianoche de un `HH:mm`, o `None` si no se entiende.
///
/// Se compara en números y no como texto por lo mismo que el respaldo: una hora de
/// un dígito (`9:05`) rompe la comparación lexicográfica en silencio.
pub fn minutes_of_day(hhmm: &str) -> Option<i64> {
    let (h, m) = hhmm.trim().split_once(':')?;
    let h: i64 = h.trim().parse().ok()?;
    let m: i64 = m.trim().parse().ok()?;
    if h > 23 || m > 59 {
        return None;
    }
    Some(h * 60 + m)
}

/// Cuántos minutos antes avisar, según el ajuste. **0 apaga el aviso.**
///
/// Mismo patrón que el resto de `settings`: parser con fallback, porque el valor
/// puede faltar, venir vacío o traer basura editada a mano. Un negativo se lee como
/// apagado y no como "avisar después de que empezó".
pub fn lead_minutes(raw: Option<&str>) -> i64 {
    match raw.map(str::trim) {
        None | Some("") => DEFAULT_LEAD,
        Some(v) => match v.parse::<i64>() {
            Ok(n) if n >= 0 => n,
            Ok(_) => 0,
            Err(_) => DEFAULT_LEAD,
        },
    }
}

/// ¿A cuál de las reuniones del día le toca aviso **ahora**?
///
/// La ventana es `[hora - lead, hora)`: se avisa desde que faltan `lead` minutos y
/// **hasta que la reunión empieza**, nunca después. Ese borde superior es el que
/// hace que el aviso no se ponga al día, y es deliberado.
///
/// Con `lead == 0` no avisa nunca: es el apagado. Una reunión con hora ilegible se
/// salta —no se puede calcular su cruce— y una que ya tiene anotada **esta misma
/// hora** tampoco: ya se avisó por esa promesa. Si le cambiaron la hora, la
/// anotación es de otra y vuelve a entrar.
pub fn due<'a>(agenda: &'a [Meeting], now_hhmm: &str, lead: i64) -> Option<&'a Meeting> {
    if lead <= 0 {
        return None;
    }
    let now = minutes_of_day(now_hhmm)?;
    agenda.iter().find(|m| {
        if m.notified_for.as_deref() == Some(m.time.as_str()) {
            return false;
        }
        match minutes_of_day(&m.time) {
            Some(hora) => now >= hora - lead && now < hora,
            None => false,
        }
    })
}

/// Cuánto dormir: lo que falta para el próximo cruce, acotado.
///
/// Sin agenda, con el aviso apagado o con todo ya avisado, se espera el techo. No
/// hay nada que adivinar y el techo alcanza: sin él, prender el aviso desde Configs
/// no tendría efecto hasta la próxima reunión.
pub fn next_wake(agenda: &[Meeting], now_hhmm: &str, lead: i64) -> Duration {
    if lead <= 0 {
        return MAX_ESPERA;
    }
    // Si ya hay algo dentro de su ventana, no se espera: es el caso de arrancar la
    // app a las 14:57 con una reunión a las 15:00. Sin esto el aviso salía hasta un
    // minuto tarde sobre un adelanto de cinco, que es un quinto del aviso.
    if due(agenda, now_hhmm, lead).is_some() {
        return MIN_ESPERA;
    }
    let Some(now) = minutes_of_day(now_hhmm) else {
        return MAX_ESPERA;
    };
    let falta = agenda
        .iter()
        .filter(|m| m.notified_for.as_deref() != Some(m.time.as_str()))
        .filter_map(|m| minutes_of_day(&m.time))
        .map(|hora| hora - lead - now)
        .filter(|d| *d > 0)
        .min();
    match falta {
        Some(min) => Duration::from_secs((min * 60) as u64).clamp(MIN_ESPERA, MAX_ESPERA),
        None => MAX_ESPERA,
    }
}

/// El cierre del cuerpo en las alertas que llevan a Focus, **igual en las dos**.
///
/// Enseña el gesto: la alerta ya no tiene botón de cerrar, así que el click sobre
/// ella entera hace lo mismo que el botón (§4.25), y eso no se descubre mirando.
/// Que sea la misma frase en los dos avisos es para que se aprenda una vez.
///
/// No dice "en sunrise": macOS ya pone el nombre de la app arriba del aviso, y
/// repetirlo gasta la línea que sirve para decir qué hacer.
pub const HINT: &str = "Toca para verla.";

/// El texto del aviso, **y vive acá y solo acá**.
///
/// Estaba en `notify.ts` con el resto de los avisos, y se movió porque el que lo
/// manda de verdad es este vigilante: dejarlo en el front obligaba a escribirlo dos
/// veces y el botón de prueba de Dev Tools acabaría probando un texto que no
/// existe. Dev Tools lo pide por `preview_meeting_notice`, así que prueba **este**.
///
/// **La hora es la del evento, no los minutos que faltan**, y eso es una
/// corrección: el aviso puede salir en cualquier punto de su ventana —la app estaba
/// cerrada, la máquina durmió, la sincronización movió la reunión—, así que "en 5
/// min" es un número que se puede equivocar. `scheduled_time` no: diga lo que diga
/// el reloj cuando llegue el aviso, la reunión empieza a esa hora.
///
/// **El título dice qué clase de cosa es y a qué hora; el cuerpo, cuál.** Con
/// varios avisos apilados, "Cambio de Focus a las 15:00" se reconoce de una pasada
/// sin leer el nombre completo de la reunión. Es la misma forma que el de la
/// campana, para que los dos se lean igual.
///
/// Y **"Sigue X" y no "Toca X"**: el cierre del cuerpo ya usa *toca* como "púlsalo",
/// y la misma palabra con dos sentidos en la misma frase obliga a releerla.
///
/// Lleva botón, y por eso es una **alerta** y no un banner: este aviso sirve
/// justamente cuando no estás mirando la pantalla, así que uno que se va solo en
/// cinco segundos no sirve de nada (SPECS §4.25).
pub fn copy(title: &str, time: &str) -> (String, String, String) {
    (
        format!("Cambio de Focus a las {time}"),
        format!("Sigue {title}. {HINT}"),
        "Ir a Focus".to_string(),
    )
}

/// Lee la agenda del día y el ajuste, y **suelta el lock antes de volver**.
///
/// Aparte del loop por lo mismo que `bell::read_active` y `backup::read_settings`:
/// sostener el `Mutex` de la base mientras se decide algo que no la necesita traba
/// al resto de la app.
fn read(app: &AppHandle, date: &str) -> Option<(Vec<Meeting>, i64)> {
    let db = app.state::<Db>();
    let conn = match db.0.lock() {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("[sunrise] aviso de reunión: no pude leer la agenda: {e}");
            return None;
        }
    };
    let lead = lead_minutes(
        repo::get_setting(&conn, KEY_LEAD)
            .ok()
            .flatten()
            .as_deref(),
    );
    let agenda = repo::meetings_for_date(&conn, date).unwrap_or_default();
    Some((agenda, lead))
}

/// Anota la hora avisada, con el lock tomado una sola vez.
fn mark(app: &AppHandle, task_id: i64, time: &str) {
    // El `State` va a una variable propia: tomando el lock dentro de un `if let`
    // el guard vive más que el `db` temporal y el borrow checker lo rechaza
    // (E0597). Es el mismo tropiezo que tuvo `bell::read_active`.
    let db = app.state::<Db>();
    let conn = match db.0.lock() {
        Ok(conn) => conn,
        Err(e) => {
            eprintln!("[sunrise] aviso de reunión: no pude tomar la base: {e}");
            return;
        }
    };
    if let Err(e) = repo::mark_notified(&conn, task_id, time) {
        eprintln!("[sunrise] aviso de reunión: no pude anotar la marca: {e}");
    }
}

/// Arranca el vigilante. Se llama una vez, desde `setup`.
pub fn start_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Por qué promesa ya se avisó, en una variable **del loop**. La marca de
        // verdad está en la base y sobrevive al reinicio; esto es la red para el
        // caso en que no se haya podido escribir: sin ella, `due` seguiría
        // devolviendo la misma reunión cada dos segundos y mandaría un aviso por
        // vuelta. Es la misma forma que `rung` en `bell.rs`.
        let mut avisado: Option<(i64, String)> = None;
        loop {
            let ahora = Utc::now().with_timezone(&crate::repo::zone_cached());
            let hoy = ahora.format("%Y-%m-%d").to_string();
            let hhmm = ahora.format("%H:%M").to_string();

            let espera = match read(&app, &hoy) {
                Some((agenda, lead)) => next_wake(&agenda, &hhmm, lead),
                None => MAX_ESPERA,
            };
            tokio::time::sleep(espera).await;

            // Se relee después de dormir: lo que se leyó para calcular la espera
            // ya puede ser viejo, y esta es la lectura que decide.
            let ahora = Utc::now().with_timezone(&crate::repo::zone_cached());
            let hoy = ahora.format("%Y-%m-%d").to_string();
            let hhmm = ahora.format("%H:%M").to_string();
            let Some((agenda, lead)) = read(&app, &hoy) else {
                continue;
            };
            let Some(reunion) = due(&agenda, &hhmm, lead) else {
                continue;
            };
            if avisado.as_ref() == Some(&(reunion.task_id, reunion.time.clone())) {
                continue;
            }
            avisado = Some((reunion.task_id, reunion.time.clone()));

            // La marca **antes** de mandar: `send()` bloquea su hilo hasta que la
            // persona responde, y si se anotara después, dos vueltas del loop
            // mandarían dos avisos de la misma reunión.
            mark(&app, reunion.task_id, &reunion.time);
            let (titulo, cuerpo, boton) = copy(&reunion.title, &reunion.time);
            eprintln!(
                "[sunrise] aviso: «{}» empieza a las {} (tarea {})",
                reunion.title, reunion.time, reunion.task_id
            );
            crate::commands::send_alert(
                &app,
                titulo,
                cuerpo,
                boton,
                Some(crate::commands::notice_sound(&app)),
                Some(crate::commands::NoticeTarget {
                    route: "/focus".into(),
                    task_id: Some(reunion.task_id),
                }),
            );
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reunion(id: i64, time: &str, notified: Option<&str>) -> Meeting {
        Meeting {
            task_id: id,
            title: format!("Reunión {id}"),
            time: time.to_string(),
            notified_for: notified.map(str::to_string),
        }
    }

    #[test]
    fn avisa_cuando_faltan_los_minutos_configurados() {
        let a = vec![reunion(1, "15:00", None)];
        assert!(due(&a, "14:54", 5).is_none());
        assert_eq!(due(&a, "14:55", 5).unwrap().task_id, 1);
        assert_eq!(due(&a, "14:59", 5).unwrap().task_id, 1);
    }

    #[test]
    fn no_avisa_de_una_reunion_que_ya_empezo() {
        // El borde de arriba es lo que hace que el aviso no se ponga al día: un
        // "en 5 minutos" a las 09:30 para una reunión de 09:00 es basura, y es
        // también lo que evita que un Mac recién despertado mande seis de golpe.
        let a = vec![reunion(1, "15:00", None)];
        assert!(due(&a, "15:00", 5).is_none());
        assert!(due(&a, "18:00", 5).is_none());
    }

    #[test]
    fn no_repite_el_aviso_de_la_misma_hora() {
        let a = vec![reunion(1, "15:00", Some("15:00"))];
        assert!(due(&a, "14:56", 5).is_none());
    }

    #[test]
    fn si_le_mueven_la_hora_vuelve_a_avisar() {
        // La promesa es "avisé que empezaba a ESTA hora", no "avisé una vez por
        // esta tarea". Con un booleano, correr la reunión dejaba la tarea muda
        // para siempre — el mismo bug que tenía la campana con su llave.
        let a = vec![reunion(1, "16:00", Some("15:00"))];
        assert_eq!(due(&a, "15:56", 5).unwrap().task_id, 1);
    }

    #[test]
    fn en_cero_el_aviso_esta_apagado() {
        let a = vec![reunion(1, "15:00", None)];
        assert!(due(&a, "14:56", 0).is_none());
    }

    #[test]
    fn una_hora_ilegible_se_salta_sin_tumbar_el_resto() {
        let a = vec![reunion(1, "ayer", None), reunion(2, "15:00", None)];
        assert_eq!(due(&a, "14:56", 5).unwrap().task_id, 2);
    }

    #[test]
    fn avisa_de_la_primera_que_toque_y_no_de_la_de_mas_tarde() {
        let a = vec![reunion(1, "15:00", None), reunion(2, "15:30", None)];
        assert_eq!(due(&a, "14:56", 5).unwrap().task_id, 1);
    }

    #[test]
    fn el_texto_dice_la_hora_del_evento_y_no_los_minutos_que_faltan() {
        // El aviso puede salir en cualquier punto de su ventana, así que "en 5 min"
        // es un número que se puede equivocar. La hora del evento no.
        let (t, b, a) = copy("Weekly de equipo", "15:00");
        assert_eq!(t, "Cambio de Focus a las 15:00");
        assert_eq!(b, "Sigue Weekly de equipo. Toca para verla.");
        assert_eq!(a, "Ir a Focus");
    }

    #[test]
    fn el_ajuste_se_lee_con_fallback() {
        assert_eq!(lead_minutes(None), DEFAULT_LEAD);
        assert_eq!(lead_minutes(Some("")), DEFAULT_LEAD);
        assert_eq!(lead_minutes(Some("basura")), DEFAULT_LEAD);
        assert_eq!(lead_minutes(Some("10")), 10);
        assert_eq!(lead_minutes(Some("0")), 0);
        // Un negativo es "apagado" y no "avisar después de que empezó".
        assert_eq!(lead_minutes(Some("-3")), 0);
    }

    #[test]
    fn duerme_justo_hasta_el_cruce() {
        let a = vec![reunion(1, "15:00", None)];
        assert_eq!(next_wake(&a, "14:45", 5), Duration::from_secs(60));
        // Ya dentro de la ventana: el piso. Arrancar la app a las 14:57 no puede
        // costar un minuto de un aviso que avisa con cinco.
        assert_eq!(next_wake(&a, "14:57", 5), MIN_ESPERA);
        // Y una reunión que ya empezó no cuenta como pendiente.
        assert_eq!(next_wake(&a, "15:10", 5), MAX_ESPERA);
    }

    #[test]
    fn sin_nada_que_avisar_espera_el_techo() {
        assert_eq!(next_wake(&[], "10:00", 5), MAX_ESPERA);
        assert_eq!(next_wake(&[reunion(1, "15:00", Some("15:00"))], "10:00", 5), MAX_ESPERA);
        // Apagado también: el techo es lo que hace que prenderlo desde Configs
        // tenga efecto sin esperar a la próxima reunión.
        assert_eq!(next_wake(&[reunion(1, "15:00", None)], "10:00", 0), MAX_ESPERA);
    }

    #[test]
    fn una_hora_de_un_digito_se_entiende() {
        assert_eq!(minutes_of_day("9:05"), Some(545));
        assert_eq!(minutes_of_day("25:00"), None);
    }
}
