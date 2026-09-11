import type { Category, Task } from "../../lib/types";
import { GroupBy } from "../../lib/enums";

/**
 * Agrupar el backlog: la pieza que estaba escrita tres veces.
 *
 * El backlog se agrupa por categoría y no por horizonte temporal ("algún día
 * esta semana / este mes") porque el modelo no tiene ese campo, y agregarlo
 * obligaría a mantener una segunda noción de fecha al lado de `scheduled_date`.
 *
 * **Los dos niveles responden preguntas distintas y por eso se puede elegir.**
 * Las categorías son un árbol de dos pisos — ver la skill `sunrise-capa-de-datos`:
 * `parent_id IS NULL` es un contexto (la carpeta) y con `parent_id` es un channel
 * (el `#tag` de las cards). Agrupar por contexto responde "en qué área tengo
 * cosas"; por channel, "de qué es exactamente cada una", que es lo que se lee en
 * la card y por lo tanto lo que uno reconoce de un vistazo. Por eso el default
 * es el channel.
 */

/**
 * A qué grupo cae una tarea, o `null` si no tiene categoría (o quedó colgada).
 *
 * Por channel es **la categoría exacta**, no "solo las que tienen padre": una
 * tarea puede colgar directo de un contexto sin hijos —`issues` es a la vez
 * carpeta y el `#issues` que se ve en la card— y mandarla a "sin channel" sería
 * decir que no tiene, cuando la card muestra que sí.
 */
export function groupIdOf(task: Task, byId: Map<number, Category>, level: GroupBy): number | null {
  if (task.categoryId == null) return null;
  const c = byId.get(task.categoryId);
  if (!c) return null;
  return level === GroupBy.CHANNEL ? c.id : (c.parentId ?? c.id);
}

/** El contexto de una tarea. Atajo de `groupIdOf(..., CONTEXT)`. */
export function folderOf(task: Task, byId: Map<number, Category>): number | null {
  return groupIdOf(task, byId, GroupBy.CONTEXT);
}

export interface TaskGroup {
  /** `null` es el grupo sin categoría, que solo aparece si tiene algo. */
  folder: Category | null;
  items: Task[];
}

/**
 * Los grupos, en el orden en que vienen las categorías.
 *
 * `includeEmpty` no es un detalle de gusto y por eso es explícito: sus dos
 * consumidores quieren cosas distintas y no se pueden unificar.
 *
 * - **`BacklogView` lo quiere en `true`.** Un contexto vacío ahí sigue
 *   mostrando su botón "Agregar tarea", que es la única forma de crear una
 *   tarea en un contexto que todavía no tiene ninguna. Sin el grupo no hay
 *   botón, y el contexto queda inalcanzable.
 * - **El sidebar y el panel de la semana lo quieren en `false`.** No crean
 *   nada, así que un grupo vacío no ofrece nada; y en los 300px del panel es
 *   espacio vertical gastado en una lista de nombres sin tareas.
 *
 * El grupo "Sin contexto" nunca se incluye vacío, en los dos casos: no es una
 * categoría, así que no hay nada a lo que colgarle una tarea nueva.
 */
export function groupTasks(
  tasks: Task[],
  categories: Category[],
  level: GroupBy,
  { includeEmpty }: { includeEmpty: boolean },
): TaskGroup[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  // Por contexto solo las carpetas; por channel **todas**, porque una tarea puede
  // estar colgada de cualquiera de los dos niveles.
  const candidatas =
    level === GroupBy.CHANNEL ? categories : categories.filter((c) => c.parentId === null);
  const withFolder: TaskGroup[] = candidatas
    .map((folder) => ({
      folder,
      items: tasks.filter((t) => groupIdOf(t, byId, level) === folder.id),
    }))
    .filter((g) => includeEmpty || g.items.length > 0);
  const loose = tasks.filter((t) => groupIdOf(t, byId, level) === null);
  return loose.length > 0 ? [...withFolder, { folder: null, items: loose }] : withFolder;
}

/** Cómo se llama el cajón de las que no tienen categoría, según el nivel. */
export function looseLabel(level: GroupBy): string {
  return level === GroupBy.CHANNEL ? "Sin channel" : "Sin contexto";
}

/**
 * Filtrar por canal, aceptando los **dos niveles** de la jerarquía.
 *
 * Elegir un channel (`#deploys`) deja solo las tareas colgadas de ese channel;
 * elegir un contexto deja todo lo que cuelga de él, channels incluidos. Es la
 * misma resolución de `folderOf`, y la razón es que el picker ofrece los dos
 * niveles: con la coincidencia exacta, elegir un contexto en un backlog donde
 * todo está en channels devolvería la lista vacía.
 *
 * `null` no filtra: es "todos los canales", no "los que no tienen".
 */
export function filterByChannel(
  tasks: Task[],
  categories: Category[],
  categoryId: number | null,
): Task[] {
  if (categoryId == null) return tasks;
  const byId = new Map(categories.map((c) => [c.id, c]));
  const elegida = byId.get(categoryId);
  if (elegida && elegida.parentId === null) {
    return tasks.filter((t) => folderOf(t, byId) === categoryId);
  }
  return tasks.filter((t) => t.categoryId === categoryId);
}
