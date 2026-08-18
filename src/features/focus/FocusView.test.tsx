import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Task } from "../../lib/types";
import { FocusView } from "./FocusView";

/** Task de prueba con lo mínimo. */
function task(over: Partial<Task> & { id: number; title: string }): Task {
  return {
    notes: null,
    categoryId: null,
    objectiveId: null,
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
    playBell: vi.fn(),
  },
}));

describe("FocusView", () => {
  beforeEach(() => {
    for (const t of queue) t.status = "TODO";
    setStatus.mockClear();
  });

  it("muestra la tarea actual como título y la lista del día", async () => {
    render(<FocusView />);
    expect(await screen.findByRole("heading", { name: "Primera tarea" })).toBeInTheDocument();
    // Solo se indica cuál es la siguiente (sin lista completa ni clicks).
    expect(screen.getByText("Siguiente")).toBeInTheDocument();
    expect(screen.getByText("Segunda tarea")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Segunda tarea/ })).toBeNull();
  });

  it("al marcar el check completa y pasa sola a la siguiente", async () => {
    const user = userEvent.setup();
    render(<FocusView />);
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

  it("muestra el estado vacío cuando no queda nada", async () => {
    for (const t of queue) t.status = "DONE";
    render(<FocusView />);
    expect(await screen.findByText("Día completado")).toBeInTheDocument();
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
        attendees: [
          { nombre: "Ana", email: "ana@acme.cl", estado: "ACCEPTED", organizador: true },
        ],
        eventDescription: "Revisar el trimestre",
      }),
    );

    render(<FocusView />);

    expect(await screen.findByRole("button", { name: /Entrar a Google Meet/ })).toBeInTheDocument();
    expect(screen.getByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("Revisar el trimestre")).toBeInTheDocument();
  });

  it("las notas y el canal se pueden editar, pero no se puede eliminar", async () => {
    // Replanificar en Focus es normal —te sientas a trabajar y ves que la tarea
    // era de otro contexto—. Borrar no: un botón de eliminar al lado del play es
    // un accidente esperando.
    queue.length = 0;
    queue.push(task({ id: 21, title: "Escribir specs" }));

    render(<FocusView />);

    expect(await screen.findByLabelText("Notas")).toBeInTheDocument();
    expect(screen.getByLabelText("Cambiar canal")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Eliminar/i)).toBeNull();
  });
});
