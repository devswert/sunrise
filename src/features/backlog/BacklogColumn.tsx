import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
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

/**
 * El día del que vino esa tarea, o `null` si la guardaste a propósito. Tolera el
 * `tasks[i - 1]` del borde.
 *
 * Devuelve el **valor** y no un booleano de la clave: un mapa con la clave puesta
 * y la fecha en `undefined` hacía que `has()` dijera que sí y que el formateo de
 * fecha recibiera nada, y eso tumbaba la vista entera (pantalla en blanco).
 */
function diaDeOrigen(
  rescued: Map<number, string> | undefined,
  t: Task | undefined,
): string | null {
  return (t != null && rescued?.get(t.id)) || null;
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
    ((active?.data.current as { date?: string | null } | undefined)?.date ??
      null) === null;

  return (
    <section
      ref={setNodeRef}
      className={`day-col${isOver && !yaEstaAca ? " is-over" : ""}`}
    >
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
        <button
          className="add-task"
          onClick={() => openCompose({ date: null })}
        >
          <Plus size={14} aria-hidden />
          <span className="add-task__label">Agregar al backlog</span>
        </button>
      </div>

      <div className="day-col__list">
        <SortableContext
          items={tasks.map((t) => `task-${t.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((t, i) => {
            const desde = diaDeOrigen(rescued, t);
            const desdeAnterior = diaDeOrigen(rescued, tasks[i - 1]);
            return (
              <div key={t.id}>
                {/* La fecha va **una vez, en el rótulo del grupo**, y no repetida
                 * bajo cada card: es lo que uno compara, y con varias tareas de
                 * días distintos eran N fechas sueltas colgando entre las cards.
                 *
                 * El rótulo va **dentro** de la lista y no arriba: partir el
                 * `SortableContext` en uno por día rompería el arrastre entre
                 * grupos. Y por lo mismo el orden sigue siendo el de `position`,
                 * no la fecha: un día vuelve a rotular si el orden lo intercala,
                 * y eso es mejor que reordenar por debajo lo que acabas de mover
                 * a mano. Mandar algo al backlog lo pone primero, así que en el
                 * caso normal cada día sale una sola vez. */}
                {desde && desde !== desdeAnterior && (
                  <div className="col-grupo">
                    <CalendarClock size={12} aria-hidden /> Desde el{" "}
                    {shortDate(desde)}
                  </div>
                )}
                {!desde && desdeAnterior && (
                  <div className="col-grupo">Guardadas</div>
                )}
                <TaskCard
                  task={t}
                  category={
                    t.categoryId != null ? categoryMap.get(t.categoryId) : null
                  }
                  categories={categories}
                  onToggle={onToggle}
                  onOpen={onOpen}
                  onPatch={onPatch}
                />
              </div>
            );
          })}
        </SortableContext>
      </div>
    </section>
  );
}
