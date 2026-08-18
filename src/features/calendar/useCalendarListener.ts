import { useEffect } from "react";
import { isTauri } from "../../lib/ipc";
import { useAppStore } from "../../lib/store";

/** El evento que emite el poller de Rust cuando escribió tareas. */
const CALENDAR_SYNCED = "sunrise://calendar-synced";

/**
 * Invalida las vistas cuando el poller de calendario importó algo.
 *
 * Usa **`markDataStale()` y no `bumpData()`**, y esa es la parte que importa: un
 * evento de Tauri llega a **las dos ventanas** por su cuenta, así que cada una
 * invalidando lo suyo alcanza. `bumpData` además escribiría en `localStorage`
 * para avisarle a la otra, que ya se enteró: sería el ping-pong entre ventanas
 * que `useDataSync` vino a evitar (ver SPECS §5.3).
 *
 * Se monta desde `Shell`, junto al resto de los listeners de ventana.
 */
export function useCalendarListener(): void {
  const markDataStale = useAppStore((s) => s.markDataStale);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen(CALENDAR_SYNCED, () => markDataStale());
    })();
    return () => unlisten?.();
  }, [markDataStale]);
}
