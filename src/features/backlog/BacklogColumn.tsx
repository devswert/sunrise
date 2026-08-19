import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CalendarClock, Inbox, Plus } from "lucide-react";
import { shortDate } from "../../lib/date";
import type { Category, Task, TaskPatch } from "../../lib/types";
import { TaskCard } from "../week/TaskCard";
import { useAppStore } from "../../lib/store";

interface Props {
  tasks: Task[];
  /** `taskId` → día del que vino, para el grupo de arriba. */
  rescued?: Map<number, string>;
  categoryMap: Map<number, Category>;
  categories: Category[];
  onToggle: (task: Task) => void;
  onOpen?: (task: Task) => void;
  onPatch?: (id: number, patch: TaskPatch) => void;
}

/** Si esa tarea (existe y) viene de un día. Tolera el `tasks[i - 1]` del borde. */
function vieneDeUnDia(rescued: Map<number, string> | undefined, t: Task | undefined): boolean {
  return t != null && rescued != null && rescued.has(t.id);
}

/**
 * El backlog como **columna del tablero**: misma card, misma caja, y zona de
 * drop en los dos sentidos.
 *
 * `scheduled_date IS NULL` es lo único que define el backlog (§3.2), así que
 * sacar algo del día es soltarlo acá y meterlo es soltarlo en el día. Por eso la
 * columna reusa `{ type: "column", date: null }`: el `onDragEnd` que ya
 * distingue columna de tarea no necesita saber que ésta es especial.
 */
export function BacklogColumn({
  tasks,
  rescued,
  categoryMap,
  categories,
  onToggle,
  onOpen,
  onPatch,
}: Props) {
  const openCompose = useAppStore((s) => s.openCompose);
  const { setNodeRef, isOver, active } = useDroppable({
    id: "col-backlog",
    data: { type: "column", date: null },
  });

  // Misma regla que las columnas de día: no se ilumina cuando la card ya está
  // acá, o reordenar dentro del backlog prende y apaga el marco sin que nada se
  // esté moviendo de lista.
  const yaEstaAca =
    ((active?.data.current as { date?: string | null } | undefined)?.date ?? null) === null;

  return (
    <section ref={setNodeRef} className={`day-col${isOver && !yaEstaAca ? " is-over" : ""}`}>
      {/* Mismo slot vacío que las columnas del día: sin él las listas de al lado
       * arrancan a distinta altura. */}
      <div className="day-progress-slot" />

      <header className="day-col__head">
        <span className="day-col__weekday">
          <Inbox size={13} aria-hidden /> Backlog
        </span>
        <span className="day-col__date">
          {tasks.length} {tasks.length === 1 ? "pendiente" : "pendientes"}
        </span>
      </header>

      <div className="day-col__actions">
        <button className="add-task" onClick={() => openCompose({ date: null })}>
          <Plus size={14} aria-hidden />
          <span className="add-task__label">Agregar al backlog</span>
        </button>
      </div>

      <div className="day-col__list">
        <SortableContext
          items={tasks.map((t) => `task-${t.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((t, i) => (
            <div key={t.id}>
              {/* El rótulo va **dentro** de la lista y no arriba: partir el
               * `SortableContext` en dos rompería el arrastre entre grupos, y
               * mandar algo al backlog lo pone en primera posición, así que los
               * rescates ya vienen juntos al principio. */}
              {vieneDeUnDia(rescued, t) && !vieneDeUnDia(rescued, tasks[i - 1]) && (
                <div className="col-grupo">
                  <CalendarClock size={12} aria-hidden /> Venían de un día
                </div>
              )}
              {!vieneDeUnDia(rescued, t) && vieneDeUnDia(rescued, tasks[i - 1]) && (
                <div className="col-grupo">Guardadas</div>
              )}
              <TaskCard
                task={t}
                category={t.categoryId != null ? categoryMap.get(t.categoryId) : null}
                categories={categories}
                onToggle={onToggle}
                onOpen={onOpen}
                onPatch={onPatch}
              />
              {vieneDeUnDia(rescued, t) && (
                <span className="col-desde">desde el {shortDate(rescued!.get(t.id)!)}</span>
              )}
            </div>
          ))}
        </SortableContext>
      </div>
    </section>
  );
}
