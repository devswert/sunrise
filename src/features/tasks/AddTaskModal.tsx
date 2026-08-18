import { useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { CalendarDays, Clock, Hash, Plus, Target } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { Popover } from "../../components/Popover";
import { es } from "date-fns/locale";
import { dateLabel, isToday, isoWeekId, parseISODate, toISODate, todayISO } from "../../lib/date";
import { formatMinutes } from "../../lib/capacity";

const TIME_PRESETS = [5, 10, 15, 20, 25, 30, 45, 60, 90, 120, 180, 240];
type Picker = "date" | "planned" | "channel" | "objective" | null;

export function AddTaskModal() {
  const { composeDefaults, closeCompose, bumpData } = useAppStore();

  const initialDate =
    composeDefaults.date !== undefined ? composeDefaults.date : todayISO();

  const [title, setTitle] = useState("");
  const [date, setDate] = useState<string | null>(initialDate);
  const [planned, setPlanned] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(
    composeDefaults.categoryId ?? null,
  );
  const [objectiveId, setObjectiveId] = useState<number | null>(
    composeDefaults.objectiveId ?? null,
  );
  const [picker, setPicker] = useState<Picker>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const chanRef = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    api.listCategories().then(setCategories);
    api.listObjectives(isoWeekId(new Date())).then(setObjectives);
  }, []);

  async function create() {
    const t = title.trim();
    if (!t) return;
    await api.createTask({
      title: t,
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
  const channelOptions = useMemo<SearchOption[]>(() => {
    const out: SearchOption[] = [];
    for (const ctx of categories.filter((c) => c.parentId === null)) {
      out.push({ value: String(ctx.id), label: ctx.name, color: ctx.color });
      for (const ch of categories.filter((c) => c.parentId === ctx.id)) {
        out.push({
          value: String(ch.id),
          label: `#${ch.name}`,
          hint: ctx.name,
          color: ch.color,
        });
      }
    }
    return out;
  }, [categories]);

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
        <input
          ref={inputRef}
          className="compose__title"
          placeholder="Descripción de la tarea…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) create();
          }}
        />

        <div className="compose__toolbar">
          <div className="chip-wrap" ref={dateRef}>
            <button
              className={`chip${picker === "date" ? " is-open" : ""}${date ? " is-set" : ""}`}
              onClick={() => toggle("date")}
            >
              <CalendarDays size={14} /> {dateChip}
            </button>
            {picker === "date" && (
              <Popover anchorRef={dateRef} align="center" className="popover--pad" onClose={() => setPicker(null)}>
                <div className="panel-quick">
                  <button onClick={() => { setDate(todayISO()); setPicker(null); }}>Hoy</button>
                  <button onClick={() => { setDate(null); setPicker(null); }}>Sin fecha</button>
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
                  options={channelOptions}
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
