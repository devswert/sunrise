import { create } from "zustand";
import { api } from "../../lib/ipc";
import type { ActiveTimer } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { todayISO } from "../../lib/date";

/** Canal de sincronización entre ventanas (main ↔ taxímetro). */
const CHANNEL = "sunrise-timer";
/** Última tarea cronometrada, para poder reanudar tras pausar. */
const LAST_KEY = "sunrise-last-task";

export interface LastTask {
  taskId: number;
  title: string;
  estimatedMinutes: number | null;
  seconds: number;
}

function readLast(): LastTask | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as LastTask) : null;
  } catch {
    return null;
  }
}

function writeLast(v: LastTask | null) {
  try {
    if (v) localStorage.setItem(LAST_KEY, JSON.stringify(v));
    else localStorage.removeItem(LAST_KEY);
  } catch {
    /* ignore */
  }
}

function broadcast() {
  try {
    localStorage.setItem(CHANNEL, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * ¿Se pasó del tiempo estimado? Se usa para la campana y el aviso en Focus.
 * Sin estimado (null o <= 0) nunca se considera excedido.
 */
export function isOverEstimate(
  elapsedSeconds: number,
  estimatedMinutes: number | null | undefined,
): boolean {
  if (estimatedMinutes == null || estimatedMinutes <= 0) return false;
  return elapsedSeconds >= estimatedMinutes * 60;
}

/**
 * Formatea segundos como H:MM:SS.
 *
 * El signo va **una vez, adelante**. Con `Math.floor` y `%` sobre un número
 * negativo cada componente salía negativo por separado y se leía
 * `-14:-17:-39`, que además de ilegible no es la hora que representa
 * (`-13:17:39`). No se recorta a cero a propósito: si algo vuelve a mandar un
 * tiempo negativo, se tiene que ver.
 */
export function hms(total: number): string {
  const signo = total < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(total));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return `${signo}${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Segundos corridos de la entrada abierta, **completos**.
 *
 * Convive con `runSeconds` porque responden dos preguntas distintas: el
 * taxímetro quiere "cuánto llevo hoy" y el campo ACTUAL de la tarea quiere
 * "cuánto llevo en total". Antes ese campo mostraba lo de hoy mientras el timer
 * corría y el acumulado cuando estaba detenido, así que el mismo número
 * significaba dos cosas y darle play a una tarea arrastrada lo hacía *bajar*.
 */
export function runTotalSeconds(startedAt: string, ahora: number = Date.now()): number {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.round((ahora - start) / 1000));
}

/**
 * Segundos corridos de la entrada abierta, contando **solo lo de hoy**.
 *
 * `base_seconds` es lo cerrado de hoy (ver `seconds_today` en `repo.rs`), así
 * que lo corrido tiene que medirse con la misma regla o el contador deja de ser
 * "lo trabajado hoy". El caso concreto: un timer que quedó abierto toda la
 * noche mostraba las 15 horas a las 9 de la mañana.
 */
export function runSeconds(startedAt: string, ahora: number = Date.now()): number {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const medianoche = new Date(ahora);
  medianoche.setHours(0, 0, 0, 0);
  const from = Math.max(start, medianoche.getTime());
  return Math.max(0, Math.round((ahora - from) / 1000));
}

/**
 * ¿Esta ventana es la responsable de tocar la campana?
 *
 * El store corre en las dos ventanas (principal y taxímetro). Si ambas tocan,
 * se oyen dos copias con unos ms de desfase y suena "vibrado"/saturado.
 */
let bellOwner = false;
export function setBellOwner(value: boolean) {
  bellOwner = value;
}

interface TimerState {
  active: ActiveTimer | null;
  elapsed: number;
  last: LastTask | null;
  /** Entrada para la que ya sonó la campana (evita repetirla). */
  belledEntryId: number | null;

  refresh: () => Promise<void>;
  start: (taskId: number) => Promise<void>;
  stop: () => Promise<[number, number] | null>;
  toggle: (taskId: number) => Promise<void>;
  dismissLast: () => void;
  tick: () => void;
  /** Completa la tarea del taxímetro y salta a la siguiente del día. */
  completeAndAdvance: () => Promise<void>;
}

/**
 * Estado del timer respaldado en la DB (`time_entries`), compartido por toda la
 * ventana. Es un store (no un hook con estado local) para que el play de una
 * card, el Focus y el taxímetro vean siempre lo mismo: los eventos `storage`
 * no se disparan en el documento que los origina, así que un hook por
 * componente nunca se enteraría de los cambios locales.
 */
export const useTimerStore = create<TimerState>((set, get) => ({
  active: null,
  elapsed: 0,
  last: readLast(),
  belledEntryId: null,

  refresh: async () => {
    const active = await api.getActiveTimer();
    let last = readLast();

    // Si hay una tarea pausada en el widget, re-léela: su título o su tiempo
    // planned pueden haber cambiado desde que se guardó el snapshot.
    if (!active && last) {
      const fresh = await api.getTask(last.taskId);
      if (fresh) {
        last = {
          taskId: fresh.id,
          title: fresh.title,
          estimatedMinutes: fresh.estimatedMinutes,
          seconds: fresh.actualSeconds,
        };
        writeLast(last);
      } else {
        // La tarea ya no está: la borraron en la otra ventana, o se restauró un
        // respaldo anterior a que existiera. El taxímetro no puede seguir
        // ofreciendo darle play a un id que ya no resuelve.
        last = null;
        writeLast(null);
      }
    }

    if (active) {
      set({ active, last, elapsed: active.baseSeconds + runSeconds(active.startedAt) });
    } else {
      set({ active: null, last, elapsed: 0, belledEntryId: null });
    }
  },

  start: async (taskId) => {
    const active = await api.startTimer(taskId);
    const last: LastTask = {
      taskId: active.taskId,
      title: active.title,
      estimatedMinutes: active.estimatedMinutes,
      seconds: active.baseSeconds,
    };
    writeLast(last);
    set({ active, last, elapsed: active.baseSeconds, belledEntryId: null });
    useAppStore.getState().bumpData();
    broadcast();
  },

  stop: async () => {
    const prev = get().active;
    const res = await api.stopTimer();
    if (res) {
      const [taskId, seconds] = res;
      const last: LastTask = {
        taskId,
        title: prev?.title ?? readLast()?.title ?? "",
        estimatedMinutes: prev?.estimatedMinutes ?? readLast()?.estimatedMinutes ?? null,
        seconds: (prev?.baseSeconds ?? 0) + seconds,
      };
      writeLast(last);
      set({ active: null, last, elapsed: 0, belledEntryId: null });
    } else {
      set({ active: null, elapsed: 0, belledEntryId: null });
    }
    useAppStore.getState().bumpData();
    broadcast();
    return res;
  },

  toggle: async (taskId) => {
    const { active, start, stop } = get();
    if (active?.taskId === taskId) {
      await stop();
    } else {
      await start(taskId);
    }
  },

  dismissLast: () => {
    writeLast(null);
    set({ last: null });
    broadcast();
  },

  completeAndAdvance: async () => {
    const { active, last, stop, start, dismissLast } = get();
    const taskId = active?.taskId ?? last?.taskId;
    if (taskId == null) return;

    if (active) await stop();

    const today = todayISO();
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    // Manda la completada al final de SU día, no de hoy: el taxímetro puede
    // estar cronometrando una tarea de otro día (se arrancó desde la semana, o
    // se reanudó la pausada), y completarla no debe reprogramarla —`carry_over`
    // no la devolvería, porque solo arrastra las que siguen en TODO.
    const done = await api.getTask(taskId);
    const doneDate = done?.scheduledDate ?? null;
    await api.setTaskStatus(taskId, "DONE");
    if (doneDate) {
      const sameDay = await api.listTasksForDate(doneDate);
      const lastPos = sameDay.reduce((m, t) => Math.max(m, t.position), 0);
      await api.moveTask(taskId, doneDate, lastPos + 1);
    }

    // Siguiente pendiente del día; si no queda ninguna, el taxímetro se oculta.
    const next = (await api.focusQueue(today, hhmm)).find((t) => t.id !== taskId);
    if (next) {
      await start(next.id);
    } else {
      dismissLast();
    }
    useAppStore.getState().bumpData();
  },

  tick: () => {
    const { active, belledEntryId } = get();
    if (!active) return;
    const elapsed = active.baseSeconds + runSeconds(active.startedAt);
    set({ elapsed });

    // Campana al alcanzar el estimado, una sola vez por entrada.
    //
    // Sin notificación nativa a propósito: el sonido más el taxímetro cambiando
    // de color ya avisan, y una notificación del sistema encima es ruido —hay
    // que ir a descartarla, y se apila si se pasan varias tareas.
    if (isOverEstimate(elapsed, active.estimatedMinutes) && belledEntryId !== active.entryId) {
      set({ belledEntryId: active.entryId });
      if (bellOwner) void api.playBell();
    }
  },
}));

/** Tarea a mostrar en el taxímetro: la activa, o la última pausada. */
export function timerDisplay(s: TimerState): LastTask | null {
  if (s.active) {
    return {
      taskId: s.active.taskId,
      title: s.active.title,
      estimatedMinutes: s.active.estimatedMinutes,
      seconds: s.elapsed,
    };
  }
  return s.last;
}
