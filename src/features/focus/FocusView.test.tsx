import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { ActiveTimer, Task } from "../../lib/types";
import { FocusView } from "./FocusView";
import { useAppStore } from "../../lib/store";
import { derive, useTimerStore } from "../timer/timerStore";

const celebrate = vi.fn();
vi.mock("../../lib/confetti", () => ({ celebrate: () => celebrate() }));

/** Focus navega al cierre del día, así que necesita un router. */
function renderFocus() {
  return render(
    <MemoryRouter>
      <FocusView />
    </MemoryRouter>,
  );
}

/** Task de prueba con lo mínimo. */
function task(over: Partial<Task> & { id: number; title: string }): Task {
  return {
    notes: null,
    categoryId: null,
    objectiveId: null,
    priority: null,
    scheduledDate: "2026-08-10",
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
    createdAt: "2026-08-10T09:00:00Z",
    updatedAt: "2026-08-10T09:00:00Z",
    ...over,
  };
}

const queue: Task[] = [
  task({ id: 1, title: "Primera tarea" }),
  task({ id: 2, title: "Segunda tarea", position: 1 }),
];

const setStatus = vi.fn(async (..._args: unknown[]) => null);

/**
 * Los timers abiertos del mock, del más antiguo al más nuevo. El store los
 * relee después de cada mutación, así que `startTimer`/`stopTimer` los editan
 * igual que Rust: el play clásico cierra todos, uno por tarea (I4).
 */
const running: ActiveTimer[] = [];
/** Tareas que no están en la cola de hoy (otro día), para `getTask`. */
const otherDay: Task[] = [];

function timerOf(id: number): ActiveTimer {
  const t = [...queue, ...otherDay].find((x) => x.id === id);
  return {
    entryId: id * 10,
    taskId: id,
    title: t?.title ?? "",
    startedAt: new Date().toISOString(),
    baseSeconds: 0,
    estimatedMinutes: t?.estimatedMinutes ?? null,
    bellRungFor: null,
  };
}

/** Deja corriendo esas tareas, en la base del mock y en el store. */
function runTimers(...ids: number[]) {
  running.length = 0;
  running.push(...ids.map(timerOf));
  useTimerStore.setState({ ...derive([...running]), loaded: true });
}

vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    focusQueue: vi.fn(async () => queue.filter((t) => t.status === "TODO")),
    setTaskStatus: (...args: unknown[]) => {
      const [id] = args as [number];
      const t = queue.find((x) => x.id === id);
      if (t) t.status = "DONE";
      const o = otherDay.find((x) => x.id === id);
      if (o) o.status = "DONE";
      // Como `set_task_status` en Rust: completar detiene solo su timer.
      const i = running.findIndex((r) => r.taskId === id);
      if (i >= 0) running.splice(i, 1);
      return setStatus(...args);
    },
    moveTask: vi.fn(async () => null),
    listCategories: vi.fn(async () => []),
    updateTask: vi.fn(async () => null),
    getActiveTimers: vi.fn(async () => [...running]),
    stopAllTimers: vi.fn(async () => []),
    getTask: vi.fn(async (id: number) => otherDay.find((t) => t.id === id) ?? null),
    listTasksForDate: vi.fn(async (date: string) =>
      otherDay.filter((t) => t.scheduledDate === date),
    ),
    startTimer: vi.fn(async (taskId: number, parallel: boolean) => {
      if (!parallel) running.length = 0;
      const already = running.find((r) => r.taskId === taskId);
      if (already) return already;
      const t = timerOf(taskId);
      running.push(t);
      return t;
    }),
    stopTimer: vi.fn(async (taskId: number) => {
      const i = running.findIndex((r) => r.taskId === taskId);
      if (i < 0) return null;
      running.splice(i, 1);
      return [taskId, 60];
    }),
    dailyLog: vi.fn(async () => [
      {
        date: "2026-08-10",
        note: null,
        closedAt: null,
        mood: null,
        workedSeconds: 5400,
        plannedMinutes: 120,
        unestimated: 0,
        done: [{ task: task({ id: 1, title: "Primera tarea", status: "DONE" }), note: null }],
        timeline: [],
        cells: [],
      },
    ]),
  },
}));

describe("FocusView", () => {
  beforeEach(() => {
    queue.length = 0;
    queue.push(
      task({ id: 1, title: "Primera tarea" }),
      task({ id: 2, title: "Segunda tarea", position: 1 }),
    );
    running.length = 0;
    useTimerStore.setState(derive([]));
    setStatus.mockClear();
    celebrate.mockClear();
  });

  it("muestra la tarea actual como título y la lista del día", async () => {
    renderFocus();
    expect(await screen.findByRole("heading", { name: "Primera tarea" })).toBeInTheDocument();
    // Solo se indica cuál es la siguiente (sin lista completa ni clicks).
    expect(screen.getByText("Siguiente")).toBeInTheDocument();
    expect(screen.getByText("Segunda tarea")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Segunda tarea/ })).toBeNull();
  });

  it("al marcar el check completa y pasa sola a la siguiente", async () => {
    const user = userEvent.setup();
    renderFocus();
    await screen.findByRole("heading", { name: "Primera tarea" });

    await user.click(screen.getByRole("button", { name: "Completar tarea" }));

    await waitFor(() => {
      expect(setStatus).toHaveBeenCalled();
    });
    // Ahora la actual es la segunda (título grande).
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Segunda tarea" })).toBeInTheDocument();
    });
  });

  it("muestra el resumen del día cuando no queda nada", async () => {
    for (const t of queue) t.status = "DONE";
    renderFocus();

    expect(await screen.findByText("Listo por hoy")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("tarea completada")).toBeInTheDocument();
    expect(await screen.findByText("1h 30m")).toBeInTheDocument();
    expect(screen.getByText("de 2h planificadas")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cerrar el día" })).toBeInTheDocument();
  });

  it("le avisa al resto de la app al completar", async () => {
    const user = userEvent.setup();
    const antes = useAppStore.getState().dataVersion;
    renderFocus();
    await screen.findByRole("heading", { name: "Primera tarea" });

    await user.click(screen.getByRole("button", { name: "Completar tarea" }));

    // Sin esto, el taxímetro de la ventana flotante seguía ofreciendo retomar
    // la tarea que acabas de cerrar: completar detiene el timer en Rust, y
    // nadie se lo contaba a la otra ventana.
    await waitFor(() => expect(useAppStore.getState().dataVersion).toBeGreaterThan(antes));
  });

  it("celebra solo al completar la última", async () => {
    const user = userEvent.setup();
    queue[1].status = "DONE";
    renderFocus();
    await screen.findByRole("heading", { name: "Primera tarea" });

    await user.click(screen.getByRole("button", { name: "Completar tarea" }));

    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
  });

  it("al completar la última muestra el resumen sin recargar", async () => {
    const user = userEvent.setup();
    queue[1].status = "DONE";
    renderFocus();
    await screen.findByRole("heading", { name: "Primera tarea" });

    await user.click(screen.getByRole("button", { name: "Completar tarea" }));

    // El camino real: el resumen se pide recién al vaciarse la cola, así que
    // tiene que llegar solo, sin volver a entrar a la vista.
    expect(await screen.findByText("Listo por hoy")).toBeInTheDocument();
    expect(await screen.findByText("1h 30m")).toBeInTheDocument();
  });

  it("no celebra si todavía queda algo por hacer", async () => {
    const user = userEvent.setup();
    renderFocus();
    await screen.findByRole("heading", { name: "Primera tarea" });

    await user.click(screen.getByRole("button", { name: "Completar tarea" }));

    await screen.findByRole("heading", { name: "Segunda tarea" });
    expect(celebrate).not.toHaveBeenCalled();
  });
});

describe("FocusView · detalle de la tarea", () => {
  it("muestra el detalle del evento igual que el modal", async () => {
    // Focus es la pantalla en la que estás cuando empieza la reunión: tener que
    // abrir otra para saber por dónde entrar no tiene sentido.
    queue.length = 0;
    queue.push(
      task({
        id: 20,
        title: "Coordinación",
        source: "CALENDAR",
        meetingUrl: "https://meet.google.com/abc-defg-hij",
        attendees: [{ name: "Ana", email: "ana@acme.cl", status: "ACCEPTED", isOrganizer: true }],
        eventDescription: "Revisar el trimestre",
      }),
    );

    renderFocus();

    expect(await screen.findByRole("button", { name: /Entrar a Google Meet/ })).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Revisar el trimestre")).toBeInTheDocument();
  });

  it("la línea sobre las notas solo aparece cuando la tarea trae datos del calendario", async () => {
    // Sin tarjeta del evento no hay nada que separar: la línea quedaba paralela
    // a la del título, con aire vacío en medio.
    queue.length = 0;
    queue.push(task({ id: 22, title: "Escribir specs" }));

    const { unmount } = renderFocus();
    const notas = (await screen.findByLabelText("Notas")).closest(".focus__notas");
    expect(notas).not.toBeNull();
    expect(notas!.className).not.toContain("has-event");
    unmount();

    queue.length = 0;
    queue.push(
      task({
        id: 23,
        title: "Coordinación",
        source: "CALENDAR",
        eventStart: "2026-08-13T19:00:00Z",
        eventEnd: "2026-08-13T19:30:00Z",
      }),
    );

    renderFocus();
    const conEvento = (await screen.findByLabelText("Notas")).closest(".focus__notas");
    expect(conEvento!.className).toContain("has-event");
  });

  it("las notas y el canal se pueden editar, pero no se puede eliminar", async () => {
    // Replanificar en Focus es normal —te sientas a trabajar y ves que la tarea
    // era de otro contexto—. Borrar no: un botón de eliminar al lado del play es
    // un accidente esperando.
    queue.length = 0;
    queue.push(task({ id: 21, title: "Escribir specs" }));

    renderFocus();

    expect(await screen.findByLabelText("Notas")).toBeInTheDocument();
    expect(screen.getByLabelText("Cambiar canal")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Eliminar/i)).toBeNull();
  });
});

describe("FocusView · una columna por timer", () => {
  /** La tarjeta (columna o única) que tiene ese título. */
  function card(title: string): HTMLElement {
    const h = screen.getByRole("heading", { name: title });
    return h.closest(".focus__card") as HTMLElement;
  }

  beforeEach(async () => {
    queue.length = 0;
    queue.push(
      task({ id: 1, title: "Primera tarea" }),
      task({ id: 2, title: "Segunda tarea", position: 1 }),
      task({ id: 3, title: "Tercera tarea", position: 2 }),
      task({ id: 4, title: "Cuarta tarea", position: 3 }),
    );
    otherDay.length = 0;
    running.length = 0;
    useTimerStore.setState(derive([]));
    setStatus.mockClear();
    celebrate.mockClear();
    const { api } = await import("../../lib/ipc");
    vi.mocked(api.startTimer).mockClear();
    vi.mocked(api.stopTimer).mockClear();
    vi.mocked(api.moveTask).mockClear();
  });

  it("con un solo timer se ve como siempre: una tarea, su pausa y la siguiente", async () => {
    runTimers(1);
    const { container } = renderFocus();

    expect(await screen.findByRole("heading", { name: "Primera tarea" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(container.querySelector(".focus__columns")).toBeNull();
    // Corriendo, solo la pausa: ni play ni nada que sumar.
    expect(screen.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar" })).toBeNull();
    expect(screen.getByText("Siguiente")).toBeInTheDocument();
    expect(screen.getByText("Segunda tarea")).toBeInTheDocument();
  });

  it("con tres timers la pantalla se divide en tres columnas, cada una con su pausa y su check", async () => {
    runTimers(1, 2, 3);
    const { container } = renderFocus();

    await screen.findByRole("heading", { name: "Tercera tarea" });
    expect(container.querySelectorAll(".focus__column")).toHaveLength(3);
    // En el orden en que arrancaron.
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "Primera tarea",
      "Segunda tarea",
      "Tercera tarea",
    ]);
    for (const t of ["Primera tarea", "Segunda tarea", "Tercera tarea"]) {
      const c = within(card(t));
      expect(c.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
      expect(c.queryByRole("button", { name: "Iniciar" })).toBeNull();
      expect(c.getByRole("button", { name: "Completar tarea" })).toBeInTheDocument();
      expect(c.getByLabelText("Ajustar tiempo real")).toBeInTheDocument();
    }
    // La cola sigue abajo, con la primera que no tiene columna.
    expect(screen.getByText("Cuarta tarea")).toBeInTheDocument();
  });

  it("completar en una columna cierra esa y deja corriendo las otras", async () => {
    const user = userEvent.setup();
    runTimers(1, 2, 3);
    const { container } = renderFocus();
    await screen.findByRole("heading", { name: "Segunda tarea" });

    await user.click(
      within(card("Segunda tarea")).getByRole("button", { name: "Completar tarea" }),
    );

    await waitFor(() => expect(container.querySelectorAll(".focus__column")).toHaveLength(2));
    expect(setStatus).toHaveBeenCalledWith(2, "DONE");
    expect(screen.queryByRole("heading", { name: "Segunda tarea" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Primera tarea" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tercera tarea" })).toBeInTheDocument();
    expect(running.map((r) => r.taskId)).toEqual([1, 3]);
    expect(celebrate).not.toHaveBeenCalled();
  });

  it("completar dejando una sola columna vuelve a Focus de una tarea, en la que sigue corriendo", async () => {
    const user = userEvent.setup();
    runTimers(1);
    const { container } = renderFocus();
    await screen.findByRole("heading", { name: "Primera tarea" });
    // Mirando otra tarea con las flechas, para que el salto de `syncedFor` no
    // alcance: la 1 ya era la más antigua y no vuelve a saltar sola.
    await user.keyboard("{ArrowDown}");
    await screen.findByRole("heading", { name: "Segunda tarea" });
    runTimers(1, 3);
    await waitFor(() => expect(container.querySelectorAll(".focus__column")).toHaveLength(2));

    await user.click(
      within(card("Tercera tarea")).getByRole("button", { name: "Completar tarea" }),
    );

    await waitFor(() => expect(container.querySelector(".focus__columns")).toBeNull());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Primera tarea" })).toBeInTheDocument();
  });

  it("completar una columna que va antes en la cola deja el foco en la que sigue corriendo", async () => {
    const user = userEvent.setup();
    runTimers(1, 3);
    const { container } = renderFocus();
    await screen.findByRole("heading", { name: "Tercera tarea" });

    await user.click(
      within(card("Primera tarea")).getByRole("button", { name: "Completar tarea" }),
    );

    await waitFor(() => expect(container.querySelector(".focus__columns")).toBeNull());
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tercera tarea"),
    );
    expect(
      within(card("Tercera tarea")).getByRole("button", { name: "Pausar" }),
    ).toBeInTheDocument();
  });

  it("completar la única que corre deja las columnas en pausa en su lugar", async () => {
    const user = userEvent.setup();
    runTimers(1, 2, 3);
    const { container } = renderFocus();
    await screen.findByRole("heading", { name: "Tercera tarea" });
    await user.click(within(card("Segunda tarea")).getByRole("button", { name: "Pausar" }));
    await within(card("Segunda tarea")).findByRole("button", { name: "Iniciar" });
    await user.click(within(card("Tercera tarea")).getByRole("button", { name: "Pausar" }));
    await within(card("Tercera tarea")).findByRole("button", { name: "Iniciar" });

    await user.click(
      within(card("Primera tarea")).getByRole("button", { name: "Completar tarea" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: "Primera tarea" })).toBeNull(),
    );
    expect(container.querySelectorAll(".focus__column")).toHaveLength(2);
    expect(
      within(card("Segunda tarea")).getByRole("button", { name: "Iniciar" }),
    ).toBeInTheDocument();
    expect(
      within(card("Tercera tarea")).getByRole("button", { name: "Iniciar" }),
    ).toBeInTheDocument();
  });

  it("un timer en paralelo con la vista abierta suma una columna al final", async () => {
    runTimers(1);
    const { container } = renderFocus();
    await screen.findByRole("heading", { name: "Primera tarea" });
    expect(container.querySelector(".focus__columns")).toBeNull();

    runTimers(1, 4);

    await waitFor(() => expect(container.querySelectorAll(".focus__column")).toHaveLength(2));
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual([
      "Primera tarea",
      "Cuarta tarea",
    ]);
  });

  it("pausar una columna la deja en su lugar, en pausa y con su play", async () => {
    const user = userEvent.setup();
    runTimers(1, 2, 3);
    const { container } = renderFocus();
    await screen.findByRole("heading", { name: "Segunda tarea" });

    await user.click(within(card("Segunda tarea")).getByRole("button", { name: "Pausar" }));

    await waitFor(() =>
      expect(
        within(card("Segunda tarea")).getByRole("button", { name: "Iniciar" }),
      ).toBeInTheDocument(),
    );
    expect(container.querySelectorAll(".focus__column")).toHaveLength(3);
    expect(running.map((r) => r.taskId)).toEqual([1, 3]);
  });

  it("el play clásico desde una columna deja solo esa: pausa las demás", async () => {
    const user = userEvent.setup();
    const { api } = await import("../../lib/ipc");
    runTimers(1, 2, 3);
    const { container } = renderFocus();
    await screen.findByRole("heading", { name: "Segunda tarea" });
    await user.click(within(card("Segunda tarea")).getByRole("button", { name: "Pausar" }));
    const play = await within(card("Segunda tarea")).findByRole("button", { name: "Iniciar" });

    await user.click(play);

    expect(api.startTimer).toHaveBeenCalledWith(2, false);
    await waitFor(() => expect(container.querySelector(".focus__columns")).toBeNull());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Segunda tarea" })).toBeInTheDocument();
    expect(running.map((r) => r.taskId)).toEqual([2]);
  });

  it("una columna de otro día se completa al final de su día, sin traerla a hoy", async () => {
    const user = userEvent.setup();
    const { api } = await import("../../lib/ipc");
    otherDay.push(
      task({ id: 90, title: "Ya en la mañana", scheduledDate: "2026-08-09", position: 4 }),
      task({ id: 99, title: "De ayer", scheduledDate: "2026-08-09", position: 0 }),
    );
    runTimers(1, 99);
    renderFocus();
    await screen.findByRole("heading", { name: "De ayer" });

    await user.click(within(card("De ayer")).getByRole("button", { name: "Completar tarea" }));

    await waitFor(() => expect(api.moveTask).toHaveBeenCalledWith(99, "2026-08-09", 5));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "De ayer" })).toBeNull());
  });
});
