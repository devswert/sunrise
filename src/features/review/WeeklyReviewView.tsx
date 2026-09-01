import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Hash,
  PieChart,
  Target,
  Trophy,
  X,
} from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective, Task, WeeklyRollup } from "../../lib/types";
import {
  dateLabel,
  isoWeekId,
  shiftWeeks,
  shortWeekday,
  todayISO,
  weekDates,
} from "../../lib/date";
import { useAppStore } from "../../lib/store";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { Popover } from "../../components/Popover";
import { channelOptions } from "../tasks/channelOptions";
import { hayFiltro, matchesFilter, SIN_FILTRO, toggleId, type ReviewFilter } from "./reviewFilter";
import { TaskCardStatic } from "../week/TaskCard";
import { TaskModal } from "../tasks/TaskModal";
import { Donut } from "../../components/Donut";
import {
  barsByDay,
  closedByDay,
  hours,
  hoursFromMinutes,
  byContext,
  ceilingInMinutes,
} from "./weeklyReview";
import "./review.css";

/** Una cifra de la cabecera: punto de color, número y su etiqueta, en una línea. */
/**
 * Un chip que abre un dropdown **multi-selección** y no se cierra al elegir:
 * poner dos objetivos o dos channels sin reabrirlo es todo el punto del filtro.
 * El contador va en el chip para que se note que hay filtro puesto aunque el
 * popover esté cerrado.
 */
function FiltroSelect({
  label,
  icon,
  options,
  selected,
  onToggle,
}: {
  label: string;
  icon: ReactNode;
  options: SearchOption[];
  selected: Set<number>;
  onToggle: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const marcados = useMemo(() => new Set([...selected].map(String)), [selected]);
  return (
    <div className="chip-wrap" ref={ref}>
      <button
        className={`review__filtro${selected.size > 0 ? " is-set" : ""}`}
        aria-label={`Filtrar por ${label.toLowerCase()}`}
        aria-pressed={selected.size > 0}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        {label}
        {selected.size > 0 && <span className="review__filtro-n">{selected.size}</span>}
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)}>
          <SearchSelect
            options={options}
            value={null}
            selected={marcados}
            placeholder={`Buscar ${label.toLowerCase()}…`}
            emptyLabel={`No hay ${label.toLowerCase()} esta semana`}
            onSelect={(v) => {
              if (v) onToggle(Number(v));
            }}
          />
        </Popover>
      )}
    </div>
  );
}

function Chip({ color, value, label }: { color: string; value: string | number; label: string }) {
  return (
    <span className="chip-cifra">
      <span className="chip-cifra__punto" style={{ background: color }} />
      <strong>{value}</strong> {label}
    </span>
  );
}

/**
 * La weekly review: qué se hizo, cuánto tiempo se fue y en qué.
 *
 * Todo el cálculo llega hecho desde `repo::weekly_rollup` —un solo comando— y
 * acá solo se dibuja. Es a propósito: la atribución por día local y las Reglas 2
 * y 3 son la parte frágil, y viven donde se pueden probar con SQLite en memoria.
 *
 * Los gráficos son **a mano** (divs para las barras, un `<svg>` para el donut) y
 * no con recharts, aunque esté instalado: los colores de los channels son tokens
 * de la paleta (`var(--mint)`), y eso obliga a resolverlos a hex —y a volver a
 * resolverlos al cambiar de tema— si el color viaja como prop a una librería.
 * Con CSS los dos temas salen gratis, y encima los tests pueden mirar el DOM.
 */
export function WeeklyReviewView() {
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  const [rollup, setRollup] = useState<WeeklyRollup | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  // Se guarda la tarea, no solo su id: destildarla desde el modal la saca de
  // `completadas`, y buscarla ahí dejaría el modal desaparecido a media edición.
  const [abierta, setAbierta] = useState<Task | null>(null);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const bumpData = useAppStore((s) => s.bumpData);

  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const isoWeek = isoWeekId(anchor);

  const load = useCallback(async () => {
    const [r, cats, objs] = await Promise.all([
      api.weeklyRollup(dates[0]),
      api.listCategories(),
      api.listObjectives(isoWeek),
    ]);
    setRollup(r);
    setCategories(cats);
    setObjectives(objs);
  }, [dates, isoWeek]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const barras = useMemo(() => (rollup ? barsByDay(rollup, catMap) : []), [rollup, catMap]);
  const contextos = useMemo(() => (rollup ? byContext(rollup, catMap) : []), [rollup, catMap]);
  const closed = useMemo(() => (rollup ? closedByDay(rollup) : new Map()), [rollup]);
  const techo = ceilingInMinutes(barras);

  const toggle = async (t: Task) => {
    await api.setTaskStatus(t.id, t.status === "DONE" ? "TODO" : "DONE");
    bumpData();
  };

  const toggleObjective = async (o: Objective) => {
    await api.updateObjective(o.id, { completed: !o.completed });
    bumpData();
  };

  /**
   * El filtro, **uno solo para los dos controles**: la lista de objetivos
   * clickeable y los dos dropdowns escriben acá y se leen entre sí. Dos
   * mecanismos separados es cómo terminan mostrando cosas distintas.
   */
  const [filter, setFilter] = useState<ReviewFilter>(SIN_FILTRO);
  const filtroActivo = hayFiltro(filter);
  // Cambiar de semana limpia el filtro: los ids de objetivo son de la semana que
  // se estaba mirando y en otra no seleccionan nada, así que quedaría una vista
  // vacía sin explicación.
  useEffect(() => {
    setFilter(SIN_FILTRO);
  }, [isoWeek]);

  const toggleObjectiveFilter = (id: number) =>
    setFilter((f) => ({ ...f, objectiveIds: toggleId(f.objectiveIds, id) }));

  /** Cuántas cerradas sobreviven al filtro, para que un día vacío se explique. */
  const visiblesFiltradas = useMemo(
    () => (rollup?.completedTasks ?? []).filter((t) => matchesFilter(t, filter, catMap)).length,
    [rollup, filter, catMap],
  );

  const selectedTask = rollup?.completedTasks.find((t) => t.id === abierta?.id) ?? abierta;
  const esSemanaActual = dates.includes(todayISO());
  const cumplidos = objectives.filter((o) => o.completed).length;

  return (
    <div className="review">
      <header className="review__head">
        <div>
          <h1 className="review__title">
            <Trophy size={19} aria-hidden /> Weekly review
          </h1>
          <p className="review__sub">
            Semana {isoWeek} · {dateLabel(dates[0])} al {dateLabel(dates[6])}
          </p>
        </div>

        {/* Las cifras van en la cabecera, no en una banda propia: son el
            encabezado de la semana, y como banda se comían el alto que le hace
            falta a "lo que se cerró". */}
        {rollup && (
          <div className="review__cifras">
            <Chip color="var(--mint-ink)" value={rollup.completedTasks.length} label="cerradas" />
            <Chip color="var(--sage-ink)" value={hours(rollup.totalSeconds)} label="trabajado" />
            {/* El gris es el mismo de la marca punteada del gráfico: el color
                ata la cifra a lo que representa más abajo. */}
            <Chip
              color="var(--faint)"
              value={hoursFromMinutes(rollup.plannedMinutes)}
              label="planificado"
            />
            {objectives.length > 0 && (
              <Chip
                color="var(--lavender-ink)"
                value={`${cumplidos}/${objectives.length}`}
                label="objetivos"
              />
            )}
            {rollup.objectiveSeconds > 0 && (
              <Chip
                color="var(--apricot-ink)"
                value={hours(rollup.objectiveSeconds)}
                label="en objetivos"
              />
            )}
          </div>
        )}

        <div className="review__nav">
          <button
            className="btn-icon"
            aria-label="Semana anterior"
            onClick={() => setAnchor((a) => shiftWeeks(a, -1))}
          >
            <ChevronLeft size={15} aria-hidden />
          </button>
          <button
            className="steps__pill"
            disabled={esSemanaActual}
            onClick={() => setAnchor(new Date())}
          >
            Esta semana
          </button>
          <button
            className="btn-icon"
            aria-label="Semana siguiente"
            onClick={() => setAnchor((a) => shiftWeeks(a, 1))}
          >
            <ChevronRight size={15} aria-hidden />
          </button>
        </div>
      </header>

      {!rollup ? (
        <p className="review__vacio">Cargando la semana…</p>
      ) : (
        <div className="review__body">
          {rollup.unestimated > 0 && (
            <p className="review__aviso">
              {rollup.unestimated} {rollup.unestimated === 1 ? "tarea" : "tareas"} sin estimar: lo
              planificado de la semana va corto.
            </p>
          )}

          <div className="review__graficos">
            {/* Daily productivity */}
            <section className="review__panel">
              <h2 className="review__h2">
                <BarChart3 size={14} aria-hidden /> Productividad diaria
                {/* La escala va en el título y no dentro del gráfico: el día
                    más alto toca el techo, así que ahí adentro el rótulo se
                    choca con su propia marca. */}
                <span className="review__pista">
                  <span className="review__pista-linea" /> planificado · escala{" "}
                  {hoursFromMinutes(techo)}
                </span>
              </h2>
              <div className="barras">
                {barras.map((d) => (
                  <div key={d.date} className="barra">
                    <div className="barra__caja">
                      {/* Lo planificado es una marca, no otra barra: son dos
                          medidas de la misma jornada, no dos jornadas. */}
                      {d.plannedMinutes > 0 && (
                        <span
                          className="barra__plan"
                          style={{ bottom: `${(d.plannedMinutes / techo) * 100}%` }}
                          title={`Planificado: ${hoursFromMinutes(d.plannedMinutes)}`}
                        />
                      )}
                      <div className="barra__pila">
                        {d.segments.map((s) => (
                          <span
                            key={s.key}
                            className="barra__seg"
                            style={{
                              height: `${(s.seconds / 60 / techo) * 100}%`,
                              background: s.color,
                            }}
                            title={`${s.name}: ${hours(s.seconds)}`}
                          />
                        ))}
                      </div>
                    </div>
                    <span className="barra__label">{d.label}</span>
                    <span className="barra__total">{d.seconds > 0 ? hours(d.seconds) : "—"}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* How you spent your time */}
            <section className="review__panel">
              <h2 className="review__h2">
                <PieChart size={14} aria-hidden /> En qué se fue el tiempo
              </h2>
              {contextos.length === 0 ? (
                <p className="review__vacio">Sin tiempo registrado esta semana.</p>
              ) : (
                <div className="donut-bloque">
                  <Donut segments={contextos} total={rollup.totalSeconds} />
                  <ul className="leyenda">
                    {contextos.map((s) => (
                      <li key={s.key}>
                        <span className="leyenda__punto" style={{ background: s.color }} />
                        <span className="leyenda__nombre">{s.name}</span>
                        <span className="leyenda__valor">{hours(s.seconds)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            {/* Los objetivos son una lista corta: van de tercera columna en la
                misma fila, no de banda a lo ancho. **La caja está siempre**,
                aunque no haya ninguno: una semana sin objetivos es un dato de la
                review, y esconder el panel lo haría pasar por olvido. */}
            <section className="review__panel review__panel--objs">
              <h2 className="review__h2">
                <Target size={14} aria-hidden /> Objetivos
              </h2>
              {/* El corte del tiempo. Cuenta el trabajo de tareas colgadas de
                  **algún** objetivo, no solo de los de esta semana: para esta
                  pregunta lo que importa es si el rato era parte de un objetivo,
                  no de cuál. Por eso puede haber horas acá con la lista vacía. */}
              {rollup.totalSeconds > 0 && (
                <div className="review__split">
                  <div className="review__split-bar">
                    <div
                      className="review__split-obj"
                      style={{
                        width: `${Math.round((rollup.objectiveSeconds / rollup.totalSeconds) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="review__split-texto">
                    {hours(rollup.objectiveSeconds)} en objetivos ·{" "}
                    {hours(rollup.totalSeconds - rollup.objectiveSeconds)} en lo demás
                  </p>
                </div>
              )}
              {objectives.length === 0 ? (
                <div className="review__sin-objs">
                  <Target size={22} aria-hidden />
                  <p>Semana sin objetivos</p>
                </div>
              ) : (
                <ul className="review__objs">
                  {objectives.map((o) => {
                    const trabajado =
                      rollup.byObjective.find((x) => x.objectiveId === o.id)?.seconds ?? 0;
                    const activo = filter.objectiveIds.has(o.id);
                    return (
                      <li
                        key={o.id}
                        className={`${o.completed ? "is-done" : ""}${activo ? " is-filtrando" : ""}`}
                      >
                        {/* Tildar se hace **acá**, que es donde uno se acuerda de
                            que cumplió algo. Corta el click para no filtrar de
                            paso: son dos gestos distintos sobre la misma fila. */}
                        <button
                          className="review__obj-check"
                          aria-label={o.completed ? "Reabrir objetivo" : "Completar objetivo"}
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleObjective(o);
                          }}
                        >
                          {o.completed ? (
                            <CheckCircle2 size={13} aria-hidden />
                          ) : (
                            <Circle size={13} aria-hidden />
                          )}
                        </button>
                        {/* El resto de la fila filtra lo cerrado de más abajo. */}
                        <button
                          className="review__obj-title"
                          aria-pressed={activo}
                          onClick={() => toggleObjectiveFilter(o.id)}
                        >
                          {o.title}
                        </button>
                        {trabajado > 0 && <span className="review__obj-h">{hours(trabajado)}</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>

          {/* Lo cerrado, día por día */}
          <section className="review__panel">
            <header className="review__cerrado-head">
              <h2 className="review__h2">Lo que se cerró</h2>
              {/* Los filtros van **acá y no en la cabecera de la vista**: es lo
                  único que filtran. Los gráficos de arriba siguen mostrando la
                  semana entera a propósito — son la respuesta a "en qué se me fue
                  el tiempo", que no cambia porque uno esté mirando un objetivo. */}
              <FiltroSelect
                label="Objetivo"
                icon={<Target size={13} aria-hidden />}
                options={objectives.map((o) => ({ value: String(o.id), label: o.title }))}
                selected={filter.objectiveIds}
                onToggle={toggleObjectiveFilter}
              />
              <FiltroSelect
                label="Channel"
                icon={<Hash size={13} aria-hidden />}
                options={channelOptions(categories)}
                selected={filter.categoryIds}
                onToggle={(id) =>
                  setFilter((f) => ({ ...f, categoryIds: toggleId(f.categoryIds, id) }))
                }
              />
              {filtroActivo && (
                <button className="btn-ghost" onClick={() => setFilter(SIN_FILTRO)}>
                  <X size={13} aria-hidden /> Quitar filtros
                </button>
              )}
            </header>
            {filtroActivo && (
              <p className="review__filtro-aviso">
                Filtrado: {visiblesFiltradas} de {rollup.completedTasks.length} cerradas.
              </p>
            )}
            <div className="review__dias">
              {rollup.days.map((d) => {
                const list: Task[] = (closed.get(d.date) ?? []).filter((t: Task) =>
                  matchesFilter(t, filter, catMap),
                );
                return (
                  <div key={d.date} className="review__dia">
                    <header className="review__dia-head">
                      <span>{shortWeekday(d.date)}</span>
                      <span className="review__dia-h">{d.seconds > 0 ? hours(d.seconds) : ""}</span>
                    </header>
                    {list.length === 0 ? (
                      <p className="review__vacio">—</p>
                    ) : (
                      list.map((t) => (
                        <TaskCardStatic
                          key={t.id}
                          task={t}
                          category={t.categoryId != null ? catMap.get(t.categoryId) : null}
                          categories={categories}
                          onToggle={toggle}
                          onOpen={(x) => setAbierta(x)}
                        />
                      ))
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          categories={categories}
          objectives={objectives}
          onClose={() => setAbierta(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
