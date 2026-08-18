import { useState } from "react";
import { DayBoard } from "../week/DayBoard";
import { TaskModal } from "../tasks/TaskModal";
import { useBoard } from "../tasks/useBoard";
import { dateLabel } from "../../lib/date";
import { useToday } from "../../lib/day";
import { useCapacitySettings, useWorkHours } from "../../lib/settings";
import { CalendarRail } from "../calendar/CalendarRail";
import { useTrabajoDelDia } from "../calendar/useTrabajoDelDia";

export function TodayView() {
  // `useToday` y no `todayISO()`: calculado al renderizar, una sesión abierta
  // cruzaba la medianoche y seguía mostrando ayer.
  const today = useToday();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const board = useBoard(today, today);
  const capacity = useCapacitySettings();
  const jornada = useWorkHours();
  const { trabajo, segundosEnCurso } = useTrabajoDelDia(today);

  const tasks = board.tasksByDate[today] ?? [];
  // Deriva de los datos frescos: así el modal refleja al instante lo guardado.
  const selectedTask =
    selectedId != null ? (board.tasks.find((t) => t.id === selectedId) ?? null) : null;

  return (
    <div className="today">
      <header className="week__toolbar">
        <div className="week__range">{dateLabel(today)}</div>
      </header>
      {/* El rail queda **fuera** del `DndContext`: es una columna de referencia
       * para planificar alrededor, no una zona de drop. Soltar ahí tendría que
       * escribir `scheduled_time`, y `boardCollision` está afinada para el
       * board. Recibe la misma lista que la columna del día, así las dos
       * lecturas del mismo día no pueden divergir. */}
      <div className="today__body">
        <DayBoard
          date={today}
          tasks={tasks}
          categoryMap={board.categoryMap}
          categories={board.categories}
          capacityTarget={capacity.target}
          capacityWarnRatio={capacity.warnRatio}
          onToggle={board.toggleTask}
          onOpen={(t) => setSelectedId(t.id)}
          onPatch={board.patchTask}
          onMove={board.moveTask}
          colClassName="today__col"
        />

        <CalendarRail
          date={today}
          today={today}
          tasks={tasks}
          categoryMap={board.categoryMap}
          workStart={jornada.start}
          workEnd={jornada.end}
          trabajo={trabajo}
          segundosEnCurso={segundosEnCurso}
          onOpen={(t) => setSelectedId(t.id)}
        />
      </div>

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          categories={board.categories}
          objectives={board.objectives}
          onClose={() => setSelectedId(null)}
          onChanged={board.reload}
        />
      )}
    </div>
  );
}
