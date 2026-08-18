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
  rescatadas?: Map<number, string>;
  categoryMap: Map<number, Category>;
  categories: Category[];
  onToggle: (task: Task) => void;
  onOpen?: (task: Task) => void;
  onPatch?: (id: number, patch: TaskPatch) => void;
}

/** Si esa tarea (existe y) viene de un día. Tolera el `tasks[i - 1]` del borde. */
function vieneDeUnDia(rescatadas: Map<number, string> | undefined, t: Task | undefined): boolean {
  return t != null && rescatadas != null && rescatadas.has(t.id);
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
  rescatadas,
  categoryMap,
  categories,
  onToggle,
  onOpen,
  onPatch,
}: Props) {
  const openCompose = useAppStore((s) => s.openCompose);
  const { setNodeRef, isOver } = useDroppable({
    id: "col-backlog",
    data: { type: "column", date: null },
  });

  return (
    <section ref={setNodeRef} className={`day-col${isOver ? " is-over" : ""}`}>
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
              {vieneDeUnDia(rescatadas, t) && !vieneDeUnDia(rescatadas, tasks[i - 1]) && (
                <div className="col-grupo">
                  <CalendarClock size={12} aria-hidden /> Venían de un día
                </div>
              )}
              {!vieneDeUnDia(rescatadas, t) && vieneDeUnDia(rescatadas, tasks[i - 1]) && (
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
              {vieneDeUnDia(rescatadas, t) && (
                <span className="col-desde">desde el {shortDate(rescatadas!.get(t.id)!)}</span>
              )}
            </div>
          ))}
        </SortableContext>
      </div>
    </section>
  );
}
