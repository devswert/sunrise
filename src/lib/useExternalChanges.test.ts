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

import { useAppStore } from "./store";
import { DATA_CHANGED, useExternalChanges } from "./useExternalChanges";

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

  it("fuera de Tauri no escucha nada", async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    renderHook(() => useExternalChanges());
    await Promise.resolve();
    expect(handlers.size).toBe(0);
  });
});
