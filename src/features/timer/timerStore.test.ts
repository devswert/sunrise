import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Task } from "../../lib/types";
import { todayISO } from "../../lib/date";

const OTRO_DIA = "2026-08-06";

function task(over: Partial<Task> & { id: number }): Task {
  return {
    title: `Tarea ${over.id}`,
    notes: null,
    categoryId: null,
    objectiveId: null,
    scheduledDate: OTRO_DIA,
    scheduledTime: null,
    position: 0,
    estimatedMinutes: 30,
    actualSeconds: 0,
    status: "TODO",
    completedAt: null,
    source: "MANUAL",
    sourceState: "ACTIVE",
    feedId: null,
    calendarUid: null,
    eventStart: null,
    eventEnd: null,
    meetingUrl: null,
    eventDescription: null,
    attendees: [],
    createdAt: "2026-08-06T09:00:00Z",
    updatedAt: "2026-08-06T09:00:00Z",
    ...over,
  };
}

/** Tarea que está en el taxímetro. La reasignan los tests. */
let enElTaximetro: Task = task({ id: 1 });

const moveTask = vi.fn(async () => null);
const setTaskStatus = vi.fn(async () => null);

vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    getTask: vi.fn(async (id: number) => (id === enElTaximetro.id ? enElTaximetro : null)),
    setTaskStatus: (...a: unknown[]) => setTaskStatus(...(a as [])),
    moveTask: (...a: unknown[]) => moveTask(...(a as [])),
    // El día de la tarea tiene otras dos, con posiciones 0 y 4.
    listTasksForDate: vi.fn(async (date: string) =>
      date === enElTaximetro.scheduledDate
        ? [task({ id: 8, position: 0 }), task({ id: 9, position: 4 })]
        : [],
    ),
    // No queda nada pendiente hoy: el taxímetro se oculta tras completar.
    focusQueue: vi.fn(async () => []),
    stopTimer: vi.fn(async () => null),
    startTimer: vi.fn(),
    getActiveTimer: vi.fn(async () => null),
  },
}));

const { useTimerStore } = await import("./timerStore");

describe("completeAndAdvance", () => {
  beforeEach(() => {
    moveTask.mockClear();
    setTaskStatus.mockClear();
    enElTaximetro = task({ id: 1 });
    // Tarea pausada en el taxímetro (el caso de "reanudar y completar").
    useTimerStore.setState({
      active: null,
      elapsed: 0,
      last: { taskId: 1, title: "Tarea 1", estimatedMinutes: 30, seconds: 0 },
    });
  });

  it("completa la tarea", async () => {
    await useTimerStore.getState().completeAndAdvance();
    expect(setTaskStatus).toHaveBeenCalledWith(1, "DONE");
  });

  it("NO reprograma a hoy una tarea de otro día", async () => {
    await useTimerStore.getState().completeAndAdvance();

    // El bug: mandaba todo a `today`, y `carry_over` no lo devolvía porque solo
    // arrastra tareas en TODO. La tarea desaparecía de su día.
    expect(moveTask).not.toHaveBeenCalledWith(1, todayISO(), expect.anything());
    expect(moveTask).toHaveBeenCalledWith(1, OTRO_DIA, expect.any(Number));
  });

  it("la manda al final de su propio día", async () => {
    await useTimerStore.getState().completeAndAdvance();
    // La posición más alta de ese día es 4.
    expect(moveTask).toHaveBeenCalledWith(1, OTRO_DIA, 5);
  });

  it("una tarea de hoy se sigue mandando al final de hoy", async () => {
    enElTaximetro = task({ id: 1, scheduledDate: todayISO() });

    await useTimerStore.getState().completeAndAdvance();

    expect(moveTask).toHaveBeenCalledWith(1, todayISO(), expect.any(Number));
  });

  it("no mueve una tarea sin fecha (backlog)", async () => {
    enElTaximetro = task({ id: 1, scheduledDate: null });

    await useTimerStore.getState().completeAndAdvance();

    expect(setTaskStatus).toHaveBeenCalledWith(1, "DONE");
    expect(moveTask).not.toHaveBeenCalled();
  });
});
