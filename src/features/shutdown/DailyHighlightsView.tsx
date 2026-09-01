import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronDown, Clock, Lock, PenLine, PieChart, Timer } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, LogDay, Objective, Task } from "../../lib/types";
import {
  dateLabel,
  hhmmInZone,
  isToday,
  isoWeekId,
  parseISODate,
  shiftWeeks,
  weekdayLabel,
} from "../../lib/date";
import { formatMinutes } from "../../lib/capacity";
import { groupBy } from "../../lib/segmentos";
import { useAppStore } from "../../lib/store";
import { useToday } from "../../lib/day";
import { useTimer } from "../timer/useTimer";
import { Donut } from "../../components/Donut";
import { TaskModal } from "../tasks/TaskModal";
import { highlights, visibleDays, segmentSeconds, workedWithRunning } from "./dailyLog";
import "./shutdown.css";

/** Cuántos días se piden de una. Alcanza para un mes de bitácora. */
const VENTANA = 30;

/** `5400` → `'1:30'`. Mismo formato de contador que las cards del tablero. */
function reloj(seconds: number): string {
  return formatMinutes(Math.max(0, seconds) / 60);
}

/**
 * La bitácora: un día por entrada, del más nuevo al más viejo.
 *
 * **Se llena sola.** Sale del trabajo trackeado y de las tareas que cerraste, no
 * de haber pasado por el shutdown (§4.16). Un día que nunca cerraste aparece
 * igual, marcado como **borrador**: eso es el dato, no un hueco.
 *
 * El día va **arriba, como separador** —no como título de una tarjeta— para que
 * el feed se lea como un cuaderno: la fecha corta, y debajo lo que pasó. A la
 * izquierda los highlights como línea de tiempo; a la derecha los contadores, el
 * timeline completo y el donut de channels, **plegado por defecto**: es un
 * detalle que se consulta, no algo que se mire siempre.
 */
export function DailyHighlightsView() {
  const [days, setDias] = useState<LogDay[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [abierta, setAbierta] = useState<Task | null>(null);
  /** Qué días tienen el donut desplegado. Plegado por defecto. */
  const [analytics, setAnalytics] = useState<Set<string>>(new Set());
  const dataVersion = useAppStore((s) => s.dataVersion);
  // Una sesión abierta cruza la medianoche sin enterarse.
  const today = useToday();
  // Lo de la corrida en curso todavía no está en la base: lo tiene el taxímetro.
  const { runTotal } = useTimer();

  const load = useCallback(async () => {
    // Los objetivos van por **rango** y no por semana: la bitácora abarca 30
    // días, o sea cinco semanas, y el detalle de una tarea de hace tres semanas
    // tiene que poder mostrar —y cambiar— el objetivo del que cuelga. Con la
    // lista de una sola semana el picker mentía; con `objectives={[]}`, que es
    // como estaba, no ofrecía ninguno.
    const anchor = parseISODate(today);
    const desde = isoWeekId(shiftWeeks(anchor, -Math.ceil(VENTANA / 7)));
    const [b, cats, objs] = await Promise.all([
      api.dailyLog(today, VENTANA),
      api.listCategories(),
      api.listObjectivesRange(desde, isoWeekId(anchor)),
    ]);
    setDias(b);
    setCategories(cats);
    setObjectives(objs);
  }, [today]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const visibles = useMemo(() => (days ? visibleDays(days, today) : []), [days, today]);

  const alternar = (date: string) =>
    setAnalytics((previo) => {
      const proximo = new Set(previo);
      if (proximo.has(date)) proximo.delete(date);
      else proximo.add(date);
      return proximo;
    });

  if (!days) return <p className="review__vacio">Cargando la bitácora…</p>;

  return (
    <div className="bitacora">
      <header className="bitacora__head">
        <h1 className="bitacora__titulo">
          <BookOpen size={17} aria-hidden /> Daily highlights
        </h1>
        <p className="bitacora__lema">Lo que hiciste, día por día, sin tener que acordarte.</p>
      </header>

      <div className="bitacora__feed">
        {visibles.map((d) => {
          // La corrida en curso se le suma **solo a hoy**: `runTotal` se mide
          // desde la medianoche local (I3), así que en cualquier otro día no
          // significa nada. Y un timer abierto desde las 23:50 de ayer marca la
          // fila de ayer como corriendo, que es justo el caso que sumaría mal.
          const enCurso = d.date === today ? runTotal : 0;
          const worked = workedWithRunning(d, enCurso);
          const { shown, others } = highlights(d);
          const channels = groupBy(d.cells, catMap, false);
          const verDonut = analytics.has(d.date);

          return (
            <section key={d.date} className="dia">
              {/* El separador: la fecha centrada, como el corte de un cuaderno. */}
              <div className="dia__sep">
                <span>{isToday(d.date) ? "Hoy" : dateLabel(d.date)}</span>
              </div>

              <div className="dia__cuerpo">
                <div className="dia__izq">
                  <span className="dia__estado">
                    {d.closedAt != null ? (
                      <>
                        <Lock size={10} aria-hidden /> Cerrado {hhmmInZone(d.closedAt)}
                      </>
                    ) : (
                      <>
                        <PenLine size={10} aria-hidden /> Borrador
                      </>
                    )}
                  </span>
                  <h2 className="dia__nombre">
                    {weekdayLabel(d.date)}
                    {d.mood && <span className="dia__mood">{d.mood}</span>}
                  </h2>

                  {d.note && <p className="dia__nota">{d.note}</p>}

                  {shown.length === 0 ? (
                    <p className="review__vacio">
                      {isToday(d.date) ? "Todavía no cerraste nada hoy." : "Nada cerrado ese día."}
                    </p>
                  ) : (
                    <ul className="hitos">
                      {shown.map(({ task, note }) => {
                        const ch =
                          task.categoryId != null ? catMap.get(task.categoryId) : undefined;
                        return (
                          <li key={task.id}>
                            {/* El punto va centrado verticalmente sobre la fila
                                entera, con o sin channel y con o sin resumen:
                                alineado arriba, cada hito parecía empezar a una
                                altura distinta. */}
                            <span
                              className="hitos__punto"
                              style={ch ? { background: `var(--${ch.color}-ink)` } : undefined}
                            />
                            <button className="hitos__cuerpo" onClick={() => setAbierta(task)}>
                              {ch && <span className="hitos__channel">#{ch.name}</span>}
                              <span className="hitos__titulo">{task.title}</span>
                              {note && <span className="hitos__nota">{note}</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Lo que no incluiste no se esconde: se dice cuánto fue. */}
                  {others.length > 0 && (
                    <p className="dia__otras">y {others.length} más, sin resumen</p>
                  )}
                </div>

                <aside className="dia__der">
                  <div className="dia__contadores">
                    <span>
                      <em>Trabajado</em>
                      <b>{reloj(worked)}</b>
                    </span>
                    <span>
                      <em>Planificado</em>
                      <b>{formatMinutes(d.plannedMinutes)}</b>
                    </span>
                  </div>

                  <div className="dia__tl">
                    <span className="dia__rotulo">
                      <Clock size={10} aria-hidden /> Timeline
                    </span>
                    {d.timeline.length === 0 ? (
                      <p className="review__vacio">Sin tiempo trackeado.</p>
                    ) : (
                      <ul>
                        {d.timeline.map((t) => (
                          <li key={t.taskId} className={t.running ? "is-running" : ""}>
                            <span className="dia__tlTitle">{t.title}</span>
                            <span className="dia__tlDur">
                              {t.running && <Timer size={9} aria-hidden />}
                              {reloj(segmentSeconds(t, enCurso))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {channels.length > 0 && (
                    <div className="dia__analytics">
                      <button
                        className="dia__rotulo dia__toggle"
                        aria-expanded={verDonut}
                        onClick={() => alternar(d.date)}
                      >
                        <PieChart size={10} aria-hidden /> Channels
                        <ChevronDown
                          size={11}
                          aria-hidden
                          className={verDonut ? "is-open" : undefined}
                        />
                      </button>
                      {verDonut && (
                        <div className="dia__donut">
                          <Donut segments={channels} total={d.workedSeconds} />
                          <ul className="leyenda">
                            {channels.map((c) => (
                              <li key={c.key}>
                                <span className="leyenda__punto" style={{ background: c.color }} />
                                <span className="leyenda__nombre">{c.name}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </aside>
              </div>
            </section>
          );
        })}
      </div>

      {abierta && (
        <TaskModal
          task={abierta}
          categories={categories}
          objectives={objectives}
          onClose={() => setAbierta(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
