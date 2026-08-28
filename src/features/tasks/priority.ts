import { PRIORITIES, Priority } from "../../lib/enums";
import type { Task } from "../../lib/types";

/**
 * Las piezas puras de la prioridad: su color, su orden y su filtro.
 *
 * Está acá y no dentro de un componente por lo de siempre en este proyecto —lo
 * testeable vive aparte— pero también porque los tres consumidores están en
 * features distintas: la card (`week`), el detalle (`tasks`) y las dos vistas del
 * backlog. Tres copias del "los sin prioridad van al final" era una promesa de
 * que en algún momento iban a discrepar.
 */

/** El color del nivel, como referencia al token de `tokens.css`. */
export function priorityVar(p: Priority): string {
  return `var(--prio-${p.toLowerCase()})`;
}

/**
 * Orden de la escala: **P1 primero y los sin prioridad al final**.
 *
 * Lo segundo es explícito y no un efecto del orden lexicográfico: una tarea sin
 * priorizar no es "menos urgente que P5", es una que nadie miró todavía, y
 * mezclarla entre los P5 la esconde justamente cuando estás ordenando por
 * prioridad para decidir qué hacer.
 */
export function comparePriority(a: Priority | null, b: Priority | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return PRIORITIES.indexOf(a) - PRIORITIES.indexOf(b);
}

/** Cómo se ordena una lista de tareas del backlog. */
export const BacklogSort = {
  /** La más vieja primero. Es el default: el backlog se lee como una fila. */
  CREATED: "CREATED",
  P: "PRIORITY",
} as const;
export type BacklogSort = (typeof BacklogSort)[keyof typeof BacklogSort];

/**
 * Las tareas ordenadas, **sin tocar el arreglo que recibe**.
 *
 * Por prioridad el desempate es la fecha de creación, y no la `position`: dentro
 * de un mismo nivel lo que queda es la misma pregunta que responde el orden por
 * defecto. La `position` del backlog además no significa nada acá — es global
 * sobre el bucket `scheduled_date IS NULL` y todo drop entra en 0.
 */
export function sortTasks(tasks: Task[], sort: BacklogSort): Task[] {
  const porFecha = (a: Task, b: Task) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id;
  if (sort === BacklogSort.CREATED) return [...tasks].sort(porFecha);
  return [...tasks].sort((a, b) => comparePriority(a.priority, b.priority) || porFecha(a, b));
}

/**
 * Filtro por prioridad. Un conjunto **vacío no filtra nada**: es "todas", no
 * "ninguna". Es el mismo criterio del filtro del repaso semanal, y el que hace
 * que destildar el último checkbox devuelva la lista entera en vez de vaciarla.
 */
export function filterByPriority(tasks: Task[], levels: Set<Priority>): Task[] {
  if (levels.size === 0) return tasks;
  return tasks.filter((t) => t.priority != null && levels.has(t.priority));
}
