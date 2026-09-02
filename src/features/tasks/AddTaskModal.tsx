import { useEffect, useMemo, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { CalendarDays, Clock, Flag, Hash, Link2, Plus, Target, X } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { channelOptions } from "./channelOptions";
import { appendResources, harvestLinks } from "./resources";
import { Popover } from "../../components/Popover";
import { es } from "date-fns/locale";
import { dateLabel, isToday, isoWeekId, parseISODate, toISODate, todayISO } from "../../lib/date";
import { TIME_PRESETS, formatMinutes } from "../../lib/capacity";
import { usePrioritiesOn, useSuggestRules } from "../../lib/settings";
import { PRIORITIES, type Priority } from "../../lib/enums";
import { PriorityTag } from "./PriorityTag";
import { priorityVar } from "./priority";
import { chipVarsForColor } from "./chipVars";
import { stripChannelTag, suggestFromTitle } from "./suggest";

type Picker = "date" | "planned" | "channel" | "objective" | "priority" | null;

/**
 * Los tres campos que el sugeridor puede escribir solo. Uno se "traba" en cuanto
 * el usuario lo elige a mano — y no se destraba: una sugerencia que pisa lo que
 * acabás de elegir convierte la ayuda en algo contra lo que hay que pelear.
 */
type Field = "planned" | "channel" | "objective";

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
  const [priority, setPriority] = useState<Priority | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  /**
   * Lo que el usuario ya eligió a mano, y que el sugeridor deja de tocar. Los
   * defaults con los que abre el modal cuentan como elegidos: quien lo abrió
   * desde una columna de canal ya dijo cuál, y adivinarle encima sería pisarlo.
   */
  const locked = useRef<Record<Field, boolean>>({
    planned: false,
    channel: composeDefaults.categoryId != null,
    objective: composeDefaults.objectiveId != null,
  });
  /**
   * Un `ref` y no estado: lock un campo no cambia nada de lo que se dibuja, y
   * como estado entraría en las dependencias del efecto de sugerencia — donde
   * solo serviría para recalcular los otros dos chips de gusto.
   */
  const lock = (c: Field) => {
    locked.current[c] = true;
  };
  /** Los links que se cosecharon del título. Se guardan en las notas al crear. */
  const [resources, setResources] = useState<string[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const chanRef = useRef<HTMLDivElement>(null);
  const objRef = useRef<HTMLDivElement>(null);
  const prioRef = useRef<HTMLDivElement>(null);
  const prioritiesOn = usePrioritiesOn();
  const rules = useSuggestRules();

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
   * Escape y ⌘Enter cuelgan de `window`, no del div del modal.
   *
   * Con el click afuera bloqueado, Escape pasó a ser **la única salida**, y un
   * `onKeyDown` en el div solo se dispara si el foco está adentro: alcanza un
   * click en el borde del modal —o en el overlay, que ahora no cierra— para que
   * el foco se vaya al `body` y la tecla no llegue a ningún lado. Es la trampa
   * que ya pagó `TaskModal`, con el mismo síntoma: la tecla muerta sin nada que
   * apunte al foco.
   *
   * Fase de burbuja a propósito, para que un control interno se quede con la
   * tecla antes (`SearchSelect` corta el Enter con `stopPropagation`).
   *
   * **Sin lista de dependencias, a propósito**: `create()` cierra sobre el título
   * y los cuatro chips, así que el handler tiene que rebindearse en cada render o
   * ⌘Enter guardaría lo que había al montarse. Acotarlo a `[picker]` es el bug de
   * closure vieja, no una optimización.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Con el diálogo de salida encima, las teclas son suyas.
      if (useAppStore.getState().quitOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        if (picker) setPicker(null);
        else closeCompose();
        return;
      }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        void create();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /**
   * Los chips que se deducen del título, **recalculados enteros en cada tecla**.
   *
   * Es una función del título actual y no un acumulado, y eso es lo que hace que
   * borrar funcione: si se saca "reunión" de la frase, los 30 minutos se van con
   * ella en vez de quedar colgados de una palabra que ya no está. Un campo que
   * el sugeridor no resuelve vuelve a vacío por el mismo motivo — mientras nadie
   * lo haya elegido a mano, el chip dice lo que dice el título y nada más.
   */
  useEffect(() => {
    const suggested = suggestFromTitle(title, categories, objectives, rules);
    if (!locked.current.planned) setPlanned(suggested.minutes ?? null);
    if (!locked.current.channel) setCategoryId(suggested.categoryId ?? null);
    if (!locked.current.objective) setObjectiveId(suggested.objectiveId ?? null);
  }, [title, categories, objectives, rules]);

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
    // El `#canal` que ya quedó en su campo sale del título, igual que los links:
    // si no, el canal viaja escrito dos veces y se lee en cada card.
    const t = stripChannelTag(text, selectedCat).trim();
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
      priority,
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
    /* El click afuera **no cierra**. Es el único modal de la app donde lo que se
     * pierde es texto que todavía no existe en ningún lado, y el gesto que lo
     * disparaba —un click al pasar— no se parece en nada a "descartar esto".
     * Para salir están Escape y la tecla de siempre. */
    <div className="compose-overlay">
      <div className="compose" role="dialog" aria-label="Nueva tarea">
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
                  {/* "Al backlog" y no "Sin fecha": con una fecha ya puesta, lo
                   * que se está eligiendo no es un estado sino a dónde se manda
                   * la tarea, y el backlog es el lugar que tiene nombre. */}
                  <button
                    onClick={() => {
                      setDate(null);
                      setPicker(null);
                    }}
                  >
                    Al backlog
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
                    lock("planned");
                    setPicker(null);
                  }}
                />
              </Popover>
            )}
          </div>

          <div className="chip-wrap" ref={chanRef}>
            {/* Teñido con el color de su canal —`chip--canal` + `chipVarsForColor`,
             * los mismos que usan los selectores de Calendarios—, porque es el
             * mismo dato que el `#tag` de las cards: verlo en apricot genérico acá
             * y en su color allá lo desconecta de su canal. El `#` sigue la regla
             * de la lista de la que se eligió (`channelOptions`): lo llevan los
             * channels, no los contextos. */}
            <button
              className={`chip${picker === "channel" ? " is-open" : ""}${
                selectedCat ? " is-set chip--canal" : ""
              }`}
              style={chipVarsForColor(selectedCat?.color)}
              onClick={() => toggle("channel")}
            >
              <Hash size={14} />{" "}
              {selectedCat
                ? selectedCat.parentId != null
                  ? `#${selectedCat.name}`
                  : selectedCat.name
                : "canal"}
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
                    lock("channel");
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
                    lock("objective");
                    setPicker(null);
                  }}
                />
              </Popover>
            )}
          </div>

          {/* La prioridad solo si el interruptor está encendido (§ ajustes): con
           * las prioritiesOn apagadas no hay nada que elegir, y un chip que no
           * lleva a ningún lado es peor que la ausencia.
           *
           * Sin buscador, igual que en el detalle: son cinco opciones fijas que
           * caben enteras en el popover. */}
          {prioritiesOn && (
            <div className="chip-wrap" ref={prioRef}>
              <button
                className={`chip${picker === "priority" ? " is-open" : ""}${
                  priority ? " is-set" : ""
                }`}
                onClick={() => toggle("priority")}
              >
                {priority ? (
                  <PriorityTag priority={priority} />
                ) : (
                  <>
                    <Flag size={14} /> prioridad
                  </>
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
                        onClick={() => {
                          setPriority(p);
                          setPicker(null);
                        }}
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
                      onClick={() => {
                        setPriority(null);
                        setPicker(null);
                      }}
                    >
                      Sin prioridad
                    </button>
                  </div>
                </Popover>
              )}
            </div>
          )}
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
