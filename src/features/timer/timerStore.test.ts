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
    priority: null,
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
    railOnly: false,
    createdAt: "2026-08-06T09:00:00Z",
    updatedAt: "2026-08-06T09:00:00Z",
    ...over,
  };
}

/** Tarea que está en el taxímetro. La reasignan los tests. */
let enElTaximetro: Task = task({ id: 1 });
/** Lo que devuelve `focus_queue`: lo pendiente de hoy. La reasignan los tests. */
let pendientes: Task[] = [];

const moveTask = vi.fn(async () => null);
const setTaskStatus = vi.fn(async () => null);
const startTimer = vi.fn();

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
    focusQueue: vi.fn(async () => pendientes),
    stopTimer: vi.fn(async () => null),
    startTimer: (...a: unknown[]) => startTimer(...(a as [])),
    getActiveTimer: vi.fn(async () => null),
  },
}));

const { useTimerStore } = await import("./timerStore");

describe("completeAndAdvance", () => {
  beforeEach(() => {
    moveTask.mockClear();
    setTaskStatus.mockClear();
    startTimer.mockClear();
    localStorage.clear();
    enElTaximetro = task({ id: 1 });
    // Por defecto no queda nada pendiente hoy.
    pendientes = [];
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

  it("deja la siguiente en pausa, sin arrancarla sola", async () => {
    pendientes = [task({ id: 7, title: "La que sigue", estimatedMinutes: 45 })];

    await useTimerStore.getState().completeAndAdvance();

    // El bug: completar arrancaba el timer de la siguiente, así que una tarea
    // que ni miraste empezaba a acumular tiempo.
    expect(startTimer).not.toHaveBeenCalled();
    const { active, last } = useTimerStore.getState();
    expect(active).toBeNull();
    // En 0 porque el taxímetro cuenta lo de hoy, y hoy no se trabajó en ella.
    expect(last).toEqual({
      taskId: 7,
      title: "La que sigue",
      estimatedMinutes: 45,
      seconds: 0,
    });
  });

  it("sin pendientes oculta el taxímetro en vez de dejar la completada", async () => {
    await useTimerStore.getState().completeAndAdvance();

    expect(useTimerStore.getState().last).toBeNull();
    expect(localStorage.getItem("sunrise-last-task")).toBeNull();
  });

  it("le avisa a la otra ventana", async () => {
    // Sin esto el taxímetro de la otra ventana sigue mostrando la completada.
    await useTimerStore.getState().completeAndAdvance();
    expect(localStorage.getItem("sunrise-timer")).not.toBeNull();
  });
});

describe("refresh cuando la tarea del taxímetro se completó desde otro lado", () => {
  beforeEach(() => {
    localStorage.clear();
    pendientes = [];
    // Focus, la card o el modal la completaron: el timer ya está detenido.
    enElTaximetro = task({ id: 1, status: "DONE" });
    localStorage.setItem(
      "sunrise-last-task",
      JSON.stringify({ taskId: 1, title: "Tarea 1", estimatedMinutes: 30, seconds: 120 }),
    );
    useTimerStore.setState({ active: null, elapsed: 0, last: null });
  });

  it("avanza a la siguiente pendiente, en pausa", async () => {
    pendientes = [task({ id: 7, title: "La que sigue" })];

    await useTimerStore.getState().refresh();

    expect(useTimerStore.getState().last?.taskId).toBe(7);
    expect(startTimer).not.toHaveBeenCalled();
  });

  it("sin pendientes oculta el taxímetro", async () => {
    await useTimerStore.getState().refresh();

    // El bug: quedaba la tarea completada en pantalla, con su botón de play.
    expect(useTimerStore.getState().last).toBeNull();
    expect(localStorage.getItem("sunrise-last-task")).toBeNull();
  });

  it("una tarea que sigue pendiente conserva los segundos de hoy", async () => {
    enElTaximetro = task({ id: 1, title: "Renombrada", actualSeconds: 9999 });

    await useTimerStore.getState().refresh();

    const { last } = useTimerStore.getState();
    // Re-lee título y estimado, pero NO pisa el contador con el acumulado
    // histórico: el taxímetro muestra lo de hoy.
    expect(last).toEqual({
      taskId: 1,
      title: "Renombrada",
      estimatedMinutes: 30,
      seconds: 120,
    });
  });

  it("ignora un registro corrupto en vez de pedir la tarea `undefined`", async () => {
    localStorage.setItem("sunrise-last-task", JSON.stringify({ titulo: "sin id" }));

    await useTimerStore.getState().refresh();

    expect(useTimerStore.getState().last).toBeNull();
  });

  it("no le avisa a la otra ventana al refrescar", async () => {
    // Refrescar no es mutar: un broadcast acá hace que la otra ventana
    // refresque y avise de vuelta, con un IPC por salto.
    await useTimerStore.getState().refresh();
    expect(localStorage.getItem("sunrise-timer")).toBeNull();
  });
});
