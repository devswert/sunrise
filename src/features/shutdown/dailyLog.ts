/**
 * Las cuentas de la bitácora y del cierre del día, separadas del render.
 *
 * El día llega armado desde `repo::daily_log` —trabajo, plan y lo cerrado, con la
 * atribución local ya resuelta—, así que acá solo queda decidir qué se muestra y
 * cuándo toca avisar.
 */
import type { LogDay, DoneTask } from "../../lib/types";
import { SettingKey, type SettingsMap } from "../../lib/settings";

/** Un día sin nada: ni trabajo, ni tareas cerradas, ni nota, ni cierre. */
export function isEmpty(d: LogDay): boolean {
  return (
    d.workedSeconds === 0 &&
    d.done.length === 0 &&
    d.timeline.length === 0 &&
    d.note == null &&
    d.closedAt == null
  );
}

/**
 * Los días que vale la pena dibujar, del más nuevo al más viejo.
 *
 * Se saltan los vacíos —un fin de semana en blanco no aporta una tarjeta— pero
 * **hoy nunca se salta**: es el día que se está por cerrar, y esconderlo dejaría
 * la bitácora sin la entrada que se viene a escribir.
 */
export function visibleDays(days: LogDay[], today: string): LogDay[] {
  return days.filter((d) => d.date === today || !isEmpty(d));
}

/**
 * Qué tareas muestra la bitácora a la izquierda, y cuántas quedan afuera.
 *
 * **Incluir es curar.** En un día con ocho cerradas puede que solo cinco
 * merezcan una línea, y esas cinco son los *highlights*: lo demás pasó, pero no
 * hay nada que decir al respecto. Lo que las separa es tener **fila** en
 * `day_task_notes` (`note != null`), que es lo que escribe el botón "Incluir" del
 * shutdown — no que el texto tenga contenido: una tarea recién incluida no tiene
 * resumen todavía y así y todo es un highlight.
 *
 * Si no incluiste ninguna se muestran todas: la alternativa sería una tarjeta
 * vacía en un día en que sí trabajaste, que es peor que mostrar de más.
 *
 * `otras` no es decoración: **lo que queda afuera se puede ver**. Esconder
 * tareas cerradas en silencio haría leer el día como más chico de lo que fue — y
 * el día completo sigue estando a la derecha, en el timeline.
 */
export function highlights(d: LogDay): { shown: DoneTask[]; others: DoneTask[] } {
  const incluidas = d.done.filter((h) => h.note != null);
  if (incluidas.length === 0) return { shown: d.done, others: [] };
  return { shown: incluidas, others: d.done.filter((h) => h.note == null) };
}

/** Estado de un día para el rótulo: lo cerraste vos, o quedó como borrador. */
export function dayStatus(d: LogDay): "CERRADO" | "BORRADOR" {
  return d.closedAt != null ? "CERRADO" : "BORRADOR";
}

/**
 * Lo trabajado de un día, sumándole la corrida en curso.
 *
 * Los segundos de una entrada abierta no están en la base todavía: los tiene el
 * taxímetro. Es la misma cuenta que hace el rail, y sin ella la tarea que estás
 * trabajando ahora mismo aparece en 0 y el total del día va corto.
 */
export function workedWithRunning(d: LogDay, segundosEnCurso: number): number {
  const hayCorrida = d.timeline.some((t) => t.running);
  return d.workedSeconds + (hayCorrida ? Math.max(0, segundosEnCurso) : 0);
}

/** Igual que la anterior, pero para un tramo del timeline. */
export function segmentSeconds(
  tramo: { seconds: number; running: boolean },
  segundosEnCurso: number,
): number {
  return tramo.seconds + (tramo.running ? Math.max(0, segundosEnCurso) : 0);
}

/**
 * Si toca avisar que es hora de cerrar el día.
 *
 * Tres condiciones, y las tres importan:
 *
 * - **Ya pasó `work_end`** (la hora de la jornada, de `settings` — nunca una hora
 *   hardcodeada: el rail ya usa ese mismo ajuste).
 * - **No se avisó todavía hoy.** El guardado es una fecha y no un booleano, por lo
 *   mismo que `planned_on`: una sesión abierta cruzando la medianoche tiene que
 *   volver a avisar al día siguiente.
 * - **El día no está cerrado.** Si ya lo cerraste, el aviso llega tarde y de más.
 */
export function shouldRemindShutdown(options: {
  nowHhmm: string;
  workEnd: string;
  values: SettingsMap;
  today: string;
  alreadyClosed: boolean;
}): boolean {
  const { nowHhmm, workEnd, values, today, alreadyClosed } = options;
  if (alreadyClosed) return false;
  if (values[SettingKey.SHUTDOWN_NOTIFIED_ON]?.trim() === today) return false;
  // Comparación de strings `HH:mm`, que es lexicográfica y por eso funciona.
  return nowHhmm >= workEnd;
}
