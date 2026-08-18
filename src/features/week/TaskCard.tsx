import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Category, Task, TaskPatch } from "../../lib/types";
import { TaskCardContent } from "./TaskCardContent";
import { useTimerStore } from "../timer/timerStore";

interface TaskCardProps {
  task: Task;
  category: Category | null | undefined;
  categories?: Category[];
  onToggle: (task: Task) => void;
  onOpen?: (task: Task) => void;
  onPatch?: (id: number, patch: TaskPatch) => void;
}

export function TaskCard({
  task,
  category,
  categories,
  onToggle,
  onOpen,
  onPatch,
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `task-${task.id}`,
      data: { type: "task", taskId: task.id, date: task.scheduledDate },
    });

  const done = task.status === "DONE";
  const running = useTimerStore((s) => s.active?.taskId === task.id);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`task-card${done ? " is-done" : ""}${isDragging ? " is-dragging" : ""}${
        running ? " is-running" : ""
      }`}
      {...attributes}
      {...listeners}
      onClick={() => onOpen?.(task)}
    >
      <TaskCardContent
        task={task}
        category={category}
        categories={categories}
        onToggle={onToggle}
        onPatch={onPatch}
      />
    </div>
  );
}

/**
 * La misma card, sin arrastre. Para listas que no son un día del tablero —el
 * repaso del día anterior—, donde soltar no significaría nada pero la card
 * **tiene** que verse igual: es la UI base de una tarea en toda la app.
 */
export function TaskCardStatic({
  task,
  category,
  categories,
  onToggle,
  onOpen,
  onPatch,
}: TaskCardProps) {
  const done = task.status === "DONE";
  return (
    <div className={`task-card${done ? " is-done" : ""}`} onClick={() => onOpen?.(task)}>
      <TaskCardContent
        task={task}
        category={category}
        categories={categories}
        onToggle={onToggle}
        onPatch={onPatch}
      />
    </div>
  );
}

/** Card no interactiva para el DragOverlay (preview inclinado). */
export function TaskCardOverlay({
  task,
  category,
}: {
  task: Task;
  category: Category | null | undefined;
}) {
  return (
    <div className={`task-card is-overlay${task.status === "DONE" ? " is-done" : ""}`}>
      <TaskCardContent task={task} category={category} />
    </div>
  );
}
