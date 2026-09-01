import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { Task } from "../../lib/types";
import { FocusView } from "./FocusView";
import { useAppStore } from "../../lib/store";

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

const setStatus = vi.fn(async () => null);

vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    focusQueue: vi.fn(async () => queue.filter((t) => t.status === "TODO")),
    setTaskStatus: (...args: unknown[]) => {
      const [id] = args as [number];
      const t = queue.find((x) => x.id === id);
      if (t) t.status = "DONE";
      return setStatus();
    },
    moveTask: vi.fn(async () => null),
    listCategories: vi.fn(async () => []),
    updateTask: vi.fn(async () => null),
    getActiveTimer: vi.fn(async () => null),
    getTask: vi.fn(async () => null),
    startTimer: vi.fn(),
    stopTimer: vi.fn(async () => null),
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
    for (const t of queue) t.status = "TODO";
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
