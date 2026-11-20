import { CapacityLevel } from "./enums";
import type { Task } from "./types";
import { minutesFromTime } from "./date";

/**
 * Semáforo del contador de capacidad diaria.
 *
 * - OVER  (rojo):   los minutos planificados superan el objetivo.
 * - WARN  (amarillo): están cerca del objetivo (>= warnRatio del objetivo).
 * - OK    (gris):   holgadamente bajo el objetivo.
 *
 * `targetMinutes <= 0` => sin objetivo configurado => siempre OK.
 */
export function computeCapacityLevel(
  plannedMinutes: number,
  targetMinutes: number,
  warnRatio = 0.85,
): CapacityLevel {
  if (targetMinutes <= 0) return CapacityLevel.OK;
  if (plannedMinutes > targetMinutes) return CapacityLevel.OVER;
  if (plannedMinutes >= targetMinutes * warnRatio) return CapacityLevel.WARN;
  return CapacityLevel.OK;
}

/**
 * La capacidad de un día, en minutos: la jornada menos lo que ese día no es
 * trabajo (#8).
 *
 * Lo que no es trabajo son los **eventos ignorados** (`railOnly`): la marca ya
 * existía para sacar el almuerzo de la carga, así que la misma marca lo saca de la
 * capacidad. Como se pone por serie, el almuerzo recurrente se marca una vez y
 * cada ocurrencia resta con su hora y su duración reales, aunque se haya movido.
 *
 * - Solo resta la parte de cada evento que cae **dentro** de la jornada.
 * - Los ignorados que se solapan restan una sola vez (la unión, no la suma).
 * - Los de día completo no restan: no tienen hora (`scheduledTime` nulo, §4.12).
 * - Un ignorado sin duración tampoco: no hay de dónde sacar cuánto ocupa, y
 *   inventarle los 30 minutos con que lo dibuja el rail sería restar un número
 *   que nadie puso.
 * - Jornada ilegible o invertida, o cubierta entera ⇒ 0, que apaga el semáforo
 *   igual que un objetivo de 0.
 *
 * La hora sale de `scheduledTime` + `estimatedMinutes`, **nunca** de
 * `eventStart`/`eventEnd`, que están en UTC (ver `railLayout.ts`).
 *
 * Recibe la **agenda** del día (`agendaByDate`), no las tarjetas: las tarjetas ya
 * vienen sin los ignorados. Se calcula al mirar y no se guarda, así que cambiar la
 * jornada repinta también los días pasados.
 */
export function dayCapacity(workStart: string, workEnd: string, agenda: Task[]): number {
  const from = minutesFromTime(workStart);
  const to = minutesFromTime(workEnd);
  if (from == null || to == null || to <= from) return 0;

  const blocks: Array<[number, number]> = [];
  for (const t of agenda) {
    if (!t.railOnly || t.sourceState !== "ACTIVE") continue;
    const start = minutesFromTime(t.scheduledTime);
    const minutes = t.estimatedMinutes ?? 0;
    if (start == null || minutes <= 0) continue;
    const a = Math.max(start, from);
    const b = Math.min(start + minutes, to);
    if (b > a) blocks.push([a, b]);
  }
  blocks.sort((x, y) => x[0] - y[0]);

  let ignored = 0;
  let curA = -1;
  let curB = -1;
  for (const [a, b] of blocks) {
    if (a > curB) {
      ignored += curB - curA;
      curA = a;
      curB = b;
    } else if (b > curB) {
      curB = b;
    }
  }
  ignored += curB - curA;

  return Math.max(0, to - from - ignored);
}

/**
 * Las duraciones que ofrecen **todos** los selectores de tiempo de la app: el
 * chip del modal de crear, los dos pickers del detalle y de la card, los de Focus
 * y el reparto por día de un objetivo.
 *
 * Una sola lista y no una por pantalla: estaba copiada en tres archivos y ya
 * habían divergido —una tenía 180 y 240, otra no— así que la misma pregunta se
 * respondía distinto según dónde la hicieras. Vive acá, con `formatMinutes` y
 * `parseDuration`, porque es el módulo que todos los selectores ya importan.
 *
 * Arranca de 5 en 5 y después se abre: **sin 10 ni 25**. La lista corta se lee de
 * un vistazo, y los valores del medio se escriben a mano en los pickers que
 * aceptan texto libre (`TimePicker`).
 */
export const TIME_PRESETS = [5, 15, 20, 30, 45, 60, 90, 120, 180, 240];

/** Formatea minutos como "H:MM" (ej. 135 -> "2:15"). */
export function formatMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return `${h}:${String(rem).padStart(2, "0")}`;
}

/**
 * Interpreta una duración escrita a mano y la devuelve en minutos.
 *
 * Acepta: "22" (min), "0:22", "00:22", "1:30", "90m", "1h", "1h30", "1h 30m".
 * Devuelve `null` si no logra interpretarla.
 */
export function parseDuration(input: string): number | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;

  // "h:mm" / "hh:mm"
  const colon = raw.match(/^(\d{1,2}):(\d{1,2})$/);
  if (colon) {
    const h = Number(colon[1]);
    const m = Number(colon[2]);
    if (m > 59) return null;
    return h * 60 + m;
  }

  // "1h30", "1h 30m", "1h", "90m"
  const hm = raw.match(/^(?:(\d{1,2})\s*h)?\s*(?:(\d{1,3})\s*m?)?$/);
  if (hm && (hm[1] || hm[2])) {
    const h = hm[1] ? Number(hm[1]) : 0;
    const m = hm[2] ? Number(hm[2]) : 0;
    if (!hm[1] && !raw.includes("m") && m > 0) return m; // sólo dígitos => minutos
    return h * 60 + m;
  }

  return null;
}

/** `27000` → `'7h 30m'`. Se redondea al minuto: el segundo no aporta acá. */
export function hours(seconds: number): string {
  const min = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** `90` (minutos) → `'1h 30m'`. */
export function hoursFromMinutes(minutes: number): string {
  return hours(Math.max(0, minutes) * 60);
}
