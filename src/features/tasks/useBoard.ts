import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/ipc";
import type { Category, Objective, Task, NewTaskInput, TaskPatch } from "../../lib/types";
import { isoWeekId, parseISODate, todayISO } from "../../lib/date";
import { useAppStore } from "../../lib/store";
import { reorderLocal } from "./reorder";

/**
 * La degradación es una **mutación**, no una lectura: manda al backlog lo
 * pendiente de días anteriores al último con actividad. Antes colgaba del ciclo
 * de recarga, así que se ejecutaba con cada cambio de datos —y desde que
 * `useDataSync` propaga los avisos de la otra ventana, más seguido todavía.
 *
 * Corre una vez por día y por ventana. La fecha es parte de la condición (y no
 * un simple booleano) para que una sesión que queda abierta cruzando la
 * medianoche la vuelva a correr al día siguiente.
 */
let degradadoPara: string | null = null;
let degradarInFlight: Promise<void> | null = null;

function degradarUnaVez(today: string): Promise<void> {
  if (degradadoPara === today) return Promise.resolve();
  // Dedup: si dos vistas montan a la vez, comparten la misma llamada.
  degradarInFlight ??= api
    .demotePending(today)
    .then(() => {
      degradadoPara = today;
    })
    .finally(() => {
      degradarInFlight = null;
    });
  return degradarInFlight;
}

/**
 * Estado y acciones compartidas por Today, la vista semana y el modal.
 * Carga categorías, tareas del rango [start, end] y objetivos de una semana ISO;
 * corre la degradación una vez al día (ver arriba).
 *
 * **`weekOf` existe porque el rango y la semana dejaron de coincidir.** La vista
 * semana dibuja tres semanas (21 columnas), así que su `start` es un lunes de
 * *dos semanas atrás*: deducir la semana ISO de ahí —como se hacía— le daría los
 * objetivos de la semana anterior sin decir nada, y con ellos el selector de
 * objetivo del modal. Por defecto sigue siendo la de `start`, que es lo correcto
 * para las vistas de un día.
 *
 * **`withBacklog` mete las tareas sin fecha en el mismo array `tasks`.** Es
 * opt-in y por eso arranca apagado: solo la vista semana, que tiene el panel de
 * backlog, las necesita. Dos razones para que vayan en el mismo array y no en
 * uno aparte:
 *
 * - `reorderLocal` ya trata `date === null` y mueve una tarea entre el bucket
 *   nulo y un día **en una sola pasada**. Con dos listas hay dos
 *   actualizaciones optimistas que pueden discrepar, y la que discrepa se ve
 *   como un salto cuando llega la recarga.
 * - `activeTask` (el `DragOverlay`) y `selectedTask` (el modal) buscan en
 *   `tasks`. Una tarea del backlog que no esté ahí arrastra un overlay vacío.
 *
 * Es seguro porque los dos conjuntos son **disjuntos por construcción**:
 * `list_tasks_for_range` filtra `scheduled_date IS NOT NULL` y `list_backlog`
 * filtra `IS NULL`. Y `tasksByDate` ya saltea las de fecha nula, así que las
 * columnas de día no se enteran de nada.
 */
export function useBoard(
  start: string,
  end: string,
  weekOf: string = start,
  withBacklog = false,
) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [rescues, setRescues] = useState<Map<number, string>>(new Map());
  const [loading, setLoading] = useState(true);
  /**
   * Espejo de `tasks` para leer el origen de un movimiento sin cerrar sobre el
   * estado: `moveTask` en un `useCallback` que dependa de `tasks` se recrearía
   * con cada recarga, y leerlo dentro del updater de `setTasks` sería un efecto
   * adentro de un updater — que StrictMode dispara dos veces.
   */
  const tasksRef = useRef<Task[]>([]);
  tasksRef.current = tasks;

  const isoWeek = useMemo(() => isoWeekId(parseISODate(weekOf)), [weekOf]);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const bumpData = useAppStore((s) => s.bumpData);

  const reload = useCallback(async () => {
    // Sin `withBacklog` no se llama y se descarta: se **no llama**. Los tests de
    // este hook mockean `../../lib/ipc` con las funciones que usa y nada más, así
    // que una llamada incondicional los deja todos rojos por una feature que ni
    // siquiera están probando.
    const [cats, list, objs, backlog, rescates] = await Promise.all([
      api.listCategories(),
      api.listTasksForRange(start, end),
      api.listObjectives(isoWeek),
      withBacklog ? api.listBacklog() : Promise.resolve<Task[]>([]),
      withBacklog ? api.rescuedFromBacklog() : Promise.resolve([]),
    ]);
    setCategories(cats);
    setTasks([...list, ...backlog]);
    setObjectives(objs);
    setRescues(new Map(rescates.filter((r) => r.fromDate).map((r) => [r.taskId, r.fromDate])));
    setLoading(false);
  }, [start, end, isoWeek, withBacklog]);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Se espera antes de la primera lectura para que el board no muestre un
      // instante el estado previo a la limpieza.
      await degradarUnaVez(todayISO());
      if (alive) await reload();
    })();
    return () => {
      alive = false;
    };
  }, [reload, dataVersion]);

  const categoryMap = useMemo(() => {
    const m = new Map<number, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  /**
   * Las del backlog, ordenadas por `position`. El panel las agrupa por contexto
   * del lado del cliente, y eso es lo que le da sentido a que un movimiento al
   * backlog entre en la posición 0: "primera de su contexto", igual antes y
   * después de la recarga. Confiar en el orden crudo de `list_backlog`
   * (`category_id, position, id`) mostraría la card arriba de todo y la haría
   * saltar a su grupo al recargar.
   */
  const backlogTasks = useMemo(
    () =>
      tasks
        .filter((t) => t.scheduledDate == null)
        .sort((a, b) => a.position - b.position || a.id - b.id),
    [tasks],
  );

  const tasksByDate = useMemo(() => {
    const by: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (!t.scheduledDate) continue;
      (by[t.scheduledDate] ??= []).push(t);
    }
    for (const d of Object.keys(by)) by[d].sort((a, b) => a.position - b.position);
    return by;
  }, [tasks]);

  // --- acciones de tareas ---
  const addTask = useCallback(
    async (input: NewTaskInput) => {
      await api.createTask(input);
      await reload();
    },
    [reload],
  );

  const toggleTask = useCallback(
    async (task: Task) => {
      await api.setTaskStatus(task.id, task.status === "DONE" ? "TODO" : "DONE");
      await reload();
      // Completar puede haber detenido el timer (lo hace Rust): avisar para que
      // el taxímetro y el resto de la UI se enteren.
      bumpData();
    },
    [reload, bumpData],
  );

  const moveTask = useCallback(
    async (id: number, date: string | null, position: number) => {
      // El origen se lee del espejo y **antes** de escribir (ver `tasksRef`).
      const from = tasksRef.current.find((t) => t.id === id)?.scheduledDate ?? null;
      const touchesBacklog = date == null || from == null;

      // Optimista **antes** de escribir: la lista tiene que quedar reordenada en
      // el mismo frame en que se suelta la card. Si se espera la escritura, el
      // overlay desaparece con la card todavía en su lugar viejo y después entra
      // deslizándose desde arriba (ver `reorderLocal`).
      setTasks((actuales) => {
        const task = actuales.find((t) => t.id === id);
        return task ? reorderLocal(actuales, task, date, position) : actuales;
      });
      await api.moveTask(id, date, position);

      // Mover **desde o hacia** el backlog cambia lo que ven otros: los conteos
      // por contexto del sidebar y `BacklogView`, que se refrescan solo con
      // `dataVersion`. Sin esto el número del sidebar queda mintiendo hasta el
      // próximo cambio de datos.
      //
      // El `bumpData()` **reemplaza** al `reload()`, no se suma: el efecto de
      // carga de este hook ya depende de `dataVersion`, así que llamar a los dos
      // son dos recargas completas por cada arrastre. Un reordenamiento dentro
      // de un día no invalida nada de eso, y por eso no despierta a la otra
      // ventana ni al taxímetro.
      if (touchesBacklog) bumpData();
      else await reload();
    },
    [reload, bumpData],
  );

  const patchTask = useCallback(
    async (id: number, patch: TaskPatch) => {
      await api.updateTask(id, patch);
      await reload();
    },
    [reload],
  );

  // --- acciones de objetivos ---
  const addObjective = useCallback(
    async (title: string) => {
      await api.createObjective(isoWeek, title);
      await reload();
    },
    [isoWeek, reload],
  );

  const toggleObjective = useCallback(
    async (o: Objective) => {
      await api.updateObjective(o.id, undefined, !o.completed);
      await reload();
    },
    [reload],
  );

  const removeObjective = useCallback(
    async (id: number) => {
      await api.deleteObjective(id);
      await reload();
    },
    [reload],
  );

  return {
    tasks,
    categories,
    objectives,
    categoryMap,
    tasksByDate,
    backlogTasks,
    rescues,
    isoWeek,
    loading,
    reload,
    addTask,
    toggleTask,
    moveTask,
    patchTask,
    addObjective,
    toggleObjective,
    removeObjective,
  };
}
