import { CapacityLevel } from "./enums";

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
export function horas(seconds: number): string {
  const min = Math.round(Math.max(0, seconds) / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** `90` (minutos) → `'1h 30m'`. */
export function horasDeMinutos(minutes: number): string {
  return horas(Math.max(0, minutes) * 60);
}
