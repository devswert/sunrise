import { useEffect } from "react";
import { isTauri } from "./ipc";
import { useAppStore } from "./store";

/** El evento que emite Rust cuando otro proceso escribió en la base. */
export const DATA_CHANGED = "sunrise://data-changed";

/**
 * Invalida las vistas cuando **otro proceso** escribió en la base: hoy, el
 * servidor MCP que usa Claude Desktop (§4.32). Lo detecta `external.rs`.
 *
 * Usa `markDataStale()` y no `bumpData()`, por lo mismo que
 * `useCalendarListener`: `bumpData` además escribiría en `localStorage`, y eso
 * es un aviso a la otra ventana que nadie pidió (§5.3).
 *
 * Se monta en **las dos ventanas**: en `main` desde `Shell`, y en el taxímetro
 * desde su raíz (`TimerRoot`, con `ExternalChanges`). Cada ventana tiene su propio
 * store, y desde #23 el MCP abre, cierra y registra timers: sin el aviso, el
 * taxímetro seguía mostrando lo último que leyó. En cada ventana `dataVersion`
 * vuelve a correr `useTimerRuntime`, que relee los timers.
 */
export function useExternalChanges(): void {
  const markDataStale = useAppStore((s) => s.markDataStale);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const off = await listen(DATA_CHANGED, () => markDataStale());
      // Si el componente se desmontó mientras `listen` resolvía, el cleanup ya
      // corrió con `unlisten` vacío: hay que soltarlo acá o queda colgado.
      if (cancelled) off();
      else unlisten = off;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [markDataStale]);
}

/** El mismo aviso como componente, para la raíz del taxímetro, que no tiene `Shell`. */
export function ExternalChanges(): null {
  useExternalChanges();
  return null;
}
