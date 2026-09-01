import {
  addDays,
  format,
  getISODay,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfISOWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import { TZDate } from "@date-fns/tz";

/**
 * El locale va **por llamada** y no con `setDefaultOptions`.
 *
 * Un default global también cambiaría `weekStartsOn` y `firstWeekContainsDate`.
 * Hoy no molestaría, porque las semanas se calculan con `startOfISOWeek` /
 * `getISOWeek`, que son ISO y no miran el locale — pero son tres call sites de
 * formato contra un cambio silencioso en los límites de semana, y ese cambio
 * mueve la vista semana entera. No vale el trueque.
 */
const LOCALE = { locale: es };

/**
 * La zona en la que el usuario vive el día.
 *
 * **Se empuja, no se lee.** Lo natural sería que esto consultara el store de
 * ajustes, y no se puede: `settings.ts` → `ipc.ts` → `mockDb.ts` → `date.ts`, así
 * que preguntar desde acá cierra un ciclo de imports. Quien la sabe la deja acá con
 * `setZone`, igual que en Rust, donde `set_setting` invalida el caché de
 * `repo::zone`. Las dos puntas del puente terminaron con la misma forma por la
 * misma razón: la zona es un dato global de hecho —un usuario, una máquina— y
 * enhebrarla por parámetro hasta cada lector no compra nada.
 *
 * `null` = la del sistema, que es también el valor de fábrica: el ajuste ausente no
 * cambia nada.
 */
let elegida: string | null = null;

/**
 * Fija la zona. La llama el runtime de ajustes cuando lee o escribe la clave.
 *
 * **Valida, aunque `timezone()` ya valide.** Son dos guardias a propósito: si una
 * zona ilegible llegara hasta acá, `format` tira `RangeError` y se cae la vista
 * entera —no el ajuste, la vista— y por un dato que la app puede ignorar sin
 * consecuencias. Un nombre que la plataforma no conoce cae a la del sistema.
 */
export function setZone(tz: string | null): void {
  const limpia = tz?.trim();
  if (!limpia) {
    elegida = null;
    return;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: limpia });
    elegida = limpia;
  } catch {
    elegida = null;
  }
}

/** La zona vigente, como nombre IANA. */
export function zone(): string {
  return elegida ?? systemZone();
}

/** La zona del sistema, ej. `'America/Santiago'`. */
export function systemZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Ahora, **leído en la zona del usuario**.
 *
 * Es el único puente entre "un instante" y "una fecha y hora de reloj", y por eso
 * todo lo que responde "¿qué día es hoy?" o "¿qué hora es?" pasa por acá. Un `Date`
 * pelado solo sabe exponer los campos de la zona del sistema; `TZDate` es lo que
 * permite que `format` lea los de otra.
 */
export function nowLocal(): Date {
  return new TZDate(Date.now(), zone());
}

/** Un `'YYYY-MM-DD'` como medianoche **en la zona del usuario**. */
export function zonedDate(dateStr: string): Date {
  return new TZDate(`${dateStr}T00:00:00`, zone());
}

/** La hora de reloj de ahora, `'HH:MM'`. */
export function nowHhmm(): string {
  return format(nowLocal(), "HH:mm");
}

/** Minutos transcurridos del día de hoy, en la zona del usuario. */
export function nowMinutes(): number {
  const d = nowLocal();
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * El día `'YYYY-MM-DD'` al que pertenece un instante ISO, **en la zona del
 * usuario**. Cadena vacía si no parsea.
 *
 * Es lo que antes se armaba a mano con `getFullYear/getMonth/getDate` en
 * `weeklyReview.ts`: la misma cuenta, pero una sola vez y con la zona correcta.
 */
export function dayInZone(iso: string): string {
  const d = new TZDate(iso, zone());
  return Number.isNaN(d.getTime()) ? "" : format(d, "yyyy-MM-dd");
}

/** La hora de reloj `'HH:MM'` de un instante ISO, en la zona del usuario. */
export function hhmmInZone(iso: string): string {
  const d = new TZDate(iso, zone());
  return Number.isNaN(d.getTime()) ? "" : format(d, "HH:mm");
}

/** Minutos del día de un instante ISO, leídos en la zona del usuario. */
export function minutesOfDay(iso: string): number {
  const d = new TZDate(iso, zone());
  return d.getHours() * 60 + d.getMinutes();
}

/**
 * Medianoche del día al que pertenece ese instante, en la zona del usuario.
 *
 * Recibe epoch y no `Date` a propósito: un `Date` ya perdió la zona, y aceptarlo
 * invitaría a pasarle uno construido con los campos del sistema.
 */
export function startOfDayAt(epochMs: number): Date {
  const d = new TZDate(epochMs, zone());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 'lunes' → 'Lunes'. El español no capitaliza días ni meses; la UI sí. */
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fecha local en formato 'YYYY-MM-DD'. */
export function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Hoy en 'YYYY-MM-DD', **en la zona del usuario**. */
export function todayISO(): string {
  return toISODate(nowLocal());
}

/**
 * Fecha y hora locales en `'YYYY-MM-DDTHH:mm'`, para las marcas de "esto pasó".
 *
 * **Sin zona y armado con `format`, nunca con `toISOString()`.** Los primeros
 * diez caracteres tienen que ser exactamente lo que devolvería `todayISO()` en
 * el mismo instante, porque quien lee la marca compara ese prefijo contra el día
 * de hoy. `toISOString()` da la fecha **en UTC**, así que en Santiago las cuatro
 * últimas horas de cada día quedarían marcadas como el día siguiente — el mismo
 * error de medianoche que la marca existe para poder desmentir.
 */
export function toISOTimestamp(d: Date): string {
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

/** Identificador de semana ISO, ej. '2026-W32'. */
export function isoWeekId(d: Date): string {
  const year = getISOWeekYear(d);
  const week = getISOWeek(d);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** Las 7 fechas (lunes→domingo) de la semana ISO que contiene `anchor`. */
export function weekDates(anchor: Date): string[] {
  const monday = startOfISOWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => toISODate(addDays(monday, i)));
}

/**
 * La ventana de la vista semana: **tres semanas** —la anterior, la del ancla y la
 * siguiente—, cada una con sus 7 fechas.
 *
 * Existe para poder arrastrar un viernes a la semana que viene sin cambiar de
 * vista, soltar, y volver. Devuelve las semanas **agrupadas** y no una lista
 * plana porque el board las dibuja como tres bloques: cada uno lleva su rótulo
 * pegado a la izquierda, y ese rótulo necesita que la semana sea un contenedor.
 * La del ancla es siempre `[1]`.
 */
export function threeWeeks(anchor: Date): string[][] {
  return [-1, 0, 1].map((delta) => weekDates(shiftWeeks(anchor, delta)));
}

/** Día de la semana ISO: lunes = 1 … domingo = 7. */
export function isoWeekday(dateStr: string): number {
  return getISODay(parseISODate(dateStr));
}

/**
 * `1` → `'Lun'`. Sale del locale y no de una lista escrita a mano, por lo mismo
 * que `shortWeekday`: una lista paralela se desincroniza del resto de la app.
 * La referencia es un lunes conocido.
 */
export function isoWeekdayLabel(isoDay: number): string {
  const monday = parseISODate("2026-08-10");
  return capitalizar(format(addDays(monday, isoDay - 1), "EEE", LOCALE)).replace(".", "");
}

/** 'YYYY-MM-DD' → Date (medianoche local). */
export function parseISODate(s: string): Date {
  return parseISO(s);
}

/** Nombre del día, ej. 'Lunes'. */
export function weekdayLabel(dateStr: string): string {
  return capitalizar(format(parseISODate(dateStr), "EEEE", LOCALE));
}

/** Etiqueta de fecha, ej. '10 de agosto'. */
export function dateLabel(dateStr: string): string {
  // No es "MMMM d" traducido: en español el día va primero y con "de" en medio.
  // Cambiar solo el locale daría "agosto 10".
  return format(parseISODate(dateStr), "d 'de' MMMM", LOCALE);
}

export function isToday(dateStr: string): boolean {
  return dateStr === todayISO();
}

/** Suma (o resta) semanas a una fecha ancla, devolviendo la nueva ancla. */
export function shiftWeeks(anchor: Date, delta: number): Date {
  return addDays(anchor, delta * 7);
}

/** Día abreviado con su número, ej. 'Lun 10'. Para los ejes de la review. */
export function shortWeekday(dateStr: string): string {
  const d = parseISODate(dateStr);
  return `${capitalizar(format(d, "EEE", LOCALE)).replace(".", "")} ${format(d, "d")}`;
}

/** Etiqueta corta de fecha, ej. '6 ago'. */
export function shortDate(dateStr: string): string {
  return format(parseISODate(dateStr), "d MMM", LOCALE);
}

/**
 * Antigüedad compacta: 'recién', 'hace 3 d', 'hace 1 sem'.
 *
 * Escrita a mano y no con `formatDistanceToNow`, que redondea y agrega ruido
 * ("alrededor de 2 meses"). Acá los cortes son duros a propósito, para que el
 * historial se lea de un vistazo.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((now.getTime() - then) / 1000));
  if (secs < 60) return "recién";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `hace ${weeks} sem`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} ${months === 1 ? "mes" : "meses"}`;
  const years = Math.floor(days / 365);
  return `hace ${years} ${years === 1 ? "año" : "años"}`;
}
