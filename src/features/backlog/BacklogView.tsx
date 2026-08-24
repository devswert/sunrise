import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective, Task } from "../../lib/types";
import { CategoryTag } from "../tasks/CategoryTag";
import { TaskModal } from "../tasks/TaskModal";
import { formatMinutes } from "../../lib/capacity";
import { isoWeekId, shortDate } from "../../lib/date";
import { useAppStore } from "../../lib/store";
import { groupByContext } from "./agrupar";

/** Card no-arrastrable para el backlog (reutiliza estilos de .task-card). */
function BacklogCard({
  task,
  category,
  onToggle,
  onOpen,
}: {
  task: Task;
  category: Category | null;
  onToggle: (t: Task) => void;
  onOpen: (t: Task) => void;
}) {
  const done = task.status === "DONE";
  return (
    <div className={`task-card${done ? " is-done" : ""}`} onClick={() => onOpen(task)}>
      <button
        className={`task-card__check${done ? " is-checked" : ""}`}
        aria-label={done ? "Marcar como pendiente" : "Marcar como completada"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task);
        }}
      >
        {done && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="task-card__body">
        <div className="task-card__title">{task.title}</div>
        <div className="task-card__meta">
          <CategoryTag category={category} />
          {task.estimatedMinutes != null && (
            <span className="task-card__est">{formatMinutes(task.estimatedMinutes)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function BacklogView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [rescued, setRescued] = useState<Map<number, string>>(new Map());
  const openCompose = useAppStore((s) => s.openCompose);
  const bumpData = useAppStore((s) => s.bumpData);
  const dataVersion = useAppStore((s) => s.dataVersion);

  const load = useCallback(async () => {
    const [bl, cats, objs, rescates] = await Promise.all([
      api.listBacklog(),
      api.listCategories(),
      api.listObjectives(isoWeekId(new Date())),
      api.rescuedFromBacklog(),
    ]);
    setTasks(bl);
    setCategories(cats);
    setObjectives(objs);
    setRescued(new Map(rescates.filter((r) => r.fromDate).map((r) => [r.taskId, r.fromDate])));
  }, []);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const toggle = async (t: Task) => {
    await api.setTaskStatus(t.id, t.status === "DONE" ? "TODO" : "DONE");
    await load();
    bumpData(); // completar pudo detener el timer
  };

  // Con los contextos vacíos: acá cada grupo trae su botón "Agregar tarea", que
  // es la única forma de crear una tarea en un contexto que todavía no tiene
  // ninguna. Sin el grupo no hay botón, y el contexto queda inalcanzable.
  const groups = groupByContext(tasks, categories, { includeEmpty: true });

  return (
    <div>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>Backlog</h1>
      <div className="backlog">
        {groups.map((g) => (
          <div className="backlog__group" key={g.folder?.id ?? "none"}>
            <div className="backlog__group-head">
              {g.folder && (
                <span
                  className="backlog__dot"
                  style={{ background: `var(--${g.folder.color})` }}
                />
              )}
              {g.folder?.name ?? "Sin contexto"}
            </div>
            <div className="backlog__list">
              {g.items.map((t) => (
                <div key={t.id}>
                  <BacklogCard
                    task={t}
                    category={t.categoryId != null ? catMap.get(t.categoryId) ?? null : null}
                    onToggle={toggle}
                    onOpen={setSelected}
                  />
                  {/* De dónde vino, si vino de un día. Acá no se agrupa aparte
                   * —el backlog se agrupa por contexto— pero saber que esto se
                   * cayó de un día cambia cómo lo lees. */}
                  {!!rescued.get(t.id) && (
                    <span className="col-desde">desde el {shortDate(rescued.get(t.id)!)}</span>
                  )}
                </div>
              ))}
              <button
                className="add-task"
                onClick={() => openCompose({ date: null, categoryId: g.folder?.id ?? null })}
              >
                <Plus size={14} aria-hidden className="add-task__icon" />
                <span className="add-task__label">Agregar tarea</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <TaskModal
          task={selected}
          categories={categories}
          objectives={objectives}
          onClose={() => setSelected(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
