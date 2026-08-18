import { useEffect, useMemo, useRef, useState } from "react";
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
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { DayColumn } from "./DayColumn";
import { boardCollision } from "./collision";
import { TaskCardOverlay } from "./TaskCard";
import { TaskModal } from "../tasks/TaskModal";
import { useBoard } from "../tasks/useBoard";
import { dateLabel, isoWeekId, parseISODate, shiftWeeks, weekDates } from "../../lib/date";
import { useToday } from "../../lib/day";
import { useCapacitySettings, useWorkHours } from "../../lib/settings";
import { anchorAfterDayChange } from "./anchor";
import { SyncButton } from "../calendar/SyncButton";
import { CalendarRail } from "../calendar/CalendarRail";
import { SideDock } from "./SideDock";
import { useDayWork } from "../calendar/useTrabajoDelDia";

export function WeekView() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [railAbierto, setRailAbierto] = useState(false);
  const dates = useMemo(() => weekDates(anchor), [anchor]);

  // El ancla se fija al montar, así que una sesión abierta que cruza un domingo
  // seguía mostrando la semana pasada. Sigue al día solo si corresponde: ver
  // `anchorAfterDayChange`.
  const today = useToday();
  const hoyPrevio = useRef(today);
  useEffect(() => {
    if (hoyPrevio.current === today) return;
    const previo = hoyPrevio.current;
    hoyPrevio.current = today;
    const fresh = anchorAfterDayChange(dates, previo, today);
    if (fresh) setAnchor(fresh);
  }, [today, dates]);
  const start = dates[0];
  const end = dates[6];

  const board = useBoard(start, end);
  const capacity = useCapacitySettings();
  const workday = useWorkHours();

  // El rail muestra un día, y de fábrica es hoy —o el lunes, si la semana que
  // miras no lo contiene—. Clickear la cabecera de otra columna lo cambia, que
  // es lo que permite proyectar el trabajo de un día que todavía no llega.
  const porDefecto = dates.includes(today) ? today : dates[0];
  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  // Al cambiar de semana la elección deja de tener sentido: el día elegido ya no
  // está en pantalla y el rail mostraría algo que no se ve en ninguna columna.
  const diaDelRail = diaElegido != null && dates.includes(diaElegido) ? diaElegido : porDefecto;
  const { work, segundosEnCurso } = useDayWork(diaDelRail);

  // Escape cierra el rail, pero **no si hay un modal abierto**: el de `TaskModal`
  // escucha en `window` igual que este, y `preventDefault()` no frena a los
  // demás listeners de la ventana — un solo Escape cerraría los dos.
  useEffect(() => {
    if (!railAbierto || selectedId != null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRailAbierto(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [railAbierto, selectedId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeTask = activeId != null ? board.tasks.find((t) => t.id === activeId) : null;
  // Deriva de los datos frescos: así el modal refleja al instante lo guardado.
  const selectedTask =
    selectedId != null ? (board.tasks.find((t) => t.id === selectedId) ?? null) : null;

  function onDragStart(e: DragStartEvent) {
    setActiveId(Number(String(e.active.id).replace("task-", "")));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const activeIdNum = Number(String(active.id).replace("task-", ""));
    const overData = over.data.current as
      { type: "column" | "task"; date: string | null } | undefined;

    let targetDate: string | null;
    let index: number;

    if (overData?.type === "column") {
      targetDate = overData.date;
      index = targetDate ? (board.tasksByDate[targetDate]?.length ?? 0) : 0;
    } else if (overData?.type === "task") {
      targetDate = overData.date;
      const list = targetDate ? (board.tasksByDate[targetDate] ?? []) : [];
      const overId = Number(String(over.id).replace("task-", ""));
      const found = list.findIndex((t) => t.id === overId);
      index = found < 0 ? list.length : found;
    } else {
      return;
    }

    if (targetDate == null) return;
    board.moveTask(activeIdNum, targetDate, index);
  }

  return (
    <div className="week">
      <header className="week__toolbar">
        <div className="week__range">
          {dateLabel(start)} – {dateLabel(end)}
          <span className="week__isoweek">
            Semana {isoWeekId(parseISODate(start)).split("-W")[1]} ·{" "}
            {isoWeekId(parseISODate(start)).split("-W")[0]}
          </span>
        </div>
        <div className="week__nav">
          {/* Comparte estado con el de Configs: si uno corre, el otro se
           * bloquea y los dos muestran la misma antigüedad. */}
          <SyncButton />
          <button
            className="btn-ghost"
            onClick={() => setAnchor((a) => shiftWeeks(a, -1))}
            aria-label="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <button className="btn-ghost" onClick={() => setAnchor(new Date())}>
            Hoy
          </button>
          <button
            className="btn-ghost"
            onClick={() => setAnchor((a) => shiftWeeks(a, 1))}
            aria-label="Semana siguiente"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </header>

      {/* El panel va acá dentro y no en `.board`: el board tiene scroll
       * horizontal, así que un absoluto colgado de él se iría de pantalla al
       * desplazar las columnas. Y va debajo de la barra de arriba, no sobre
       * ella, o taparía los controles de navegación. */}
      <div className="week__body">
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollision}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="board">
            {dates.map((d) => (
              <DayColumn
                key={d}
                date={d}
                tasks={board.tasksByDate[d] ?? []}
                categoryMap={board.categoryMap}
                categories={board.categories}
                capacityTarget={capacity.target}
                capacityWarnRatio={capacity.warnRatio}
                onToggle={board.toggleTask}
                onOpen={(t) => setSelectedId(t.id)}
                onPatch={board.patchTask}
                onPickDay={(d) => {
                  setDiaElegido(d);
                  setRailAbierto(true);
                }}
                isPicked={railAbierto && d === diaDelRail}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {activeTask ? (
              <TaskCardOverlay
                task={activeTask}
                category={
                  activeTask.categoryId != null
                    ? board.categoryMap.get(activeTask.categoryId)
                    : null
                }
              />
            ) : null}
          </DragOverlay>
        </DndContext>

        {/* Fuera del `DndContext`, como en Today: es referencia, no zona de
         * drop. Abierto tapa la última columna, que por lo tanto no recibe drops
         * mientras esté visible. Es aceptable porque la agenda se abre para
         * *consultar* a qué hora hay algo, no para arrastrar: se cierra y se
         * arrastra. Un rail que se corriera para dejar la columna libre movería
         * las siete de lugar cada vez que se abre. */}
        {railAbierto && (
          <CalendarRail
            className="rail--overlay"
            date={diaDelRail}
            today={today}
            tasks={board.tasksByDate[diaDelRail] ?? []}
            categoryMap={board.categoryMap}
            workStart={workday.start}
            workEnd={workday.end}
            work={work}
            segundosEnCurso={segundosEnCurso}
            onOpen={(t) => setSelectedId(t.id)}
            onClose={() => setRailAbierto(false)}
          />
        )}

        {/* La tira de iconos es permanente y no se superpone: los paneles se
         * abren a su izquierda. Por ahora tiene un solo botón — objetivos de la
         * semana y backlog llegan con sus milestones. */}
        <SideDock
          items={[
            {
              id: "agenda",
              label: "Agenda",
              icon: <CalendarDays size={17} />,
              active: railAbierto,
              onToggle: () => setRailAbierto((v) => !v),
            },
          ]}
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
