import {
  addDays,
  format,
  getISOWeek,
  getISOWeekYear,
  parseISO,
  startOfISOWeek,
} from "date-fns";
import { es } from "date-fns/locale";

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

/** 'lunes' → 'Lunes'. El español no capitaliza días ni meses; la UI sí. */
function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fecha local en formato 'YYYY-MM-DD'. */
export function toISODate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

/** Hoy en 'YYYY-MM-DD' (hora local). */
export function todayISO(): string {
  return toISODate(new Date());
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
