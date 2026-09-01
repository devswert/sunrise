import { useCallback, useEffect, useMemo, useState } from "react";
import { Inbox, Plus, Search, X } from "lucide-react";
import { api } from "../../lib/ipc";
import type { Category, Objective, Task, TaskPatch } from "../../lib/types";
import { TaskCardStatic } from "../week/TaskCard";
import { TaskModal } from "../tasks/TaskModal";
import { PLAIN_INPUT } from "../../components/plainInput";
import { isoWeekId, shortDate } from "../../lib/date";
import { useAppStore } from "../../lib/store";
import { groupByContext } from "./grouping";
import { PriorityFilter } from "./PriorityFilter";
import { filterByPriority } from "../tasks/priority";
import { usePrioritiesOn } from "../../lib/settings";
import type { Priority } from "../../lib/enums";

/**
 * El backlog a pantalla completa: **un contexto por columna**, lado a lado.
 *
 * La card es la misma de todas las vistas (`TaskCardStatic`, con el badge de
 * origen cosido al borde como en el panel de la semana), y por eso la columna es
 * de 236px: el ancho de una columna de día. La regla ya estaba escrita para el
 * ritual diario —"una card estirada al doble deja de leerse como la misma
 * card"— y esta vista la rompía, primero con su propio reskin de `.task-card` y
 * después con una lista de 720px de ancho.
 *
 * **Columnas y no una lista vertical** porque los contextos son pocos y cortos:
 * apilados, la mayor parte del scroll era aire entre rótulos, y llegar al sexto
 * obligaba a pasar por los cinco anteriores. Lado a lado se ven todos de una,
 * cada uno con cuántas tiene, y el scroll horizontal es el mismo gesto del
 * board de la semana.
 *
 * Dos diferencias con el board, a propósito:
 *
 * - **No arrastra.** Acá no hay días a los que soltar, y reordenar dentro del
 *   backlog no significa nada: la `position` es global sobre el bucket
 *   `scheduled_date IS NULL` y el agrupado por contexto es del lado del cliente.
 *   De ahí `TaskCardStatic`.
 * - **Dibuja los contextos vacíos**, cada uno con su "Agregar tarea": es la única
 *   forma de crear una tarea en un contexto que todavía no tiene ninguna. Con el
 *   buscador escrito sí se esconden, pero ahí es lo contrario de perderlos —
 *   estás filtrando, y una columna vacía no es un resultado.
 */
export function BacklogView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [selected, setSelected] = useState<Task | null>(null);
  const [rescued, setRescued] = useState<Map<number, string>>(new Map());
  const [query, setQuery] = useState("");
  const [levels, setLevels] = useState<Set<Priority>>(new Set());
  const prioridades = usePrioritiesOn();
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

  const patch = async (id: number, p: TaskPatch) => {
    await api.updateTask(id, p);
    await load();
    bumpData();
  };

  // Por título y nada más: es lo que uno recuerda de una tarea que dejó anotada.
  // Mismo `includes` en minúsculas que el buscador de los selects, y por lo mismo
  // no se normalizan acentos: los dos campos se escriben igual que se leen.
  const filtro = query.trim().toLowerCase();
  const porTitulo = filtro ? tasks.filter((t) => t.title.toLowerCase().includes(filtro)) : tasks;
  // Con las prioridades apagadas el filtro no se dibuja, así que tampoco puede
  // seguir aplicándose: quedaría una vista recortada por un control invisible.
  const visibles = prioridades ? filterByPriority(porTitulo, levels) : porTitulo;
  const filtrando = !!filtro || (prioridades && levels.size > 0);

  // Con el buscador escrito, un contexto sin resultados no es un contexto vacío
  // al que agregarle algo: es ruido entre los que sí coinciden.
  const groups = groupByContext(visibles, categories, { includeEmpty: !filtrando });

  return (
    <div className="backlog">
      {/* Misma cabecera de dos líneas que los paneles de la tira —qué es esto, y
       * qué hay adentro—, en el cuerpo de tipo de una vista. */}
      <header className="backlog__head">
        <div>
          <h1 className="backlog__title">
            <Inbox size={19} aria-hidden /> Backlog
          </h1>
          <p className="backlog__sub">
            {/* Filtrando, el total se queda al lado del filtrado: "2" a secas
             * escondería que el backlog tiene veinte. */}
            {filtrando && `${visibles.length} de `}
            {tasks.length} {tasks.length === 1 ? "pendiente" : "pendientes"}
          </p>
        </div>

        <div className="backlog__tools">
          {prioridades && <PriorityFilter value={levels} onChange={setLevels} />}

          <div className="backlog__search">
            <Search size={14} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar en el backlog"
              aria-label="Buscar en el backlog"
              {...PLAIN_INPUT}
            />
            {query && (
              <button
                className="backlog__search-clear"
                aria-label="Limpiar la búsqueda"
                onClick={() => setQuery("")}
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="backlog__board">
        {groups.map((g) => (
          <section className="day-col backlog__col" key={g.folder?.id ?? "none"}>
            <header className="day-col__head">
              <span className="day-col__weekday backlog__col-name">
                {g.folder && (
                  <span
                    className="backlog__dot"
                    style={{ background: `var(--${g.folder.color})` }}
                  />
                )}
                {g.folder?.name ?? "Sin contexto"}
              </span>
              {/* Cuántas tiene, en el lugar donde una columna de día lleva su
               * fecha. Con las columnas lado a lado es lo que dice de un vistazo
               * dónde hay algo que mirar. */}
              <span className="day-col__date">{g.items.length}</span>
            </header>

            <div className="day-col__actions">
              <button
                className="add-task"
                onClick={() => openCompose({ date: null, categoryId: g.folder?.id ?? null })}
              >
                <Plus size={14} aria-hidden className="add-task__icon" />
                <span className="add-task__label">Agregar tarea</span>
              </button>
            </div>

            <div className="day-col__list">
              {g.items.map((t) => (
                <div className={`backlog__item${rescued.get(t.id) ? " has-from" : ""}`} key={t.id}>
                  <TaskCardStatic
                    task={t}
                    category={t.categoryId != null ? (catMap.get(t.categoryId) ?? null) : null}
                    categories={categories}
                    onToggle={toggle}
                    onOpen={setSelected}
                    onPatch={patch}
                    // Igual que en el panel: acá la mayoría todavía no tiene ni
                    // estimado ni canal, y una columna de guiones y numerales se
                    // lee como ruido en vez de datos.
                    hidePlaceholders
                  />
                  {/* De qué día se cayó. Acá no agrupa —la vista agrupa por
                   * contexto— pero saber que esto viene de un día cambia cómo se
                   * lee: no lo guardaste, se degradó solo. */}
                  {!!rescued.get(t.id) && (
                    <span className="backlog__from">Desde el {shortDate(rescued.get(t.id)!)}</span>
                  )}
                </div>
              ))}
            </div>
          </section>
        ))}

        {groups.length === 0 && (
          <p className="backlog__vacio">
            {filtro
              ? `Nada en el backlog dice "${query.trim()}".`
              : filtrando
                ? "Nada en el backlog tiene esa prioridad."
                : "No hay nada en el backlog. Lo que quede pendiente de un día cae acá solo."}
          </p>
        )}
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
