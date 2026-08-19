import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowUpDown, Plus } from "lucide-react";
import type { Category, Task, TaskPatch } from "../../lib/types";
import { TaskCard } from "./TaskCard";
import { computeCapacityLevel, formatMinutes } from "../../lib/capacity";
import { CapacityLevel } from "../../lib/enums";
import { dateLabel, isToday, weekdayLabel } from "../../lib/date";
import { useAppStore } from "../../lib/store";

interface DayColumnProps {
  date: string;
  tasks: Task[];
  categoryMap: Map<number, Category>;
  categories: Category[];
  capacityTarget: number;
  capacityWarnRatio: number;
  onToggle: (task: Task) => void;
  onOpen?: (task: Task) => void;
  onPatch?: (id: number, patch: TaskPatch) => void;
  /** Si viene, la cabecera del día es clickeable (la usa el rail de la semana). */
  onPickDay?: (date: string) => void;
  /** El día que el rail está mostrando ahora mismo. */
  isPicked?: boolean;
}

const LEVEL_CLASS: Record<CapacityLevel, string> = {
  [CapacityLevel.OK]: "cap--ok",
  [CapacityLevel.WARN]: "cap--warn",
  [CapacityLevel.OVER]: "cap--over",
};

export function DayColumn({
  date,
  tasks,
  categoryMap,
  categories,
  capacityTarget,
  capacityWarnRatio,
  onToggle,
  onOpen,
  onPatch,
  onPickDay,
  isPicked = false,
}: DayColumnProps) {
  const openCompose = useAppStore((s) => s.openCompose);
  // Toda la columna es zona de drop (no solo la lista), para que el arrastre
  // funcione igual en la mitad superior.
  const { setNodeRef, isOver, active } = useDroppable({
    id: `day-${date}`,
    data: { type: "column", date },
  });

  // La columna se ilumina solo si la card viene de **otro** día. Reordenando
  // dentro del mismo, la cascada de colisión resuelve a veces la columna en vez
  // de una card, y el marco prendía y apagaba anunciando un movimiento que no
  // estaba pasando.
  const deOtroDia = (active?.data.current as { date?: string | null } | undefined)?.date !== date;
  const resaltar = isOver && deOtroDia;

  const plannedTotal = tasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  const level = computeCapacityLevel(plannedTotal, capacityTarget, capacityWarnRatio);
  const today = isToday(date);

  // Progreso del día: minutos planificados ya completados (o conteo si no hay estimados).
  const doneTasks = tasks.filter((t) => t.status === "DONE");
  const donePlanned = doneTasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  const progress =
    plannedTotal > 0
      ? Math.round((donePlanned / plannedTotal) * 100)
      : tasks.length
        ? Math.round((doneTasks.length / tasks.length) * 100)
        : 0;

  return (
    <section
      ref={setNodeRef}
      className={`day-col${today ? " is-today" : ""}${resaltar ? " is-over" : ""}`}
    >
      {/* Slot de altura fija en todas las columnas (va ARRIBA del nombre del día):
       * mantiene las listas alineadas aunque la barra solo se pinte en hoy. */}
      <div className="day-progress-slot">
        {today && (
          <div className="day-progress" title={`${progress}% del día completado`}>
            <div className="day-progress__bar">
              <div className="day-progress__fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="day-progress__label">
              {doneTasks.length}/{tasks.length} · {progress}%
            </span>
          </div>
        )}
      </div>

      {/* La cabecera es el selector del día que muestra el rail. Va acá y no en
       * la lista porque la lista es la zona de drop del board: un click ahí
       * competiría con el arrastre. El `<button>` solo aparece cuando alguien
       * ofrece `onPickDay`, así que en Today y en el backlog no hay nada nuevo
       * que tabular. */}
      <header className={`day-col__head${isPicked ? " is-picked" : ""}`}>
        {onPickDay ? (
          <button
            type="button"
            className="day-col__pick"
            aria-pressed={isPicked}
            aria-label={`Ver ${weekdayLabel(date)} en la agenda`}
            onClick={() => onPickDay(date)}
          >
            <span className="day-col__weekday">{weekdayLabel(date)}</span>
          </button>
        ) : (
          <span className="day-col__weekday">{weekdayLabel(date)}</span>
        )}
        <span className="day-col__date">{dateLabel(date)}</span>
      </header>

      <div className="day-col__actions">
        <button className="add-task" onClick={() => openCompose({ date })}>
          <Plus size={14} aria-hidden />
          <span className="add-task__label">Agregar tarea</span>
        </button>
        <ArrowUpDown size={13} className="day-col__sort" aria-hidden />
        {plannedTotal > 0 && (
          <span className={`day-col__cap ${LEVEL_CLASS[level]}`}>
            {formatMinutes(plannedTotal)}
          </span>
        )}
      </div>

      <div className="day-col__list">
        <SortableContext
          items={tasks.map((t) => `task-${t.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((t) => (
            <TaskCard
              key={t.id}
              task={t}
              category={t.categoryId != null ? categoryMap.get(t.categoryId) : null}
              categories={categories}
              onToggle={onToggle}
              onOpen={onOpen}
              onPatch={onPatch}
            />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}
