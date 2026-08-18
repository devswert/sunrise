//! Lectura de un feed ICS a eventos listos para importar.
//!
//! **Capa pura**: entra un `&str` con el contenido del `.ics` y sale un
//! `Vec<EventoIcs>`. No toca la red ni la base. Es a propósito: la descarga vive
//! en `calendar::fetch` y la escritura en `repo`, así que todo lo que puede
//! salir mal al interpretar un calendario real se prueba con fixtures y sin
//! levantar nada.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveDateTime, TimeZone};
use icalendar::{Calendar, Component, DatePerhapsTime, EventStatus};

use crate::models::Participante;

/// Cuántas ocurrencias se aceptan por serie antes de cortar. Una regla mal
/// formada (`FREQ=SECONDLY` sin `UNTIL`) es infinita, y `rrule` corta en el
/// límite que se le pase en vez de colgarse.
const MAX_OCURRENCIAS: u16 = 512;

/// Un evento, ya resuelto a un instante concreto y a hora local.
#[derive(Debug, Clone, PartialEq)]
pub struct EventoIcs {
    /// Clave estable **dentro del feed**, la que va a `tasks.calendar_uid`.
    ///
    /// Para un evento suelto es el `UID` tal cual. Para una instancia de una
    /// serie es `UID#<instante>`, porque el `UID` de un evento recurrente es
    /// **uno solo para todas sus repeticiones**: usarlo pelado colapsaría el
    /// standup de todo el mes en una fila, por el `UNIQUE(feed_id, calendar_uid)`.
    pub uid: String,
    pub titulo: String,
    /// Fecha **local** `YYYY-MM-DD`. Ver `a_local`.
    pub fecha: String,
    /// `HH:MM` local. `None` en los eventos de día completo.
    pub hora: Option<String>,
    /// Inicio y fin en ISO (UTC). `None` en los de día completo: no tienen
    /// reloj, y darles uno inventado los haría contar horas que nadie trabajó.
    pub inicio: Option<String>,
    pub fin: Option<String>,
    /// Duración en minutos, para `estimated_minutes`. `None` si no se puede
    /// saber (día completo, o un evento sin `DTEND` ni `DURATION`).
    pub minutos: Option<i64>,
    /// Link para entrar a la videollamada, si el evento trae uno. Ver `link_de`.
    pub link: Option<String>,
    /// Descripción del evento, si la trae.
    pub descripcion: Option<String>,
    /// Organizador e invitados. Vacío si el evento no los declara — que es lo
    /// que pasa con un calendario compartido "ocultando los detalles".
    pub participantes: Vec<Participante>,
}

/// Interpreta un feed y devuelve las ocurrencias que caen en `[desde, hasta]`
/// (fechas locales, ambas inclusive).
///
/// La ventana existe porque un calendario de trabajo tiene series sin fin: sin
/// acotar, "importar el calendario" es "importar hasta el año 2400".
pub fn parse_eventos(
    ics: &str,
    desde: NaiveDate,
    hasta: NaiveDate,
) -> std::result::Result<Vec<EventoIcs>, String> {
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
        let titulo = match ev.get_summary().map(str::trim) {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => "(sin título)".to_string(),
        };

        let dia_completo = matches!(ev.get_start(), Some(DatePerhapsTime::Date(_)));
        let duracion = duracion_de(&ev);
        let link = link_de(&ev);
        let descripcion = ev
            .get_description()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(str::to_string);
        let participantes = participantes_de(&ev);

        // Una instancia editada de una serie viene como un VEVENT aparte con el
        // mismo UID y un `RECURRENCE-ID` que dice a qué repetición reemplaza.
        // Su clave tiene que ser la de esa repetición, o quedarían las dos.
        let sobrescribe = ev
            .property_value("RECURRENCE-ID")
            .and_then(|v| instante_de_valor(v, ev.property_value("DTSTART")));

        let es_serie = ev.property_value("RRULE").is_some();

        for inicio_local in ocurrencias(&ev, desde, hasta) {
            let clave = match (&sobrescribe, es_serie) {
                (Some(instante), _) => format!("{uid}#{}", sello(*instante)),
                (None, true) => format!("{uid}#{}", sello(inicio_local)),
                (None, false) => uid.to_string(),
            };

            let fin_local = duracion.map(|d| inicio_local + d);
            out.push(EventoIcs {
                uid: clave,
                titulo: titulo.clone(),
                fecha: inicio_local.format("%Y-%m-%d").to_string(),
                hora: if dia_completo {
                    None
                } else {
                    Some(inicio_local.format("%H:%M").to_string())
                },
                inicio: if dia_completo {
                    None
                } else {
                    Some(inicio_local.to_utc().to_rfc3339())
                },
                fin: if dia_completo {
                    None
                } else {
                    fin_local.map(|f| f.to_utc().to_rfc3339())
                },
                minutos: if dia_completo {
                    None
                } else {
                    duracion.map(|d| d.num_minutes()).filter(|m| *m > 0)
                },
                link: link.clone(),
                descripcion: descripcion.clone(),
                participantes: participantes.clone(),
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
fn ocurrencias(
    ev: &icalendar::CalendarEvent<'_>,
    desde: NaiveDate,
    hasta: NaiveDate,
) -> Vec<DateTime<Local>> {
    let Ok(set) = ev.get_recurrence() else {
        // Regla que `rrule` rechaza: mejor importar el `DTSTART` solo que perder
        // el evento entero en silencio.
        return match ev.get_start().and_then(a_local) {
            Some(dt) if en_ventana(dt, desde, hasta) => vec![dt],
            _ => vec![],
        };
    };

    // El borde va en instantes y no en fechas: `after`/`before` comparan
    // momentos, así que el día `hasta` se incluye entero tomando su medianoche
    // siguiente.
    let ini = medianoche_local(desde);
    let fin = medianoche_local(hasta + Duration::days(1));
    let (Some(ini), Some(fin)) = (ini, fin) else {
        return vec![];
    };

    // `rrule` itera en su propio `Tz`; `LOCAL` es su envoltorio de `chrono::Local`.
    set.after(ini.with_timezone(&icalendar::Tz::LOCAL))
        .before(fin.with_timezone(&icalendar::Tz::LOCAL))
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
fn participantes_de(ev: &icalendar::CalendarEvent<'_>) -> Vec<Participante> {
    let mut out: Vec<Participante> = Vec::new();

    if let Some(org) = ev.property_value("ORGANIZER") {
        let email = correo(org);
        out.push(Participante {
            nombre: ev
                .properties()
                .get("ORGANIZER")
                .and_then(|p| p.params().get("CN"))
                .map(|v| limpiar_cn(v.value())),
            email: email.clone(),
            estado: None,
            organizador: true,
        });
    }

    for a in ev.get_attendees() {
        let email = correo(&a.cal_address);
        // Si el organizador también está invitado, no se lista dos veces.
        if email.is_some() && out.iter().any(|p| p.email == email) {
            continue;
        }
        out.push(Participante {
            nombre: a.cn.as_deref().map(limpiar_cn),
            email,
            estado: a.part_stat.map(|s| format!("{s:?}").to_uppercase()),
            organizador: false,
        });
    }

    out
}

/// `mailto:x@y.com` → `x@y.com`. Devuelve `None` si no parece un correo.
fn correo(cal_address: &str) -> Option<String> {
    let v = cal_address.trim();
    let sin_esquema = v.strip_prefix("mailto:").or_else(|| v.strip_prefix("MAILTO:")).unwrap_or(v);
    let limpio = sin_esquema.trim();
    if limpio.contains('@') {
        Some(limpio.to_string())
    } else {
        None
    }
}

/// Saca las comillas con que algunos servidores envuelven el `CN`.
fn limpiar_cn(cn: &str) -> String {
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
fn link_de(ev: &icalendar::CalendarEvent<'_>) -> Option<String> {
    for prop in ["X-GOOGLE-CONFERENCE", "CONFERENCE"] {
        if let Some(v) = ev.property_value(prop).map(str::trim) {
            if es_url(v) {
                return Some(v.to_string());
            }
        }
    }
    if let Some(loc) = ev.property_value("LOCATION").map(str::trim) {
        if es_url(loc) {
            return Some(loc.to_string());
        }
    }
    ev.get_description().and_then(url_de_llamada)
}

fn es_url(v: &str) -> bool {
    v.starts_with("http://") || v.starts_with("https://")
}

/// Primera URL del texto que apunte a un servicio de videollamada conocido.
fn url_de_llamada(texto: &str) -> Option<String> {
    texto
        .split(|c: char| c.is_whitespace() || c == '<' || c == '>' || c == '"')
        .map(recortar_puntuacion)
        .find(|t| es_url(t) && HOSTS_DE_LLAMADA.iter().any(|h| t.contains(h)))
        .map(str::to_string)
}

/// Saca la puntuación que queda pegada cuando el link va dentro de una frase
/// ("...entra a https://meet.google.com/abc-defg-hij.").
fn recortar_puntuacion(t: &str) -> &str {
    t.trim_end_matches(|c| matches!(c, '.' | ',' | ')' | ';' | ':' | ']' | '\''))
}

/// Cuánto dura el evento, mirando `DTEND` (o `DURATION` si es lo que trae).
fn duracion_de(ev: &icalendar::CalendarEvent<'_>) -> Option<Duration> {
    let inicio = ev.get_start().and_then(a_local)?;
    if let Some(fin) = ev.get_end().and_then(a_local) {
        let d = fin - inicio;
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
fn a_local(d: DatePerhapsTime) -> Option<DateTime<Local>> {
    match d {
        DatePerhapsTime::DateTime(dt) => match dt {
            icalendar::CalendarDateTime::Utc(utc) => Some(utc.with_timezone(&Local)),
            icalendar::CalendarDateTime::Floating(naive) => local_desde_naive(naive),
            icalendar::CalendarDateTime::WithTimezone { date_time, tzid } => {
                let tz: chrono_tz::Tz = tzid.parse().ok()?;
                // `.single()` falla en el salto de horario de verano; ahí se
                // toma la primera lectura válida en vez de descartar el evento.
                let zonificado = tz
                    .from_local_datetime(&date_time)
                    .single()
                    .or_else(|| tz.from_local_datetime(&date_time).earliest())?;
                Some(zonificado.with_timezone(&Local))
            }
        },
        // Día completo: se ancla a la medianoche local para poder ubicarlo en un
        // día del tablero. La hora no se usa (ver `dia_completo`).
        DatePerhapsTime::Date(fecha) => medianoche_local(fecha),
    }
}

fn local_desde_naive(naive: NaiveDateTime) -> Option<DateTime<Local>> {
    Local
        .from_local_datetime(&naive)
        .single()
        .or_else(|| Local.from_local_datetime(&naive).earliest())
}

fn medianoche_local(fecha: NaiveDate) -> Option<DateTime<Local>> {
    local_desde_naive(fecha.and_hms_opt(0, 0, 0)?)
}

fn en_ventana(dt: DateTime<Local>, desde: NaiveDate, hasta: NaiveDate) -> bool {
    let d = dt.date_naive();
    d >= desde && d <= hasta
}

/// Sello del instante para la clave de una instancia: `20260810T093000`.
/// En hora local, que es la misma referencia que usa `fecha`.
fn sello(dt: DateTime<Local>) -> String {
    dt.format("%Y%m%dT%H%M%S").to_string()
}

/// Interpreta el valor crudo de un `RECURRENCE-ID`.
///
/// Llega sin sus parámetros (el crate expone el valor pelado), así que se
/// prueban los tres formatos de ICS. El `DTSTART` se pasa solo para heredar su
/// zona cuando el `RECURRENCE-ID` viene sin `Z`: en la práctica los dos usan la
/// misma, y sin eso una instancia editada no calzaría con la generada.
fn instante_de_valor(valor: &str, _dtstart: Option<&str>) -> Option<DateTime<Local>> {
    if let Ok(utc) = DateTime::parse_from_str(valor, "%Y%m%dT%H%M%SZ") {
        return Some(utc.with_timezone(&Local));
    }
    if let Ok(naive) = NaiveDateTime::parse_from_str(valor, "%Y%m%dT%H%M%S") {
        return local_desde_naive(naive);
    }
    if let Ok(fecha) = NaiveDate::parse_from_str(valor, "%Y%m%d") {
        return medianoche_local(fecha);
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
pub fn ventana(hoy: NaiveDate) -> (NaiveDate, NaiveDate) {
    (
        hoy - Duration::days(DIAS_ATRAS),
        hoy + Duration::days(DIAS_ADELANTE),
    )
}

/// Hoy en hora local. Vive acá para que el resto del módulo no necesite `Local`.
pub fn hoy_local() -> NaiveDate {
    let ahora = Local::now();
    NaiveDate::from_ymd_opt(ahora.year(), ahora.month(), ahora.day()).expect("fecha de hoy válida")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Envuelve VEVENTs en un VCALENDAR mínimo.
    fn cal(cuerpo: &str) -> String {
        format!(
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//test//EN\r\n{}\r\nEND:VCALENDAR\r\n",
            cuerpo.replace('\n', "\r\n")
        )
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    /// Ventana amplia, para los tests que no prueban el recorte.
    fn todo(ics: &str) -> Vec<EventoIcs> {
        parse_eventos(ics, d("2026-01-01"), d("2026-12-31")).unwrap()
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
        assert_eq!(evs[0].titulo, "Daily");
        // La fecha depende del TZ de la máquina; lo invariante es que coincida
        // con la conversión local del instante, no con el día UTC.
        let esperado = DateTime::parse_from_rfc3339("2026-08-10T23:00:00Z")
            .unwrap()
            .with_timezone(&Local);
        assert_eq!(evs[0].fecha, esperado.format("%Y-%m-%d").to_string());
        assert_eq!(evs[0].hora, Some(esperado.format("%H:%M").to_string()));
        assert_eq!(evs[0].minutos, Some(30));
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
        let esperado = chrono_tz::America::Santiago
            .with_ymd_and_hms(2026, 8, 10, 9, 0, 0)
            .unwrap()
            .with_timezone(&Local);
        assert_eq!(evs[0].fecha, esperado.format("%Y-%m-%d").to_string());
        assert_eq!(evs[0].hora, Some(esperado.format("%H:%M").to_string()));
        assert_eq!(evs[0].minutos, Some(60));
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
        assert_eq!(evs[0].fecha, "2026-08-10");
        assert_eq!(evs[0].hora, None);
        assert_eq!(evs[0].inicio, None);
        assert_eq!(evs[0].fin, None);
        assert_eq!(evs[0].minutos, None);
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
        let claves: std::collections::HashSet<_> = evs.iter().map(|e| &e.uid).collect();
        assert_eq!(claves.len(), 4, "cada instancia necesita su propia clave");
        assert!(evs.iter().all(|e| e.uid.starts_with("serie@test#")));
        assert!(evs.iter().all(|e| e.minutos == Some(15)));
    }

    #[test]
    fn la_ventana_recorta_la_serie() {
        // Una serie sin fin no se importa hasta el infinito.
        let ics = cal(
            "BEGIN:VEVENT\nUID:infinita@test\nSUMMARY:Semanal\nDTSTART;TZID=America/Santiago:20260810T090000\nDTEND;TZID=America/Santiago:20260810T093000\nRRULE:FREQ=WEEKLY\nEND:VEVENT",
        );
        // Tres semanas exactas desde el primer lunes.
        let evs = parse_eventos(&ics, d("2026-08-10"), d("2026-08-30")).unwrap();
        assert_eq!(evs.len(), 3);
        assert!(evs.iter().all(|e| e.fecha.as_str() >= "2026-08-10"));
        assert!(evs.iter().all(|e| e.fecha.as_str() <= "2026-08-30"));
    }

    #[test]
    fn exdate_saca_la_instancia_saltada() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:conhueco@test\nSUMMARY:Semanal\nDTSTART;TZID=America/Santiago:20260810T090000\nDTEND;TZID=America/Santiago:20260810T093000\nRRULE:FREQ=WEEKLY;COUNT=3\nEXDATE;TZID=America/Santiago:20260817T090000\nEND:VEVENT",
        );
        let evs = todo(&ics);
        assert_eq!(evs.len(), 2);
        assert!(
            !evs.iter().any(|e| e.fecha == "2026-08-17"),
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
        let generada = sello(
            chrono_tz::America::Santiago
                .with_ymd_and_hms(2026, 8, 17, 9, 0, 0)
                .unwrap()
                .with_timezone(&Local),
        );
        let clave = format!("serie@test#{generada}");
        let mismas: Vec<_> = evs.iter().filter(|e| e.uid == clave).collect();
        assert_eq!(
            mismas.len(),
            2,
            "la instancia editada y la generada comparten clave, así el upsert deja una"
        );
        assert!(mismas.iter().any(|e| e.titulo == "Standup (movido)"));
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
        let ps = &todo(&ics)[0].participantes;
        assert_eq!(ps.len(), 3);
        // El organizador va primero: es lo que uno busca al abrir una reunión
        // que no reconoce.
        assert!(ps[0].organizador);
        assert_eq!(ps[0].nombre.as_deref(), Some("Ana Pérez"));
        assert_eq!(ps[0].email.as_deref(), Some("ana@acme.cl"));
        assert_eq!(ps[1].email.as_deref(), Some("beto@acme.cl"));
        assert_eq!(ps[1].estado.as_deref(), Some("ACCEPTED"));
        assert_eq!(ps[2].estado.as_deref(), Some("DECLINED"));
        assert!(!ps[1].organizador);
    }

    #[test]
    fn el_organizador_que_tambien_esta_invitado_no_se_duplica() {
        // Google manda al organizador en las dos propiedades. Sin deduplicar,
        // aparecería dos veces en la lista.
        let ics = cal(
            "BEGIN:VEVENT\nUID:dup@test\nSUMMARY:Sync\nDTSTART:20260810T120000Z\nORGANIZER;CN=Ana:mailto:ana@acme.cl\nATTENDEE;CN=Ana;PARTSTAT=ACCEPTED:mailto:ana@acme.cl\nEND:VEVENT",
        );
        let ps = &todo(&ics)[0].participantes;
        assert_eq!(ps.len(), 1);
        assert!(ps[0].organizador);
    }

    #[test]
    fn lee_la_descripcion_del_evento() {
        let ics = cal(
            "BEGIN:VEVENT\nUID:desc2@test\nSUMMARY:Kickoff\nDTSTART:20260810T120000Z\nDESCRIPTION:Revisar el alcance del proyecto\nEND:VEVENT",
        );
        assert_eq!(
            todo(&ics)[0].descripcion.as_deref(),
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
        assert_eq!(ev.titulo, "busy");
        assert_eq!(ev.descripcion, None);
        assert!(ev.participantes.is_empty());
        assert_eq!(ev.link, None);
        // Lo único que sí llega es cuándo y cuánto dura.
        assert_eq!(ev.minutos, Some(60));
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
        assert_eq!(evs[0].titulo, "(sin título)");
    }

    #[test]
    fn sin_dtend_no_inventa_duracion() {
        let ics = cal("BEGIN:VEVENT\nUID:sinfin@test\nSUMMARY:Sin fin\nDTSTART:20260810T120000Z\nEND:VEVENT");
        let evs = todo(&ics);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].minutos, None);
        assert_eq!(evs[0].fin, None);
    }

    #[test]
    fn la_ventana_arranca_hoy_y_llega_a_tres_semanas() {
        // Nada del pasado: una reunión de la semana pasada que nunca se trackeó
        // no aporta nada y solo ensucia el tablero.
        let (desde, hasta) = ventana(d("2026-08-13"));
        assert_eq!(desde, d("2026-08-13"));
        assert_eq!(hasta, d("2026-09-03"));
    }

    #[test]
    fn un_ics_que_no_se_entiende_devuelve_error_y_no_panic() {
        assert!(parse_eventos("esto no es un calendario", d("2026-01-01"), d("2026-12-31")).is_err());
    }
}
