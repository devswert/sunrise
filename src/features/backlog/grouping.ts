import type { Category, Task } from "../../lib/types";

/**
 * Agrupar el backlog por contexto: la pieza que estaba escrita tres veces.
 *
 * El backlog se agrupa por **contexto** y no por horizonte temporal ("algún día
 * esta semana / este mes") porque el modelo no tiene ese campo, y agregarlo
 * obligaría a mantener una segunda noción de fecha al lado de `scheduled_date`.
 *
 * El contexto de una tarea es la categoría **padre** de su categoría, o la
 * categoría misma cuando ya es de primer nivel — ver la skill
 * `sunrise-capa-de-datos`: `parent_id IS NULL` es un contexto (la carpeta) y con
 * `parent_id` es un channel (el `#tag` de las cards). Una tarea puede apuntar a
 * cualquiera de los dos niveles, así que resolverlo es `parentId ?? id`.
 */

/** El contexto de una tarea, o `null` si no tiene categoría (o quedó colgada). */
export function folderOf(task: Task, byId: Map<number, Category>): number | null {
  if (task.categoryId == null) return null;
  const c = byId.get(task.categoryId);
  if (!c) return null;
  return c.parentId ?? c.id;
}

export interface ContextGroup {
  /** `null` es el grupo "Sin contexto", que solo aparece si tiene algo. */
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
export function groupByContext(
  tasks: Task[],
  categories: Category[],
  { includeEmpty }: { includeEmpty: boolean },
): ContextGroup[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const withFolder: ContextGroup[] = categories
    .filter((c) => c.parentId === null)
    .map((folder) => ({ folder, items: tasks.filter((t) => folderOf(t, byId) === folder.id) }))
    .filter((g) => includeEmpty || g.items.length > 0);
  const loose = tasks.filter((t) => folderOf(t, byId) === null);
  return loose.length > 0 ? [...withFolder, { folder: null, items: loose }] : withFolder;
}
