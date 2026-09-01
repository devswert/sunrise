import { create } from "zustand";
import { api } from "../../lib/ipc";
import type { ActiveTimer } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { nowHhmm, startOfDayAt, todayISO } from "../../lib/date";

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
    if (!raw) return null;
    const v = JSON.parse(raw) as LastTask;
    // Un registro sin `taskId` —corrupto, o de un formato que ya no existe—
    // haría que `refresh` pida la tarea `undefined` y reviente sin síntoma
    // visible salvo un taxímetro que deja de actualizarse.
    return typeof v?.taskId === "number" ? v : null;
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

/**
 * Escribe solo si el registro cambió.
 *
 * `refresh` escribe, y escribir dispara el evento `storage` en la **otra**
 * ventana, que refresca y vuelve a escribir. Eso se sostiene mientras el valor
 * sea idéntico en cada salto; desde que `refresh` puede avanzar a la siguiente
 * tarea —y eso cuesta una llamada a `focus_queue`— un registro que varíe
 * convierte el ida y vuelta en un ping-pong con un IPC por salto.
 */
function persistLast(v: LastTask | null) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(LAST_KEY);
  } catch {
    /* ignore */
  }
  if (raw === (v ? JSON.stringify(v) : null)) return;
  writeLast(v);
}

/**
 * La siguiente pendiente de hoy **en pausa**, o `null` si no queda ninguna —y
 * entonces el taxímetro se oculta, que es la señal de que no queda nada por
 * hacer. Excluye `exceptId` porque la recién completada puede seguir en la cola
 * que se lee.
 */
async function nextPaused(exceptId: number): Promise<LastTask | null> {
  // El día y la hora tienen que salir de la misma zona: `focus_queue` compara
  // `scheduled_time <= ?2` dentro del día `?1`, así que si el corte viniera de la
  // zona del sistema y el día de la del usuario, la cola se ordenaría contra un
  // reloj que no es el que el usuario ve.
  const next = (await api.focusQueue(todayISO(), nowHhmm())).find((t) => t.id !== exceptId);
  if (!next) return null;
  return {
    taskId: next.id,
    title: next.title,
    estimatedMinutes: next.estimatedMinutes,
    // En 0: el taxímetro cuenta lo de HOY, y a esta tarea todavía no le pusiste
    // tiempo hoy. Empieza a correr cuando le des play.
    seconds: 0,
  };
}

function broadcast() {
  try {
    localStorage.setItem(CHANNEL, String(Date.now()));
  } catch {
    /* ignore */
  }
}

/**
 * ¿Se pasó del tiempo estimado? Pinta el taxímetro en rojo y da el aviso de
 * Focus. Sin estimado (null o <= 0) nunca se considera excedido.
 *
 * **La campana no sale de acá**: la misma regla vive en `bell::is_due` (Rust),
 * que es quien la toca. Si cambia una, cambia la otra.
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
  // La medianoche **de la zona del usuario**, la misma que usa `seconds_today`
  // en Rust. Con `setHours` sobre un `Date` pelado se usaba la del sistema, y las
  // dos puntas del contador podían hablar de días distintos.
  const from = Math.max(start, startOfDayAt(ahora).getTime());
  return Math.max(0, Math.round((ahora - from) / 1000));
}

interface TimerState {
  active: ActiveTimer | null;
  elapsed: number;
  last: LastTask | null;

  refresh: () => Promise<void>;
  start: (taskId: number) => Promise<void>;
  stop: () => Promise<[number, number] | null>;
  toggle: (taskId: number) => Promise<void>;
  dismissLast: () => void;
  tick: () => void;
  /** Completa la tarea del taxímetro y deja lista la siguiente del día. */
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

  refresh: async () => {
    const active = await api.getActiveTimer();
    let last = readLast();

    // Si hay una tarea pausada en el widget, re-léela: su título o su tiempo
    // planned pueden haber cambiado desde que se guardó el snapshot.
    if (!active && last) {
      const fresh = await api.getTask(last.taskId);
      if (!fresh) {
        // La tarea ya no está: la borraron en la otra ventana, o se restauró un
        // respaldo anterior a que existiera. El taxímetro no puede seguir
        // ofreciendo darle play a un id que ya no resuelve.
        last = null;
      } else if (fresh.status === "DONE") {
        // La completaron desde otro lado (Focus, la card, el modal): el
        // taxímetro no puede seguir ofreciendo retomar algo ya cerrado, así que
        // avanza igual que si hubieras usado su propio check —y si no queda
        // nada pendiente, se oculta.
        last = await nextPaused(fresh.id);
      } else {
        // `seconds` NO se toma de `actualSeconds`: eso es el total histórico y
        // el taxímetro cuenta lo de hoy. Acá solo se refrescan el título y el
        // estimado, que es para lo que existe esta re-lectura.
        last = { ...last, title: fresh.title, estimatedMinutes: fresh.estimatedMinutes };
      }
      // Sin `broadcast()`: refrescar no es mutar, y avisarle a la otra ventana
      // la haría refrescar y avisar de vuelta.
      persistLast(last);
    }

    if (active) {
      set({ active, last, elapsed: active.baseSeconds + runSeconds(active.startedAt) });
    } else {
      set({ active: null, last, elapsed: 0 });
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
    set({ active, last, elapsed: active.baseSeconds });
    useAppStore.getState().bumpData();
    broadcast();
  },

  stop: async () => {
    const prev = get().active;
    const res = await api.stopTimer();
    if (res) {
      const [taskId, seconds] = res;
      const guardada = readLast();
      const last: LastTask = {
        taskId,
        title: prev?.title ?? guardada?.title ?? "",
        estimatedMinutes: prev?.estimatedMinutes ?? guardada?.estimatedMinutes ?? null,
        seconds: (prev?.baseSeconds ?? 0) + seconds,
      };
      writeLast(last);
      set({ active: null, last, elapsed: 0 });
    } else {
      set({ active: null, elapsed: 0 });
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
    const { active, last, stop } = get();
    const taskId = active?.taskId ?? last?.taskId;
    if (taskId == null) return;

    if (active) await stop();

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

    // Avanzar no es empezar: la siguiente queda **en pausa**, esperando su play.
    // Arrancarla sola hacía que el tiempo de una tarea que ni miraste empezara a
    // correr por haber completado la anterior. Si no queda ninguna, el taxímetro
    // se oculta: no queda nada que cronometrar.
    const next = await nextPaused(taskId);
    writeLast(next);
    set({ active: null, elapsed: 0, last: next });
    broadcast();
    useAppStore.getState().bumpData();
  },

  /**
   * Avanza la cuenta que se ve. **No toca la campana**, y eso es deliberado:
   * la campana la decide Rust (`bell.rs`), porque este tick vive en un webview y
   * un webview que no se ve no corre sus timers — con la ventana tapada la
   * campana no sonaba hasta que algo despertaba la página.
   */
  tick: () => {
    const { active } = get();
    if (!active) return;
    set({ elapsed: active.baseSeconds + runSeconds(active.startedAt) });
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
