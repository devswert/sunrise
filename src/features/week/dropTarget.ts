import type { Task } from "../../lib/types";

/** Datos que cada droppable del board publica en su `data`. */
export interface DropData {
  type: "column" | "task";
  date: string | null;
}

/** Dónde termina la card: el día destino (`null` = backlog) y su índice. */
export interface DropTarget {
  date: string | null;
  index: number;
}

/** El id numérico detrás de un `task-<n>` de dnd-kit. */
export function taskIdFrom(id: string | number): number {
  return Number(String(id).replace("task-", ""));
}

/**
 * A dónde va la card que se soltó, o `null` si el drop no hace nada.
 *
 * Está afuera de `WeekView` porque es **la única parte testeable** del arrastre:
 * jsdom no implementa rectángulos, así que el gesto se verifica en el browser,
 * pero la decisión que toma el gesto se puede fijar acá. Mismo criterio que
 * `anchor.ts` y `reorder.ts`.
 *
 * Los cinco casos que devuelven `null` son el contrato, y cada uno tapa algo que
 * ya se rompió o que se rompería:
 *
 * 1. **Datos que no reconoce.** Un droppable nuevo sin `type` no debería mover
 *    nada por accidente.
 * 2. **Un día plegado.** No tiene ref de droppable, así que no debería llegar
 *    nunca — pero la cascada de colisión cae a la esquina más cercana, que no
 *    distingue. A un día **pasado** sí se puede: ver `DayColumn`.
 * 3. **Del backlog al backlog.** Con el panel superpuesto el arrastre *empieza*
 *    con el puntero adentro, y la card fuente sigue montada en su rectángulo, así
 *    que un empujón de 5px —la constante de activación— resuelve el panel. Sin
 *    este caso, ese empujón reescribiría la `position` de todo el backlog.
 * 4. **Una tarea completada al backlog.** `list_backlog` filtra `status='TODO'`,
 *    así que saldría del día y no entraría al backlog: no se borra, queda
 *    inalcanzable en toda la app. Mejor que el drop no haga nada.
 * 5. **Sin tarea.** No debería pasar; si pasa, no se inventa un movimiento.
 */
export function resolveDrop({
  task,
  overId,
  overData,
  tasksByDate,
  isCollapsed,
}: {
  task: Task | null | undefined;
  overId: string | number;
  overData: DropData | undefined;
  tasksByDate: Record<string, Task[]>;
  isCollapsed: (date: string) => boolean;
}): DropTarget | null {
  if (task == null) return null;
  if (overData?.type !== "column" && overData?.type !== "task") return null;

  const date = overData.date;

  if (date == null) {
    // Al backlog. No lleva índice: la `position` del backlog es global sobre el
    // bucket `scheduled_date IS NULL` mientras `list_backlog` ordena por
    // `category_id, position, id`, así que un índice dentro de un grupo de
    // contexto no corresponde a ninguna posición global. Entra en 0, que con el
    // panel agrupando del lado del cliente significa "primera de su contexto".
    if (task.scheduledDate == null) return null;
    if (task.status === "DONE") return null;
    return { date: null, index: 0 };
  }

  if (isCollapsed(date)) return null;

  const list = tasksByDate[date] ?? [];

  if (overData.type === "column") {
    // Al final de la columna destino, salvo que la card ya esté en ella: la
    // cascada de colisión resuelve la columna en vez de una card al pasar por el
    // header o los márgenes, y ahí "al final" era un movimiento inventado.
    const ownIndex = list.findIndex((t) => t.id === task.id);
    return { date, index: ownIndex >= 0 ? ownIndex : list.length };
  }

  const found = list.findIndex((t) => t.id === taskIdFrom(overId));
  return { date, index: found < 0 ? list.length : found };
}
