import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Flag, Hash, Link2, Pause, Play, Trash2, X } from "lucide-react";
import { api } from "../../lib/ipc";
import type {
  Category,
  Objective,
  Task,
  TaskEvent,
  TaskPatch,
  TimeEntry,
} from "../../lib/types";
import { extractLinks, taskEventLine } from "./history";
import { abrirExterno } from "../calendar/MeetingLink";
import { EventoDelCalendario } from "../calendar/EventoDelCalendario";
import { duracionCorta, tiempoPorDia } from "./timeByDay";
import { formatMinutes } from "../../lib/capacity";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { TimePicker } from "../../components/TimePicker";
import { Popover } from "../../components/Popover";
import { es } from "date-fns/locale";
import { parseISODate, shortDate, toISODate } from "../../lib/date";
import { useNavigate } from "react-router-dom";
import { useTimer, hms } from "../timer/useTimer";
import { useAppStore } from "../../lib/store";

interface TaskModalProps {
  task: Task;
  categories: Category[];
  objectives: Objective[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

type Picker = "channel" | "objective" | "start" | "planned" | "actual" | null;

export function TaskModal({ task, categories, objectives, onClose, onChanged }: TaskModalProps) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [planned, setPlanned] = useState<number | null>(task.estimatedMinutes);
  const [categoryId, setCategoryId] = useState<number | null>(task.categoryId);
  const [objectiveId, setObjectiveId] = useState<number | null>(task.objectiveId);
  const [startDate, setStartDate] = useState<string | null>(task.scheduledDate);
  const [done, setDone] = useState(task.status === "DONE");
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const timer = useTimer();
  const bumpData = useAppStore((s) => s.bumpData);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const quitOpen = useAppStore((s) => s.quitOpen);
  const navigate = useNavigate();
  const running = timer.active?.taskId === task.id;
  // Siempre el **acumulado de la tarea**, más lo que va de la corrida en curso
  // si el timer está en ella. Antes mostraba `timer.elapsed` mientras corría, o
  // sea lo de hoy: el mismo campo significaba dos cosas, y darle play a una
  // tarea arrastrada hacía *bajar* el número. Lo de "solo hoy" vive en el
  // taxímetro, que es el contador de la sesión.
  const liveSeconds = task.actualSeconds + (running ? timer.runTotal : 0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const chanRef = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const plannedRef = useRef<HTMLDivElement>(null);
  const actualRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  /** Lo que el debounce todavía no escribió, acumulado por campo. */
  const pendienteRef = useRef<TaskPatch | null>(null);

  useEffect(() => {
    api.listTaskEvents(task.id).then(setEvents);
  }, [task.id]);

  // Se relee con `dataVersion` (además de al cambiar de tarea) para que un
  // ajuste manual de tiempo o una pausa se reflejen sin cerrar el modal.
  useEffect(() => {
    api.listTimeEntries(task.id).then(setEntries);
  }, [task.id, dataVersion]);

  const porDia = useMemo(
    () => tiempoPorDia(entries, running ? timer.runTotal : 0),
    [entries, running, timer.runTotal],
  );

  // La tarea llega fresca desde el board: re-sincroniza los campos que no se
  // estén editando en este momento (planned, fecha, estado…).
  useEffect(() => {
    setPlanned(task.estimatedMinutes);
    setCategoryId(task.categoryId);
    setObjectiveId(task.objectiveId);
    setStartDate(task.scheduledDate);
    setDone(task.status === "DONE");
  }, [
    task.estimatedMinutes,
    task.categoryId,
    task.objectiveId,
    task.scheduledDate,
    task.status,
  ]);

  useEffect(() => {
    if (editingNotes) notesRef.current?.focus();
  }, [editingNotes]);

  const flash = useCallback(() => {
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1200);
  }, []);

  /** Guarda de inmediato (selects, checks, fechas). */
  const commit = useCallback(
    async (patch: TaskPatch) => {
      await api.updateTask(task.id, patch);
      await onChanged();
      // Avisa al resto (taxímetro incluido) de que la tarea cambió.
      bumpData();
      flash();
    },
    [task.id, onChanged, flash, bumpData],
  );

  /** Guarda con debounce (campos de texto). */
  const commitDebounced = useCallback(
    (patch: TaskPatch) => {
      pendienteRef.current = { ...pendienteRef.current, ...patch };
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const p = pendienteRef.current;
        pendienteRef.current = null;
        if (p) void commit(p);
      }, 500);
    },
    [commit],
  );

  /**
   * Escribe ya lo que estuviera esperando el debounce.
   *
   * Antes el cleanup solo hacía `clearTimeout`, así que cerrar el modal dentro
   * de los 500ms de la última tecla **descartaba** lo escrito. Con autosave y
   * sin botón "Guardar" eso es pérdida de datos, y con ⌘Enter cerrando el modal
   * pasaría de raro a cotidiano: se escribe y se cierra en el mismo gesto.
   */
  const flush = useCallback(async () => {
    clearTimeout(debounceRef.current);
    const p = pendienteRef.current;
    pendienteRef.current = null;
    if (p) await commit(p);
  }, [commit]);

  // Por ref para que el cleanup pueda ir con deps vacías (correr una sola vez,
  // al desmontar) y aun así usar el `flush` más reciente.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(
    () => () => {
      void flushRef.current();
    },
    [],
  );

  // Al abrirse, el modal se queda con el foco.
  //
  // Abrir con el mouse dejaba el foco en la **tarjeta de atrás**, que lleva los
  // `listeners` de `useSortable`: el `KeyboardSensor` de dnd-kit arranca un
  // arrastre con Enter o Espacio y no mira los modificadores, así que ⌘Enter
  // sobre una tarjeta enfocada levantaba la tarjeta en vez de cerrar el modal.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  /**
   * Atajos del modal: Escape cierra (o cierra el picker abierto), ⌘/Ctrl+Enter
   * guarda y cierra.
   *
   * Van en un listener de `window` y no en el `onKeyDown` del div porque **el
   * evento no siempre pasa por ahí**, y cada caso en que no pasaba era un atajo
   * muerto: con el foco en la tarjeta de atrás el modal no es ancestro del
   * `target`; los popovers se renderizan en un portal sobre `body`, así que
   * Escape con un picker abierto tampoco llegaba; y basta hacer click en una
   * zona no enfocable del modal para que el foco se vaya al `body`.
   *
   * `flush` va explícito y no se deja al cleanup del desmontaje: cerrar depende
   * de que el padre desmonte el modal, y eso no lo controla este componente. Se
   * llama sin esperar para que la ventana no se trabe durante el guardado; la
   * escritura sigue después del desmontaje, porque `flush` ya se quedó con lo
   * pendiente.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Con el diálogo de salida encima, las teclas son suyas. Mismo criterio
      // que `useShortcuts`.
      if (quitOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (picker) setPicker(null);
        else onClose();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void flush();
        onClose();
      }
    };
    // Fase de burbuja a propósito: deja que un control interno se quede con la
    // tecla (`SearchSelect` corta el Enter con `stopPropagation`) antes de que
    // el modal la interprete como "cerrar".
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker, quitOpen, onClose, flush]);

  async function remove() {
    await api.deleteTask(task.id);
    await onChanged();
    onClose();
  }

  const channel = categoryId != null ? categories.find((c) => c.id === categoryId) : null;
  const objective = objectiveId != null ? objectives.find((o) => o.id === objectiveId) : null;
  const links = extractLinks(notes);

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

  const toggle = (p: Picker) => setPicker((cur) => (cur === p ? null : p));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="tmodal"
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de tarea"
        // Enfocable por código para poder recibir el foco al abrirse, pero
        // fuera del orden de tabulación.
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {/* --- Barra superior: channel · objetivo · start · cerrar --- */}
        <header className="tmodal__top">
          <div className="chip-wrap" ref={chanRef}>
            <button className="tmodal__meta" onClick={() => toggle("channel")}>
              <span className="tmodal__meta-label">Canal</span>
              <span className={`tmodal__meta-value${channel ? " is-set" : ""}`}>
                <Hash size={13} />
                {channel ? channel.name : "ninguno"}
              </span>
            </button>
            {picker === "channel" && (
              <Popover anchorRef={chanRef} onClose={() => setPicker(null)}>
                <SearchSelect
                  options={channelOptions}
                  value={categoryId != null ? String(categoryId) : null}
                  placeholder="Buscar canal…"
                  clearLabel="Sin canal"
                  onSelect={(v) => {
                    const id = v ? Number(v) : null;
                    setCategoryId(id);
                    setPicker(null);
                    void commit({ categoryId: id });
                  }}
                />
              </Popover>
            )}
          </div>

          <div className="tmodal__top-right">
            {savedFlash && <span className="tmodal__saved">Guardado</span>}

            <div className="chip-wrap" ref={objRef}>
              <button className="tmodal__meta" onClick={() => toggle("objective")}>
                <span className="tmodal__meta-label">Objetivo</span>
                <span className={`tmodal__meta-value${objective ? " is-set" : ""}`}>
                  <Flag size={13} />
                  {objective ? objective.title : "ninguno"}
                </span>
              </button>
              {picker === "objective" && (
                <Popover anchorRef={objRef} align="right" onClose={() => setPicker(null)}>
                  <SearchSelect
                    options={objectives.map((o) => ({ value: String(o.id), label: o.title }))}
                    value={objectiveId != null ? String(objectiveId) : null}
                    placeholder="Buscar objetivo…"
                    clearLabel="Sin objetivo"
                    emptyLabel="No hay objetivos esta semana"
                    onSelect={(v) => {
                      const id = v ? Number(v) : null;
                      setObjectiveId(id);
                      setPicker(null);
                      void commit({ objectiveId: id });
                    }}
                  />
                </Popover>
              )}
            </div>

            <div className="chip-wrap" ref={startRef}>
              <button className="tmodal__meta" onClick={() => toggle("start")}>
                <span className="tmodal__meta-label">Inicio</span>
                <span className={`tmodal__meta-value${startDate ? " is-set" : ""}`}>
                  {startDate ? shortDate(startDate) : "Sin fecha"}
                </span>
              </button>
              {picker === "start" && (
                <Popover anchorRef={startRef} align="right" className="popover--pad" onClose={() => setPicker(null)}>
                  <div className="panel-quick">
                    <button
                      onClick={async () => {
                        setStartDate(null);
                        setPicker(null);
                        await api.moveTask(task.id, null, 0);
                        await onChanged();
                        flash();
                      }}
                    >
                      Sin fecha (backlog)
                    </button>
                  </div>
                  <DayPicker
                    mode="single"
                    weekStartsOn={1}
                    locale={es}
                    selected={startDate ? parseISODate(startDate) : undefined}
                    onSelect={async (d) => {
                      const iso = d ? toISODate(d) : null;
                      setStartDate(iso);
                      setPicker(null);
                      await api.moveTask(task.id, iso, 0);
                      await onChanged();
                      flash();
                    }}
                  />
                </Popover>
              )}
            </div>

            <button className="tmodal__close" aria-label="Cerrar" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="tmodal__body">
          {/* --- Título + tiempos --- */}
          <div className="tmodal__titlerow">
            <button
              type="button"
              className={`tmodal__check${done ? " is-checked" : ""}`}
              aria-label={done ? "Marcar como pendiente" : "Marcar como completada"}
              aria-pressed={done}
              onClick={async () => {
                const next = !done;
                setDone(next);
                await api.setTaskStatus(task.id, next ? "DONE" : "TODO");
                await onChanged();
                bumpData(); // completar pudo detener el timer
                flash();
              }}
            >
              {done && <Check size={14} strokeWidth={3} />}
            </button>

            <input
              className={`tmodal__title${done ? " is-done" : ""}`}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                commitDebounced({ title: e.target.value.trim() || task.title });
              }}
              aria-label="Título"
            />

            <div className="tmodal__times">
              <div className="chip-wrap" ref={actualRef}>
                <button
                  className="tmodal__time"
                  aria-label="Ajustar tiempo real"
                  onClick={() => toggle("actual")}
                >
                  <span className="tmodal__time-label">Real</span>
                  <span
                    className={`tmodal__time-value is-actual${
                      running && timer.overEstimate ? " is-over" : ""
                    }`}
                  >
                    {running ? hms(liveSeconds) : formatMinutes(Math.round(liveSeconds / 60))}
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
                        await onChanged();
                        bumpData();
                        flash();
                      }}
                    />
                  </Popover>
                )}
              </div>
              <div className="chip-wrap" ref={plannedRef}>
                <button className="tmodal__time" onClick={() => toggle("planned")}>
                  <span className="tmodal__time-label">Estimado</span>
                  <span className="tmodal__time-value">
                    {planned != null ? formatMinutes(planned) : "--:--"}
                  </span>
                </button>
                {picker === "planned" && (
                  <Popover anchorRef={plannedRef} align="right" onClose={() => setPicker(null)}>
                    <TimePicker
                      value={planned}
                      onSelect={(mins) => {
                        setPlanned(mins);
                        setPicker(null);
                        void commit({ estimatedMinutes: mins });
                      }}
                    />
                  </Popover>
                )}
              </div>

              <button
                className={`tmodal__play${running ? " is-running" : ""}`}
                aria-label={running ? "Pausar" : "Iniciar"}
                onClick={async () => {
                  if (running) {
                    await timer.stop();
                    return;
                  }
                  // Al arrancar desde el detalle, pasamos a trabajar: cierra el
                  // modal y lleva a Focus con esa tarea.
                  await timer.start(task.id);
                  onClose();
                  navigate("/focus");
                }}
              >
                {running ? <Pause size={14} /> : <Play size={14} />}
              </button>
            </div>
          </div>

          {/* --- Datos del evento del calendario ---
            * Arriba de las notas y separado por una línea: el orden en que uno
            * los necesita antes de una reunión es a qué hora, por dónde entro,
            * quién viene y de qué se trata. Las notas propias van después. */}
          <EventoDelCalendario task={task} />

          {/* --- Notas (markdown) --- */}
          <div className="tmodal__notes">
            {editingNotes ? (
              <textarea
                ref={notesRef}
                className="tmodal__notes-input"
                value={notes}
                placeholder="Notas… (soporta markdown)"
                onChange={(e) => {
                  setNotes(e.target.value);
                  commitDebounced({ notes: e.target.value });
                }}
                onBlur={() => {
                  setEditingNotes(false);
                  void commit({ notes });
                }}
              />
            ) : (
              <div
                className="tmodal__notes-view md"
                onClick={() => setEditingNotes(true)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setEditingNotes(true);
                }}
              >
                {notes.trim() ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
                ) : (
                  <span className="tmodal__notes-placeholder">Notas…</span>
                )}
              </div>
            )}
          </div>

          {/* --- Links detectados --- */}
          {links.length > 0 && (
            <div className="tmodal__links">
              {links.map((l) => (
                <button
                  key={l}
                  type="button"
                  className="tmodal__link"
                  onClick={() => void abrirExterno(l)}
                >
                  <Link2 size={14} />
                  {l.replace(/^https?:\/\//, "")}
                </button>
              ))}
            </div>
          )}

          {/* --- Tiempo por día ---
            * Una tarea arrastrada varios días mostraba un único total sin decir
            * cuánto cayó en cada día, y el dato estaba en `time_entries` desde
            * M2 sin que ninguna vista lo leyera. También es lo que hace visible
            * un ajuste manual de tiempo. */}
          {porDia.length > 0 && (
            <div className="tmodal__bydays">
              <span className="tmodal__bydays-title">Tiempo por día</span>
              <ul>
                {porDia.map((d) => (
                  <li key={d.date}>
                    <span className="tmodal__bydays-day">
                      {d.date === toISODate(new Date()) ? "Hoy" : shortDate(d.date)}
                    </span>
                    <span className="tmodal__bydays-dur">{duracionCorta(d.seconds)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* --- Historial --- */}
          <ul className="tmodal__history">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className="tmodal__history-dot" />
                {taskEventLine(ev)}
              </li>
            ))}
          </ul>
        </div>

        {/* --- Footer: solo eliminar (los cambios se guardan solos) --- */}
        <footer className="tmodal__foot">
          {confirmDelete ? (
            <div className="confirm">
              <span>¿Eliminar esta tarea?</span>
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>
                Cancelar
              </button>
              <button className="btn-danger is-solid" onClick={remove}>
                Sí, eliminar
              </button>
            </div>
          ) : (
            <button
              className="btn-danger"
              onClick={() => setConfirmDelete(true)}
              aria-label="Eliminar tarea"
            >
              <Trash2 size={14} /> Eliminar
            </button>
          )}
          <span className="tmodal__autosave">Los cambios se guardan automáticamente</span>
        </footer>
      </div>
    </div>
  );
}
