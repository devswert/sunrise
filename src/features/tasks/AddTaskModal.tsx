import { useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { CalendarDays, Clock, Hash, Link2, Plus, Target, X } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { channelOptions } from "./channelOptions";
import { appendResources, harvestLinks } from "./resources";
import { Popover } from "../../components/Popover";
import { es } from "date-fns/locale";
import { dateLabel, isToday, isoWeekId, parseISODate, toISODate, todayISO } from "../../lib/date";
import { formatMinutes } from "../../lib/capacity";

const TIME_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240];
type Picker = "date" | "planned" | "channel" | "objective" | null;

export function AddTaskModal() {
  const { composeDefaults, closeCompose, bumpData } = useAppStore();

  const initialDate = composeDefaults.date !== undefined ? composeDefaults.date : todayISO();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string | null>(initialDate);
  const [planned, setPlanned] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(composeDefaults.categoryId ?? null);
  const [objectiveId, setObjectiveId] = useState<number | null>(
    composeDefaults.objectiveId ?? null,
  );
  const [picker, setPicker] = useState<Picker>(null);
  /** Los links que se cosecharon del título. Se guardan en las notas al crear. */
  const [resources, setResources] = useState<string[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const chanRef = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    api.listCategories().then(setCategories);
    api.listObjectives(isoWeekId(new Date())).then(setObjectives);
  }, []);

  // El alto sigue al texto. Igual que en `TaskModal`: `auto` antes de medir o
  // el `scrollHeight` queda clavado en el alto anterior y el campo no achica; el
  // guard es por jsdom, donde `scrollHeight` es 0.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  /**
   * Cosecha los links de un texto y los suma a la lista de recursos.
   * Devuelve el texto ya sin ellos, que es lo que queda en el título.
   */
  function cosechar(texto: string, terminatedOnly = false): string {
    const { text, links } = harvestLinks(texto, terminatedOnly);
    if (links.length > 0) {
      setResources((prev) => [...prev, ...links.filter((l) => !prev.includes(l))]);
    }
    return text;
  }

  async function create() {
    // Última pasada: un link escrito a mano al final del título no lo cosechó
    // ni el pegado ni el `onChange` —que solo mira links cerrados—, así que sin
    // esto se crearía con el link todavía adentro.
    const { text, links } = harvestLinks(title);
    const t = text.trim();
    if (!t) return;
    const todos = [...resources, ...links.filter((l) => !resources.includes(l))];
    const notes = appendResources("", todos);
    await api.createTask({
      title: t,
      notes: notes || undefined,
      scheduledDate: date,
      estimatedMinutes: planned,
      categoryId,
      objectiveId,
    });
    bumpData();
    closeCompose();
  }

  const selectedCat = categoryId != null ? categories.find((c) => c.id === categoryId) : null;
  const selectedObj = objectiveId != null ? objectives.find((o) => o.id === objectiveId) : null;

  /** Opciones de canal: contexto (nivel 1) seguido de sus canales. */
  const options = useMemo(() => channelOptions(categories), [categories]);

  const timeOptions = useMemo<SearchOption[]>(
    () =>
      TIME_PRESETS.map((m) => ({
        value: String(m),
        label: formatMinutes(m),
        hint: `${m} min`,
      })),
    [],
  );

  const objectiveOptions = useMemo<SearchOption[]>(
    () => objectives.map((o) => ({ value: String(o.id), label: o.title })),
    [objectives],
  );

  const toggle = (p: Picker) => setPicker((cur) => (cur === p ? null : p));
  const dateChip = date ? (isToday(date) ? "Hoy" : dateLabel(date)) : "Sin fecha";

  return (
    <div className="compose-overlay" onClick={closeCompose}>
      <div
        className="compose"
        role="dialog"
        aria-label="Nueva tarea"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) create();
          if (e.key === "Escape") picker ? setPicker(null) : closeCompose();
        }}
      >
        {/* Mismo campo que el título de `TaskModal`, y por el mismo motivo: una
         * descripción larga en un `input` de una línea se va corriendo a la
         * izquierda y deja de verse el principio, que es lo que uno está
         * escribiendo. Crece hasta el tope de `.compose__title` y ahí scrollea.
         *
         * Enter **crea la tarea** —es el gesto de este modal, no un salto de
         * línea—, así que el `preventDefault` va igual: sin él el textarea
         * metía un `\n` antes de que `create()` leyera el título. */}
        <textarea
          ref={inputRef}
          rows={1}
          className="compose__title"
          placeholder="Descripción de la tarea…"
          value={title}
          /* El aplanado de saltos va **antes** de cosechar: un pegado multilínea
           * termina la URL con el salto, que convertido en espacio la deja
           * cerrada y lista para que la levante hasta el `onChange`. */
          onChange={(e) => setTitle(cosechar(e.target.value.replace(/\s*\n\s*/g, " "), true))}
          /* Pegar es el gesto que motivó esto, y lo que se pega llega entero:
           * acá se cosecha todo, sin esperar a que la URL quede cerrada —al
           * final de un pegado no hay espacio que la cierre. Se inserta a mano
           * porque hay que quedarse con el resto del texto pegado. */
          onPaste={(e) => {
            const pegado = e.clipboardData.getData("text");
            if (!/https?:\/\//.test(pegado)) return;
            e.preventDefault();
            const limpio = cosechar(pegado.replace(/\s*\n\s*/g, " "));
            const el = e.currentTarget;
            const desde = el.selectionStart ?? title.length;
            const hasta = el.selectionEnd ?? desde;
            setTitle((prev) => `${prev.slice(0, desde)}${limpio}${prev.slice(hasta)}`.trimStart());
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
              e.preventDefault();
              create();
            }
          }}
        />

        {/* --- Recursos cosechados ---
         * La lista existe para poder **deshacer**: el título se limpia solo, y
         * sin ver a dónde fue el link el gesto se sentiría como que se perdió.
         * Va acá y no en la barra de abajo porque es parte de lo que se está
         * escribiendo, no un ajuste de la tarea. */}
        {resources.length > 0 && (
          <ul className="compose__res">
            {resources.map((l) => (
              <li key={l} className="compose__res-item">
                <Link2 size={13} />
                <span className="compose__res-url">{l.replace(/^https?:\/\//, "")}</span>
                <button
                  type="button"
                  className="compose__res-del"
                  aria-label={`Quitar ${l}`}
                  onClick={() => setResources((prev) => prev.filter((x) => x !== l))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="compose__toolbar">
          <div className="chip-wrap" ref={dateRef}>
            <button
              className={`chip${picker === "date" ? " is-open" : ""}${date ? " is-set" : ""}`}
              onClick={() => toggle("date")}
            >
              <CalendarDays size={14} /> {dateChip}
            </button>
            {picker === "date" && (
              <Popover
                anchorRef={dateRef}
                align="center"
                className="popover--pad"
                onClose={() => setPicker(null)}
              >
                <div className="panel-quick">
                  <button
                    onClick={() => {
                      setDate(todayISO());
                      setPicker(null);
                    }}
                  >
                    Hoy
                  </button>
                  <button
                    onClick={() => {
                      setDate(null);
                      setPicker(null);
                    }}
                  >
                    Sin fecha
                  </button>
                </div>
                <DayPicker
                  mode="single"
                  weekStartsOn={1}
                  locale={es}
                  selected={date ? parseISODate(date) : undefined}
                  onSelect={(d) => {
                    setDate(d ? toISODate(d) : null);
                    setPicker(null);
                  }}
                />
              </Popover>
            )}
          </div>

          <div className="chip-wrap" ref={timeRef}>
            <button
              className={`chip${picker === "planned" ? " is-open" : ""}${planned ? " is-set" : ""}`}
              onClick={() => toggle("planned")}
            >
              <Clock size={14} /> {planned ? formatMinutes(planned) : "--:--"}
            </button>
            {picker === "planned" && (
              <Popover anchorRef={timeRef} onClose={() => setPicker(null)}>
                <SearchSelect
                  options={timeOptions}
                  value={planned != null ? String(planned) : null}
                  placeholder="Buscar tiempo…"
                  clearLabel="Sin estimar"
                  onSelect={(v) => {
                    setPlanned(v ? Number(v) : null);
                    setPicker(null);
                  }}
                />
              </Popover>
            )}
          </div>

          <div className="chip-wrap" ref={chanRef}>
            <button
              className={`chip${picker === "channel" ? " is-open" : ""}${selectedCat ? " is-set" : ""}`}
              onClick={() => toggle("channel")}
            >
              <Hash size={14} /> {selectedCat ? selectedCat.name : "canal"}
            </button>
            {picker === "channel" && (
              <Popover anchorRef={chanRef} onClose={() => setPicker(null)}>
                <SearchSelect
                  options={options}
                  value={categoryId != null ? String(categoryId) : null}
                  placeholder="Buscar canal…"
                  clearLabel="Sin canal"
                  onSelect={(v) => {
                    setCategoryId(v ? Number(v) : null);
                    setPicker(null);
                  }}
                />
              </Popover>
            )}
          </div>

          <div className="chip-wrap" ref={objRef}>
            <button
              className={`chip${picker === "objective" ? " is-open" : ""}${selectedObj ? " is-set" : ""}`}
              onClick={() => toggle("objective")}
            >
              <Target size={14} /> {selectedObj ? selectedObj.title : "objetivo"}
            </button>
            {picker === "objective" && (
              <Popover anchorRef={objRef} align="right" onClose={() => setPicker(null)}>
                <SearchSelect
                  options={objectiveOptions}
                  value={objectiveId != null ? String(objectiveId) : null}
                  placeholder="Buscar objetivo…"
                  clearLabel="Sin objetivo"
                  emptyLabel="No hay objetivos esta semana"
                  onSelect={(v) => {
                    setObjectiveId(v ? Number(v) : null);
                    setPicker(null);
                  }}
                />
              </Popover>
            )}
          </div>
        </div>

        <div className="compose__foot">
          <span className="compose__hint">⌘↵ para crear</span>
          <button className="btn-primary" onClick={create} disabled={!title.trim()}>
            <Plus size={14} aria-hidden /> Crear task
          </button>
        </div>
      </div>
    </div>
  );
}
