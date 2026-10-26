import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import type { DayWork } from "../../lib/types";
import { useDayWork } from "./useTrabajoDelDia";

const row = (taskId: number): DayWork => ({
  taskId,
  trackedAt: "2026-10-20T13:00:00Z",
  seconds: 1800,
  running: false,
});

describe("useDayWork", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("al cambiar de día no devuelve lo trabajado del día anterior mientras lee el nuevo", async () => {
    // Una tarea movida conserva su id: con las filas del día anterior, el rail la
    // dibujaba trabajada en un día en que no se tocó, hasta que llegaba la lectura.
    const pending = new Map<string, (rows: DayWork[]) => void>();
    vi.spyOn(api, "dayWork").mockImplementation(
      (date: string) => new Promise((resolve) => pending.set(date, resolve)),
    );

    const { result, rerender } = renderHook(({ date }) => useDayWork(date), {
      initialProps: { date: "2026-10-20" },
    });
    await act(async () => pending.get("2026-10-20")!([row(7)]));
    await waitFor(() => expect(result.current.work).toEqual([row(7)]));

    rerender({ date: "2026-10-21" });
    expect(result.current.work).toEqual([]);

    await act(async () => pending.get("2026-10-21")!([row(9)]));
    await waitFor(() => expect(result.current.work).toEqual([row(9)]));
  });
});
