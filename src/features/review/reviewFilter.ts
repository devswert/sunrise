/**
 * El filtro de la weekly review: por objetivo y por channel, varios a la vez.
 *
 * Cálculo puro para poder probarlo — la vista solo guarda los ids elegidos y
 * dibuja. Las dos reglas que no son obvias están abajo.
 */
import type { Category, Task } from "../../lib/types";

export interface ReviewFilter {
  objectiveIds: Set<number>;
  categoryIds: Set<number>;
}

export const SIN_FILTRO: ReviewFilter = {
  objectiveIds: new Set(),
  categoryIds: new Set(),
};

export function hayFiltro(f: ReviewFilter): boolean {
  return f.objectiveIds.size > 0 || f.categoryIds.size > 0;
}

/**
 * **OR dentro de una dimensión, AND entre dimensiones.** Elegir dos objetivos
 * muestra los dos; elegir un objetivo y un channel muestra lo que cumple ambas.
 * Es la lectura natural de "puedo querer más de uno a la vez y filtran en
 * conjunto", y la única que no vacía la vista al segundo click.
 *
 * **Un contexto elegido incluye sus channels.** Las categorías son de dos niveles
 * y una tarea apunta a cualquiera de ellos, así que comparar solo contra
 * `categoryId` exacto haría que elegir un contexto no calzara con nada. Se
 * resuelve `parentId ?? id`, igual que `work_by_day` y `groupBy`.
 */
export function matchesFilter(
  task: Task,
  filter: ReviewFilter,
  cats: Map<number, Category>,
): boolean {
  if (filter.objectiveIds.size > 0) {
    if (task.objectiveId == null || !filter.objectiveIds.has(task.objectiveId)) return false;
  }
  if (filter.categoryIds.size > 0) {
    if (task.categoryId == null) return false;
    const cat = cats.get(task.categoryId);
    const contextId = cat ? (cat.parentId ?? cat.id) : task.categoryId;
    if (!filter.categoryIds.has(task.categoryId) && !filter.categoryIds.has(contextId)) {
      return false;
    }
  }
  return true;
}

/** Prende o apaga un id de una de las dos dimensiones, sin mutar el original. */
export function toggleId(ids: Set<number>, id: number): Set<number> {
  const next = new Set(ids);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
