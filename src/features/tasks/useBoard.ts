import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/ipc";
import type { Category, Objective, Task, NewTaskInput, TaskPatch } from "../../lib/types";
import { isoWeekId, parseISODate, todayISO } from "../../lib/date";
import { useAppStore } from "../../lib/store";

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
 * Carga categorías, tareas del rango [start, end] y objetivos de la semana
 * que contiene `start`; corre la degradación una vez al día (ver arriba).
 */
export function useBoard(start: string, end: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [loading, setLoading] = useState(true);

  const isoWeek = useMemo(() => isoWeekId(parseISODate(start)), [start]);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const bumpData = useAppStore((s) => s.bumpData);

  const reload = useCallback(async () => {
    const [cats, list, objs] = await Promise.all([
      api.listCategories(),
      api.listTasksForRange(start, end),
      api.listObjectives(isoWeek),
    ]);
    setCategories(cats);
    setTasks(list);
    setObjectives(objs);
    setLoading(false);
  }, [start, end, isoWeek]);

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
      await api.moveTask(id, date, position);
      await reload();
    },
    [reload],
  );

  const patchTask = useCallback(
    async (id: number, patch: TaskPatch) => {
      await api.updateTask(id, patch);
      await reload();
    },
    [reload],
  );

  const removeTask = useCallback(
    async (id: number) => {
      await api.deleteTask(id);
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
    isoWeek,
    loading,
    reload,
    addTask,
    toggleTask,
    moveTask,
    patchTask,
    removeTask,
    addObjective,
    toggleObjective,
    removeObjective,
  };
}
