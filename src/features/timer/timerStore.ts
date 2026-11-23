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

/** La foto de un timer que corre, para dejarla como `last`. */
function snapshot(a: ActiveTimer): LastTask {
  return {
    taskId: a.taskId,
    title: a.title,
    estimatedMinutes: a.estimatedMinutes,
    // `baseSeconds` y no lo corrido: es estable entre lecturas, así que dos
    // ventanas que reparan `last` a la vez escriben lo mismo y no se contestan.
    // Al pausarla, `stop` escribe el número de verdad.
    seconds: a.baseSeconds,
  };
}

/**
 * **Mientras haya timers corriendo, `last` es uno de ellos** (#19).
 *
 * `last` es la fila que queda en pausa cuando la pila se vacía, y también lo que
 * `refresh` revisa para avanzar si la completaron desde otro lado. Si apuntara a
 * una que ya salió de la pila —pausaste A de A+B, y después B se completó desde
 * una card—, la pila vacía mostraría A en pausa en vez de avanzar: una tarea que
 * dejaste a propósito vuelve sola al taxímetro. Por eso, si `last` no está entre
 * las que corren, pasa a ser la primera de ellas.
 */
function lastInStack(last: LastTask | null, actives: ActiveTimer[]): LastTask | null {
  if (actives.length === 0) return last;
  if (last && actives.some((a) => a.taskId === last.taskId)) return last;
  return snapshot(actives[0]);
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

/** Opciones de `start`. */
export interface StartOptions {
  /**
   * `true` arranca **sin pausar** los demás timers (play en paralelo, #17).
   * Por defecto es el play clásico: pausa todo lo que corre y arranca esta.
   */
  parallel?: boolean;
}

/**
 * Lo que se deriva de la lista de timers abiertos. Sale **siempre** de
 * `derive`, para que `actives`, `elapsedById`, `active` y `elapsed` no puedan
 * quedar desalineados entre sí.
 */
export interface TimersSnapshot {
  actives: ActiveTimer[];
  elapsedById: Record<number, number>;
  active: ActiveTimer | null;
  elapsed: number;
}

export function derive(actives: ActiveTimer[], now: number = Date.now()): TimersSnapshot {
  const elapsedById: Record<number, number> = {};
  for (const a of actives) elapsedById[a.taskId] = a.baseSeconds + runSeconds(a.startedAt, now);
  const active = actives[0] ?? null;
  return {
    actives,
    elapsedById,
    active,
    elapsed: active ? elapsedById[active.taskId] : 0,
  };
}

export interface TimerState {
  /**
   * Los timers en curso, **del más antiguo al más nuevo** (como los devuelve
   * `get_active_timers`). A lo más uno por tarea (I4).
   */
  actives: ActiveTimer[];
  /** Lo trabajado **hoy** por cada tarea que corre (`baseSeconds` + `runSeconds`). */
  elapsedById: Record<number, number>;
  /**
   * **Compat**: el primero de `actives`, o `null`. Es "el" timer de las vistas
   * que todavía muestran uno solo; con un solo timer corriendo es el de siempre.
   */
  active: ActiveTimer | null;
  /** **Compat**: lo de hoy de `active` (`elapsedById[active.taskId]`), o 0. */
  elapsed: number;
  last: LastTask | null;
  /**
   * Si ya se leyó el timer de la base **al menos una vez** en esta ventana.
   *
   * Existe para una sola cosa, y es de peso: **`actives` arranca vacío porque
   * vive en la base**, mientras que `last` sí se lee de `localStorage` de forma
   * síncrona. Sin esta bandera, un timer *corriendo* se ve como "no hay nada que
   * mostrar" durante el primer render, y quien decide la visibilidad del
   * taxímetro lo esconde antes de saber que había algo. Ver `useSelfVisibility`.
   */
  loaded: boolean;

  refresh: () => Promise<void>;
  /**
   * Arranca el timer de `taskId`. Por defecto es el play clásico (pausa todos
   * y arranca este); con `{ parallel: true }` lo suma sin tocar los demás. Si la
   * tarea ya corre, no cambia nada.
   */
  start: (taskId: number, opts?: StartOptions) => Promise<void>;
  /**
   * Pausa el timer de `taskId`; **sin id, el de `active`** (compat con las
   * vistas de un solo timer). Los demás siguen. Devuelve `[taskId, seconds]` de
   * lo registrado, o `null` si no corría.
   */
  stop: (taskId?: number) => Promise<[number, number] | null>;
  /** Pausa todos los timers. Un `[taskId, seconds]` por cada uno. */
  stopAll: () => Promise<Array<[number, number]>>;
  /** Si corre la pausa; si no, play **clásico**. */
  toggle: (taskId: number) => Promise<void>;
  /** Si el timer de esa tarea está corriendo (lectura puntual; en un render usa `selectIsRunning`). */
  isRunning: (taskId: number) => boolean;
  dismissLast: () => void;
  /**
   * El ojo del taxímetro: pausa **toda la pila** y la esconde, con una sola
   * escritura de `last` (`null`) y un solo aviso. Si pasara por `stopAll` y
   * después `dismissLast`, `stopAll` escribiría una pausada intermedia y la
   * avisaría: la otra ventana podría leerla, y su `refresh` reescribirla encima
   * del `null` — la fila oculta volvía en pausa.
   */
  hideAll: () => Promise<void>;
  tick: () => void;
  /**
   * Completa una tarea del taxímetro; **sin id, la primera fila** (la que
   * corre más antigua, o la pausada). Si quedan otras corriendo solo la saca de
   * la pila; si era la última, deja lista la siguiente del día en pausa.
   */
  completeAndAdvance: (taskId?: number) => Promise<void>;
}

/** Selector para suscribirse a "¿corre esta tarea?" desde un componente. */
export const selectIsRunning =
  (taskId: number) =>
  (s: TimerState): boolean =>
    s.actives.some((a) => a.taskId === taskId);

/**
 * Estado del timer respaldado en la DB (`time_entries`), compartido por toda la
 * ventana. Es un store (no un hook con estado local) para que el play de una
 * card, el Focus y el taxímetro vean siempre lo mismo: los eventos `storage`
 * no se disparan en el documento que los origina, así que un hook por
 * componente nunca se enteraría de los cambios locales.
 *
 * **Varios timers pueden correr a la vez** (#17), uno por tarea. Después de cada
 * mutación la lista se **relee** de la base en vez de editarse a mano: un `set`
 * que borrara `active` dejaría fuera de la vista a los que siguen corriendo.
 */
export const useTimerStore = create<TimerState>((set, get) => ({
  ...derive([]),
  last: readLast(),
  loaded: false,

  refresh: async () => {
    const actives = await api.getActiveTimers();
    let last = readLast();

    // Si hay una tarea pausada en el widget, re-léela: su título, su tiempo
    // planned o lo trabajado hoy pueden haber cambiado desde que se guardó el
    // snapshot.
    if (actives.length === 0 && last) {
      const [fresh, secondsToday] = await Promise.all([
        api.getTask(last.taskId),
        api.secondsToday(last.taskId),
      ]);
      if (!fresh) {
        // La tarea ya no está: la mandaron al basurero (#11) —desde la otra
        // ventana, desde esta o desde el MCP—, o se restauró un respaldo anterior a
        // que existiera. El taxímetro no puede seguir
        // ofreciendo darle play a un id que ya no resuelve.
        last = null;
      } else if (fresh.status === "DONE") {
        // La completaron desde otro lado (Focus, la card, el modal): el
        // taxímetro no puede seguir ofreciendo retomar algo ya cerrado, así que
        // avanza igual que si hubieras usado su propio check —y si no queda
        // nada pendiente, se oculta.
        last = await nextPaused(fresh.id);
      } else {
        // El contador sale de `seconds_today`, lo cerrado **hoy** en la base, y
        // NUNCA de `actualSeconds`: eso es el total histórico, y pisarlo hacía
        // saltar el número al primer refresco. Releerlo es lo que hace que la
        // fila en pausa se entere de lo que cambió por fuera de este store: un
        // `stop_timer` del MCP la dejaba con la foto de cuando arrancó (se veía
        // retroceder) y un `log_time` no la movía (#38). Las dos ventanas leen el
        // mismo número, así que `persistLast` no arma un ida y vuelta.
        last = {
          ...last,
          title: fresh.title,
          estimatedMinutes: fresh.estimatedMinutes,
          seconds: secondsToday,
        };
      }
      // Sin `broadcast()`: refrescar no es mutar, y avisarle a la otra ventana
      // la haría refrescar y avisar de vuelta.
      persistLast(last);
    } else if (actives.length > 0 && last) {
      // Una pausa o un check que llegó por otro camino (Rust al completar, la
      // otra ventana) pudo dejar `last` fuera de la pila. Ver `lastInStack`.
      // Un `last` en `null` **no** se repara: es el ojo (`hideAll`), y un
      // `refresh` que leyó la pila justo antes de que se pausara la resucitaría.
      last = lastInStack(last, actives);
      persistLast(last);
    }

    set({ ...derive(actives), last, loaded: true });
  },

  start: async (taskId, opts) => {
    const started = await api.startTimer(taskId, opts?.parallel ?? false);
    const actives = await api.getActiveTimers();
    const last: LastTask = {
      taskId: started.taskId,
      title: started.title,
      estimatedMinutes: started.estimatedMinutes,
      seconds: started.baseSeconds,
    };
    writeLast(last);
    set({ ...derive(actives), last });
    useAppStore.getState().bumpData();
    broadcast();
  },

  stop: async (taskId) => {
    // `typeof`: si alguien pasa `stop` directo a un `onClick`, el primer
    // argumento es el evento del mouse, no un id.
    // Sin id se pausa el primero **de la base**, no el de este store: si la
    // ventana está desfasada (llegó tarde el aviso de un play en la otra), el
    // id local cerraría nada y el clic se perdería.
    const id = typeof taskId === "number" ? taskId : (await api.getActiveTimers())[0]?.taskId;
    const prev = get().actives.find((a) => a.taskId === id) ?? null;
    const res = id == null ? null : await api.stopTimer(id);
    const actives = await api.getActiveTimers();
    if (res) {
      const [stoppedId, seconds] = res;
      const guardada = readLast();
      const sameSaved = guardada?.taskId === stoppedId ? guardada : null;
      // Pausar una de varias la **saca** de la pila: las que siguen corriendo
      // son las filas, y `last` sigue apuntando a una de ellas. Solo la última
      // en pausarse queda en el taxímetro esperando su play, como con un timer.
      const last: LastTask | null =
        actives.length > 0
          ? lastInStack(guardada, actives)
          : {
              taskId: stoppedId,
              title: prev?.title ?? sameSaved?.title ?? "",
              estimatedMinutes: prev?.estimatedMinutes ?? sameSaved?.estimatedMinutes ?? null,
              seconds: (prev?.baseSeconds ?? 0) + seconds,
            };
      writeLast(last);
      set({ ...derive(actives), last });
    } else {
      set(derive(actives));
    }
    useAppStore.getState().bumpData();
    broadcast();
    return res;
  },

  stopAll: async () => {
    const prev = get().actives;
    const res = await api.stopAllTimers();
    // La pausada que queda en el taxímetro es la que mostraba: la primera.
    const first = res[0];
    if (first) {
      const [stoppedId, seconds] = first;
      const p = prev.find((a) => a.taskId === stoppedId);
      const saved = readLast();
      const last: LastTask = {
        taskId: stoppedId,
        title: p?.title ?? (saved?.taskId === stoppedId ? saved.title : ""),
        estimatedMinutes:
          p?.estimatedMinutes ?? (saved?.taskId === stoppedId ? saved.estimatedMinutes : null),
        seconds: (p?.baseSeconds ?? 0) + seconds,
      };
      writeLast(last);
      set({ ...derive(await api.getActiveTimers()), last });
    } else {
      set(derive(await api.getActiveTimers()));
    }
    useAppStore.getState().bumpData();
    broadcast();
    return res;
  },

  toggle: async (taskId) => {
    const { isRunning, start, stop } = get();
    if (isRunning(taskId)) {
      await stop(taskId);
    } else {
      await start(taskId);
    }
  },

  isRunning: (taskId) => selectIsRunning(taskId)(get()),

  dismissLast: () => {
    writeLast(null);
    set({ last: null });
    broadcast();
  },

  hideAll: async () => {
    try {
      await api.stopAllTimers();
    } catch (err) {
      // Esconder igual: un ojo que no responde es peor que una pausa que falló,
      // y la pila se relee de la base abajo, así que lo que siga corriendo se ve.
      console.error("[sunrise] taxímetro: no pude pausar al ocultar:", err);
    }
    writeLast(null);
    set({ ...derive(await api.getActiveTimers()), last: null });
    useAppStore.getState().bumpData();
    broadcast();
  },

  completeAndAdvance: async (target) => {
    const { active, last, stop, isRunning } = get();
    // `typeof`, igual que en `stop`: pasado directo a un `onClick`, el primer
    // argumento sería el evento.
    const taskId = typeof target === "number" ? target : (active?.taskId ?? last?.taskId);
    if (taskId == null) return;

    if (isRunning(taskId)) await stop(taskId);

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

    // **Completar una de varias no adelanta nada**: las otras siguen
    // corriendo y son las filas del taxímetro. Se mira la base y no el store,
    // porque es la base la que sabe qué quedó abierto después del check.
    const remaining = await api.getActiveTimers();
    if (remaining.length > 0) {
      const kept = lastInStack(readLast(), remaining);
      writeLast(kept);
      set({ ...derive(remaining), last: kept });
      broadcast();
      useAppStore.getState().bumpData();
      return;
    }

    // Avanzar no es empezar: la siguiente queda **en pausa**, esperando su play.
    // Arrancarla sola hacía que el tiempo de una tarea que ni miraste empezara a
    // correr por haber completado la anterior. Si no queda ninguna, el taxímetro
    // se oculta: no queda nada que cronometrar.
    const next = await nextPaused(taskId);
    writeLast(next);
    set({ ...derive(remaining), last: next });
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
    const { actives } = get();
    if (actives.length === 0) return;
    set(derive(actives));
  },
}));

/**
 * Las filas del taxímetro (#19): **una por timer que corre**, del más antiguo al
 * más nuevo; si no corre ninguno, la pausada (`last`); si tampoco hay, ninguna.
 * Una pausada nunca convive con filas que corren: pausar una de varias la saca.
 */
export function timerRows(s: Pick<TimerState, "actives" | "elapsedById" | "last">): LastTask[] {
  if (s.actives.length > 0) {
    return s.actives.map((a) => ({
      taskId: a.taskId,
      title: a.title,
      estimatedMinutes: a.estimatedMinutes,
      seconds: s.elapsedById[a.taskId] ?? a.baseSeconds,
    }));
  }
  return s.last ? [s.last] : [];
}

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
