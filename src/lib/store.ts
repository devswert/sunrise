import { useEffect } from "react";
import { create } from "zustand";

/**
 * Clave de `localStorage` con la que una ventana le avisa a la otra que los
 * datos cambiaron. No transporta información: solo un timestamp para que el
 * valor sea siempre distinto y el evento `storage` se dispare.
 */
export const DATA_CHANNEL = "sunrise-data";

export interface ComposeDefaults {
  date?: string | null;
  categoryId?: number | null;
  objectiveId?: number | null;
}

interface AppState {
  /** Modal global de "Add task". */
  composeOpen: boolean;
  composeDefaults: ComposeDefaults;
  openCompose: (defaults?: ComposeDefaults) => void;
  closeCompose: () => void;

  /** Contador que las vistas observan para recargar tras mutaciones globales. */
  dataVersion: number;
  /** Invalida las vistas de ESTA ventana y le avisa a la otra. */
  bumpData: () => void;
  /** Invalida solo las de esta ventana, sin avisar. Ver `useDataSync`. */
  markDataStale: () => void;

  /** Diálogo de confirmación de salida (⌘Q o cerrar la ventana). */
  quitOpen: boolean;
  setQuitOpen: (v: boolean) => void;

  /**
   * En qué tarea tiene que abrir Focus, **una sola vez**.
   *
   * Lo escribe el aviso al accionarlo y lo aplica `FocusView` cuando su cola ya
   * tiene la tarea; después lo limpia. Es de un solo uso a propósito: si quedara
   * puesto, cada vez que vuelvas a Focus te llevaría a la reunión de la mañana.
   *
   * **Se lee como valor y se limpia aparte**, no con un "tomar y vaciar": en dev
   * React monta los efectos dos veces, y consumirlo en la primera pasada lo dejaba
   * vacío para la segunda, que reseteaba el índice. El aviso abría Focus sin mover
   * la tarea, que fue el síntoma reportado.
   */
  focusTaskId: number | null;
  /** Pide que Focus abra en esa tarea. */
  requestFocusTask: (taskId: number) => void;
  /** Lo limpia, una vez aplicado. */
  clearFocusTask: () => void;

  /** Timer simple (M1). El widget flotante y la campana llegan en M2. */
  activeTaskId: number | null;
  startedAtMs: number | null;
  startTimer: (taskId: number) => void;
  /** Detiene el timer y devuelve los segundos transcurridos. */
  stopTimer: () => { taskId: number; seconds: number } | null;
}

export const useAppStore = create<AppState>((set, get) => ({
  composeOpen: false,
  composeDefaults: {},
  openCompose: (defaults = {}) => set({ composeOpen: true, composeDefaults: defaults }),
  closeCompose: () => set({ composeOpen: false }),

  dataVersion: 0,
  bumpData: () => {
    get().markDataStale();
    // La otra ventana tiene su propio store: los eventos `storage` son la única
    // vía para avisarle que los datos cambiaron.
    try {
      localStorage.setItem(DATA_CHANNEL, String(Date.now()));
    } catch {
      /* ignore */
    }
  },
  markDataStale: () => set((s) => ({ dataVersion: s.dataVersion + 1 })),

  focusTaskId: null,
  requestFocusTask: (taskId) => set({ focusTaskId: taskId }),
  clearFocusTask: () => set({ focusTaskId: null }),

  quitOpen: false,
  setQuitOpen: (v) => set({ quitOpen: v }),

  activeTaskId: null,
  startedAtMs: null,
  startTimer: (taskId) => set({ activeTaskId: taskId, startedAtMs: Date.now() }),
  stopTimer: () => {
    const { activeTaskId, startedAtMs } = get();
    if (activeTaskId == null || startedAtMs == null) return null;
    const seconds = Math.max(0, Math.round((Date.now() - startedAtMs) / 1000));
    set({ activeTaskId: null, startedAtMs: null });
    return { taskId: activeTaskId, seconds };
  },
}));

/**
 * Recibe los avisos de cambio de datos que manda la OTRA ventana e invalida las
 * vistas de esta. Se llama una vez por ventana que tenga vistas de datos
 * (hoy solo `main`, desde `Shell`).
 *
 * Sin esto, completar una tarea desde el taxímetro quedaba bien guardado pero
 * dejaba la semana, Today, el backlog y el sidebar mostrando lo viejo: el
 * `bumpData()` del taxímetro solo incrementaba el `dataVersion` de SU ventana.
 *
 * Usa `markDataStale` y no `bumpData` a propósito. Los eventos `storage` no se
 * disparan en el documento que los origina, así que quien escribe nunca se
 * escucha a sí mismo; el riesgo real es **responder**: si al recibir el aviso
 * volviéramos a escribir en el canal, la otra ventana recibiría ese eco,
 * respondería a su vez, y las dos quedarían recargándose en ping-pong para
 * siempre.
 *
 * Va aquí y no en `useTimerRuntime` porque ese hook corre en las dos ventanas:
 * el taxímetro no tiene vistas que dependan de `dataVersion` y no necesita
 * recargar nada. Cuando M3 traiga el poller de ICS mutando datos desde Rust,
 * el evento de Tauri puede entrar por esta misma puerta llamando a
 * `markDataStale`.
 */
export function useDataSync() {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DATA_CHANNEL) useAppStore.getState().markDataStale();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // Sin dependencias: se registra una sola vez por ventana. `markDataStale`
    // se lee del store en el momento del evento para no re-suscribir en cada
    // cambio de `dataVersion` (que es justo lo que este listener provoca).
  }, []);
}
