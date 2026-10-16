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
 * Se monta desde `Shell`, que solo existe en `main`: el taxímetro no se entera.
 * Por eso el MCP no toca ni el estado ni el timer (I5).
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
