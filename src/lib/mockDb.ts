/**
 * Mock in-memory de la API IPC para correr la UI fuera de Tauri
 * (preview en browser y tests). Espeja el comportamiento de `repo.rs`.
 */
import type {
  ActiveTimer,
  Rescue,
  CalendarFeed,
  Category,
  Objective,
  Task,
  TaskEvent,
  TimeEntry,
  DayWork,
  WeeklyRollup,
  LogDay,
  DaySegment,
  RollupCell,
  RollupDay,
  NewTaskInput,
  TaskPatch,
  BackupFile,
  RestoreResult,
  Profile,
  AppUpdate,
} from "./types";
import { toISODate, todayISO, weekDates } from "./date";

let seq = 1;
const nextId = () => seq++;

/** `date` → nota, cierre y mood del día (tabla `day_entries`). */
const dayEntries = new Map<
  string,
  { note: string | null; closedAt: string | null; mood: string | null }
>();
const ENTRADA_VACIA = { note: null, closedAt: null, mood: null };
/** `'YYYY-MM-DD:taskId'` → reflexión sobre esa tarea ese día. */
const dayTaskNotes = new Map<string, string>();
const nowISO = () => new Date().toISOString();

const categories: Category[] = [
  { id: 1, parentId: null, name: "Thinking", color: "lavender", position: 0, archived: false },
  { id: 2, parentId: null, name: "Tooling", color: "sky", position: 1, archived: false },
  { id: 3, parentId: null, name: "Docs", color: "mint", position: 2, archived: false },
  { id: 4, parentId: null, name: "Projects", color: "apricot", position: 3, archived: false },
  { id: 5, parentId: null, name: "Selfcare", color: "rose", position: 4, archived: false },
  { id: 6, parentId: null, name: "Issues", color: "butter", position: 5, archived: false },
  { id: 7, parentId: null, name: "Meetings", color: "sage", position: 6, archived: false },
];
seq = 100;

/** Espeja los valores que siembra la migración 2. */
const settings = new Map<string, string>([
  ["daily_capacity_minutes", "480"],
  ["capacity_warn_ratio", "0.85"],
  ["bell_sound", "bell"],
  ["work_start", "09:00"],
  ["work_end", "18:00"],
  // Espeja la migración 9. La fila existe para que "ninguno colapsado" se pueda
  // expresar: ausente ⇒ el default, presente ⇒ lo que diga, incluso vacío.
  ["collapsed_weekdays", "6,7"],
]);

/**
 * Inicio automático. Aparte de `settings` porque en Tauri también está aparte:
 * la verdad la tiene el sistema operativo, no la base.
 */
let autostart = false;

/**
 * Los respaldos "hechos" en esta sesión.
 *
 * El mock no toca el disco: fuera de Tauri no hay `VACUUM INTO` ni carpeta que
 * escribir. Lo que sí replica es el contrato que la vista consume —que
 * `createBackup` falle sin carpeta configurada, que el nuevo aparezca primero en
 * la lista, y que la retención recorte— porque eso es lo que los tests miran.
 */
const backups: BackupFile[] = [];

const tasks: Task[] = [];
const feeds: CalendarFeed[] = [];
let nextFeedId = 1;
const objectives: Objective[] = [];
const events: TaskEvent[] = [];
const entries: TimeEntry[] = [];

function blankTask(input: NewTaskInput, position: number): Task {
  return {
    id: nextId(),
    title: input.title,
    notes: input.notes ?? null,
    categoryId: input.categoryId ?? null,
    objectiveId: input.objectiveId ?? null,
    scheduledDate: input.scheduledDate ?? null,
    scheduledTime: input.scheduledTime ?? null,
    position,
    estimatedMinutes: input.estimatedMinutes ?? null,
    actualSeconds: 0,
    status: "TODO",
    completedAt: null,
    source: "MANUAL",
    sourceState: "ACTIVE",
    feedId: null,
    calendarUid: null,
    eventStart: null,
    eventEnd: null,
    meetingUrl: null,
    eventDescription: null,
    attendees: [],
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
}

/**
 * Segundos cerrados de hoy para una tarea (el contador reinicia cada día).
 *
 * El piso en 0 espeja el `MAX(0, …)` de `repo::seconds_today`: un ajuste manual
 * hacia abajo se guarda como delta negativo, y si el recorte supera lo trackeado
 * hoy la suma se iría a negativo.
 */
function secondsToday(taskId: number): number {
  const today = todayISO();
  const suma = entries
    .filter((e) => e.taskId === taskId && e.endedAt !== null && e.startedAt.slice(0, 10) === today)
    .reduce((s, e) => s + e.seconds, 0);
  return Math.max(0, suma);
}

/**
 * Parte un intervalo en tramos por día local. Espeja `segments_by_local_day` de
 * `repo.rs`: el tiempo se atribuye por `startedAt`, así que una fila que cruza
 * la medianoche le acreditaría todo al primer día.
 */
function tramosPorDiaLocal(start: Date, end: Date): Array<[Date, Date]> {
  if (end <= start) return [[start, end]];
  const segments: Array<[Date, Date]> = [];
  let cursor = start;
  for (let i = 0; i < 400; i++) {
    const corte = new Date(cursor);
    corte.setHours(0, 0, 0, 0);
    corte.setDate(corte.getDate() + 1);
    if (corte >= end) break;
    segments.push([cursor, corte]);
    cursor = corte;
  }
  segments.push([cursor, end]);
  return segments;
}

function nextPosition(date: string | null): number {
  const inDay = tasks.filter((t) => t.scheduledDate === date);
  return inDay.reduce((m, t) => Math.max(m, t.position + 1), 0);
}

function logEvent(
  taskId: number,
  type: TaskEvent["type"],
  fromDate: string | null,
  toDate: string | null,
) {
  events.push({ id: nextId(), taskId, type, fromDate, toDate, at: nowISO() });
}

// Semilla de tareas para que el preview muestre contenido.
(function seedTasks() {
  const wk = weekDates(new Date());
  const today = todayISO();
  const seed: Array<[string, string, number, number | null]> = [
    ["Plan Semanal + Slack", today, 45, 1],
    ["Revisar PRs de Paquetes", today, 60, 4],
    ["Review PR Gabo", today, 10, 2],
    ["Tareas con la Tere", today, 30, 7],
    ["Continuar Backend Arch", wk[2] ?? today, 90, 1],
    ["Investigar error de Datadog", wk[1] ?? today, 45, 6],
  ];
  for (const [title, date, est, cat] of seed) {
    const t = blankTask(
      { title, scheduledDate: date, estimatedMinutes: est, categoryId: cat },
      nextPosition(date),
    );
    tasks.push(t);
    logEvent(t.id, "CREATED", null, date);
    logEvent(t.id, "START_DATE_SET", null, date);
  }
  // una en backlog
  const b = blankTask({ title: "Idea: automatizar reporte", categoryId: 1 }, 0);
  tasks.push(b);

  // Un día anterior con algo cerrado: sin esto el repaso del ritual (§4.14) no
  // se puede ver en el browser, porque el carry-over se lleva a hoy todo lo
  // manual sin terminar y la fecha queda vacía.
  //
  // Se calcula desde hoy y no como `wk[1]`, que era el **martes** de la semana:
  // los lunes eso caía en el futuro y el repaso quedaba vacío justo el día en que
  // más se usa. Los demás items sí se anclan a días de la semana a propósito,
  // para que el preview de la semana muestre varias columnas con contenido.
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const yesterday = toISODate(ayer);
  const closed = blankTask(
    { title: "Ajustar dashboards", scheduledDate: yesterday, estimatedMinutes: 60, categoryId: 3 },
    nextPosition(yesterday),
  );
  closed.status = "DONE";
  closed.completedAt = nowISO();
  tasks.push(closed);
  entries.push({
    id: nextId(),
    taskId: closed.id,
    startedAt: `${yesterday}T13:00:00.000Z`,
    endedAt: `${yesterday}T13:50:00.000Z`,
    seconds: 3000,
  });

  // Dos reuniones importadas: sin ellas el rail y el detalle de evento no se
  // pueden ver en el browser ni ejercitar en jsdom. La de día completo existe
  // para que la franja de arriba del rail tenga qué mostrar.
  const reuniones: Array<Partial<Task> & { title: string }> = [
    {
      title: "Weekly de equipo",
      scheduledTime: "10:00",
      estimatedMinutes: 60,
      categoryId: 7,
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      eventDescription: "Revisamos el tablero<br><ul><li>Bloqueos</li><li>Riesgos</li></ul>",
      attendees: [
        { name: "Tere", email: "tere@example.com", status: "ACCEPTED", isOrganizer: true },
        { name: null, email: "gabo@example.com", status: "TENTATIVE", isOrganizer: false },
      ],
    },
    { title: "1:1 con Gabo", scheduledTime: "10:30", estimatedMinutes: 30, categoryId: 7 },
    // Día completo: sin hora, sin estimado (SPECS §4.12).
    { title: "Feriado regional", scheduledTime: null, estimatedMinutes: null },
  ];
  for (const [i, r] of reuniones.entries()) {
    const t = blankTask({ title: r.title, scheduledDate: today }, nextPosition(today));
    tasks.push(
      Object.assign(t, r, {
        source: "CALENDAR" as const,
        feedId: 1,
        calendarUid: `mock-uid-${i}`,
        scheduledDate: today,
      }),
    );
    logEvent(t.id, "CREATED", null, today);
  }
})();


/**
 * Espeja `repo::adjustment_stamp`: un ajuste manual de tiempo se acredita **al
 * día de la tarea**, no al día en que se escribe. Con la hora de la tarea si la
 * tiene, mediodía si no, y hoy cuando la tarea no tiene fecha o es futura.
 *
 * Si esto se separa de Rust, el rail y el rollup del browser cuentan las horas en
 * otro día que la app, y ningún test lo nota.
 */
function selloDeAjuste(t: Task): string {
  const date = t.scheduledDate;
  if (!date || date > todayISO()) return nowISO();
  const [h, m] = (t.scheduledTime ?? "12:00").split(":").map(Number);
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return nowISO();
  d.setHours(Number.isFinite(h) ? h : 12, Number.isFinite(m) ? m : 0, 0, 0);
  return d.toISOString();
}

export const mock = {
  ping: async () => "pong",

  listCategories: async (): Promise<Category[]> => categories.filter((c) => !c.archived),

  listObjectives: async (isoWeek: string): Promise<Objective[]> =>
    objectives.filter((o) => o.isoWeek === isoWeek).sort((a, b) => a.position - b.position),

  listTasksForRange: async (start: string, end: string): Promise<Task[]> =>
    tasks
      .filter(
        (t) =>
          t.sourceState === "ACTIVE" &&
          t.scheduledDate !== null &&
          t.scheduledDate >= start &&
          t.scheduledDate <= end,
      )
      .sort((a, b) => a.position - b.position),

  listTasksForDate: async (date: string): Promise<Task[]> =>
    tasks
      .filter((t) => t.sourceState === "ACTIVE" && t.scheduledDate === date)
      .sort((a, b) => a.position - b.position),

  listBacklog: async (): Promise<Task[]> =>
    tasks
      .filter((t) => t.sourceState === "ACTIVE" && t.scheduledDate === null && t.status === "TODO")
      .sort((a, b) => a.position - b.position),

  createTask: async (input: NewTaskInput): Promise<Task> => {
    const t = blankTask(input, nextPosition(input.scheduledDate ?? null));
    tasks.push(t);
    logEvent(t.id, "CREATED", null, t.scheduledDate);
    if (t.scheduledDate) logEvent(t.id, "START_DATE_SET", null, t.scheduledDate);
    return t;
  },

  updateTask: async (id: number, patch: TaskPatch): Promise<Task | null> => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    if (patch.title !== undefined) t.title = patch.title;
    if (patch.notes !== undefined) t.notes = patch.notes;
    if (patch.categoryId !== undefined) t.categoryId = patch.categoryId;
    if (patch.objectiveId !== undefined) t.objectiveId = patch.objectiveId;
    if (patch.scheduledTime !== undefined) t.scheduledTime = patch.scheduledTime;
    if (patch.estimatedMinutes !== undefined) t.estimatedMinutes = patch.estimatedMinutes;
    if (patch.actualSeconds !== undefined) t.actualSeconds = patch.actualSeconds;
    t.updatedAt = nowISO();
    return t;
  },

  deleteTask: async (id: number): Promise<void> => {
    const i = tasks.findIndex((x) => x.id === id);
    if (i >= 0) tasks.splice(i, 1);
  },

  setTaskStatus: async (id: number, status: Task["status"]): Promise<Task | null> => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    // Completar detiene el timer de esa tarea (igual que en Rust).
    if (status === "DONE") {
      const open = entries.find((e) => e.endedAt === null && e.taskId === id);
      if (open) await mock.stopTimer();
    }
    t.status = status;
    t.completedAt = status === "DONE" ? nowISO() : null;
    t.updatedAt = nowISO();
    return t;
  },

  moveTask: async (id: number, date: string | null, position: number): Promise<Task | null> => {
    const t = tasks.find((x) => x.id === id);
    if (!t) return null;
    const old = t.scheduledDate;
    if (old !== date) {
      logEvent(t.id, old === null ? "START_DATE_SET" : "MOVED", old, date);
    }
    // Misma semántica que `repo::move_task_as`: se renumera el destino entero en
    // vez de correr +1 las de abajo. `position` es el índice **final**, contando
    // que la tarea ya salió de la lista, así que reordenar dentro de un mismo día
    // sale donde se soltó y no un lugar antes.
    // Se renumera con las `ORPHANED` incluidas —si no, quedan dos con la misma
    // posición— pero el índice que llega se cuenta contra la lista que se ve,
    // que las filtra: `at` es el primer punto que deja `position` visibles atrás.
    const orden = tasks
      .filter((x) => x.id !== id && x.scheduledDate === date)
      .sort((a, b) => a.position - b.position || a.id - b.id);
    const visibles = orden.filter((x) => x.sourceState === "ACTIVE").length;
    const delante = Math.min(Math.max(position, 0), visibles);
    let at = orden.length;
    if (delante === 0) {
      at = 0;
    } else {
      let vistas = 0;
      for (let i = 0; i < orden.length; i++) {
        if (orden[i].sourceState !== "ACTIVE") continue;
        vistas += 1;
        if (vistas === delante) {
          at = i + 1;
          break;
        }
      }
    }
    orden.forEach((otra, i) => {
      otra.position = i < at ? i : i + 1;
    });
    t.scheduledDate = date;
    t.position = at;
    t.updatedAt = nowISO();
    return t;
  },

  /**
   * Espeja `repo::demote_pending`: preserva el último día con tareas —el
   * que repasa el ritual— y baja al backlog, en primera posición, lo pendiente
   * de días anteriores.
   */
  demotePending: async (today: string): Promise<number> => {
    const liveDay = tasks
      .filter((t) => t.sourceState === "ACTIVE" && t.scheduledDate && t.scheduledDate < today)
      .reduce<string | null>(
        (m, t) => (m == null || t.scheduledDate! > m ? t.scheduledDate! : m),
        null,
      );
    if (liveDay == null) return 0;

    const viejas = tasks
      .filter(
        (t) =>
          t.source === "MANUAL" &&
          t.status === "TODO" &&
          t.sourceState === "ACTIVE" &&
          t.scheduledDate !== null &&
          t.scheduledDate < liveDay,
      )
      .sort((a, b) =>
        a.scheduledDate! < b.scheduledDate! ? 1 : a.scheduledDate! > b.scheduledDate! ? -1 : 0,
      );

    for (const t of viejas) {
      // Igual que `move_task`: entra en 0 y empuja al resto del backlog.
      for (const otra of tasks) {
        if (otra.scheduledDate === null && otra.id !== t.id) otra.position += 1;
      }
      logEvent(t.id, "MOVED", t.scheduledDate, null);
      t.scheduledDate = null;
      t.position = 0;
    }
    return viejas.length;
  },

  /**
   * Espeja `repo::rescued_from_backlog`: lo que está en el backlog y **venía
   * de un día**, según el historial. Cubre por igual lo que bajó la degradación
   * y lo que mandaste a mano.
   */
  rescuedFromBacklog: async (): Promise<Rescue[]> => {
    const out: Rescue[] = [];
    for (const t of tasks) {
      if (t.sourceState !== "ACTIVE" || t.status !== "TODO" || t.scheduledDate !== null) continue;
      const last = [...events]
        .reverse()
        .find((e) => e.taskId === t.id && e.type === "MOVED" && e.toDate === null);
      if (last?.fromDate) out.push({ taskId: t.id, fromDate: last.fromDate });
    }
    return out;
  },

  setActualSeconds: async (taskId: number, seconds: number): Promise<Task | null> => {
    const t = tasks.find((x) => x.id === taskId);
    if (!t) return null;
    const value = Math.max(0, seconds);
    const delta = value - t.actualSeconds;
    if (delta !== 0) {
      const ts = selloDeAjuste(t);
      entries.push({ id: nextId(), taskId, startedAt: ts, endedAt: ts, seconds: delta });
    }
    t.actualSeconds = value;
    t.updatedAt = nowISO();
    return t;
  },

  getTask: async (id: number): Promise<Task | null> => tasks.find((t) => t.id === id) ?? null,

  listTaskEvents: async (taskId: number): Promise<TaskEvent[]> =>
    events.filter((e) => e.taskId === taskId),

  // --- timer ---
  getActiveTimer: async (): Promise<ActiveTimer | null> => {
    const open = entries.find((e) => e.endedAt === null);
    if (!open) return null;
    const t = tasks.find((x) => x.id === open.taskId);
    if (!t) return null;
    return {
      entryId: open.id,
      taskId: t.id,
      title: t.title,
      startedAt: open.startedAt,
      baseSeconds: secondsToday(t.id),
      estimatedMinutes: t.estimatedMinutes,
    };
  },

  startTimer: async (taskId: number): Promise<ActiveTimer> => {
    await mock.stopTimer();
    // Espeja `repo::start_timer`: volver a trabajar en algo lo reabre.
    const t = tasks.find((x) => x.id === taskId);
    if (t && t.status === "DONE") {
      t.status = "TODO";
      t.completedAt = null;
      t.updatedAt = nowISO();
    }
    entries.push({
      id: nextId(),
      taskId,
      startedAt: nowISO(),
      endedAt: null,
      seconds: 0,
    });
    return (await mock.getActiveTimer())!;
  },

  stopTimer: async (): Promise<[number, number] | null> => {
    const open = entries.find((e) => e.endedAt === null);
    if (!open) return null;
    const ended = nowISO();
    const seconds = Math.max(
      0,
      Math.round((new Date(ended).getTime() - new Date(open.startedAt).getTime()) / 1000),
    );
    // Espeja `repo::stop_timer`: si la corrida cruzó una medianoche local se
    // guarda partida por día, para que el tiempo quede acreditado al día en que
    // se trabajó. El último tramo absorbe el resto, así la suma de las filas da
    // exactamente `seconds`.
    const segments = tramosPorDiaLocal(new Date(open.startedAt), new Date(ended));
    if (segments.length > 1) {
      let repartido = 0;
      segments.forEach(([ini, end], i) => {
        const last = i === segments.length - 1;
        const secs = last
          ? seconds - repartido
          : Math.max(0, Math.round((end.getTime() - ini.getTime()) / 1000));
        repartido += secs;
        if (i === 0) {
          open.endedAt = end.toISOString();
          open.seconds = secs;
        } else {
          entries.push({
            id: nextId(),
            taskId: open.taskId,
            startedAt: ini.toISOString(),
            endedAt: end.toISOString(),
            seconds: secs,
          });
        }
      });
    } else {
      open.endedAt = ended;
      open.seconds = seconds;
    }

    const t = tasks.find((x) => x.id === open.taskId);
    if (t) t.actualSeconds += seconds; // acumula, no recalcula
    return [open.taskId, seconds];
  },

  listTimeEntries: async (taskId: number): Promise<TimeEntry[]> =>
    entries.filter((e) => e.taskId === taskId),

  /**
   * Espeja `repo::day_work`: una fila por tarea, con el primer inicio del
   * día y los segundos cerrados. El día se acota por la fecha **local** de
   * `startedAt` —igual que en Rust—, no cortando el timestamp.
   */
  dayWork: async (date: string): Promise<DayWork[]> => {
    const porTarea = new Map<number, DayWork>();
    for (const e of entries) {
      const start = new Date(e.startedAt);
      if (Number.isNaN(start.getTime()) || toISODate(start) !== date) continue;
      const previo = porTarea.get(e.taskId);
      const fila: DayWork = previo ?? {
        taskId: e.taskId,
        startedAt: e.startedAt,
        seconds: 0,
        running: false,
      };
      if (e.startedAt < fila.startedAt) fila.startedAt = e.startedAt;
      if (e.endedAt === null) fila.running = true;
      else fila.seconds += e.seconds;
      porTarea.set(e.taskId, fila);
    }
    return [...porTarea.values()]
      .map((f) => ({ ...f, seconds: Math.max(0, f.seconds) }))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  },

  /**
   * Espeja `repo::weekly_rollup`, incluidas sus tres reglas: el tiempo se
   * atribuye por `startedAt` (Regla 2), una reunión sin entradas cuenta su
   * duración de evento (Regla 3), y acá **no** se filtran las `ORPHANED`.
   *
   * El día se saca con `toISODate(new Date(...))`, que es local: cortar el
   * timestamp UTC mandaría al día siguiente todo lo trabajado de tarde.
   */
  weeklyRollup: async (weekStart: string): Promise<WeeklyRollup> => {
    // Los 7 días **desde `weekStart`**, literal: `weekDates` los encajaría al
    // lunes ISO y el mock devolvería otra semana que Rust, que lo toma tal cual.
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(`${weekStart}T00:00:00`);
      d.setDate(d.getDate() + i);
      return toISODate(d);
    });
    const indice = (iso: string | null | undefined): number => {
      if (!iso) return -1;
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? -1 : days.indexOf(toISODate(d));
    };
    const ctxDe = (categoryId: number | null): number | null => {
      if (categoryId == null) return null;
      const c = categories.find((x) => x.id === categoryId);
      return c ? (c.parentId ?? c.id) : null;
    };

    // (día, tarea) → segundos. El piso en 0 va a esta granularidad: un ajuste
    // manual hacia abajo se guarda como delta negativo.
    const porTarea = new Map<string, number>();
    const suma = (i: number, taskId: number, secs: number) => {
      const k = `${i}:${taskId}`;
      porTarea.set(k, (porTarea.get(k) ?? 0) + secs);
    };

    for (const e of entries) {
      if (e.endedAt === null) continue;
      const i = indice(e.startedAt);
      if (i < 0) continue;
      suma(i, e.taskId, e.seconds);
    }

    const now = Date.now();
    for (const t of tasks) {
      if (t.source !== "CALENDAR" || t.sourceState !== "ACTIVE") continue;
      if (!t.eventStart || !t.eventEnd) continue;
      if (entries.some((e) => e.taskId === t.id)) continue;
      const ini = new Date(t.eventStart).getTime();
      const end = new Date(t.eventEnd).getTime();
      if (Number.isNaN(ini) || Number.isNaN(end) || ini > now) continue;
      const i = indice(t.eventStart);
      if (i < 0) continue;
      suma(i, t.id, Math.max(0, Math.round((end - ini) / 1000)));
    }

    const accumulated = new Map<string, RollupCell>();
    for (const [k, secs] of porTarea) {
      const [i, taskId] = k.split(":").map(Number);
      const categoryId = tasks.find((t) => t.id === taskId)?.categoryId ?? null;
      const key = `${i}:${categoryId}`;
      const celda = accumulated.get(key) ?? {
        date: days[i],
        categoryId,
        contextId: ctxDe(categoryId),
        seconds: 0,
      };
      celda.seconds += Math.max(0, secs);
      accumulated.set(key, celda);
    }
    const cells = [...accumulated.values()]
      .filter((c) => c.seconds > 0)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.categoryId ?? 0) - (b.categoryId ?? 0));

    const completedTasks = tasks
      .filter((t) => t.status === "DONE" && indice(t.completedAt) >= 0)
      .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""));

    const rows: RollupDay[] = days.map((date, i) => {
      const delDia = tasks.filter((t) => t.sourceState === "ACTIVE" && t.scheduledDate === date);
      let plannedMinutes = 0;
      let unestimated = 0;
      for (const t of delDia) {
        // Una reunión sin estimar dura lo que dura; una manual se avisa.
        const minutes =
          t.estimatedMinutes ??
          (t.source === "CALENDAR" && t.eventStart && t.eventEnd
            ? Math.max(0, Math.round((+new Date(t.eventEnd) - +new Date(t.eventStart)) / 60000))
            : null);
        if (minutes == null) unestimated += 1;
        else plannedMinutes += minutes;
      }
      return {
        date,
        seconds: cells.filter((c) => c.date === date).reduce((a, c) => a + c.seconds, 0),
        plannedMinutes,
        done: completedTasks.filter((t) => indice(t.completedAt) === i).length,
        unestimated,
      };
    });

    return {
      weekStart,
      days: rows,
      cells,
      completedTasks,
      totalSeconds: rows.reduce((a, d) => a + d.seconds, 0),
      plannedMinutes: rows.reduce((a, d) => a + d.plannedMinutes, 0),
      unestimated: rows.reduce((a, d) => a + d.unestimated, 0),
    };
  },

  /**
   * Espeja `repo::daily_log`. Se arma sola: sale del trabajo y de lo cerrado, no
   * de haber pasado por el shutdown.
   */
  dailyLog: async (to: string, days: number): Promise<LogDay[]> => {
    const n = Math.min(90, Math.max(1, Math.round(days)));
    const end = new Date(`${to}T00:00:00`);
    if (Number.isNaN(end.getTime())) return [];
    const fechas = Array.from({ length: n }, (_, i) => {
      const d = new Date(end);
      d.setDate(d.getDate() - (n - 1 - i));
      return toISODate(d);
    });
    const diaDe = (iso: string | null | undefined): string | null => {
      if (!iso) return null;
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : toISODate(d);
    };

    // (fecha, tarea) → tramo. Igual que en Rust: el piso en 0 va acá.
    const acc = new Map<string, DaySegment & { date: string; start: string }>();
    for (const e of entries) {
      const date = diaDe(e.startedAt);
      if (date == null || !fechas.includes(date)) continue;
      const t = tasks.find((x) => x.id === e.taskId);
      if (!t) continue;
      const k = `${date}:${e.taskId}`;
      const previo = acc.get(k) ?? {
        date,
        start: e.startedAt,
        taskId: e.taskId,
        title: t.title,
        seconds: 0,
        running: false,
      };
      if (e.startedAt < previo.start) previo.start = e.startedAt;
      if (e.endedAt === null) previo.running = true;
      else previo.seconds += e.seconds;
      acc.set(k, previo);
    }

    // Regla 3: reunión sin ninguna entrada.
    const now = Date.now();
    for (const t of tasks) {
      if (t.source !== "CALENDAR" || t.sourceState !== "ACTIVE") continue;
      if (!t.eventStart || !t.eventEnd) continue;
      if (entries.some((e) => e.taskId === t.id)) continue;
      const ini = new Date(t.eventStart).getTime();
      const fin2 = new Date(t.eventEnd).getTime();
      if (Number.isNaN(ini) || Number.isNaN(fin2) || ini > now) continue;
      const date = diaDe(t.eventStart);
      if (date == null || !fechas.includes(date)) continue;
      acc.set(`${date}:${t.id}`, {
        date,
        start: t.eventStart,
        taskId: t.id,
        title: t.title,
        seconds: Math.max(0, Math.round((fin2 - ini) / 1000)),
        running: false,
      });
    }

    const out: LogDay[] = fechas.map((date) => {
      const segments = [...acc.values()]
        .filter((x) => x.date === date)
        .sort((a, b) => a.start.localeCompare(b.start) || a.taskId - b.taskId);
      const delDia = tasks.filter((t) => t.sourceState === "ACTIVE" && t.scheduledDate === date);
      let plannedMinutes = 0;
      let unestimated = 0;
      for (const t of delDia) {
        const minutes =
          t.estimatedMinutes ??
          (t.source === "CALENDAR" && t.eventStart && t.eventEnd
            ? Math.max(0, Math.round((+new Date(t.eventEnd) - +new Date(t.eventStart)) / 60000))
            : null);
        if (minutes == null) unestimated += 1;
        else plannedMinutes += minutes;
      }
      const entry = dayEntries.get(date);
      const cells = new Map<number | null, RollupCell>();
      for (const x of segments) {
        const t = tasks.find((y) => y.id === x.taskId);
        const categoryId = t?.categoryId ?? null;
        const c = cells.get(categoryId) ?? {
          date,
          categoryId,
          contextId: (() => {
            if (categoryId == null) return null;
            const cat = categories.find((y) => y.id === categoryId);
            return cat ? (cat.parentId ?? cat.id) : null;
          })(),
          seconds: 0,
        };
        c.seconds += Math.max(0, x.seconds);
        cells.set(categoryId, c);
      }
      return {
        date,
        note: entry?.note ?? null,
        closedAt: entry?.closedAt ?? null,
        mood: entry?.mood ?? null,
        cells: [...cells.values()]
          .filter((c) => c.seconds > 0)
          .sort((a, b) => (a.categoryId ?? 0) - (b.categoryId ?? 0)),
        workedSeconds: segments.reduce((a, x) => a + Math.max(0, x.seconds), 0),
        plannedMinutes,
        unestimated,
        done: tasks
          .filter((t) => t.status === "DONE" && diaDe(t.completedAt) === date)
          .sort((a, b) => (a.completedAt ?? "").localeCompare(b.completedAt ?? ""))
          .map((task) => {
            const k = `${date}:${task.id}`;
            // `has` y no `get() ?? null`: la cadena vacía significa "incluida sin
            // resumen", y con `??` se confundiría con "no incluida".
            return { task, note: dayTaskNotes.has(k) ? dayTaskNotes.get(k)! : null };
          }),
        timeline: segments
          .filter((x) => x.seconds > 0 || x.running)
          .map(({ taskId, title, seconds, running }) => ({
            taskId,
            title,
            seconds: Math.max(0, seconds),
            running,
          })),
      };
    });
    // Del más nuevo al más viejo.
    return out.reverse();
  },

  setDayNote: async (date: string, note: string | null): Promise<void> => {
    const limpia = note?.trim() ?? "";
    const previo = dayEntries.get(date) ?? ENTRADA_VACIA;
    dayEntries.set(date, { ...previo, note: limpia === "" ? null : limpia });
  },

  setDayMood: async (date: string, mood: string | null): Promise<void> => {
    const limpia = mood?.trim() ?? "";
    const previo = dayEntries.get(date) ?? ENTRADA_VACIA;
    dayEntries.set(date, { ...previo, mood: limpia === "" ? null : limpia });
  },

  /** Vaciar el texto **no** la saca: la fila es lo que significa "incluida". */
  setDayTaskNote: async (date: string, taskId: number, note: string): Promise<void> => {
    dayTaskNotes.set(`${date}:${taskId}`, note.trim());
  },

  includeInLog: async (date: string, taskId: number): Promise<void> => {
    const k = `${date}:${taskId}`;
    if (!dayTaskNotes.has(k)) dayTaskNotes.set(k, "");
  },

  removeFromLog: async (date: string, taskId: number): Promise<void> => {
    dayTaskNotes.delete(`${date}:${taskId}`);
  },

  closeDay: async (date: string): Promise<string> => {
    const previo = dayEntries.get(date) ?? ENTRADA_VACIA;
    // No vuelve a sellar: "a qué hora cerré" es el dato interesante.
    const closedAt = previo.closedAt ?? nowISO();
    dayEntries.set(date, { ...previo, closedAt });
    return closedAt;
  },

  reopenDay: async (date: string): Promise<void> => {
    const previo = dayEntries.get(date);
    if (previo) dayEntries.set(date, { ...previo, closedAt: null });
  },

  focusQueue: async (date: string, nowHhmm: string): Promise<Task[]> =>
    tasks
      .filter((t) => t.sourceState === "ACTIVE" && t.status === "TODO" && t.scheduledDate === date)
      .sort((a, b) => {
        const late = (t: Task) => (t.scheduledTime && t.scheduledTime > nowHhmm ? 1 : 0);
        if (late(a) !== late(b)) return late(a) - late(b);
        const hasTime = (t: Task) => (t.scheduledTime ? 0 : 1);
        if (hasTime(a) !== hasTime(b)) return hasTime(a) - hasTime(b);
        if (a.scheduledTime && b.scheduledTime && a.scheduledTime !== b.scheduledTime) {
          return a.scheduledTime < b.scheduledTime ? -1 : 1;
        }
        return a.position - b.position;
      }),

  notifyAlert: async (
    _title: string,
    _body: string,
    _action: string,
    _sound: string,
  ): Promise<void> => {
    /* fuera de Tauri no hay avisos del sistema; los manda macOS vía Rust */
  },

  // Los catorce de `/System/Library/Sounds` en un macOS de fábrica. Fuera de
  // Tauri no se puede leer la carpeta, y una lista vacía dejaría el selector
  // mudo sin explicar por qué.
  noticeSounds: async (): Promise<string[]> => [
    "Basso",
    "Blow",
    "Bottle",
    "Frog",
    "Funk",
    "Glass",
    "Hero",
    "Morse",
    "Ping",
    "Pop",
    "Purr",
    "Sosumi",
    "Submarine",
    "Tink",
  ],

  notificationIdentity: async (): Promise<string> => "",

  openNotificationSettings: async (): Promise<void> => {
    /* fuera de Tauri no hay Ajustes del sistema que abrir */
  },

  createObjective: async (isoWeek: string, title: string): Promise<Objective> => {
    const o: Objective = {
      id: nextId(),
      isoWeek,
      title,
      position: objectives.filter((x) => x.isoWeek === isoWeek).length,
      completed: false,
    };
    objectives.push(o);
    return o;
  },

  updateObjective: async (id: number, title?: string, completed?: boolean): Promise<void> => {
    const o = objectives.find((x) => x.id === id);
    if (!o) return;
    if (title !== undefined) o.title = title;
    if (completed !== undefined) o.completed = completed;
  },

  deleteObjective: async (id: number): Promise<void> => {
    const i = objectives.findIndex((x) => x.id === id);
    if (i >= 0) objectives.splice(i, 1);
  },

  createCategory: async (
    parentId: number | null,
    name: string,
    color: string,
  ): Promise<Category> => {
    const c: Category = {
      id: nextId(),
      parentId,
      name,
      color,
      position: categories.length,
      archived: false,
    };
    categories.push(c);
    return c;
  },

  updateCategory: async (id: number, name: string, color: string): Promise<void> => {
    const c = categories.find((x) => x.id === id);
    if (c) {
      c.name = name;
      c.color = color;
    }
  },

  deleteCategory: async (id: number): Promise<void> => {
    const i = categories.findIndex((x) => x.id === id);
    if (i >= 0) categories.splice(i, 1);
  },

  // --- settings ---

  listSettings: async (): Promise<Array<[string, string]>> =>
    [...settings.entries()].sort(([a], [b]) => a.localeCompare(b)),

  setSetting: async (key: string, value: string): Promise<void> => {
    settings.set(key, value);
  },

  /**
   * Fuera de Tauri no hay sistema operativo al que registrarse, así que el estado
   * vive en memoria. A propósito **no** está en `settings`: es lo mismo que hace
   * el comando de verdad, y así un test que espere encontrarlo en la tabla falla
   * acá en vez de fallar en producción.
   */
  autostartEnabled: async (): Promise<boolean> => autostart,

  setAutostart: async (enabled: boolean): Promise<void> => {
    autostart = enabled;
  },

  // --- respaldos ---

  /**
   * Fuera de Tauri no hay build, así que no hay versión que informar. Devolver
   * `"dev"` es más honesto que hardcodear un número que va a quedar viejo: la
   * versión de verdad la fija el compilador (`backup::APP_VERSION`).
   */
  appVersion: async (): Promise<string> => "dev",

  /**
   * Fuera de Tauri **siempre es dev**: si estás mirando la app en el browser, no
   * estás en un `.dmg` instalado. Eso también apaga el respaldo automático en los
   * tests, que es lo correcto —no hay disco que escribir— y de paso deja el
   * distintivo "dev" visible en el sidebar del preview.
   */
  profile: async (): Promise<Profile> => ({ dev: true, dbFile: "sunrise-dev.sqlite" }),

  /**
   * Fuera de Tauri **nunca hay actualización**, y eso no es una simplificación:
   * el updater reemplaza un `.app` instalado, y en el browser o en jsdom no hay
   * ninguno. Devolver `null` deja a la vista en su estado "estás al día", que es
   * justamente lo que corresponde mostrar ahí.
   */
  checkForUpdate: async (): Promise<AppUpdate | null> => null,

  installUpdate: async (): Promise<void> => {
    throw new Error("no hay nada que instalar fuera de la app de escritorio");
  },

  createBackup: async (): Promise<BackupFile> => {
    const dir = settings.get("backup_dir")?.trim();
    if (!dir) throw new Error("no hay carpeta de respaldos configurada (Configs → Respaldo)");

    const d = new Date();
    const p = (n: number, largo = 2) => String(n).padStart(largo, "0");
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
      d.getHours(),
    )}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const name = `sunrise-${stamp}.zip`;

    const hecho: BackupFile = {
      name,
      path: `${dir}/${name}`,
      bytes: 64 * 1024,
      createdAt: d.toISOString(),
    };
    // Un respaldo del mismo segundo **reemplaza** al anterior, que es lo que hace
    // el disco: mismo nombre de archivo, mismo archivo. Sin esto la lista quedaba
    // con dos rutas idénticas y React se queja de las keys repetidas.
    const same = backups.findIndex((b) => b.path === hecho.path);
    if (same !== -1) backups.splice(same, 1);
    // Al principio: la lista va del más nuevo al más viejo, como en Rust.
    backups.unshift(hecho);

    // Misma retención que `create_backup` en Rust, y con el mismo default.
    const keep = Number(settings.get("backup_keep") ?? 2);
    if (Number.isFinite(keep) && keep > 0) backups.splice(keep);
    return { ...hecho };
  },

  /**
   * El mock no puede probar permisos de escritura, pero sí lo único que se puede
   * saber de una ruta sin tocar el disco: que sea absoluta. Una relativa se
   * resolvería contra el directorio de trabajo del proceso, que no es un lugar
   * donde nadie quiera sus respaldos.
   */
  testBackupDir: async (dir: string): Promise<void> => {
    if (!dir.trim()) throw new Error("elige una carpeta");
    if (!dir.trim().startsWith("/")) throw new Error("la ruta tiene que ser absoluta");
  },

  listBackups: async (): Promise<BackupFile[]> =>
    settings.get("backup_dir")?.trim() ? backups.map((b) => ({ ...b })) : [],

  restoreBackup: async (zipPath: string): Promise<RestoreResult> => {
    const del = backups.find((b) => b.path === zipPath);
    if (!del) {
      throw new Error("el .zip no trae ninguna base de datos (.sqlite) adentro");
    }
    // No se restaura nada: reemplazar la base es justo lo que el mock no tiene.
    // Lo que sí devuelve es la misma forma, con las cuentas de esta memoria, para
    // que el diálogo de resultado se pueda ver y testear.
    const ultima = entries.reduce<string | null>(
      (max, e) => (max == null || e.startedAt > max ? e.startedAt : max),
      null,
    );
    return {
      from: zipPath,
      backupCopy: `${del.path.replace(/[^/]+$/, "")}antes-de-restaurar-mock.sqlite`,
      createdAt: del.createdAt,
      backupVersion: "dev",
      currentVersion: "dev",
      tasks: tasks.length,
      lastActivity: ultima,
    };
  },

  // --- feeds de calendario ---
  //
  // El mock no sale a la red: `syncCalendarFeed` solo sella el intento, igual
  // que haría un feed que respondió vacío. Alcanza para que la UI de Configs se
  // pueda usar en el browser y para que los tests no dependan de internet.

  listCalendarFeeds: async (): Promise<CalendarFeed[]> => feeds.map((f) => ({ ...f })),

  createCalendarFeed: async (
    name: string,
    icsUrl: string,
    defaultCategoryId: number | null,
    pollMinutes: number,
  ): Promise<CalendarFeed> => {
    const f: CalendarFeed = {
      id: nextFeedId++,
      name,
      icsUrl: icsUrl.trim(),
      defaultCategoryId,
      importAsTasks: true,
      // Mismo piso que `POLL_MINIMO` en `repo.rs`.
      pollMinutes: Math.max(2, pollMinutes),
      lastSyncedAt: null,
      lastError: null,
    };
    feeds.push(f);
    return { ...f };
  },

  updateCalendarFeed: async (
    id: number,
    name: string,
    icsUrl: string,
    defaultCategoryId: number | null,
    importAsTasks: boolean,
    pollMinutes: number,
  ): Promise<CalendarFeed | null> => {
    const f = feeds.find((x) => x.id === id);
    if (!f) return null;
    f.name = name;
    f.icsUrl = icsUrl.trim();
    f.defaultCategoryId = defaultCategoryId;
    f.importAsTasks = importAsTasks;
    f.pollMinutes = Math.max(2, pollMinutes);
    // Espeja `apply_default_channel` de `repo.rs`: le pone el canal a las
    // reuniones del feed que todavía no tienen uno, sin pisar las que se
    // etiquetaron a mano.
    if (defaultCategoryId != null) {
      for (const t of tasks) {
        if (t.feedId === id && t.categoryId == null) t.categoryId = defaultCategoryId;
      }
    }
    return { ...f };
  },

  deleteCalendarFeed: async (id: number): Promise<void> => {
    const i = feeds.findIndex((x) => x.id === id);
    if (i >= 0) feeds.splice(i, 1);
    // Como en Rust (`ON DELETE SET NULL`): las tareas importadas sobreviven.
    for (const t of tasks) if (t.feedId === id) t.feedId = null;
  },

  syncCalendarFeed: async (id: number): Promise<number> => {
    const f = feeds.find((x) => x.id === id);
    if (!f) throw new Error("ese feed ya no existe");
    f.lastSyncedAt = new Date().toISOString();
    f.lastError = null;
    return 0;
  },

  syncCalendarFeeds: async (_forzar = false): Promise<number> => {
    for (const f of feeds) {
      f.lastSyncedAt = new Date().toISOString();
      f.lastError = null;
    }
    return feeds.length;
  },

  /** Fuera de Tauri no hay app que cerrar (y el timer sigue corriendo igual). */
  confirmQuit: async (): Promise<void> => {},
};
