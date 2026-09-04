import { useMemo } from "react";
import type { Task } from "../../lib/types";
import { buildRail, lateTaskIds } from "./railLayout";
import { useDayWork } from "./useTrabajoDelDia";
import { useMinuteTick } from "../../lib/day";

/**
 * Qué tareas del día **se salen del horario de trabajo**, para marcarlas en el
 * board.
 *
 * Solo tiene sentido en el día de hoy —la proyección arranca en la hora actual—
 * y por eso `enabled`: en un día futuro no hay nada que avisar, y sin la bandera
 * el board pagaría siete proyecciones y siete consultas para nada.
 *
 * Se suscribe a `useMinuteTick` porque el aviso **envejece solo**: nadie toca un
 * dato cuando el reloj empuja la última tarea fuera de la jornada.
 */
export function useLateTasks(
  date: string,
  tasks: Task[],
  workStart: string,
  workEnd: string,
  enabled: boolean,
): Set<number> {
  const nowMin = useMinuteTick(enabled);
  // La consulta va siempre: es una lectura local de un día, y condicionarla
  // obligaría a un hook condicional o a pedir la fecha vacía.
  const { work, segundosEnCurso } = useDayWork(date);

  return useMemo(() => {
    if (!enabled) return new Set<number>();
    const rail = buildRail(tasks, workStart, workEnd, {
      ahoraMin: nowMin,
      work,
      segundosEnCurso,
    });
    return lateTaskIds(rail, tasks);
  }, [enabled, tasks, workStart, workEnd, nowMin, work, segundosEnCurso]);
}
