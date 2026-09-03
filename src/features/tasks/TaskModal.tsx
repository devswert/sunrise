import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { Check, Flag, Hash, Link2, Pause, Play, Trash2, X } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective, Task, TaskEvent, TaskPatch, TimeEntry } from "../../lib/types";
import { Markdown } from "../../components/Markdown";
import { extractLinks, taskEventLine } from "./history";
import { chipVars } from "./chipVars";
import { abrirExterno } from "../calendar/MeetingLink";
import { CalendarEventCard } from "../calendar/EventoDelCalendario";
import { shortDuration, timeByDay } from "./timeByDay";
import { formatMinutes } from "../../lib/capacity";
import { SearchSelect } from "../../components/SearchSelect";
import { Switch } from "../../components/Switch";
import { channelOptions } from "./channelOptions";
import { PriorityTag } from "./PriorityTag";
import { priorityVar } from "./priority";
import { TimePicker } from "../../components/TimePicker";
import { Popover } from "../../components/Popover";
import { es } from "date-fns/locale";
import { parseISODate, shortDate, toISODate } from "../../lib/date";
import { useNavigate } from "react-router-dom";
import { useTimer, hms } from "../timer/useTimer";
import { useAppStore } from "../../lib/store";
import { usePrioritiesOn } from "../../lib/settings";
import { PRIORITIES, type Priority } from "../../lib/enums";

interface TaskModalProps {
  task: Task;
  categories: Category[];
  objectives: Objective[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

type Picker = "channel" | "objective" | "priority" | "start" | "planned" | "actual" | null;

export function TaskModal({ task, categories, objectives, onClose, onChanged }: TaskModalProps) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [editingNotes, setEditingNotes] = useState(false);
  const [planned, setPlanned] = useState<number | null>(task.estimatedMinutes);
  const [categoryId, setCategoryId] = useState<number | null>(task.categoryId);
  const [objectiveId, setObjectiveId] = useState<number | null>(task.objectiveId);
  const [priority, setPriority] = useState<Priority | null>(task.priority);
  const [startDate, setStartDate] = useState<string | null>(task.scheduledDate);
  const [done, setDone] = useState(task.status === "DONE");
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [picker, setPicker] = useState<Picker>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const timer = useTimer();
  const prioridades = usePrioritiesOn();
  const bumpData = useAppStore((s) => s.bumpData);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const quitOpen = useAppStore((s) => s.quitOpen);
  const navigate = useNavigate();
  const running = timer.active?.taskId === task.id;
  /**
   * Una tarea ignorada (§4.12) no es trabajo: **el detalle esconde todo lo que
   * la trataría como tal** —completar, el play y los dos ajustes de tiempo—.
   * No es solo prolijidad: el play sobre algo que no tiene tarjeta en ninguna
   * columna deja el taxímetro corriendo donde no se puede ver ni detener, que es
   * la trampa que `repo::set_series_rail_only` evita al no tocar lo ya trabajado.
   * Quedan sus datos, sus notas, el canal y el switch para dejar de ignorarla.
   */
  const ignorada = task.railOnly;
  // Siempre el **acumulado de la tarea**, más lo que va de la corrida en curso
  // si el timer está en ella. Antes mostraba `timer.elapsed` mientras corría, o
  // sea lo de hoy: el mismo campo significaba dos cosas, y darle play a una
  // tarea arrastrada hacía *bajar* el número. Lo de "solo hoy" vive en el
  // taxímetro, que es el contador de la sesión.
  const liveSeconds = task.actualSeconds + (running ? timer.runTotal : 0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const chanRef = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLDivElement>(null);
  const prioRef = useRef<HTMLDivElement>(null);
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
    () => timeByDay(entries, running ? timer.runTotal : 0),
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
  }, [task.estimatedMinutes, task.categoryId, task.objectiveId, task.scheduledDate, task.status]);

  useEffect(() => {
    if (editingNotes) notesRef.current?.focus();
  }, [editingNotes]);

  // El alto del título sigue al texto: se resetea a `auto` antes de medir, o el
  // `scrollHeight` quedaría clavado en el alto anterior y el campo nunca
  // achicaría. El `max-height` del CSS es el que corta y deja el scroll.
  // En jsdom `scrollHeight` es 0, así que el guard evita dejar el campo en 0px.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [title]);

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

  /**
   * Borrar es una mutación como cualquier otra, así que **también avisa**
   * (`bumpData`). El `onChanged` de la vista que monta el modal recarga lo suyo y
   * nada más: en el ritual diario, por ejemplo, es el board de hoy, mientras el
   * repaso del día anterior y la columna del backlog son estado aparte que se
   * refresca con el aviso. Sin él la tarea se borraba de la base y la card se
   * quedaba en pantalla; el gesto se sentía muerto y el click siguiente abría el
   * detalle de algo que ya no existía.
   */
  async function remove() {
    await api.deleteTask(task.id);
    await onChanged();
    bumpData();
    onClose();
  }

  const channel = categoryId != null ? categories.find((c) => c.id === categoryId) : null;
  const objective = objectiveId != null ? objectives.find((o) => o.id === objectiveId) : null;
  const links = extractLinks(notes);

  const options = useMemo(() => channelOptions(categories), [categories]);

  const toggle = (p: Picker) => setPicker((cur) => (cur === p ? null : p));

  /** Elegir un nivel cierra el popover y guarda, como el canal y el objetivo. */
  function elegirPrioridad(p: Priority | null) {
    setPriority(p);
    setPicker(null);
    void commit({ priority: p });
  }

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
              {/* El mismo chip que la card de la semana, no un texto teñido: es
                  la pieza por la que se reconoce el canal en el resto de la app. */}
              {channel ? (
                <span className="cat-tag tmodal__chip" style={chipVars(channel)}>
                  {`#${channel.name}`}
                </span>
              ) : (
                <span className="tmodal__meta-value">
                  <Hash size={13} />
                  ninguno
                </span>
              )}
            </button>
            {picker === "channel" && (
              <Popover anchorRef={chanRef} onClose={() => setPicker(null)}>
                <SearchSelect
                  options={options}
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

            {/* La prioridad, a la izquierda del objetivo. Misma carcasa que sus
             * dos vecinos —`chip-wrap` + `tmodal__meta` + `Popover`— y a
             * propósito: es la tercera cosa que se elige de una lista en esta
             * barra, y dibujarla distinta la haría parecer otra clase de control.
             *
             * **Sin buscador**, y ahí sí se separa del canal y del objetivo: son
             * cinco opciones fijas que caben enteras en el popover, y un campo de
             * texto encima de cinco filas es un paso más para llegar a lo mismo.
             */}
            {prioridades && (
              <div className="chip-wrap" ref={prioRef}>
                <button className="tmodal__meta" onClick={() => toggle("priority")}>
                  <span className="tmodal__meta-label">Prioridad</span>
                  {priority ? (
                    <PriorityTag priority={priority} className="tmodal__prio" />
                  ) : (
                    <span className="tmodal__meta-value">
                      <Flag size={13} />
                      ninguna
                    </span>
                  )}
                </button>
                {picker === "priority" && (
                  <Popover
                    anchorRef={prioRef}
                    align="right"
                    className="popover--pad"
                    onClose={() => setPicker(null)}
                  >
                    <div className="prio-menu">
                      {PRIORITIES.map((p) => (
                        <button
                          key={p}
                          className={`prio-menu__item${p === priority ? " is-active" : ""}`}
                          onClick={() => elegirPrioridad(p)}
                        >
                          <span
                            className="prio-tag__dot"
                            style={{ background: priorityVar(p) }}
                            aria-hidden
                          />
                          {p}
                        </button>
                      ))}
                      <button
                        className={`prio-menu__item prio-menu__none${
                          priority === null ? " is-active" : ""
                        }`}
                        onClick={() => elegirPrioridad(null)}
                      >
                        Sin prioridad
                      </button>
                    </div>
                  </Popover>
                )}
              </div>
            )}

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
                <Popover
                  anchorRef={startRef}
                  align="right"
                  className="popover--pad"
                  onClose={() => setPicker(null)}
                >
                  <div className="panel-quick">
                    <button
                      onClick={async () => {
                        setStartDate(null);
                        setPicker(null);
                        await api.moveTask(task.id, null, 0);
                        await onChanged();
                        // Mover entre backlog y calendario cambia el contador del
                        // sidebar, que vive fuera del `onChanged` de la vista.
                        bumpData();
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
                      bumpData();
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
            {/* Ignorada: el círculo de completar no va, y su lugar **no** se
             * reserva. Se probó reservarlo para que el título no perdiera la
             * sangría, y el hueco vacío se veía peor que el título pegado al
             * borde. */}
            {!ignorada && (
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
            )}

            {/* Es un `textarea` y no un `input` porque el título tiene que
             * **leerse entero**: es el único lugar de la app donde no se
             * recorta (la card lo corta en dos líneas). Crece con el texto
             * hasta el tope de `.tmodal__title` y ahí scrollea, así el resto
             * del detalle no se va abajo del pliegue por un título largo.
             *
             * El dato sigue siendo de una línea: Enter no escribe un salto
             * —lo come el `onKeyDown`— y un pegado multilínea se aplana en el
             * `onChange`. Un `\n` guardado se vería como un corte raro dentro
             * del clamp de la card. */}
            <textarea
              ref={titleRef}
              rows={1}
              className={`tmodal__title${done ? " is-done" : ""}`}
              value={title}
              onChange={(e) => {
                const limpio = e.target.value.replace(/\s*\n\s*/g, " ");
                setTitle(limpio);
                commitDebounced({ title: limpio.trim() || task.title });
              }}
              onKeyDown={(e) => {
                // Sin modificadores el Enter no hace nada. **No se corta la
                // propagación**: ⌘Enter cierra el modal desde un handler en
                // `window`, y un `stopPropagation` acá lo mataría en silencio.
                if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) e.preventDefault();
              }}
              aria-label="Título"
            />

            {!ignorada && (
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
            )}
          </div>

          {/* --- Datos del evento del calendario ---
           * Arriba de las notas y separado por una línea: el orden en que uno
           * los necesita antes de una reunión es a qué hora, por dónde entro,
           * quién viene y de qué se trata. Las notas propias van después. */}
          <CalendarEventCard task={task} />

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
                  <Markdown>{notes}</Markdown>
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
                    <span className="tmodal__bydays-dur">{shortDuration(d.seconds)}</span>
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
          {/* Ignorar el evento: lo que convierte un "focus time" del calendario
           * —el almuerzo, un rato de concentración— en espacio reservado en vez
           * de trabajo planificado (§4.12).
           *
           * Va **en el pie**, en el lugar que ocupaba "los cambios se guardan
           * automáticamente": ese texto no decía nada que el usuario necesitara
           * —el autosave se nota usándolo— y era el único espacio del modal que
           * no hacía nada. Acá abajo queda además lejos del título y de las
           * notas: es una decisión sobre el evento, no un campo que se edita.
           *
           * Marcar y desmarcar se hacen los dos desde acá. Una vez ignorada la
           * tarea no tiene tarjeta, pero el detalle sigue siendo alcanzable: su
           * bloque del rail lo abre igual que cualquier otro.
           *
           * Solo se ofrece en una tarea del calendario: en una escrita a mano no
           * significa nada, ya está donde la pusiste. El rótulo dice **"como
           * tarea"** porque eso es exactamente lo que deja de ser: el evento
           * sigue ahí, en el rail, a su hora. */}
          {task.feedId != null && task.calendarUid != null && (
            <label className="tmodal__ignorar">
              <span className="tmodal__ignorar-texto">Ignorar como tarea</span>
              <Switch
                checked={ignorada}
                label="Ignorar este evento"
                onChange={async (value) => {
                  await api.setTaskRailOnly(task.id, value);
                  await onChanged();
                  bumpData();
                }}
              />
            </label>
          )}
        </footer>
      </div>
    </div>
  );
}
