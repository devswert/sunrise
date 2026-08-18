import { useEffect } from "react";
import { create } from "zustand";
import { api, isTauri } from "./ipc";
import { useAppStore } from "./store";

interface CalendarSyncState {
  /** Hay una sincronización en curso. */
  sincronizando: boolean;
  /** Cuándo se **intentó** por última vez (ISO), mirando todos los feeds. */
  ultimaSync: string | null;
  /** Cuántos feeds hay configurados. Sin feeds, el botón no tiene sentido. */
  feeds: number;
  /** Relee el estado de los feeds sin sincronizar nada. */
  refresh: () => Promise<void>;
  /** Sincroniza. `id` para uno solo; sin `id`, todos y sin mirar el reloj. */
  sync: (id?: number) => Promise<void>;
}

/**
 * Estado de la sincronización de calendarios, **compartido por toda la ventana**.
 *
 * Existe porque hay dos botones de sincronizar —el de la vista semana y el de
 * Configs— y tienen que ser el mismo botón: si uno está corriendo, el otro se
 * bloquea, y los dos muestran la misma antigüedad. Con estado local en cada
 * componente, apretar en Configs dejaría al de la semana diciendo que no pasó
 * nada.
 *
 * `ultimaSync` es el **más reciente** de todos los feeds, porque el botón habla
 * de "el calendario" en general. El detalle por feed se ve en Configs.
 */
export const useCalendarSync = create<CalendarSyncState>((set, get) => ({
  sincronizando: false,
  ultimaSync: null,
  feeds: 0,

  refresh: async () => {
    try {
      const feeds = await api.listCalendarFeeds();
      const marcas = feeds.map((f) => f.lastSyncedAt).filter((m): m is string => m != null);
      set({
        feeds: feeds.length,
        ultimaSync: marcas.length > 0 ? marcas.sort()[marcas.length - 1] : null,
      });
    } catch (err) {
      console.error("[sunrise] calendario: no pude leer los feeds:", err);
    }
  },

  sync: async (id) => {
    // Dos clicks seguidos, o el botón de la semana mientras corre el de Configs:
    // una sola sync a la vez.
    if (get().sincronizando) return;
    set({ sincronizando: true });
    try {
      if (id == null) await api.syncCalendarFeeds(true);
      else await api.syncCalendarFeed(id);
    } catch (err) {
      // El detalle queda en `lastError` de cada feed y se ve en Configs; acá
      // basta con no dejar el botón trabado.
      console.error("[sunrise] calendario: falló la sincronización:", err);
    } finally {
      set({ sincronizando: false });
      await get().refresh();
      // Entraron o cambiaron tareas: las vistas y el taxímetro tienen que releer.
      useAppStore.getState().bumpData();
    }
  },
}));

/**
 * Sincroniza al abrir la app y al volver a la ventana.
 *
 * Es lo que de verdad hace que el calendario se sienta al día, más que bajar el
 * intervalo: el momento en que te importa es cuando te sientas a mirarlo. El
 * poller de Rust solo mira el reloj, así que volver después de dos horas mostraba
 * lo de hace dos horas hasta el siguiente pulso.
 *
 * Fuera de Tauri no hace nada: el mock no sale a la red y sincronizar sería puro
 * ruido en los tests.
 */
export function useCalendarSyncRuntime(): void {
  const refresh = useCalendarSync((s) => s.refresh);
  const sync = useCalendarSync((s) => s.sync);

  useEffect(() => {
    void refresh();
    if (!isTauri()) return;

    // Al montar. El poller de Rust también corre, pero su primer pulso puede
    // caer hasta un minuto después de abrir la app.
    void sync();

    const alVolver = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("focus", alVolver);
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      window.removeEventListener("focus", alVolver);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [refresh, sync]);
}
