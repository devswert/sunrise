import type { TimeEntry } from "../../lib/types";
import { toISODate, todayISO } from "../../lib/date";

export interface DiaTrabajado {
  /** Fecha local 'YYYY-MM-DD'. */
  date: string;
  seconds: number;
}

/**
 * Agrupa el tiempo trackeado por día, para poder verlo en el detalle.
 *
 * El dato existía desde M2 y no había forma de mirarlo: una tarea arrastrada
 * tres días mostraba un único total, sin decir cuánto cayó en cada día. También
 * es lo que hace **visible** un ajuste manual de tiempo, que hasta ahora se
 * guardaba como una entrada con el delta y no se veía en ninguna parte.
 *
 * Agrupa por la fecha **local** de `startedAt`, no por los primeros 10
 * caracteres del timestamp: viene en UTC, y cortar el string mandaría al día
 * siguiente todo lo trabajado después de las 20:00 en Chile. Cada entrada cae
 * entera en un día porque `stop_timer` las parte en la medianoche local.
 *
 * @param extraHoy Segundos de la corrida en curso, que todavía no están en
 * ninguna entrada cerrada. Así la fila de hoy avanza mientras trabajas.
 */
export function timeByDay(
  entries: TimeEntry[],
  extraHoy = 0,
  today: string = todayISO(),
): DiaTrabajado[] {
  const porDia = new Map<string, number>();

  for (const e of entries) {
    if (e.endedAt === null) continue; // la corrida en curso entra por `extraHoy`
    // La validación va ANTES de formatear: `toISODate` usa date-fns, que lanza
    // con una fecha inválida en vez de devolver algo que se pueda descartar.
    const start = new Date(e.startedAt);
    if (Number.isNaN(start.getTime())) continue;
    const date = toISODate(start);
    porDia.set(date, (porDia.get(date) ?? 0) + e.seconds);
  }

  if (extraHoy > 0) porDia.set(today, (porDia.get(today) ?? 0) + extraHoy);

  return [...porDia.entries()]
    .map(([date, seconds]) => ({
      date,
      // Piso en 0 por la misma razón que `seconds_today`: un ajuste hacia abajo
      // puede dejar el día en negativo, y un tiempo trabajado negativo no
      // significa nada. El día se muestra igual, en 0, porque desaparecerlo
      // escondería que ahí pasó algo.
      seconds: Math.max(0, seconds),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Duración compacta para las filas: "45m", "1h 30m", "0m". */
export function shortDuration(totalSeconds: number): string {
  const min = Math.max(0, Math.round(totalSeconds / 60));
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
