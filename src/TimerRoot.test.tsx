import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, () => void>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: () => void) => {
    handlers.set(event, cb);
    return () => {};
  }),
}));

// El taxímetro real necesita la ventana de Tauri; acá basta su runtime, que es lo
// que relee los timers.
vi.mock("./features/timer/FloatingTimer", async () => {
  const { useTimerRuntime } = await import("./features/timer/useTimer");
  return {
    FloatingTimer: () => {
      useTimerRuntime();
      return null;
    },
  };
});

import { TimerRoot } from "./TimerRoot";
import { DATA_CHANGED } from "./lib/useExternalChanges";
import { useTimerStore } from "./features/timer/timerStore";

describe("TimerRoot", () => {
  const original = useTimerStore.getState().refresh;

  beforeEach(() => {
    handlers.clear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    useTimerStore.setState({ refresh: original });
  });

  it("un cambio de otro proceso relee los timers del taxímetro (#23)", async () => {
    // Cada ventana tiene su propio store: sin el listener en esta raíz, un
    // start/stop que hace Claude por el MCP no llegaba al taxímetro.
    const refresh = vi.fn(async () => {});
    useTimerStore.setState({ refresh });
    const { unmount } = render(<TimerRoot />);
    await waitFor(() => expect(handlers.has(DATA_CHANGED)).toBe(true));
    const before = refresh.mock.calls.length;

    act(() => handlers.get(DATA_CHANGED)!());
    await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(before));
    // Desmontar antes de restaurar: si no, el efecto corre el `refresh` real, que
    // con `__TAURI_INTERNALS__` falso intenta un `invoke`.
    unmount();
  });
});
