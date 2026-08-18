import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus, Target, Trash2 } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Objective, Task } from "../../lib/types";
import { isoWeekId, todayISO, weekDates } from "../../lib/date";
import { useAppStore } from "../../lib/store";

export function WeeklyPlanningView() {
  const anchor = useMemo(() => new Date(), []);
  const dates = useMemo(() => weekDates(anchor), [anchor]);
  const isoWeek = isoWeekId(anchor);

  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newObj, setNewObj] = useState("");
  const openCompose = useAppStore((s) => s.openCompose);
  const bumpData = useAppStore((s) => s.bumpData);
  const dataVersion = useAppStore((s) => s.dataVersion);

  const load = useCallback(async () => {
    const [objs, list] = await Promise.all([
      api.listObjectives(isoWeek),
      api.listTasksForRange(dates[0], dates[6]),
    ]);
    setObjectives(objs);
    setTasks(list);
  }, [isoWeek, dates]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const unassigned = tasks.filter((t) => t.objectiveId == null);

  const addObjective = async () => {
    const v = newObj.trim();
    if (!v) return;
    await api.createObjective(isoWeek, v);
    setNewObj("");
    bumpData();
  };
  const toggleObj = async (o: Objective) => {
    await api.updateObjective(o.id, undefined, !o.completed);
    bumpData();
  };
  const removeObj = async (id: number) => {
    await api.deleteObjective(id);
    bumpData();
  };
  const toggleTask = async (t: Task) => {
    await api.setTaskStatus(t.id, t.status === "DONE" ? "TODO" : "DONE");
    bumpData();
  };
  const assign = async (taskId: number, objectiveId: number) => {
    await api.updateTask(taskId, { objectiveId });
    bumpData();
  };

  return (
    <div className="planning">
      <div>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Weekly planning</h1>
        <p style={{ color: "var(--muted)", marginTop: 0 }}>
          Semana {isoWeek}. Define objetivos, asígnales tareas y sigue el progreso.
        </p>
      </div>

      {/* Paso 1: objetivos */}
      <section>
        <div className="planning__step-label">1 · Objetivos de la semana</div>
        <div className="obj-add" style={{ marginBottom: 12 }}>
          <Plus size={14} aria-hidden />
          <input
            value={newObj}
            placeholder="Nuevo objetivo"
            aria-label="Nuevo objetivo"
            onChange={(e) => setNewObj(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addObjective();
            }}
          />
        </div>
      </section>

      {/* Paso 2 + 3: asignar y progreso */}
      <section>
        <div className="planning__step-label">2 · Tareas y progreso</div>
        {objectives.length === 0 && (
          <p style={{ color: "var(--muted)" }}>Aún no hay objetivos esta semana.</p>
        )}
        {objectives.map((o) => {
          const objTasks = tasks.filter((t) => t.objectiveId === o.id);
          const doneCount = objTasks.filter((t) => t.status === "DONE").length;
          const pct = objTasks.length ? Math.round((doneCount / objTasks.length) * 100) : 0;
          return (
            <div key={o.id} className={`plan-obj${o.completed ? " is-done" : ""}`}>
              <div className="plan-obj__head">
                <Target size={16} aria-hidden style={{ color: "var(--apricot-ink)" }} />
                <span className="plan-obj__title">{o.title}</span>
                <span className="plan-count">
                  {doneCount}/{objTasks.length}
                </span>
                <button
                  className="obj-chip__check"
                  aria-label={o.completed ? "Reabrir objetivo" : "Completar objetivo"}
                  onClick={() => toggleObj(o)}
                  style={o.completed ? { background: "var(--mint-ink)", borderColor: "var(--mint-ink)" } : undefined}
                >
                  {o.completed && <Check size={11} strokeWidth={3} />}
                </button>
                <button className="set-row__icon is-danger" aria-label="Eliminar objetivo" onClick={() => removeObj(o.id)}>
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="plan-obj__progress">
                <div className="plan-obj__bar" style={{ width: `${pct}%` }} />
              </div>

              <div className="plan-obj__tasks">
                {objTasks.map((t) => (
                  <div key={t.id} className={`plan-task${t.status === "DONE" ? " is-done" : ""}`}>
                    <button
                      className={`task-card__check${t.status === "DONE" ? " is-checked" : ""}`}
                      aria-label="Completar"
                      onClick={() => toggleTask(t)}
                    >
                      {t.status === "DONE" && <Check size={11} strokeWidth={3} />}
                    </button>
                    {t.title}
                  </div>
                ))}

                <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <button
                    className="btn-ghost"
                    onClick={() => openCompose({ objectiveId: o.id, date: todayISO() })}
                  >
                    <Plus size={13} /> Nueva tarea
                  </button>
                  {unassigned.length > 0 && (
                    <select
                      className="btn-ghost"
                      aria-label="Asignar tarea existente"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) assign(Number(e.target.value), o.id);
                      }}
                    >
                      <option value="">Asignar existente…</option>
                      {unassigned.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
