import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ChevronsRightLeft, Plus } from "lucide-react";
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
  /**
   * Es un día ya pasado. **Solo cambia cómo se ve** —la columna va atenuada—: sí
   * recibe cards. Ver el comentario del `useDroppable`.
   */
  isPast?: boolean;
  /**
   * Se dibuja como una tira angosta con el día en vertical. No recibe drops y no
   * muestra sus cards; `onExpand` la abre.
   */
  collapsed?: boolean;
  /** Abre una columna colapsada. Solo se ofrece si `collapsed`. */
  onExpand?: (date: string) => void;
  /**
   * Vuelve a plegarla. **Solo viene en un día plegable que se abrió a mano**: en
   * un día normal el botón no tendría sentido, porque plegar es del ajuste y no
   * de la columna.
   */
  onCollapse?: (date: string) => void;
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
  isPast = false,
  collapsed = false,
  onExpand,
  onCollapse,
}: DayColumnProps) {
  const openCompose = useAppStore((s) => s.openCompose);
  // Toda la columna es zona de drop (no solo la lista), para que el arrastre
  // funcione igual en la mitad superior.
  //
  // **Un día pasado sí las acepta**, y eso se decidió a conciencia. Una pendiente
  // soltada muy atrás se va al backlog en la próxima degradación (SPECS §4.2),
  // pero eso es visible y documentado —aparece con su rótulo "Desde el X"— y
  // bloquear el gesto sacaba algo que se podía hacer navegando a la semana
  // anterior. Lo que sí queda apagado es el día plegado: ahí la columna no
  // muestra sus cards, así que un drop no tendría dónde aterrizar.
  const { setNodeRef, isOver, active } = useDroppable({
    id: `day-${date}`,
    data: { type: "column", date },
    disabled: collapsed,
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

  /**
   * Colapsada: una tira con el nombre del día en vertical.
   *
   * **No se esconde el trabajo.** Si el día tiene tareas se dibuja su cuenta, y
   * el click abre la columna: un día plegado con tres cosas adentro que no
   * dijera nada sería una forma de perder tareas de vista sin manera de
   * recuperarlas desde acá.
   */
  if (collapsed) {
    return (
      <section
        data-date={date}
        className={`day-col day-col--collapsed${today ? " is-today" : ""}${
          isPast ? " is-past" : ""
        }`}
      >
        <button
          type="button"
          className="day-col__unfold"
          aria-label={`Abrir ${weekdayLabel(date)} ${dateLabel(date)}`}
          onClick={() => onExpand?.(date)}
        >
          <span className="day-col__unfold-countame">{weekdayLabel(date)}</span>
          {tasks.length > 0 && <span className="day-col__unfold-count">{tasks.length}</span>}
        </button>
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      data-date={date}
      className={`day-col${today ? " is-today" : ""}${resaltar ? " is-over" : ""}${
        isPast ? " is-past" : ""
      }`}
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
        {/* La fecha y el botón de plegar van agrupados a la derecha, no como dos
         * hijos más del `space-between`: si no, la fecha se corría al centro al
         * aparecer el botón y el día se movía de lugar al abrirlo. */}
        <span className="day-col__head-end">
          <span className="day-col__date">{dateLabel(date)}</span>
          {onCollapse && (
            <button
              type="button"
              className="day-col__fold"
              title="Volver a plegar este día"
              aria-label={`Plegar ${weekdayLabel(date)}`}
              onClick={() => onCollapse(date)}
            >
              <ChevronsRightLeft size={12} aria-hidden />
            </button>
          )}
        </span>
      </header>

      <div className="day-col__actions">
        <button className="add-task" onClick={() => openCompose({ date })}>
          <Plus size={14} aria-hidden />
          <span className="add-task__label">Agregar tarea</span>
        </button>
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
