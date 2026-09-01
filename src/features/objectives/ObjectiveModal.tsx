import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Flag, Hash, Trash2, X } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective, Task } from "../../lib/types";
import { SearchSelect } from "../../components/SearchSelect";
import { Popover } from "../../components/Popover";
import { channelOptions } from "../tasks/channelOptions";
import { chipVars } from "../tasks/chipVars";
import { TIME_PRESETS, formatMinutes } from "../../lib/capacity";
import { shortWeekday } from "../../lib/date";
import { shortDuration } from "../tasks/timeByDay";
import { useAppStore } from "../../lib/store";
import "./objectives.css";

/** Los mismos escalones que ofrece el estimado de una tarea. */

interface ObjectiveModalProps {
  objective: Objective;
  /** Las 7 fechas de la semana del objetivo, lunes→domingo. */
  dates: string[];
  /**
   * Las tareas de esa semana, ya cargadas por la vista. **Es la semana y nada
   * más**: una tarea colgada de este objetivo pero agendada en otra semana o
   * sentada en el backlog no llega acá, y por eso la lista y sus totales dicen
   * "de la semana" en vez de "del objetivo". El corte de la review sí la cuenta
   * (§4.29), así que los dos números pueden no coincidir a propósito.
   */
  tasks: Task[];
  categories: Category[];
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

/**
 * El detalle de un objetivo semanal: su channel, sus tareas con lo real contra
 * lo estimado, y la fila de siete días que **reparte las horas**.
 *
 * El reparto es la razón de ser del modal: elegir minutos en un día crea ahí una
 * tarea colgada del objetivo, que es cómo un objetivo semanal baja a tareas
 * diarias sin escribir el título siete veces.
 *
 * Dos reglas de producto que no son detalles de implementación:
 *
 * - **La tarea generada se llama como el objetivo**, sin el día pegado atrás. El
 *   día ya lo dice la columna del tablero, y repetirlo en el título es ruido en
 *   el único lugar donde el título se lee.
 * - **Bajar los minutos nunca borra la tarea.** Solo mueve el estimado, y
 *   "sin tiempo" la **desliga** del objetivo dejándola viva en su día. Es el
 *   precedente de DECISIONES §6: borrar es barato de equivocarse y caro de
 *   deshacer, y acá la tarea puede tener tiempo trackeado que no está en ningún
 *   otro lado.
 */
export function ObjectiveModal({
  objective,
  dates,
  tasks,
  categories,
  onClose,
  onChanged,
}: ObjectiveModalProps) {
  const [title, setTitle] = useState(objective.title);
  const [categoryId, setCategoryId] = useState<number | null>(objective.categoryId);
  const [picker, setPicker] = useState<"channel" | string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const chanRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const bumpData = useAppStore((s) => s.bumpData);

  const options = useMemo(() => channelOptions(categories), [categories]);
  const channel = categoryId != null ? categories.find((c) => c.id === categoryId) : null;

  const objTasks = useMemo(
    () => tasks.filter((t) => t.objectiveId === objective.id),
    [tasks, objective.id],
  );

  useEffect(() => {
    setTitle(objective.title);
    setCategoryId(objective.categoryId);
  }, [objective.title, objective.categoryId]);

  // El foco arranca en el título **con el texto seleccionado**: el modal se abre
  // recién creado el objetivo, con el nombre genérico puesto, así que lo primero
  // que se hace acá es reemplazarlo. Sin la selección hay que borrarlo a mano, y
  // dejar el campo en blanco no guarda nada (el autosave exige texto), así que un
  // objetivo cerrado a medio renombrar se quedaría con el genérico igual — que es
  // el peor caso aceptado, mejor que uno sin nombre.
  useEffect(() => {
    const input = titleRef.current;
    if (input) {
      input.focus();
      input.select();
    } else {
      dialogRef.current?.focus();
    }
  }, []);

  const commit = useCallback(
    async (patch: Parameters<typeof api.updateObjective>[1]) => {
      await api.updateObjective(objective.id, patch);
      await onChanged();
      bumpData();
    },
    [objective.id, onChanged, bumpData],
  );

  // El título se autoguarda con debounce, como el de una tarea. Y lo pendiente se
  // escribe al desmontar: cerrar dentro de los 500 ms no puede descartar lo
  // escrito cuando no hay botón "Guardar".
  const pendienteRef = useRef<string | null>(null);
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const onTitle = (v: string) => {
    setTitle(v);
    pendienteRef.current = v;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const p = pendienteRef.current;
      pendienteRef.current = null;
      if (p !== null && p.trim()) void commitRef.current({ title: p.trim() });
    }, 500);
  };
  useEffect(
    () => () => {
      clearTimeout(debounceRef.current);
      const p = pendienteRef.current;
      pendienteRef.current = null;
      if (p !== null && p.trim()) void commitRef.current({ title: p.trim() });
    },
    [],
  );

  // Escape cierra, y el picker abierto primero. En `window` con captura porque
  // los popovers viven en un portal y su Escape no pasa por este div (SPECS §7).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (picker) {
        e.stopPropagation();
        setPicker(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [picker, onClose]);

  /** Las tareas del objetivo que caen en un día, en el orden del tablero. */
  const delDia = useCallback(
    (date: string) =>
      objTasks
        .filter((t) => t.scheduledDate === date)
        .sort((a, b) => a.position - b.position || a.id - b.id),
    [objTasks],
  );

  /**
   * Le pone (o le saca) minutos a un día.
   *
   * Con varias tareas ese día se edita **la primera** y las demás quedan como
   * están: la casilla muestra el total y avisa cuántas hay, así que el número no
   * miente aunque el gesto toque solo una.
   */
  const repartir = async (date: string, minutes: number | null) => {
    const existentes = delDia(date);
    const primera = existentes[0];
    if (!primera) {
      if (minutes == null) return;
      await api.createTask({
        title: objective.title,
        scheduledDate: date,
        estimatedMinutes: minutes,
        objectiveId: objective.id,
        categoryId: objective.categoryId,
      });
    } else if (minutes == null) {
      // Nunca se borra: se desliga y la tarea sigue viva en su día con su tiempo.
      await api.updateTask(primera.id, { objectiveId: null });
    } else {
      await api.updateTask(primera.id, { estimatedMinutes: minutes });
    }
    setPicker(null);
    await onChanged();
    bumpData();
  };

  const totalPlanned = objTasks.reduce((a, t) => a + (t.estimatedMinutes ?? 0), 0);
  const totalActual = objTasks.reduce((a, t) => a + t.actualSeconds, 0);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="omodal"
        role="dialog"
        aria-modal="true"
        aria-label={`Objetivo ${objective.title}`}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="omodal__head">
          <Flag size={16} aria-hidden style={{ color: "var(--apricot-ink)" }} />
          <input
            ref={titleRef}
            className="omodal__title"
            value={title}
            aria-label="Título del objetivo"
            onChange={(e) => onTitle(e.target.value)}
          />
          <button
            className="obj-chip__check"
            aria-label={objective.completed ? "Reabrir objetivo" : "Completar objetivo"}
            onClick={() => void commit({ completed: !objective.completed })}
            style={
              objective.completed
                ? { background: "var(--mint-ink)", borderColor: "var(--mint-ink)" }
                : undefined
            }
          >
            {objective.completed && <Check size={11} strokeWidth={3} />}
          </button>
          <button className="btn-icon" aria-label="Cerrar" onClick={onClose}>
            <X size={15} />
          </button>
        </header>

        <div className="omodal__meta" ref={chanRef}>
          <button
            className="omodal__chip"
            onClick={() => setPicker((p) => (p === "channel" ? null : "channel"))}
          >
            <span className="omodal__chip-label">Channel</span>
            {/* Con canal elegido va el chip teñido, el mismo `#tag` que llevan las
             * tarjetas: es el mismo dato y verlo en gris acá lo desconecta de su
             * canal. Sin canal no hay color que mostrar, así que se queda el
             * numeral en gris. */}
            {channel ? (
              <span className="cat-tag" style={chipVars(channel)}>
                #{channel.name}
              </span>
            ) : (
              <span className="omodal__chip-value">
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
          <span className="omodal__totales">
            Esta semana: {shortDuration(totalActual)} de {formatMinutes(totalPlanned)} estimados
          </span>
        </div>

        <section className="omodal__reparto">
          <div className="omodal__step-label">Reparto de la semana</div>
          <div className="omodal__dias">
            {dates.map((date) => {
              const delDiaTasks = delDia(date);
              const minutos = delDiaTasks.reduce((a, t) => a + (t.estimatedMinutes ?? 0), 0);
              return (
                <DiaCasilla
                  key={date}
                  date={date}
                  minutes={minutos}
                  count={delDiaTasks.length}
                  open={picker === date}
                  onToggle={() => setPicker((p) => (p === date ? null : date))}
                  onPick={(m) => void repartir(date, m)}
                />
              );
            })}
          </div>
          <p className="omodal__pie">
            Elegir minutos crea la tarea del día colgada de este objetivo. «Sin tiempo» no la borra:
            la desliga y la deja en su día.
          </p>
        </section>

        <section className="omodal__tareas">
          <div className="omodal__step-label">Tareas de la semana</div>
          {objTasks.length === 0 ? (
            <p className="omodal__vacio">Esta semana no hay tareas colgando de este objetivo.</p>
          ) : (
            objTasks.map((t) => (
              <div key={t.id} className={`omodal__tarea${t.status === "DONE" ? " is-done" : ""}`}>
                <span className="omodal__tarea-check" aria-hidden>
                  {t.status === "DONE" && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="omodal__tarea-titulo">{t.title}</span>
                {/* Siempre tiene fecha: `tasks` es el rango de la semana. */}
                <span className="omodal__tarea-dia">{shortWeekday(t.scheduledDate!)}</span>
                <span className="omodal__tarea-tiempo">
                  {shortDuration(t.actualSeconds)}
                  {t.estimatedMinutes != null && ` / ${formatMinutes(t.estimatedMinutes)}`}
                </span>
                <button
                  className="set-row__icon"
                  aria-label={`Desligar ${t.title} del objetivo`}
                  onClick={async () => {
                    await api.updateTask(t.id, { objectiveId: null });
                    await onChanged();
                    bumpData();
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}

interface DiaCasillaProps {
  date: string;
  minutes: number;
  count: number;
  open: boolean;
  onToggle: () => void;
  onPick: (minutes: number | null) => void;
}

/** Una de las siete casillas Lun→Dom, con su popover de minutos. */
function DiaCasilla({ date, minutes, count, open, onToggle, onPick }: DiaCasillaProps) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="omodal__dia-wrap" ref={ref}>
      <button
        className={`omodal__dia${minutes > 0 ? " is-set" : ""}`}
        aria-label={`Repartir minutos del ${shortWeekday(date)}`}
        onClick={onToggle}
      >
        <span className="omodal__dia-nombre">{shortWeekday(date)}</span>
        <span className="omodal__dia-min">{minutes > 0 ? formatMinutes(minutes) : "—"}</span>
        {count > 1 && <span className="omodal__dia-count">{count} tareas</span>}
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={onToggle}>
          <SearchSelect
            options={TIME_PRESETS.map((m) => ({
              value: String(m),
              label: formatMinutes(m),
              hint: `${m} min`,
            }))}
            value={minutes > 0 ? String(minutes) : null}
            placeholder="Minutos…"
            clearLabel="Sin tiempo"
            onSelect={(v) => onPick(v ? Number(v) : null)}
          />
        </Popover>
      )}
    </div>
  );
}
