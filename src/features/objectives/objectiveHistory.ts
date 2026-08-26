/**
 * El histórico de objetivos: las últimas N semanas con su avance, y la racha.
 *
 * Es cálculo puro sobre lo que devuelve `listObjectivesRange`, aparte de la vista
 * para poder probarlo. La regla que no es obvia está en `streak`.
 */
import { isoWeekId, shiftWeeks } from "../../lib/date";
import type { Objective } from "../../lib/types";

export interface SemanaDeObjetivos {
  isoWeek: string;
  total: number;
  done: number;
}

/**
 * Las `weeks` fechas —una por semana— que terminan en la de `anchor`, de la más
 * vieja a la más nueva.
 *
 * Devuelve fechas y no ids porque la tira también las usa para **navegar**: con
 * solo el `YYYY-Www` habría que parsearlo de vuelta a un lunes para mover el
 * ancla, y esa conversión es justo la que no vale la pena escribir dos veces.
 */
export function weekAnchorsBackFrom(anchor: Date, weeks: number): Date[] {
  return Array.from({ length: weeks }, (_, i) => shiftWeeks(anchor, i - (weeks - 1)));
}

/** Las `weeks` semanas que terminan en la de `anchor`, de la más vieja a la más nueva. */
export function weekIdsBackFrom(anchor: Date, weeks: number): string[] {
  return weekAnchorsBackFrom(anchor, weeks).map(isoWeekId);
}

/**
 * Una fila por semana del rango, **incluidas las vacías**: una semana sin
 * objetivos es un dato del histórico, y saltearla haría ver como continua una
 * racha que tuvo un hueco.
 */
export function historyByWeek(weekIds: string[], objectives: Objective[]): SemanaDeObjetivos[] {
  return weekIds.map((isoWeek) => {
    const suyos = objectives.filter((o) => o.isoWeek === isoWeek);
    return {
      isoWeek,
      total: suyos.length,
      done: suyos.filter((o) => o.completed).length,
    };
  });
}

/**
 * Cuántas semanas seguidas se cumplió **todo**, contando hacia atrás desde la
 * última semana del rango.
 *
 * Una semana sin objetivos **corta** la racha en vez de contar como cumplida.
 * Con `total === 0` la condición "todos cumplidos" es verdadera por vacuidad, y
 * eso regalaría una racha perfecta a quien no se propuso nada — justo lo
 * contrario de lo que la cifra dice.
 */
export function streak(semanas: SemanaDeObjetivos[]): number {
  let n = 0;
  for (let i = semanas.length - 1; i >= 0; i--) {
    const s = semanas[i];
    if (s.total === 0 || s.done < s.total) break;
    n += 1;
  }
  return n;
}
