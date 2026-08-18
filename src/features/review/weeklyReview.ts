/**
 * Lo que la weekly review necesita **calcular**, separado de lo que dibuja.
 *
 * El rollup ya llega agregado desde Rust (día × categoría, con el contexto
 * resuelto): acá solo se le pone nombre y color a cada segmento y se decide la
 * escala de las barras. Nada de esto toca fechas UTC — la atribución por día
 * local ya la resolvió `repo::weekly_rollup`.
 */
import type { Category, Task, WeeklyRollup } from "../../lib/types";
import { groupBy, type Segmento } from "../../lib/segmentos";
import { shortWeekday } from "../../lib/date";
// Se re-exportan: el formato de duraciones vive en `lib/capacity.ts` —lo comparten
// la review y la bitácora—, pero la vista lo pide junto al resto de sus cuentas.
export { hours, hoursFromMinutes } from "../../lib/capacity";
export type { Segmento } from "../../lib/segmentos";

export interface DiaDeBarra {
  date: string;
  /** `Lun 10`. */
  label: string;
  seconds: number;
  plannedMinutes: number;
  done: number;
  unestimated: number;
  segments: Segmento[];
}

/** Las 7 barras del gráfico diario, con sus segmentos por channel. */
export function barsByDay(rollup: WeeklyRollup, cats: Map<number, Category>): DiaDeBarra[] {
  return rollup.days.map((d) => ({
    date: d.date,
    label: shortWeekday(d.date),
    seconds: d.seconds,
    plannedMinutes: d.plannedMinutes,
    done: d.done,
    unestimated: d.unestimated,
    segments: groupBy(
      rollup.cells.filter((c) => c.date === d.date),
      cats,
      false,
    ),
  }));
}

/** El donut: por **contexto**, que es como se lee una semana de un vistazo. */
export function byContext(rollup: WeeklyRollup, cats: Map<number, Category>): Segmento[] {
  return groupBy(rollup.cells, cats, true);
}

/**
 * El techo de la escala, en minutos.
 *
 * Es el máximo entre lo trabajado y lo planificado de **toda** la semana, no de
 * cada día: una escala por día haría ver igual de alto un martes de 8 horas y un
 * sábado de 20 minutos.
 */
export function ceilingInMinutes(days: DiaDeBarra[]): number {
  const max = Math.max(
    60,
    ...days.map((d) => Math.max(Math.round(d.seconds / 60), d.plannedMinutes)),
  );
  return max;
}

/** Las tareas cerradas, agrupadas por el día en que se cerraron. */
export function closedByDay(rollup: WeeklyRollup): Map<string, Task[]> {
  const por = new Map<string, Task[]>();
  for (const d of rollup.days) por.set(d.date, []);
  for (const t of rollup.completedTasks) {
    if (!t.completedAt) continue;
    // El día es **local**: cortar el timestamp UTC mandaría al día siguiente
    // todo lo cerrado de tarde.
    const day = new Date(t.completedAt);
    if (Number.isNaN(day.getTime())) continue;
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(
      day.getDate(),
    ).padStart(2, "0")}`;
    por.get(key)?.push(t);
  }
  return por;
}
