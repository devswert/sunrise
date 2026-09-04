import { useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Clock, Flag, Hash, Pause, Play } from "lucide-react";
import type { Category, Task, TaskPatch } from "../../lib/types";
import { chipVars } from "../tasks/chipVars";
import { formatMinutes } from "../../lib/capacity";
import { SearchSelect } from "../../components/SearchSelect";
import { channelOptions } from "../tasks/channelOptions";
import { PriorityTag } from "../tasks/PriorityTag";
import { TimePicker } from "../../components/TimePicker";
import { Popover } from "../../components/Popover";
import { useTimer, hms } from "../timer/useTimer";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../lib/store";
import { usePrioritiesOn } from "../../lib/settings";

interface Props {
  task: Task;
  category: Category | null | undefined;
  categories?: Category[];
  onToggle?: (task: Task) => void;
  onPatch?: (id: number, patch: TaskPatch) => void;
  /**
   * Esconde los **rellenos de los campos vacíos**: el badge `--:--` cuando no hay
   * ningún tiempo, y el chip `#` cuando no hay canal.
   *
   * Existe por el backlog: ahí la mayoría de las tareas todavía no tiene ni
   * estimado ni canal, así que las cards se llenaban de marcas de posición
   * —guiones donde deberían ir números, y un numeral suelto que a 12px no se lee
   * como "poner canal" sino como un glifo raro— en vez de datos. En un día sí se
   * muestran, porque ahí "sin estimar" es información: es lo que no está contando
   * para la capacidad.
   *
   * No se pierde nada: el reloj del pie abre los mismos tiempos, y el canal se
   * cambia desde el detalle. Es lo que ya hace la vista Backlog, donde
   * `CategoryTag` tampoco dibuja nada sin categoría.
   */
  hidePlaceholders?: boolean;
  /**
   * La proyección del día deja esta tarea fuera del horario de trabajo, así que
   * el badge de tiempo va en ámbar. Quién lo decide: `useLateTasks`, con el
   * mismo `buildRail` que dibuja la agenda.
   */
  late?: boolean;
}

/**
 * Contenido de la card:
 *   [hora]
 *   Título                              [planned]   ← alineado con el título
 *   (✓) (⏱) (#)                          #canal
 *   ── footer expandible: ▷  ACTUAL / PLANNED ──
 */
export function TaskCardContent({
  task,
  category,
  categories = [],
  onToggle,
  onPatch,
  hidePlaceholders,
  late = false,
}: Props) {
  const [openFooter, setOpenFooter] = useState(false);
  const [picker, setPicker] = useState<null | "channel" | "planned" | "actual">(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const plannedRef = useRef<HTMLDivElement>(null);
  const actualRef = useRef<HTMLDivElement>(null);
  const timer = useTimer();
  const prioridades = usePrioritiesOn();
  const bumpData = useAppStore((s) => s.bumpData);
  const running = timer.active?.taskId === task.id;
  // El acumulado de la tarea más lo que va de la corrida en curso: este número
  // es "cuánto llevo en total", no "cuánto llevo hoy" (eso es el taxímetro).
  const liveSeconds = task.actualSeconds + (running ? timer.runTotal : 0);

  const done = task.status === "DONE";

  const options = useMemo(() => channelOptions(categories), [categories]);

  const stop = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  async function togglePlay(e: React.MouseEvent) {
    stop(e);
    await timer.toggle(task.id);
  }

  return (
    <>
      {/* La fila aparece si hay hora **o** si viene del calendario: un evento de
       * día completo no tiene hora, y sin esta condición perdía su marca de
       * origen por completo al mover el icono acá. */}
      {(task.scheduledTime || task.source === "CALENDAR") && (
        <div className="tc__top">
          {/* La hora es un label con el mismo diseño que ACTUAL/PLANNED pero con
           * su propio color: es información de otra naturaleza —cuándo, no
           * cuánto— y confundirlas cuesta un segundo de lectura cada vez.
           *
           * El icono va acá y no junto al título: una reunión importada no se
           * planifica como una tarea propia (no la puedes achicar ni moverla sin
           * avisarle a alguien), y su marca natural es la hora, que es
           * justamente lo que no se puede tocar. */}
          <span className={`tc__time${task.scheduledTime ? "" : " is-todoeldia"}`}>
            {task.source === "CALENDAR" && (
              <CalendarDays size={11} aria-label="Viene del calendario" />
            )}
            {task.scheduledTime ?? "todo el día"}
          </span>
        </div>
      )}

      {/* Título + tiempo alineados en la misma fila */}
      <div className="tc__main">
        {/* `title` nativo: el clamp de dos líneas puede estar cortando, y sin
         * esto la única forma de ver el texto entero sería abrir el detalle. */}
        <div className="tc__title" title={task.title}>
          {task.title}
        </div>
        {!(hidePlaceholders && task.estimatedMinutes == null && liveSeconds === 0) && (
          <button
            className={`tc__badge${running ? " is-running" : ""}${late ? " is-late" : ""}`}
            onPointerDown={stop}
            onClick={(e) => {
              stop(e);
              setOpenFooter((v) => !v);
            }}
            aria-label="Ver tiempos"
          >
            {running && <span className="tc__pulse" aria-hidden />}
            {liveSeconds > 0 && <>{formatMinutes(Math.round(liveSeconds / 60))} / </>}
            {task.estimatedMinutes != null ? formatMinutes(task.estimatedMinutes) : "--:--"}
          </button>
        )}
      </div>

      <div className="tc__foot">
        <button
          type="button"
          className={`tc__check${done ? " is-checked" : ""}`}
          aria-label={done ? "Marcar como pendiente" : "Marcar como completada"}
          aria-pressed={done}
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            onToggle?.(task);
          }}
        >
          <Check size={11} strokeWidth={3} aria-hidden />
        </button>

        <button
          type="button"
          className="tc__icon"
          aria-label="Tiempos"
          onPointerDown={stop}
          onClick={(e) => {
            stop(e);
            setOpenFooter((v) => !v);
          }}
        >
          <Clock size={12} />
        </button>

        {/* La prioridad. Como la banderita del objetivo, **no es un botón**: el
         * nivel se cambia en el detalle, y un target clickeable de 20px entre el
         * check y el reloj se aprieta sin querer. Sin prioridad no dibuja nada, y
         * eso no depende de `hidePlaceholders` — no es un relleno de campo vacío,
         * es una marca que está o no está. */}
        {prioridades && <PriorityTag priority={task.priority} />}

        {/* Marca de "esto cuelga de un objetivo". **Solo el icono, sin el
         * nombre**: en una card de 200px el título del objetivo compite con el de
         * la tarea, y saber de cuál se trata es una pregunta del detalle, no de
         * la lista. Por lo mismo no lleva relleno cuando no hay objetivo — no es
         * un placeholder, así que tampoco depende de `hidePlaceholders`. */}
        {task.objectiveId != null && (
          <span className="tc__obj" title="Cuelga de un objetivo">
            <Flag size={11} aria-label="Cuelga de un objetivo" />
          </span>
        )}

        {/* Canal editable desde la lista. Sin canal y con `hidePlaceholders` no se
         * dibuja: el chip vacío es solo un numeral, y en una lista de tareas sin
         * canal es una columna de glifos que no dice nada. */}
        {!(hidePlaceholders && !category) && (
          <div className="chip-wrap tc__tagwrap" ref={tagRef} onPointerDown={stop}>
            <button
              type="button"
              className={`cat-tag tc__tag${category ? "" : " is-empty"}`}
              style={chipVars(category)}
              aria-label="Cambiar canal"
              onClick={(e) => {
                stop(e);
                setPicker((p) => (p === "channel" ? null : "channel"));
              }}
            >
              {category ? `#${category.name}` : <Hash size={12} />}
            </button>
            {picker === "channel" && (
              <Popover anchorRef={tagRef} align="right" onClose={() => setPicker(null)}>
                <SearchSelect
                  options={options}
                  value={task.categoryId != null ? String(task.categoryId) : null}
                  placeholder="Buscar canal…"
                  clearLabel="Sin canal"
                  onSelect={(v) => {
                    onPatch?.(task.id, { categoryId: v ? Number(v) : null });
                    setPicker(null);
                  }}
                />
              </Popover>
            )}
          </div>
        )}
      </div>

      {/* Mini footer de tiempos: abierto por defecto en la tarea en curso */}
      {(openFooter || running) && (
        <div className="tc__timer" onPointerDown={stop} onClick={stop}>
          <button
            className={`tc__play${running ? " is-running" : ""}`}
            onClick={togglePlay}
            aria-label={running ? "Pausar" : "Iniciar"}
          >
            {running ? <Pause size={13} /> : <Play size={13} />}
          </button>

          <div className="tc__timer-times">
            <div className="chip-wrap tc__timer-col" ref={actualRef}>
              <button
                className="tc__timer-planned"
                aria-label="Ajustar tiempo real"
                onClick={(e) => {
                  stop(e);
                  setPicker((p) => (p === "actual" ? null : "actual"));
                }}
              >
                <span className="tc__timer-label">Real</span>
                <span className={`tc__timer-value${running ? " is-running" : ""}`}>
                  {liveSeconds > 0 ? hms(liveSeconds) : "--:--"}
                </span>
              </button>
              {picker === "actual" && (
                <Popover anchorRef={actualRef} align="right" onClose={() => setPicker(null)}>
                  <TimePicker
                    value={Math.round(task.actualSeconds / 60)}
                    clearLabel="Sin tiempo"
                    onSelect={async (mins) => {
                      setPicker(null);
                      await api.setActualSeconds(task.id, (mins ?? 0) * 60);
                      bumpData();
                    }}
                  />
                </Popover>
              )}
            </div>
            <div className="chip-wrap tc__timer-col" ref={plannedRef}>
              <button
                className="tc__timer-planned"
                onClick={(e) => {
                  stop(e);
                  setPicker((p) => (p === "planned" ? null : "planned"));
                }}
              >
                <span className="tc__timer-label">Estimado</span>
                <span className="tc__timer-value">
                  {task.estimatedMinutes != null ? formatMinutes(task.estimatedMinutes) : "--:--"}
                </span>
              </button>
              {picker === "planned" && (
                <Popover anchorRef={plannedRef} align="right" onClose={() => setPicker(null)}>
                  <TimePicker
                    value={task.estimatedMinutes}
                    onSelect={(mins) => {
                      onPatch?.(task.id, { estimatedMinutes: mins });
                      setPicker(null);
                    }}
                  />
                </Popover>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
