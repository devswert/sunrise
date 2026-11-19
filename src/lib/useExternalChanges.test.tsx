import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, () => void>();
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (event: string, cb: () => void) => {
    handlers.set(event, cb);
    return unlisten;
  }),
}));

import { render } from "@testing-library/react";
import { useAppStore } from "./store";
import { DATA_CHANGED, ExternalChanges, useExternalChanges } from "./useExternalChanges";
import { useTimerStore } from "../features/timer/timerStore";
import { useTimerRuntime } from "../features/timer/useTimer";

describe("useExternalChanges", () => {
  beforeEach(() => {
    handlers.clear();
    unlisten.mockClear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    localStorage.clear();
  });

  it("invalida las vistas cuando otro proceso escribió en la base", async () => {
    renderHook(() => useExternalChanges());
    await waitFor(() => expect(handlers.has(DATA_CHANGED)).toBe(true));

    const before = useAppStore.getState().dataVersion;
    handlers.get(DATA_CHANGED)!();
    expect(useAppStore.getState().dataVersion).toBe(before + 1);
  });

  it("no avisa a la otra ventana: el evento ya le llega a las dos", async () => {
    // `bumpData` escribiría en este canal, y la otra ventana respondería.
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderHook(() => useExternalChanges());
    await waitFor(() => expect(handlers.has(DATA_CHANGED)).toBe(true));

    handlers.get(DATA_CHANGED)!();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("suelta el listener al desmontarse", async () => {
    const { unmount } = renderHook(() => useExternalChanges());
    await waitFor(() => expect(handlers.has(DATA_CHANGED)).toBe(true));
    unmount();
    expect(unlisten).toHaveBeenCalled();
  });

  it("en el taxímetro, un cambio externo relee los timers (#23)", async () => {
    // La raíz del taxímetro monta `ExternalChanges` junto al runtime del timer:
    // sin eso, un start/stop que hace Claude por el MCP no llegaba a esa ventana.
    const refresh = vi.fn(async () => {});
    const original = useTimerStore.getState().refresh;
    useTimerStore.setState({ refresh });
    function Raiz() {
      useTimerRuntime();
      return <ExternalChanges />;
    }
    const { unmount } = render(<Raiz />);
    await waitFor(() => expect(handlers.has(DATA_CHANGED)).toBe(true));
    const before = refresh.mock.calls.length;

    handlers.get(DATA_CHANGED)!();
    await waitFor(() => expect(refresh.mock.calls.length).toBeGreaterThan(before));
    // Desmontar antes de restaurar: si no, el efecto corre el `refresh` real, que
    // con `__TAURI_INTERNALS__` falso intenta un `invoke`.
    unmount();
    useTimerStore.setState({ refresh: original });
  });

  it("fuera de Tauri no escucha nada", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    renderHook(() => useExternalChanges());
    await Promise.resolve();
    expect(handlers.size).toBe(0);
  });
});
