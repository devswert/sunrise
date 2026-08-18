import { useMemo, useRef, useState } from "react";
import { CalendarDays, Check, Clock, Hash, Pause, Play } from "lucide-react";
import type { Category, Task, TaskPatch } from "../../lib/types";
import { formatMinutes } from "../../lib/capacity";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { TimePicker } from "../../components/TimePicker";
import { Popover } from "../../components/Popover";
import { useTimer, hms } from "../timer/useTimer";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../lib/store";

interface Props {
  task: Task;
  category: Category | null | undefined;
  categories?: Category[];
  onToggle?: (task: Task) => void;
  onPatch?: (id: number, patch: TaskPatch) => void;
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
}: Props) {
  const [openFooter, setOpenFooter] = useState(false);
  const [picker, setPicker] = useState<null | "channel" | "planned" | "actual">(null);
  const tagRef = useRef<HTMLDivElement>(null);
  const plannedRef = useRef<HTMLDivElement>(null);
  const actualRef = useRef<HTMLDivElement>(null);
  const timer = useTimer();
  const bumpData = useAppStore((s) => s.bumpData);
  const running = timer.active?.taskId === task.id;
  // El acumulado de la tarea más lo que va de la corrida en curso: este número
  // es "cuánto llevo en total", no "cuánto llevo hoy" (eso es el taxímetro).
  const liveSeconds = task.actualSeconds + (running ? timer.runTotal : 0);

  const done = task.status === "DONE";

  const channelOptions = useMemo<SearchOption[]>(() => {
    const out: SearchOption[] = [];
    for (const ctx of categories.filter((c) => c.parentId === null)) {
      out.push({ value: String(ctx.id), label: ctx.name, color: ctx.color });
      for (const ch of categories.filter((c) => c.parentId === ctx.id)) {
        out.push({ value: String(ch.id), label: `#${ch.name}`, hint: ctx.name, color: ch.color });
      }
    }
    return out;
  }, [categories]);

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
        <div className="tc__title">{task.title}</div>
        <button
          className={`tc__badge${running ? " is-running" : ""}`}
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

        {/* Canal editable desde la lista */}
        <div className="chip-wrap tc__tagwrap" ref={tagRef} onPointerDown={stop}>
          <button
            type="button"
            className="tc__tag"
            style={category ? { color: `var(--${category.color}-ink)` } : undefined}
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
                options={channelOptions}
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
