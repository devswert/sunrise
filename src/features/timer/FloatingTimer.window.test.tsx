/**
 * El alto de la ventana del taxímetro (#19), con `isTauri()` en verdadero: es la
 * única forma de que `useWindowHeight` corra. Lo que se fija es la trampa
 * §5.4.2 — la ventana se llama **una vez por cambio de filas**, no una por tick.
 */
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setHeight = vi.fn(async (_h: number) => {});

vi.mock("../../lib/ipc", async () => {
  const { mock } = await import("../../lib/mockDb");
  return {
    isTauri: () => true,
    api: {
      ...mock,
      setTaximeterHeight: (h: number) => setHeight(h),
      setTaximeterVisible: async () => true,
    },
  };
});

const { api } = await import("../../lib/ipc");
const { todayISO } = await import("../../lib/date");
const { FloatingTimer } = await import("./FloatingTimer");
const { useTimerStore } = await import("./timerStore");

async function newTask(title: string) {
  return (await api.createTask({ title, scheduledDate: todayISO() })).id;
}

describe("FloatingTimer · alto de la ventana", () => {
  beforeEach(async () => {
    await api.stopAllTimers();
    localStorage.clear();
    setHeight.mockClear();
    useTimerStore.setState({
      actives: [],
      elapsedById: {},
      active: null,
      elapsed: 0,
      last: null,
      loaded: false,
    });
    // La ventana real no existe en jsdom: sus llamadas best-effort fallan y se loguean.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(async () => {
    await api.stopAllTimers();
    vi.restoreAllMocks();
  });

  it("pide el alto de la pila una vez por cambio de filas, no en cada tick", async () => {
    const a = await newTask("Primera");
    const b = await newTask("Segunda");
    await useTimerStore.getState().start(a);
    render(<FloatingTimer />);
    await waitFor(() => expect(setHeight).toHaveBeenLastCalledWith(70));

    for (let i = 0; i < 3; i++) act(() => useTimerStore.getState().tick());
    expect(setHeight).toHaveBeenCalledTimes(1);

    await act(() => useTimerStore.getState().start(b, { parallel: true }));
    await waitFor(() => expect(setHeight).toHaveBeenLastCalledWith(126));
    act(() => useTimerStore.getState().tick());
    expect(setHeight).toHaveBeenCalledTimes(2);
  });
});
