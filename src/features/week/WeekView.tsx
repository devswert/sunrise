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
import { CalendarDays, ChevronLeft, ChevronRight, Inbox } from "lucide-react";
import { DayColumn } from "./DayColumn";
import { boardCollision } from "./collision";
import { resolveDrop, taskIdFrom, type DropData } from "./dropTarget";
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
import { usePanelPresence } from "./panelPresence";
import { BacklogPanel } from "../backlog/BacklogPanel";
import type { Task } from "../../lib/types";
import { useDayWork } from "../calendar/useTrabajoDelDia";

export function WeekView() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  /**
   * Qué panel de la tira está abierto, y por eso **uno solo**: los dos se montan
   * en el mismo lugar (`right: 44px`, 300px de ancho), así que dos abiertos se
   * apilarían uno sobre el otro.
   */
  const [panel, setPanel] = useState<"agenda" | "backlog" | null>(null);
  /**
   * Los paneles siguen montados mientras se van, para poder animar la salida —
   * ver `usePanelPresence`. Uno por panel y no uno compartido: al cambiar de la
   * agenda al backlog los dos están en pantalla durante la transición, el que se
   * va saliendo y el que llega entrando.
   */
  const agenda = usePanelPresence(panel === "agenda");
  const backlog = usePanelPresence(panel === "backlog");
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

  // Con el backlog: es la única vista que lo muestra al lado de las columnas, y
  // las tareas sin fecha tienen que estar en el mismo array que las del rango
  // para que el `DragOverlay` y el modal las encuentren (ver `useBoard`).
  const board = useBoard(dates[0], dates[dates.length - 1], start, true);
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

  // Escape cierra el panel, con dos excepciones:
  //
  // - **No si hay un modal abierto**: el de `TaskModal` escucha en `window` igual
  //   que este, y `preventDefault()` no frena a los demás listeners de la
  //   ventana — un solo Escape cerraría los dos.
  // - **No en medio de un arrastre.** El `PointerSensor` cancela el arrastre con
  //   Escape, y no hay forma de saberlo desde acá: sin este guard, un Escape
  //   cancelaría el arrastre *y* cerraría el panel, sacándole el piso a la card
  //   que estaba en vuelo.
  useEffect(() => {
    if (panel == null || selectedId != null || activeId != null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panel, selectedId, activeId]);

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
  /**
   * Deriva de los datos frescos: así el modal refleja al instante lo guardado.
   *
   * Pero **conserva el último conocido** cuando la tarea desaparece de las dos
   * listas, y eso no es paranoia: `list_backlog` filtra `status='TODO'`, así que
   * marcar como completada una tarea del backlog desde el modal la saca del array
   * y el modal **se cerraría solo en medio de una edición**. Con la tarea sin
   * fecha adentro del board, ese camino existe.
   */
  const lastSelected = useRef<Task | null>(null);
  const found =
    selectedId != null ? (board.tasks.find((t) => t.id === selectedId) ?? null) : null;
  if (selectedId == null) lastSelected.current = null;
  else if (found) lastSelected.current = found;
  const selectedTask = found ?? lastSelected.current;

  function onDragStart(e: DragStartEvent) {
    setActiveId(Number(String(e.active.id).replace("task-", "")));
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const id = taskIdFrom(active.id);
    // La decisión entera vive en `destino.ts`, que es lo que la hace testeable:
    // jsdom no devuelve rectángulos, así que el gesto se verifica en el browser,
    // pero los guards (el día plegado, el backlog→backlog, la card completada) se
    // fijan con tests.
    const target = resolveDrop({
      task: board.tasks.find((t) => t.id === id),
      overId: over.id,
      overData: over.data.current as DropData | undefined,
      tasksByDate: board.tasksByDate,
      isCollapsed,
    });
    if (!target) return;
    board.moveTask(id, target.date, target.index);
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
                      // Clickear la cabecera es un pedido de ver ese día, así
                      // que abre la agenda incluso si el backlog está abierto:
                      // dejarlo sin efecto visible sería peor que el cambio.
                      onPickDay={(day) => {
                        setDiaElegido(day);
                        setPanel("agenda");
                      }}
                      // Acotado a la agenda, o la cabecera quedaría marcada
                      // mientras se muestra el backlog.
                      isPicked={panel === "agenda" && d === diaDelRail}
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

          {/* **Adentro** del `DndContext`, y es el primero de la tira que lo
            * necesita: el panel es zona de drop en los dos sentidos. Los costos
            * de que además se superponga están escritos en `BacklogPanel`. */}
          {backlog.mounted && (
            <BacklogPanel
              leaving={backlog.leaving}
              tasks={board.backlogTasks}
              rescued={board.rescues}
              categoryMap={board.categoryMap}
              categories={board.categories}
              onToggle={board.toggleTask}
              onOpen={(t) => setSelectedId(t.id)}
              onPatch={board.patchTask}
              onClose={() => setPanel(null)}
            />
          )}
        </DndContext>

        {/* La agenda queda fuera del `DndContext`, y no por la frontera en sí:
         * lo que la hace no-droppable es no tener ningún `useDroppable`. Es
         * referencia, no zona de drop — arrastrar ahí tendría que escribir
         * `scheduled_time`. Abierta tapa la última columna, que por lo tanto no
         * recibe drops mientras esté visible; es aceptable porque se abre para
         * *consultar* a qué hora hay algo. Un rail que se corriera para dejar la
         * columna libre movería las siete de lugar cada vez que se abre. */}
        {agenda.mounted && (
          <CalendarRail
            className={`rail--overlay${agenda.leaving ? " is-leaving" : ""}`}
            date={diaDelRail}
            today={today}
            // La agenda y no la lista de la columna: los bloques que solo
            // ocupan el rail (§4.12) no son tarjetas, pero sí hay que verlos
            // para planificar alrededor.
            tasks={board.agendaByDate[diaDelRail] ?? []}
            categoryMap={board.categoryMap}
            workStart={workday.start}
            workEnd={workday.end}
            work={work}
            segundosEnCurso={segundosEnCurso}
            onOpen={(t) => setSelectedId(t.id)}
            onClose={() => setPanel(null)}
          />
        )}

        {/* La tira de iconos es permanente y no se superpone: los paneles se
         * abren a su izquierda. Falta el de objetivos de la semana, que sale con
         * M3.5 — el avance que muestra lo calcula la review.
         *
         * Abrir uno cierra el otro, y no es una preferencia: los dos se montan en
         * el mismo lugar. */}
        <SideDock
          items={[
            {
              id: "agenda",
              label: "Agenda",
              icon: <CalendarDays size={17} />,
              active: panel === "agenda",
              onToggle: () => setPanel((p) => (p === "agenda" ? null : "agenda")),
            },
            {
              id: "backlog",
              label: "Backlog",
              icon: <Inbox size={17} />,
              active: panel === "backlog",
              onToggle: () => setPanel((p) => (p === "backlog" ? null : "backlog")),
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
