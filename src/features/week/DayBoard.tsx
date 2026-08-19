import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { DayColumn } from "./DayColumn";
import { boardCollision } from "./collision";
import { TaskCardOverlay } from "./TaskCard";
import { BacklogColumn } from "../backlog/BacklogColumn";
import type { Category, Task, TaskPatch } from "../../lib/types";

interface Props {
  date: string;
  tasks: Task[];
  categoryMap: Map<number, Category>;
  categories: Category[];
  capacityTarget: number;
  capacityWarnRatio: number;
  onToggle: (task: Task) => void;
  onOpen?: (task: Task) => void;
  onPatch?: (id: number, patch: TaskPatch) => void;
  onMove: (id: number, date: string | null, position: number) => void;
  /** Clase del envoltorio de la columna del día: cada vista le da su ancho. */
  colClassName: string;
  /** Si viene, se dibuja el backlog como segunda columna y acepta drops. */
  backlog?: Task[];
  /** `taskId` → día del que vino, para el grupo de arriba del backlog. */
  rescued?: Map<number, string>;
}

/**
 * Un día como tablero arrastrable, opcionalmente con el backlog al lado.
 *
 * Existe porque Today y el ritual de planificación montaban **el mismo** cableado
 * de dnd-kit —sensores, `boardCollision`, el overlay y el cálculo del índice al
 * soltar— palabra por palabra. La vista semana **no** lo usa: ahí el
 * `DndContext` envuelve las siete columnas, que es lo que permite cruzar de día.
 *
 * Con `backlog`, arrastrar es la única forma de sacar algo del día o traerlo: el
 * gesto ya lleva la acción y la intención, así que no hay botones que digan lo
 * mismo.
 */
export function DayBoard({
  date,
  tasks,
  categoryMap,
  categories,
  capacityTarget,
  capacityWarnRatio,
  onToggle,
  onOpen,
  onPatch,
  onMove,
  colClassName,
  backlog,
  rescued,
}: Props) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeTask =
    activeId != null ? [...tasks, ...(backlog ?? [])].find((t) => t.id === activeId) : null;

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const carriedOver = Number(String(active.id).replace("task-", ""));
    // `date: null` es el backlog, y es un destino válido: no se puede tratar
    // como "no hay destino" (que es lo que hace la vista semana, donde no hay
    // ninguna columna sin fecha).
    const destino = over.data.current as
      | { type: "column" | "task"; date: string | null }
      | undefined;
    if (!destino) return;

    const list = destino.date == null ? (backlog ?? []) : tasks;
    let indice = list.length;
    if (destino.type === "task") {
      const encima = Number(String(over.id).replace("task-", ""));
      const found = list.findIndex((t) => t.id === encima);
      if (found >= 0) indice = found;
    } else {
      // Soltar sobre la columna es "al final", pero **solo si la card viene de
      // otra**. Reordenando dentro de la misma, la cascada de colisión resuelve a
      // veces la columna en vez de una card —pasa sobre el header y los
      // márgenes—, y ahí "al final" mandaba la tarea al fondo del día sin que
      // nadie lo hubiera pedido.
      const propio = list.findIndex((t) => t.id === carriedOver);
      if (propio >= 0) indice = propio;
    }
    onMove(carriedOver, destino.date, indice);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={boardCollision}
      onDragCancel={() => setActiveId(null)}
      onDragStart={(e: DragStartEvent) =>
        setActiveId(Number(String(e.active.id).replace("task-", "")))
      }
      onDragEnd={onDragEnd}
    >
      <div className={colClassName}>
        <DayColumn
          date={date}
          tasks={tasks}
          categoryMap={categoryMap}
          categories={categories}
          capacityTarget={capacityTarget}
          capacityWarnRatio={capacityWarnRatio}
          onToggle={onToggle}
          onOpen={onOpen}
          onPatch={onPatch}
        />
      </div>
      {backlog && (
        <div className={colClassName}>
          <BacklogColumn
            tasks={backlog}
            rescued={rescued}
            categoryMap={categoryMap}
            categories={categories}
            onToggle={onToggle}
            onOpen={onOpen}
            onPatch={onPatch}
          />
        </div>
      )}
      <DragOverlay dropAnimation={null}>
        {activeTask ? (
          <TaskCardOverlay
            task={activeTask}
            category={activeTask.categoryId != null ? categoryMap.get(activeTask.categoryId) : null}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
