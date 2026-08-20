import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import {
  dateLabel,
  isoWeekday,
  isoWeekId,
  parseISODate,
  shiftWeeks,
  threeWeeks,
  weekDates,
} from "../../lib/date";
import { useToday } from "../../lib/day";
import { useCapacitySettings, useCollapsedWeekdays, useWorkHours } from "../../lib/settings";
import { anchorAfterDayChange, scrollDelta } from "./anchor";
import { SyncButton } from "../calendar/SyncButton";
import { CalendarRail } from "../calendar/CalendarRail";
import { SideDock } from "./SideDock";
import { useDayWork } from "../calendar/useTrabajoDelDia";

export function WeekView() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [railAbierto, setRailAbierto] = useState(false);
  /**
   * Dos arreglos y no uno, porque el board dejó de ser una semana:
   *
   * - `anchorWeek` son los 7 días del ancla. Es la semana **de referencia**: la que
   *   nombra la barra de arriba, la que es dueña de los objetivos, y donde se
   *   posiciona el scroll.
   * - `weeks` son los tres bloques, y `dates` las 21 columnas planas.
   *
   * Confundirlos es el error fácil: `dates[0]` es un lunes de dos semanas atrás,
   * así que todo lo que signifique "la semana en que estoy" va contra `anchorWeek`.
   */
  const anchorWeek = useMemo(() => weekDates(anchor), [anchor]);
  const weeks = useMemo(() => threeWeeks(anchor), [anchor]);
  const dates = useMemo(() => weeks.flat(), [weeks]);

  // El ancla se fija al montar, así que una sesión abierta que cruza un domingo
  // seguía mostrando la semana pasada. Sigue al día solo si corresponde: ver
  // `anchorAfterDayChange`.
  const today = useToday();
  const hoyPrevio = useRef(today);
  useEffect(() => {
    if (hoyPrevio.current === today) return;
    const previo = hoyPrevio.current;
    hoyPrevio.current = today;
    // Contra `anchorWeek` y no contra `dates`: la pregunta es si el día nuevo salió
    // de la semana de referencia. Con las 21 fechas, despertar el lunes
    // siguiente caería "dentro de lo visible" y el ancla no se movería — los
    // objetivos y el scroll seguirían en la semana pasada.
    const fresh = anchorAfterDayChange(anchorWeek, previo, today);
    if (fresh) setAnchor(fresh);
  }, [today, anchorWeek]);
  // El lunes del ancla: la semana de los objetivos y la columna donde aterriza
  // el scroll. El domingo ya no hace falta acá, el rótulo lo saca de su semana.
  const start = anchorWeek[0];

  const board = useBoard(dates[0], dates[dates.length - 1], start);
  const capacity = useCapacitySettings();
  const workday = useWorkHours();

  // El rail muestra un día, y de fábrica es hoy —o el lunes, si la semana que
  // miras no lo contiene—. Clickear la cabecera de otra columna lo cambia, que
  // es lo que permite proyectar el trabajo de un día que todavía no llega.
  const porDefecto = anchorWeek.includes(today) ? today : start;
  const [diaElegido, setDiaElegido] = useState<string | null>(null);
  // Al cambiar de semana la elección deja de tener sentido: el día elegido ya no
  // está en pantalla y el rail mostraría algo que no se ve en ninguna columna.
  const diaDelRail = diaElegido != null && dates.includes(diaElegido) ? diaElegido : porDefecto;
  const { work, segundosEnCurso } = useDayWork(diaDelRail);

  /**
   * Los días plegados salen de Configs (números ISO), con dos excepciones:
   *
   * - **Hoy nunca se pliega.** Si el ajuste trae el sábado y hoy es sábado, la
   *   vista esconde el día en el que estás trabajando. El ajuste dice qué días
   *   suelen estar vacíos, no que hoy no importe.
   * - **Lo que abriste a mano queda abierto** mientras dure la sesión. Es la
   *   salida para el día plegado que sí tiene tareas; no se guarda, porque es una
   *   ojeada y no un cambio de configuración.
   */
  const collapsedWeekdays = useCollapsedWeekdays();
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  /** El ajuste lo pliega, así que la columna puede ofrecer abrir y volver a plegar. */
  const isFoldable = (d: string) => collapsedWeekdays.includes(isoWeekday(d)) && d !== today;
  const isCollapsed = (d: string) => isFoldable(d) && !unfolded.has(d);

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

  /**
   * Dónde queda parado el scroll. Dos objetivos, y la condición entre ellos es lo
   * que evita pelearse con la navegación:
   *
   * - **Hoy al centro**, cuando hoy cae en la semana del ancla. Es lo que se
   *   quiere al entrar: con el lunes pegado al borde izquierdo, hoy queda en la
   *   mitad izquierda y media pantalla se la lleva la semana que ya pasó.
   * - **El lunes del ancla al borde**, cuando no.
   *
   * La condición es contra la semana del ancla y **no contra las 21 fechas**: al
   * apretar "semana siguiente", hoy sigue estando en la ventana —pasa a ser la
   * semana anterior—, así que centrarlo scrollearía de vuelta y la flecha no
   * haría nada.
   *
   * Corre **al montar, al cambiar de semana y al cambiar el día**, y no con cada
   * invalidación de datos: si ya scrolleaste a propósito, que la vista se
   * recoloque sola al guardar una tarea sería pelear contigo. `recenter` es un
   * contador y no un booleano porque "Hoy" tiene que reposicionar aunque el ancla
   * ya sea la de hoy: sin él, apretarlo después de scrollear a mano no hacía nada.
   *
   * El cálculo vive en `scrollDelta` porque es la única parte testeable: jsdom no
   * implementa `scrollLeft` ni devuelve rectángulos.
   */
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [recenter, setRecenter] = useState(0);
  useLayoutEffect(() => {
    const board = boardRef.current;
    const center = anchorWeek.includes(today);
    // Por `data-date` y no por un ref en la columna: la sección ya tiene el ref
    // del droppable de dnd-kit, y componer dos sobre el mismo nodo se rompe en
    // silencio. Buscar la fecha además dice qué se está buscando.
    const col = board?.querySelector<HTMLElement>(`[data-date="${center ? today : start}"]`);
    if (!board || !col) return;
    const rect = col.getBoundingClientRect();
    board.scrollLeft += scrollDelta({
      colLeft: rect.left,
      colWidth: rect.width,
      boardLeft: board.getBoundingClientRect().left,
      boardWidth: board.clientWidth,
      center,
    });
  }, [start, recenter, today, anchorWeek]);

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
      const list = targetDate ? (board.tasksByDate[targetDate] ?? []) : [];
      // Al final de la columna destino, salvo que la card ya esté en ella: la
      // cascada de colisión resuelve la columna en vez de una card al pasar por
      // el header o los márgenes, y ahí "al final" era un movimiento inventado.
      const propio = list.findIndex((t) => t.id === activeIdNum);
      index = propio >= 0 ? propio : list.length;
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
    // A un día plegado no: no tiene ref de droppable, así que no debería llegar,
    // pero la cascada de colisión tiene un fallback por esquina más cercana que
    // no distingue. **A un día pasado sí** — ver el comentario del `useDroppable`
    // en `DayColumn`.
    if (isCollapsed(targetDate)) return;
    board.moveTask(activeIdNum, targetDate, index);
  }

  return (
    <div className="week">
      {/* El rango ya no vive acá: cada semana lleva el suyo pegado a la
       * izquierda, dentro del board (ver `.board__wk-head`). Un rótulo fijo
       * arriba nombraría una semana que puede no estar en pantalla. */}
      <header className="week__toolbar">
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
          <button
            className="btn-ghost"
            onClick={() => {
              setAnchor(new Date());
              setRecenter((n) => n + 1);
            }}
          >
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
          {/* Una semana es un bloque, no siete columnas sueltas: es lo que le
           * da al rótulo un contenedor donde pegarse —entra a la izquierda y lo
           * empuja el que sigue— y lo que pone el corte de semana en un solo
           * lugar en vez de en la primera columna de cada tanda. */}
          <div className="board" ref={boardRef}>
            {weeks.map((week) => (
              <section className="board__wk" key={week[0]}>
                <header className="board__wk-head">
                  <span className="board__wk-range">
                    {dateLabel(week[0])} – {dateLabel(week[6])}
                  </span>
                  <span className="week__isoweek">
                    Semana {isoWeekId(parseISODate(week[0])).split("-W")[1]} ·{" "}
                    {isoWeekId(parseISODate(week[0])).split("-W")[0]}
                  </span>
                </header>
                <div className="board__wk-days">
                  {week.map((d) => (
                    <DayColumn
                      key={d}
                      date={d}
                      isPast={d < today}
                      collapsed={isCollapsed(d)}
                      onExpand={(day) => setUnfolded((prev) => new Set(prev).add(day))}
                      // Solo en un día plegable que está abierto a mano: en el
                      // resto no hay nada que plegar y el botón sobraría.
                      onCollapse={
                        isFoldable(d) && unfolded.has(d)
                          ? (day) =>
                              setUnfolded((prev) => {
                                const next = new Set(prev);
                                next.delete(day);
                                return next;
                              })
                          : undefined
                      }
                      tasks={board.tasksByDate[d] ?? []}
                      categoryMap={board.categoryMap}
                      categories={board.categories}
                      capacityTarget={capacity.target}
                      capacityWarnRatio={capacity.warnRatio}
                      onToggle={board.toggleTask}
                      onOpen={(t) => setSelectedId(t.id)}
                      onPatch={board.patchTask}
                      onPickDay={(day) => {
                        setDiaElegido(day);
                        setRailAbierto(true);
                      }}
                      isPicked={railAbierto && d === diaDelRail}
                    />
                  ))}
                </div>
              </section>
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
