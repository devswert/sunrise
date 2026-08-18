//! Lectura de un feed ICS a eventos listos para importar.
//!
//! **Capa pura**: entra un `&str` con el contenido del `.ics` y sale un
//! `Vec<IcsEvent>`. No toca la red ni la base. Es a propósito: la descarga vive
//! en `calendar::fetch` y la escritura en `repo`, así que todo lo que puede
//! salir mal al interpretar un calendario real se prueba con fixtures y sin
//! levantar nada.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, TimeZone};
use icalendar::{Calendar, Component, DatePerhapsTime, EventStatus};

use crate::models::Attendee;

/// Cuántas ocurrencias se aceptan por serie antes de cortar. Una regla mal
/// formada (`FREQ=SECONDLY` sin `UNTIL`) es infinita, y `rrule` corta en el
/// límite que se le pase en vez de colgarse.
const MAX_OCURRENCIAS: u16 = 512;

/// Un evento, ya resuelto a un instante concreto y a hora local.
#[derive(Debug, Clone, PartialEq)]
pub struct IcsEvent {
    /// Clave estable **dentro del feed**, la que va a `tasks.calendar_uid`.
    ///
    /// Para un evento suelto es el `UID` tal cual. Para una instancia de una
    /// serie es `UID#<instante>`, porque el `UID` de un evento recurrente es
    /// **uno solo para todas sus repeticiones**: usarlo pelado colapsaría el
    /// standup de todo el mes en una fila, por el `UNIQUE(feed_id, calendar_uid)`.
    pub uid: String,
    pub title: String,
    /// Fecha **local** `YYYY-MM-DD`. Ver `to_local`.
    pub date: String,
    /// `HH:MM` local. `None` en los eventos de día completo.
    pub hour: Option<String>,
    /// Inicio y fin en ISO (UTC). `None` en los de día completo: no tienen
    /// reloj, y darles uno inventado los haría contar horas que nadie trabajó.
    pub start: Option<String>,
    pub end: Option<String>,
    /// Duración en minutos, para `estimated_minutes`. `None` si no se puede
    /// saber (día completo, o un evento sin `DTEND` ni `DURATION`).
    pub minutes: Option<i64>,
    /// Link para entrar a la videollamada, si el evento trae uno. Ver `link_of`.
    pub link: Option<String>,
    /// Descripción del evento, si la trae.
    pub description: Option<String>,
    /// Organizador e invitados. Vacío si el evento no los declara — que es lo
    /// que pasa con un calendario compartido "ocultando los detalles".
    pub attendees: Vec<Attendee>,
}

/// Interpreta un feed y devuelve las ocurrencias que caen en `[desde, hasta]`
/// (fechas locales, ambas inclusive).
///
/// La ventana existe porque un calendario de trabajo tiene series sin fin: sin
/// acotar, "importar el calendario" es "importar hasta el año 2400".
pub fn parse_events(
    ics: &str,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> std::result::Result<Vec<IcsEvent>, String> {
    let cal: Calendar = ics.parse().map_err(|e: String| e)?;
    let mut out = Vec::new();

    for ev in cal.calendar_events() {
        // Un evento cancelado sigue viniendo en el feed, con `STATUS:CANCELLED`.
        // Importarlo crearía una tarea para una reunión que no existe.
        if ev.get_status() == Some(EventStatus::Cancelled) {
            continue;
        }
        let Some(uid) = ev.get_uid() else {
            continue; // sin UID no hay forma de reconocerlo en la próxima sync
        };
        let title = match ev.get_summary().map(str::trim) {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => "(sin título)".to_string(),
        };

        let all_day = matches!(ev.get_start(), Some(DatePerhapsTime::Date(_)));
        let duration = duration_of(&ev);
        let link = link_of(&ev);
        let description = ev
            .get_description()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(str::to_string);
        let attendees = attendees_of(&ev);

        // Una instancia editada de una serie viene como un VEVENT aparte con el
        // mismo UID y un `RECURRENCE-ID` que dice a qué repetición reemplaza.
        // Su clave tiene que ser la de esa repetición, o quedarían las dos.
        // Su `TZID` va aparte, en los parámetros: `property_value` devuelve el
        // valor pelado y ahí ya se perdió la zona.
        let overrides = ev.properties().get("RECURRENCE-ID").and_then(|p| {
            instant_of_value(p.value(), p.params().get("TZID").map(|t| t.value()))
        });

        let is_series = ev.property_value("RRULE").is_some();

        for local_start in occurrences(&ev, from_date, to_date) {
            let key = match (&overrides, is_series) {
                (Some(instant), _) => format!("{uid}#{}", stamp(*instant)),
                (None, true) => format!("{uid}#{}", stamp(local_start)),
                (None, false) => uid.to_string(),
            };

            let local_end = duration.map(|d| local_start + d);
            out.push(IcsEvent {
                uid: key,
                title: title.clone(),
                date: local_start.format("%Y-%m-%d").to_string(),
                hour: if all_day {
                    None
                } else {
                    Some(local_start.format("%H:%M").to_string())
                },
                start: if all_day {
                    None
                } else {
                    Some(local_start.to_utc().to_rfc3339())
                },
                end: if all_day {
                    None
                } else {
                    local_end.map(|f| f.to_utc().to_rfc3339())
                },
                minutes: if all_day {
                    None
                } else {
                    duration.map(|d| d.num_minutes()).filter(|m| *m > 0)
                },
                link: link.clone(),
                description: description.clone(),
                attendees: attendees.clone(),
            });
        }
    }

    Ok(out)
}

/// Los instantes en que ocurre el evento dentro de la ventana, en hora local.
///
/// Sirve igual para un evento suelto que para una serie: `get_recurrence()`
/// devuelve un `RRuleSet` que, sin `RRULE`, rinde solo su `DTSTART`. Así no hay
/// dos caminos que puedan divergir.
fn occurrences(
    ev: &icalendar::CalendarEvent<'_>,
    from_date: NaiveDate,
    to_date: NaiveDate,
) -> Vec<DateTime<Local>> {
    let Ok(set) = ev.get_recurrence() else {
        // Regla que `rrule` rechaza: mejor importar el `DTSTART` solo que perder
        // el evento entero en silencio.
        return match ev.get_start().and_then(to_local) {
            Some(dt) if in_window(dt, from_date, to_date) => vec![dt],
            _ => vec![],
        };
    };

    // El borde va en instantes y no en fechas: `after`/`before` comparan
    // momentos, así que el día `hasta` se incluye entero tomando su medianoche
    // siguiente.
    let start = local_midnight(from_date);
    let end = local_midnight(to_date + Duration::days(1));
    let (Some(start), Some(end)) = (start, end) else {
        return vec![];
    };

    // `rrule` itera en su propio `Tz`; `LOCAL` es su envoltorio de `chrono::Local`.
    set.after(start.with_timezone(&icalendar::Tz::LOCAL))
        .before(end.with_timezone(&icalendar::Tz::LOCAL))
        .all(MAX_OCURRENCIAS)
        .dates
        .into_iter()
        .map(|d| d.with_timezone(&Local))
        .collect()
}

/// Organizador e invitados del evento.
///
/// El organizador va **primero** y marcado, porque es el dato que uno busca al
/// abrir una reunión que no reconoce. Sale de `ORGANIZER`, que es una propiedad
/// distinta de `ATTENDEE` —aunque suele venir también como invitado, y en ese
/// caso se deduplica por correo.
///
/// Un calendario compartido **ocultando los detalles** no trae ninguna de las
/// dos, así que esto queda vacío. No es un error: la información no está en el
/// feed.
fn attendees_of(ev: &icalendar::CalendarEvent<'_>) -> Vec<Attendee> {
    let mut out: Vec<Attendee> = Vec::new();

    if let Some(organizer) = ev.property_value("ORGANIZER") {
        let email = email(organizer);
        out.push(Attendee {
            name: ev
                .properties()
                .get("ORGANIZER")
                .and_then(|p| p.params().get("CN"))
                .map(|v| clean_cn(v.value())),
            email: email.clone(),
            status: None,
            is_organizer: true,
        });
    }

    for a in ev.get_attendees() {
        let email = email(&a.cal_address);
        // Si el organizador también está invitado, no se lista dos veces.
        if email.is_some() && out.iter().any(|p| p.email == email) {
            continue;
        }
        out.push(Attendee {
            name: a.cn.as_deref().map(clean_cn),
            email,
            status: a.part_stat.map(|s| format!("{s:?}").to_uppercase()),
            is_organizer: false,
        });
    }

    out
}

/// `mailto:x@y.com` → `x@y.com`. Devuelve `None` si no parece un correo.
fn email(cal_address: &str) -> Option<String> {
    let v = cal_address.trim();
    let schemeless = v.strip_prefix("mailto:").or_else(|| v.strip_prefix("MAILTO:")).unwrap_or(v);
    let clean = schemeless.trim();
    if clean.contains('@') {
        Some(clean.to_string())
    } else {
        None
    }
}

/// Saca las comillas con que algunos servidores envuelven el `CN`.
fn clean_cn(cn: &str) -> String {
    cn.trim().trim_matches('"').trim().to_string()
}

/// Hosts que se reconocen como videollamada dentro de una descripción.
///
/// La lista existe para el último recurso: una `DESCRIPTION` de Google trae el
/// link del Meet **y** links de ayuda, de adjuntos y de "responder a la
/// invitación". Sin filtrar, el botón "Entrar" abriría cualquiera de esos.
const HOSTS_DE_LLAMADA: &[&str] = &[
    "meet.google.com",
    "zoom.us",
    "teams.microsoft.com",
    "teams.live.com",
    "whereby.com",
    "meet.jit.si",
    "webex.com",
    "chime.aws",
    "around.co",
    "gather.town",
];

/// El link de la videollamada, buscándolo donde cada proveedor lo pone.
///
/// En orden de confianza, porque los tres primeros son el link **declarado** y
/// el último es adivinar dentro de un texto:
///
/// 1. `X-GOOGLE-CONFERENCE` — lo que usa Google Calendar para el Meet.
/// 2. `CONFERENCE` — el estándar (RFC 7986); lo emiten algunos servidores.
/// 3. `LOCATION`, si es una URL — Zoom y Teams suelen dejarlo ahí.
/// 4. La primera URL de la `DESCRIPTION` cuyo host esté en `HOSTS_DE_LLAMADA`.
fn link_of(ev: &icalendar::CalendarEvent<'_>) -> Option<String> {
    for prop in ["X-GOOGLE-CONFERENCE", "CONFERENCE"] {
        if let Some(v) = ev.property_value(prop).map(str::trim) {
            if is_url(v) {
                return Some(v.to_string());
            }
        }
    }
    if let Some(loc) = ev.property_value("LOCATION").map(str::trim) {
        if is_url(loc) {
            return Some(loc.to_string());
        }
    }
    ev.get_description().and_then(call_url)
}

fn is_url(v: &str) -> bool {
    v.starts_with("http://") || v.starts_with("https://")
}

/// Primera URL del texto que apunte a un servicio de videollamada conocido.
fn call_url(text: &str) -> Option<String> {
    text
        .split(|c: char| c.is_whitespace() || c == '<' || c == '>' || c == '"')
        .map(trim_punctuation)
        .find(|t| is_url(t) && HOSTS_DE_LLAMADA.iter().any(|h| t.contains(h)))
        .map(str::to_string)
}

/// Saca la puntuación que queda pegada cuando el link va dentro de una frase
/// ("...entra a https://meet.google.com/abc-defg-hij.").
fn trim_punctuation(t: &str) -> &str {
    t.trim_end_matches(|c| matches!(c, '.' | ',' | ')' | ';' | ':' | ']' | '\''))
}

/// Cuánto dura el evento, mirando `DTEND` (o `DURATION` si es lo que trae).
fn duration_of(ev: &icalendar::CalendarEvent<'_>) -> Option<Duration> {
    let start = ev.get_start().and_then(to_local)?;
    if let Some(end) = ev.get_end().and_then(to_local) {
        let d = end - start;
        return if d > Duration::zero() { Some(d) } else { None };
    }
    None
}

/// Convierte cualquiera de las tres formas de fecha de ICS a hora **local**.
///
/// Las tres tienen que aterrizar en la misma regla o el día se corre: un
/// `DTSTART:20260810T230000Z` es el 10 en UTC y el **10 a las 20:00** en Chile,
/// y cortar el string por los primeros 10 caracteres lo mandaría al 10 pero con
/// hora equivocada — o al día siguiente para un evento de la tarde. Este
/// proyecto ya pagó dos veces por esa confusión.
fn to_local(d: DatePerhapsTime) -> Option<DateTime<Local>> {
    match d {
        DatePerhapsTime::DateTime(dt) => match dt {
            icalendar::CalendarDateTime::Utc(utc) => Some(utc.with_timezone(&Local)),
            icalendar::CalendarDateTime::Floating(naive) => local_from_naive(naive),
            icalendar::CalendarDateTime::WithTimezone { date_time, tzid } => {
                let tz: chrono_tz::Tz = tzid.parse().ok()?;
                // `.single()` falla en el salto de horario de verano; ahí se
                // toma la primera lectura válida en vez de descartar el evento.
                let zoned = tz
                    .from_local_datetime(&date_time)
                    .single()
                    .or_else(|| tz.from_local_datetime(&date_time).earliest())?;
                Some(zoned.with_timezone(&Local))
            }
        },
        // Día completo: se ancla a la medianoche local para poder ubicarlo en un
        // día del tablero. La hora no se usa (ver `all_day`).
        DatePerhapsTime::Date(date) => local_midnight(date),
    }
}

fn local_from_naive(naive: NaiveDateTime) -> Option<DateTime<Local>> {
    Local
        .from_local_datetime(&naive)
        .single()
        .or_else(|| Local.from_local_datetime(&naive).earliest())
}

fn local_midnight(date: NaiveDate) -> Option<DateTime<Local>> {
    local_from_naive(date.and_hms_opt(0, 0, 0)?)
}

fn in_window(dt: DateTime<Local>, from_date: NaiveDate, to_date: NaiveDate) -> bool {
    let d = dt.date_naive();
    d >= from_date && d <= to_date
}

/// Sello del instante para la clave de una instancia: `20260810T093000`.
/// En hora local, que es la misma referencia que usa `fecha`.
fn stamp(dt: DateTime<Local>) -> String {
    dt.format("%Y%m%dT%H%M%S").to_string()
}

/// Interpreta el valor crudo de un `RECURRENCE-ID`, en la zona que declara.
///
/// Se prueban los tres formatos de ICS. **El `tzid` no es opcional de adorno**:
/// sin él, un valor sin `Z` se leería en la zona del computador, y la clave de la
/// instancia editada dejaría de calzar con la de la repetición que reemplaza en
/// cuanto tu máquina no esté en la misma zona que el calendario — o sea, la
/// reunión movida aparecería dos veces en la semana. Se veía "bien" porque la
/// máquina de desarrollo y las fixtures comparten zona; lo delató CI, que corre
/// en UTC.
///
/// Sin `tzid` el valor es flotante y ahí sí se lee en local, que es lo que manda
/// el estándar.
fn instant_of_value(value: &str, tzid: Option<&str>) -> Option<DateTime<Local>> {
    if let Ok(utc) = DateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ") {
        return Some(utc.with_timezone(&Local));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S") {
        if let Some(tz) = tzid.and_then(|t| t.parse::<chrono_tz::Tz>().ok()) {
            // Igual que en `to_local`: `.single()` falla en el salto de horario
            // de verano, y ahí se toma la primera lectura válida.
            let zoned = tz
                .from_local_datetime(&naive)
                .single()
                .or_else(|| tz.from_local_datetime(&naive).earliest())?;
            return Some(zoned.with_timezone(&Local));
        }
        return local_from_naive(naive);
    }
    if let Ok(date) = NaiveDate::parse_from_str(value, "%Y%m%d") {
        return local_midnight(date);
    }
    None
}

/// Ventana que se importa, relativa a hoy.
///
/// **Nada del pasado**: una reunión de la semana pasada que nunca se trackeó no
/// aporta a la review y solo ensucia el tablero con tareas que ya no se pueden
/// hacer. Las que sí se trabajaron ya están en la base con su tiempo, y el
/// import no las vuelve a tocar.
///
/// Tres semanas hacia adelante alcanzan para planificar navegando un par de
/// semanas, sin arrastrar series enteras a meses de distancia.
pub const DIAS_ATRAS: i64 = 0;
pub const DIAS_ADELANTE: i64 = 21;

/// La ventana de importación alrededor de una fecha local.
pub fn window(today: NaiveDate) -> (NaiveDate, NaiveDate) {
    (
        today - Duration::days(DIAS_ATRAS),
        today + Duration::days(DIAS_ADELANTE),
    )
}

/// Hoy en hora local. Vive acá para que el resto del módulo no necesite `Local`.
pub fn today_local() -> NaiveDate {
    let now = Local::now();
    NaiveDate::from_ymd_opt(now.year(), now.month(), now.day()).expect("fecha de hoy válida")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Envuelve VEVENTs en un VCALENDAR mínimo.
    fn cal(body: &str) -> String {
        format!(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//test//EN\r\n{}\r\nEND:VCALENDAR\r\n",
            body.replace('\n', "\r\n")
        )
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    /// Ventana amplia, para los tests que no prueban el recorte.
    fn todo(ics: &str) -> Vec<IcsEvent> {
        parse_events(ics, d("2026-01-01"), d("2026-12-31")).unwrap()
    }

    #[test]
    fn lee_un_evento_con_hora_en_la_fecha_local() {
        // 23:00 UTC del 10 es el 10 a las 20:00 en Chile (UTC-3). Lo que se
        // prueba es que la fecha sale de la hora LOCAL: con la conversión mal
        // hecha, un evento de la tarde se va al día siguiente.
        let ics = cal(
            "BEGIN:VEVENT\nUID:uno@test\nSUMMARY:Daily\nDTSTART:20260810T230000Z\nDTEND:20260810T233000Z\nEND:VEVENT",
        );
        let evs = todo(&ics);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].uid, "uno@test");
        assert_eq!(evs[0].title, "Daily");
        // La fecha depende del TZ de la máquina; lo invariante es que coincida
        // con la conversión local del instante, no con el día UTC.
        let expected = DateTime::parse_from_rfc3339("2026-08-10T23:00:00Z")
            .unwrap()
            .with_timezone(&Local);
        assert_eq!(evs[0].date, expected.format("%Y-%m-%d").to_string());
        assert_eq!(evs[0].hour, Some(expected.format("%H:%M").to_string()));
        assert_eq!(evs[0].minutes, Some(30));
    }

    #[test]
    fn respeta_el_tzid_en_vez_de_tratarlo_como_utc() {
        // Las 09:00 en Santiago no son las 09:00 UTC. Si se ignorara el TZID,
        // el instante se correría tres horas y podría cambiar de día.
        let ics = cal(
            "BEGIN:VEVENT\nUID:tz@test\nSUMMARY:Con zona\nDTSTART;TZID=America/Santiago:20260810T090000\nDTEND;TZID=America/Santiago:20260810T100000\nEND:VEVENT",
        );
        let evs = todo(&ics);
        assert_eq!(evs.len(), 1);
        let expected = chrono_tz::America::Santiago
            .with_ymd_and_hms(2026, 8, 10, 9, 0, 0)
            .unwrap()
            .with_timezone(&Local);
        assert_eq!(evs[0].date, expected.format("%Y-%m-%d").to_string());
        assert_eq!(evs[0].hour, Some(expected.format("%H:%M").to_string()));
        assert_eq!(evs[0].minutes, Some(60));
    }

    #[test]
    fn el_dia_completo_entra_sin_reloj_ni_duracion() {
        // Un feriado no son 24 horas trabajadas: sin hora, sin inicio/fin y sin
        // minutos, para que no infle ningún total cuando llegue el rollup.
        let ics = cal(
            "BEGIN:VEVENT\nUID:dia@test\nSUMMARY:Feriado\nDTSTART;VALUE=DATE:20260810\nDTEND;VALUE=DATE:20260811\nEND:VEVENT",
        );
        let evs = todo(&ics);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].date, "2026-08-10");
        assert_eq!(evs[0].hour, None);
        assert_eq!(evs[0].start, None);
        assert_eq!(evs[0].end, None);
        assert_eq!(evs[0].minutes, None);
    }

    #[test]
    fn descarta_los_cancelados() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:cancel@test\nSUMMARY:Reunión que se cayó\nDTSTART:20260810T120000Z\nSTATUS:CANCELLED\nEND:VEVENT",
        );
        assert!(todo(&ics).is_empty());
    }

    #[test]
    fn expande_una_serie_con_una_clave_por_instancia() {
        // Sin expandir, un standup semanal aparece una sola vez y la app queda
        // inútil para el contenido más común de un calendario de trabajo. Y sin
        // clave por instancia, el UNIQUE(feed_id, calendar_uid) las colapsa
        // todas en una fila.
        let ics = cal(
            "BEGIN:VEVENT\nUID:serie@test\nSUMMARY:Standup\nDTSTART;TZID=America/Santiago:20260810T090000\nDTEND;TZID=America/Santiago:20260810T091500\nRRULE:FREQ=WEEKLY;COUNT=4\nEND:VEVENT",
        );
        let evs = todo(&ics);
        assert_eq!(evs.len(), 4);
        let keys: std::collections::HashSet<_> = evs.iter().map(|e| &e.uid).collect();
        assert_eq!(keys.len(), 4, "cada instancia necesita su propia clave");
        assert!(evs.iter().all(|e| e.uid.starts_with("serie@test#")));
        assert!(evs.iter().all(|e| e.minutes == Some(15)));
    }

    #[test]
    fn la_ventana_recorta_la_serie() {
        // Una serie sin fin no se importa hasta el infinito.
        let ics = cal(
            "BEGIN:VEVENT\nUID:infinita@test\nSUMMARY:Semanal\nDTSTART;TZID=America/Santiago:20260810T090000\nDTEND;TZID=America/Santiago:20260810T093000\nRRULE:FREQ=WEEKLY\nEND:VEVENT",
        );
        // Tres semanas exactas desde el primer lunes.
        let evs = parse_events(&ics, d("2026-08-10"), d("2026-08-30")).unwrap();
        assert_eq!(evs.len(), 3);
        assert!(evs.iter().all(|e| e.date.as_str() >= "2026-08-10"));
        assert!(evs.iter().all(|e| e.date.as_str() <= "2026-08-30"));
    }

    #[test]
    fn exdate_saca_la_instancia_saltada() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:conhueco@test\nSUMMARY:Semanal\nDTSTART;TZID=America/Santiago:20260810T090000\nDTEND;TZID=America/Santiago:20260810T093000\nRRULE:FREQ=WEEKLY;COUNT=3\nEXDATE;TZID=America/Santiago:20260817T090000\nEND:VEVENT",
        );
        let evs = todo(&ics);
        assert_eq!(evs.len(), 2);
        assert!(
            !evs.iter().any(|e| e.date == "2026-08-17"),
            "la fecha excluida no debería importarse"
        );
    }

    #[test]
    fn una_instancia_editada_reemplaza_a_la_generada() {
        // Google manda la serie y, aparte, un VEVENT con el mismo UID y
        // RECURRENCE-ID para la repetición que se movió o se renombró. Las dos
        // tienen que compartir clave, o la semana muestra la reunión dos veces.
        let ics = cal(
            "BEGIN:VEVENT\nUID:serie@test\nSUMMARY:Standup\nDTSTART;TZID=America/Santiago:20260810T090000\nDTEND;TZID=America/Santiago:20260810T091500\nRRULE:FREQ=WEEKLY;COUNT=2\nEND:VEVENT\nBEGIN:VEVENT\nUID:serie@test\nRECURRENCE-ID;TZID=America/Santiago:20260817T090000\nSUMMARY:Standup (movido)\nDTSTART;TZID=America/Santiago:20260817T110000\nDTEND;TZID=America/Santiago:20260817T111500\nEND:VEVENT",
        );
        let evs = todo(&ics);
        let generated = stamp(
            chrono_tz::America::Santiago
                .with_ymd_and_hms(2026, 8, 17, 9, 0, 0)
                .unwrap()
                .with_timezone(&Local),
        );
        let key = format!("serie@test#{generated}");
        let same: Vec<_> = evs.iter().filter(|e| e.uid == key).collect();
        assert_eq!(
            same.len(),
            2,
            "la instancia editada y la generada comparten clave, así el upsert deja una"
        );
        assert!(same.iter().any(|e| e.title == "Standup (movido)"));
    }

    /// El mismo caso que el de arriba pero **en una zona que no es la de esta
    /// máquina**, que es lo que el otro no puede pillar: con fixtures en Santiago y
    /// un Mac en Santiago, leer el `RECURRENCE-ID` en la zona equivocada da el mismo
    /// resultado por casualidad. Este se cae en cualquier parte si alguien vuelve a
    /// ignorar el `TZID`, y de hecho así se descubrió el bug: verde en local, rojo
    /// en CI, que corre en UTC.
    #[test]
    fn la_instancia_editada_calza_aunque_el_calendario_este_en_otra_zona() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:madrid@test\nSUMMARY:Standup\nDTSTART;TZID=Europe/Madrid:20260810T090000\nDTEND;TZID=Europe/Madrid:20260810T091500\nRRULE:FREQ=WEEKLY;COUNT=2\nEND:VEVENT\nBEGIN:VEVENT\nUID:madrid@test\nRECURRENCE-ID;TZID=Europe/Madrid:20260817T090000\nSUMMARY:Standup (movido)\nDTSTART;TZID=Europe/Madrid:20260817T110000\nDTEND;TZID=Europe/Madrid:20260817T111500\nEND:VEVENT",
        );
        let evs = todo(&ics);
        let generated = stamp(
            chrono_tz::Europe::Madrid
                .with_ymd_and_hms(2026, 8, 17, 9, 0, 0)
                .unwrap()
                .with_timezone(&Local),
        );
        let same: Vec<_> = evs
            .iter()
            .filter(|e| e.uid == format!("madrid@test#{generated}"))
            .collect();
        assert_eq!(
            same.len(),
            2,
            "sin respetar el TZID del RECURRENCE-ID la reunión movida sale dos veces"
        );
        assert!(same.iter().any(|e| e.title == "Standup (movido)"));
    }

    #[test]
    fn saca_el_link_del_meet_de_google() {
        // Google Calendar lo declara en `X-GOOGLE-CONFERENCE`. Es la fuente más
        // confiable, y por eso va primero.
        let ics = cal(
            "BEGIN:VEVENT\nUID:meet@test\nSUMMARY:Reunión\nDTSTART:20260810T120000Z\nDTEND:20260810T130000Z\nX-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij\nEND:VEVENT",
        );
        let evs = todo(&ics);
        assert_eq!(evs[0].link.as_deref(), Some("https://meet.google.com/abc-defg-hij"));
    }

    #[test]
    fn saca_el_link_de_location_cuando_es_una_url() {
        // Zoom y Teams suelen dejarlo ahí en vez de una propiedad propia.
        let ics = cal(
            "BEGIN:VEVENT\nUID:zoom@test\nSUMMARY:Sync\nDTSTART:20260810T120000Z\nLOCATION:https://acme.zoom.us/j/123456789\nEND:VEVENT",
        );
        assert_eq!(
            todo(&ics)[0].link.as_deref(),
            Some("https://acme.zoom.us/j/123456789")
        );
    }

    #[test]
    fn un_location_que_es_una_sala_no_es_un_link() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:sala@test\nSUMMARY:Presencial\nDTSTART:20260810T120000Z\nLOCATION:Sala 3, piso 2\nEND:VEVENT",
        );
        assert_eq!(todo(&ics)[0].link, None);
    }

    #[test]
    fn saca_el_link_de_la_descripcion_ignorando_los_otros_links() {
        // El caso real: la descripción de Google trae el Meet junto con links de
        // ayuda y de "responder a la invitación". Sin filtrar por host conocido,
        // el botón "Entrar" abriría el de soporte.
        let ics = cal(
            "BEGIN:VEVENT\nUID:desc@test\nSUMMARY:Reunión\nDTSTART:20260810T120000Z\nDESCRIPTION:Únete: https://meet.google.com/xyz-abcd-efg\\nMás info en https://support.google.com/meet\nEND:VEVENT",
        );
        assert_eq!(
            todo(&ics)[0].link.as_deref(),
            Some("https://meet.google.com/xyz-abcd-efg")
        );
    }

    #[test]
    fn el_punto_final_de_la_frase_no_queda_pegado_al_link() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:punto@test\nSUMMARY:Reunión\nDTSTART:20260810T120000Z\nDESCRIPTION:Entra a https://meet.google.com/abc-defg-hij.\nEND:VEVENT",
        );
        assert_eq!(
            todo(&ics)[0].link.as_deref(),
            Some("https://meet.google.com/abc-defg-hij")
        );
    }

    #[test]
    fn una_reunion_presencial_no_inventa_link() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:sinlink@test\nSUMMARY:Café\nDTSTART:20260810T120000Z\nDESCRIPTION:Nos vemos en la oficina\nEND:VEVENT",
        );
        assert_eq!(todo(&ics)[0].link, None);
    }

    #[test]
    fn cada_instancia_de_la_serie_lleva_el_link() {
        // Un standup recurrente tiene el mismo Meet todas las semanas: el link
        // se copia a cada ocurrencia, no solo a la primera.
        let ics = cal(
            "BEGIN:VEVENT\nUID:serielink@test\nSUMMARY:Standup\nDTSTART;TZID=America/Santiago:20260810T090000\nDTEND;TZID=America/Santiago:20260810T091500\nRRULE:FREQ=WEEKLY;COUNT=3\nX-GOOGLE-CONFERENCE:https://meet.google.com/std-upup-xyz\nEND:VEVENT",
        );
        let evs = todo(&ics);
        assert_eq!(evs.len(), 3);
        assert!(evs
            .iter()
            .all(|e| e.link.as_deref() == Some("https://meet.google.com/std-upup-xyz")));
    }

    #[test]
    fn lee_organizador_e_invitados_con_su_estado() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:gente@test\nSUMMARY:Revisión\nDTSTART:20260810T120000Z\nORGANIZER;CN=Ana Pérez:mailto:ana@acme.cl\nATTENDEE;CN=Beto Soto;PARTSTAT=ACCEPTED:mailto:beto@acme.cl\nATTENDEE;CN=Carla Díaz;PARTSTAT=DECLINED:mailto:carla@acme.cl\nEND:VEVENT",
        );
        let ps = &todo(&ics)[0].attendees;
        assert_eq!(ps.len(), 3);
        // El organizador va primero: es lo que uno busca al abrir una reunión
        // que no reconoce.
        assert!(ps[0].is_organizer);
        assert_eq!(ps[0].name.as_deref(), Some("Ana Pérez"));
        assert_eq!(ps[0].email.as_deref(), Some("ana@acme.cl"));
        assert_eq!(ps[1].email.as_deref(), Some("beto@acme.cl"));
        assert_eq!(ps[1].status.as_deref(), Some("ACCEPTED"));
        assert_eq!(ps[2].status.as_deref(), Some("DECLINED"));
        assert!(!ps[1].is_organizer);
    }

    #[test]
    fn el_organizador_que_tambien_esta_invitado_no_se_duplica() {
        // Google manda al organizador en las dos propiedades. Sin deduplicar,
        // aparecería dos veces en la lista.
        let ics = cal(
            "BEGIN:VEVENT\nUID:dup@test\nSUMMARY:Sync\nDTSTART:20260810T120000Z\nORGANIZER;CN=Ana:mailto:ana@acme.cl\nATTENDEE;CN=Ana;PARTSTAT=ACCEPTED:mailto:ana@acme.cl\nEND:VEVENT",
        );
        let ps = &todo(&ics)[0].attendees;
        assert_eq!(ps.len(), 1);
        assert!(ps[0].is_organizer);
    }

    #[test]
    fn lee_la_descripcion_del_evento() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:desc2@test\nSUMMARY:Kickoff\nDTSTART:20260810T120000Z\nDESCRIPTION:Revisar el alcance del proyecto\nEND:VEVENT",
        );
        assert_eq!(
            todo(&ics)[0].description.as_deref(),
            Some("Revisar el alcance del proyecto")
        );
    }

    #[test]
    fn un_calendario_que_oculta_los_detalles_no_trae_nada_que_mostrar() {
        // Esto es lo que emite Google cuando el calendario se comparte "solo
        // libre/ocupado": el evento existe y ocupa su hora, pero sin título
        // real, sin descripción, sin invitados y sin link. No es un bug de la
        // app: la información no está en el feed.
        let ics = cal(
            "BEGIN:VEVENT\nUID:oculto@test\nSUMMARY:busy\nDTSTART:20260810T120000Z\nDTEND:20260810T130000Z\nEND:VEVENT",
        );
        let ev = &todo(&ics)[0];
        assert_eq!(ev.title, "busy");
        assert_eq!(ev.description, None);
        assert!(ev.attendees.is_empty());
        assert_eq!(ev.link, None);
        // Lo único que sí llega es cuándo y cuánto dura.
        assert_eq!(ev.minutes, Some(60));
    }

    #[test]
    fn un_evento_sin_uid_se_ignora() {
        // Sin UID no hay forma de reconocerlo en la próxima sync: cada
        // sincronización crearía una tarea nueva.
        let ics = cal("BEGIN:VEVENT\nSUMMARY:Anónimo\nDTSTART:20260810T120000Z\nEND:VEVENT");
        assert!(todo(&ics).is_empty());
    }

    #[test]
    fn un_evento_sin_summary_no_queda_sin_titulo() {
        let ics = cal("BEGIN:VEVENT\nUID:vacio@test\nDTSTART:20260810T120000Z\nEND:VEVENT");
        let evs = todo(&ics);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].title, "(sin título)");
    }

    #[test]
    fn sin_dtend_no_inventa_duracion() {
        let ics = cal("BEGIN:VEVENT\nUID:sinfin@test\nSUMMARY:Sin fin\nDTSTART:20260810T120000Z\nEND:VEVENT");
        let evs = todo(&ics);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].minutes, None);
        assert_eq!(evs[0].end, None);
    }

    #[test]
    fn la_ventana_arranca_hoy_y_llega_a_tres_semanas() {
        // Nada del pasado: una reunión de la semana pasada que nunca se trackeó
        // no aporta nada y solo ensucia el tablero.
        let (from_date, to_date) = window(d("2026-08-13"));
        assert_eq!(from_date, d("2026-08-13"));
        assert_eq!(to_date, d("2026-09-03"));
    }

    #[test]
    fn un_ics_que_no_se_entiende_devuelve_error_y_no_panic() {
        assert!(parse_events("esto no es un calendario", d("2026-01-01"), d("2026-12-31")).is_err());
    }
}
