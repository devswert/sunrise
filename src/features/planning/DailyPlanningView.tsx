import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarCheck, Check, History, Inbox, Sunrise } from "lucide-react";
import { DayBoard } from "../week/DayBoard";
import { TaskCardStatic } from "../week/TaskCard";
import { TaskModal } from "../tasks/TaskModal";
import { Dialog } from "../../components/Dialog";
import { reorderLocal } from "../tasks/reorder";
import { useBoard } from "../tasks/useBoard";
import { CalendarRail } from "../calendar/CalendarRail";
import { useDayWork } from "../calendar/useTrabajoDelDia";
import { api } from "../../lib/ipc";
import type { Task, DayWork } from "../../lib/types";
import { CapacityLevel } from "../../lib/enums";
import { formatMinutes } from "../../lib/capacity";
import { dateLabel, parseISODate, toISODate, toISOTimestamp, weekdayLabel } from "../../lib/date";
import { useToday } from "../../lib/day";
import {
  SettingKey,
  useCapacitySettings,
  useSettingsStore,
  useWorkHours,
  planMark,
  type PlanMark,
} from "../../lib/settings";
import { useAppStore } from "../../lib/store";
import { celebrate } from "../../lib/confetti";
import {
  capacityMessage,
  workedMinutes,
  dayRecap,
  daySummary,
  lastDayWithTasks,
} from "./dailyPlan";

/** Modificadores propios: las `.cap--*` de la semana son un chip, no un medidor. */
const NIVEL_CLASS: Record<CapacityLevel, string> = {
  [CapacityLevel.OK]: "is-ok",
  [CapacityLevel.WARN]: "is-warn",
  [CapacityLevel.OVER]: "is-over",
};

/**
 * Dos pasos, no tres: "armar el día" y "ver si cabe" son el mismo gesto —se
 * saca algo justamente porque no cabe—, y separarlos obligaba a ir y volver
 * para tomar una sola decisión.
 */
const PASOS = ["Cómo cerró ayer", "Qué hay para hoy"];

/** Cuántos días se miran hacia atrás para encontrar el último con actividad. */
const VENTANA_ATRAS = 7;

function sumarDias(date: string, delta: number): string {
  const d = parseISODate(date);
  d.setDate(d.getDate() + delta);
  return toISODate(d);
}

/**
 * Ritual de planificación diaria, en dos pasos: cerrar el día anterior y armar
 * el de hoy contra el backlog y la agenda.
 *
 * **No guarda nada** — todo lo que se toca acá ya persiste solo (autosave, la
 * convención del proyecto). El botón del final es un **terminador de ritual**,
 * no un "Guardar": marca el día como planificado y te devuelve a la semana.
 *
 * Tampoco corre el carry-over: `useBoard` ya lo arrastró al montar cualquier
 * vista, mucho antes de que llegues acá. El paso 1 lo **muestra para
 * triagearlo**, sin decidir por el usuario (misma regla que Mej.3), y además
 * muestra lo que el carry-over **no** toca —las reuniones se quedan en su día—,
 * que si no se queda para siempre en un día que ya nadie mira.
 */
export function DailyPlanningView() {
  const today = useToday();
  const navigate = useNavigate();
  const board = useBoard(today, today);
  const capacity = useCapacitySettings();
  const workday = useWorkHours();
  const { work, segundosEnCurso } = useDayWork(today);
  const values = useSettingsStore((s) => s.values);
  const ajustesCargados = useSettingsStore((s) => s.loaded);
  const setSetting = useSettingsStore((s) => s.set);
  const dataVersion = useAppStore((s) => s.dataVersion);

  const [paso, setPaso] = useState(0);
  const [previas, setPrevias] = useState<Task[]>([]);
  const [backlog, setBacklog] = useState<Task[]>([]);
  const [rescued, setRescued] = useState<Map<number, string>>(new Map());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Guarda **la marca**, no un booleano: el aviso dice a qué hora planificaste,
  // y esa hora sale de lo guardado y no del reloj de ahora.
  const [notice, setAviso] = useState<PlanMark | null>(null);

  const load = useCallback(async () => {
    const [atras, bl, rescates] = await Promise.all([
      api.listTasksForRange(sumarDias(today, -VENTANA_ATRAS), sumarDias(today, -1)),
      api.listBacklog(),
      api.rescuedFromBacklog(),
    ]);
    setPrevias(atras);
    setBacklog(bl);
    // Se filtran los sin fecha: la clave existiendo con valor `undefined` es lo
    // que rompía la vista, porque `has()` decía que sí y el formateo recibía nada.
    setRescued(new Map(rescates.filter((r) => r.fromDate).map((r) => [r.taskId, r.fromDate])));
  }, [today]);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  const tasks = board.tasksByDate[today] ?? [];
  const summary = daySummary(tasks, capacity.target, capacity.warnRatio);

  /**
   * El día que se repasa es el último con tareas, y **coincide con el que la
   * degradación preserva** (`repo::demote_pending`): esa es la razón de que
   * el conteo sea honesto sin hacer nada más. Todo lo anterior ya está en el
   * backlog, así que no hay tareas que se hayan ido sin que las vieras.
   */
  const diaAnterior = useMemo(() => lastDayWithTasks(previas, today), [previas, today]);
  const delDiaAnterior = useMemo(
    () => previas.filter((t) => t.scheduledDate === diaAnterior),
    [previas, diaAnterior],
  );
  const repaso = useMemo(() => dayRecap(delDiaAnterior), [delDiaAnterior]);

  // Lo trabajado ese día es una lectura aparte: `actual_seconds` es el total de
  // la tarea, y una arrastrada de tres días lo trae todo junto.
  const [trabajadoAyer, setTrabajadoAyer] = useState(0);
  useEffect(() => {
    if (diaAnterior == null) {
      setTrabajadoAyer(0);
      return;
    }
    void api
      .dayWork(diaAnterior)
      .then((rows: DayWork[]) => setTrabajadoAyer(workedMinutes(rows)));
  }, [diaAnterior, dataVersion]);

  // Busca también en los días previos y en el backlog: el paso 1 abre tareas que
  // **no** están en el día de hoy, y `useBoard` solo carga hoy.
  const selectedTask =
    selectedId != null
      ? ([...board.tasks, ...previas, ...backlog].find((t) => t.id === selectedId) ?? null)
      : null;

  const move = async (id: number, date: string | null, position: number) => {
    // `board.moveTask` ya es optimista para la columna del día, pero el backlog
    // de acá es estado propio: sin esto la card cruzaba de columna recién cuando
    // volvía la escritura, y el salto se veía.
    const task = [...board.tasks, ...backlog].find((t) => t.id === id);
    if (task) {
      setBacklog((actual) =>
        date === null
          ? reorderLocal(actual, task, null, position).filter(
              (t) => (t.scheduledDate ?? null) === null,
            )
          : actual.filter((t) => t.id !== id),
      );
    }
    await board.moveTask(id, date, position);
    await load();
  };

  const terminar = async () => {
    // Fecha **y hora**: la hora es lo que hace desmentible el aviso de más abajo
    // (`planMark`). El prefijo del timestamp es, por construcción, el mismo día
    // que devuelve `todayISO()`, que es contra lo que se compara al leerlo.
    await setSetting(SettingKey.PLANNED_AT, toISOTimestamp(new Date()));
    // El confeti es imperativo y cuelga de `document.body`: sobrevive al
    // navigate de la línea siguiente (ver `lib/confetti.ts`).
    celebrate();
    navigate("/");
  };

  const last = paso === PASOS.length - 1;

  /**
   * Avisar **una vez por día**, cuando se entra a un día ya planificado. Antes
   * era un sello en la cabecera y se leía como decoración: el ritual está para
   * hacerse una vez, y volver a entrar suele ser sin querer.
   *
   * Se espera a que los ajustes estén cargados (`loaded`) o el diálogo saltaría
   * un frame tarde, ya con la vista dibujada. El `ref` guarda **para qué día**
   * se decidió, así una sesión que cruza la medianoche vuelve a preguntar.
   */
  const avisadoPara = useRef<string | null>(null);
  useEffect(() => {
    if (!ajustesCargados || avisadoPara.current === today) return;
    avisadoPara.current = today;
    const mark = planMark(values);
    if (mark?.date === today) setAviso(mark);
  }, [ajustesCargados, values, today]);

  /**
   * "Volver a planificar hoy": borra la marca y sigue el ritual.
   *
   * Sin esto el aviso era una afirmación sin salida —solo se podía cerrar—, y la
   * marca se escribe con gestos que el usuario no reconoce como planificar (un
   * ritual cerrado pasada la medianoche, por ejemplo). Deja `""` en vez de borrar
   * la fila: `set_setting` es un upsert y `planMark` trata el vacío como ausente,
   * que es el mismo gesto que "Volver a avisar hoy" en Dev Tools.
   */
  const desmentir = async () => {
    setAviso(null);
    await setSetting(SettingKey.PLANNED_AT, "");
  };

  const cardDe = (t: Task) => (
    <TaskCardStatic
      task={t}
      category={t.categoryId != null ? board.categoryMap.get(t.categoryId) : null}
      categories={board.categories}
      onToggle={board.toggleTask}
      onOpen={(x) => setSelectedId(x.id)}
      onPatch={board.patchTask}
    />
  );

  return (
    <div className="daily-plan">
      <header className="daily-plan__head">
        <div>
          <h1 className="daily-plan__title">
            <Sunrise size={20} aria-hidden /> Planificación diaria
          </h1>
          <p className="daily-plan__sub">
            {weekdayLabel(today)} {dateLabel(today)}
          </p>
        </div>
        {/* Los pasos se pueden saltear: es un guion, no un trámite. */}
        <nav className="steps" aria-label="Pasos del ritual">
          {PASOS.map((label, i) => (
            <button
              key={label}
              className={`steps__pill${i === paso ? " is-active" : ""}`}
              aria-current={i === paso ? "step" : undefined}
              onClick={() => setPaso(i)}
            >
              <span className="steps__n">{i + 1}</span>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <div className="daily-plan__body">
        {paso === 0 && (
          <div className="daily-plan__paso">
            {diaAnterior == null ? (
              <p className="daily-plan__empty">
                No hay días anteriores con tareas. Nada que cerrar.
              </p>
            ) : (
              <section className="repaso">
                <header className="repaso__hero">
                  <h2 className="repaso__dia">
                    {weekdayLabel(diaAnterior)} {dateLabel(diaAnterior)}
                  </h2>
                  <div className="repaso__cifras">
                    <div className="cifra">
                      <span className="cifra__n">
                        {repaso.closed.length}
                        <small>/{repaso.total}</small>
                      </span>
                      <span className="cifra__label">cerradas</span>
                    </div>
                    <div className="cifra">
                      <span className="cifra__n">{formatMinutes(repaso.planned)}</span>
                      <span className="cifra__label">planificado</span>
                    </div>
                    <div className="cifra">
                      <span className="cifra__n">{formatMinutes(trabajadoAyer)}</span>
                      <span className="cifra__label">trabajado</span>
                    </div>
                  </div>
                  <div className="repaso__barra">
                    <div
                      className="repaso__barra-fill"
                      style={{
                        width: `${
                          repaso.total ? Math.round((repaso.closed.length / repaso.total) * 100) : 0
                        }%`,
                      }}
                    />
                  </div>
                </header>

                {/* Lo que el carry-over **no** mueve: solo toca las `MANUAL`, así
                 * que acá quedan las reuniones, que si no se quedan para siempre
                 * en un día que ya nadie va a mirar. */}
                {repaso.abiertas.length > 0 && (
                  <>
                    <div className="repaso__grupo">
                      <History size={12} aria-hidden /> Quedaron abiertas ahí
                    </div>
                    {repaso.abiertas.map((t) => (
                      <div key={t.id} className="repaso__row">
                        {cardDe(t)}
                        <div className="repaso__acciones">
                          <button
                            className="btn-icon"
                            onClick={() => move(t.id, today, tasks.length)}
                            aria-label={`Traer ${t.title} a hoy`}
                            title="Traer a hoy"
                          >
                            <ArrowRight size={14} aria-hidden />
                          </button>
                          <button
                            className="btn-icon"
                            onClick={() => move(t.id, null, 0)}
                            aria-label={`Mandar ${t.title} al backlog`}
                            title="Mandar al backlog"
                          >
                            <Inbox size={14} aria-hidden />
                          </button>
                        </div>
                      </div>
                    ))}
                  </>
                )}

                {repaso.closed.length > 0 && (
                  <>
                    <div className="repaso__grupo">
                      <Check size={12} strokeWidth={3} aria-hidden /> Cerradas
                    </div>
                    {repaso.closed.map((t) => (
                      <div key={t.id} className="repaso__row">
                        {cardDe(t)}
                      </div>
                    ))}
                  </>
                )}
              </section>
            )}

          </div>
        )}

        {/* El día y el backlog, lado a lado y arrastrables entre sí: sacar algo
         * del día es soltarlo al lado, y traerlo de vuelta también. El gesto
         * lleva la acción y la intención, así que no hay botones que repitan lo
         * mismo. */}
        {paso === 1 && (
          <div className="daily-plan__paso daily-plan__hoy">
            <DayBoard
              date={today}
              tasks={tasks}
              backlog={backlog}
              rescued={rescued}
              categoryMap={board.categoryMap}
              categories={board.categories}
              capacityTarget={capacity.target}
              capacityWarnRatio={capacity.warnRatio}
              onToggle={board.toggleTask}
              onOpen={(t) => setSelectedId(t.id)}
              onPatch={board.patchTask}
              onMove={move}
              colClassName="daily-plan__col"
            />
          </div>
        )}

        {/* El rail acompaña los dos pasos: es la agenda contra la que se
         * planifica, y cambiar de paso no cambia el día. */}
        <CalendarRail
          date={today}
          today={today}
          tasks={tasks}
          categoryMap={board.categoryMap}
          workStart={workday.start}
          workEnd={workday.end}
          work={work}
          segundosEnCurso={segundosEnCurso}
          onOpen={(t) => setSelectedId(t.id)}
        />
      </div>

      <footer className="daily-plan__nav">
        {/* La carga del día en una línea. Como card ocupaba media pantalla para
         * decir dos números. */}
        <div className={`cap-line ${NIVEL_CLASS[summary.nivel]}`}>
          <strong>{formatMinutes(summary.planned)}</strong>
          {capacity.target > 0 && <span> de {formatMinutes(capacity.target)}</span>}
          <span className="cap-line__bar">
            <span
              className="cap-line__fill"
              style={{
                width: `${
                  capacity.target > 0
                    ? Math.min(100, Math.round((summary.planned / capacity.target) * 100))
                    : 0
                }%`,
              }}
            />
          </span>
          <span className="cap-line__msg">{capacityMessage(summary)}</span>
          {summary.withoutEstimate > 0 && (
            <span className="cap-line__warn">{summary.withoutEstimate} sin estimar</span>
          )}
        </div>

        <div className="daily-plan__botones">
          {paso > 0 && (
            <button className="btn-ghost" onClick={() => setPaso(paso - 1)}>
              Atrás
            </button>
          )}
          {last ? (
            <button className="btn-primary" onClick={terminar}>
              <Sunrise size={14} aria-hidden /> Empezar el día
            </button>
          ) : (
            <button className="btn-primary" onClick={() => setPaso(paso + 1)}>
              Siguiente <ArrowRight size={14} aria-hidden />
            </button>
          )}
        </div>
      </footer>

      {notice && (
        <Dialog
          title="Ya pasaste por acá"
          label="Ya planificaste hoy"
          icon={<CalendarCheck size={26} />}
          hint="Enter o Escape para revisar"
          onClose={() => setAviso(null)}
          onEnter={() => setAviso(null)}
          actions={
            <>
              <button className="btn-ghost" onClick={() => navigate("/")}>
                Ir a la semana
              </button>
              <button className="btn-primary" onClick={() => setAviso(null)} autoFocus>
                <ArrowRight size={14} aria-hidden /> Revisar igual
              </button>
            </>
          }
        >
          <p className="dialog__body">
            {notice.time
              ? `Hoy a las ${notice.time} cerraste la planificación.`
              : "Hoy ya cerraste la planificación (la marca no dice a qué hora)."}{" "}
            Puedes revisarla igual —nada se deshace—, pero si venías de paso, la semana te
            espera.
          </p>
          {/* El desmentido va pegado a la frase que hace la afirmación, y no en la
           * fila de botones: corrige el texto en vez de ofrecer una salida más, y
           * un tercer botón ahí competiría con las dos decisiones de verdad. */}
          <button className="dialog__deny" onClick={() => void desmentir()}>
            Volver a planificar hoy
          </button>
        </Dialog>
      )}

      {selectedTask && (
        <TaskModal
          task={selectedTask}
          categories={board.categories}
          objectives={board.objectives}
          onClose={() => setSelectedId(null)}
          onChanged={board.reload}
        />
      )}
    </div>
  );
}
