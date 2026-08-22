import { useEffect } from "react";
import { useTimerStore, timerDisplay, isOverEstimate, runTotalSeconds } from "./timerStore";
import { DATA_CHANNEL, useAppStore } from "../../lib/store";

export { hms, isOverEstimate } from "./timerStore";
export type { LastTask } from "./timerStore";

/**
 * Arranca el ciclo de vida del timer en la ventana actual: carga el estado,
 * escucha cambios de la otra ventana y mantiene el tick de 1s.
 * Se llama UNA vez por ventana (Shell en main, raíz en el taxímetro).
 *
 * **No lleva parámetro de campana.** Lo llevaba —`{ bell: true }` en `main`, nada
 * en el taxímetro— porque el tick de acá la tocaba y dos ventanas sonando se oyen
 * "vibrado". Ahora la toca Rust (`bell.rs`), así que no hay ventana que elegir:
 * este tick solo dibuja.
 */
export function useTimerRuntime() {
  const refresh = useTimerStore((s) => s.refresh);
  const tick = useTimerStore((s) => s.tick);
  const hasActive = useTimerStore((s) => !!s.active);
  // Al editar la tarea (p. ej. su tiempo planned) hay que releer el timer:
  // `active` guarda una foto de la tarea y quedaría desactualizado.
  const dataVersion = useAppStore((s) => s.dataVersion);

  useEffect(() => {
    void refresh();
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === "sunrise-timer" ||
        e.key === "sunrise-last-task" ||
        e.key === DATA_CHANNEL // cambió una tarea (p. ej. su planned)
      ) {
        void refresh();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refresh, dataVersion]);

  useEffect(() => {
    if (!hasActive) return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [hasActive, tick]);
}

/** Estado y acciones del timer (compartido dentro de la ventana). */
export function useTimer() {
  const active = useTimerStore((s) => s.active);
  const elapsed = useTimerStore((s) => s.elapsed);
  const last = useTimerStore((s) => s.last);
  const start = useTimerStore((s) => s.start);
  const stop = useTimerStore((s) => s.stop);
  const toggle = useTimerStore((s) => s.toggle);
  const dismissLast = useTimerStore((s) => s.dismissLast);
  const completeAndAdvance = useTimerStore((s) => s.completeAndAdvance);
  const refresh = useTimerStore((s) => s.refresh);

  const display = active
    ? {
        taskId: active.taskId,
        title: active.title,
        estimatedMinutes: active.estimatedMinutes,
        seconds: elapsed,
      }
    : last;

  return {
    active,
    elapsed,
    last,
    display,
    // Lo que va de la corrida en curso, para sumarlo al acumulado de la tarea.
    // Se recalcula en cada render, y el tick de 1s provoca uno por segundo, así
    // que avanza sin necesidad de guardarlo en el store.
    runTotal: active ? runTotalSeconds(active.startedAt) : 0,
    overEstimate: isOverEstimate(elapsed, active?.estimatedMinutes),
    start,
    stop,
    toggle,
    dismissLast,
    completeAndAdvance,
    refresh,
  };
}

// Reexport para tests/otros usos.
export { timerDisplay };
