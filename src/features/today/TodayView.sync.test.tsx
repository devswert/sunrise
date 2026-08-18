import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { Task } from "../../lib/types";
import { DATA_CHANNEL, useAppStore, useDataSync } from "../../lib/store";
import { todayISO } from "../../lib/date";
import { TodayView } from "./TodayView";

/**
 * El bug que cierra este test: completar una tarea desde el taxímetro quedaba
 * bien guardado en la DB, pero la ventana principal seguía mostrándola
 * pendiente. Acá el "taxímetro" es la mutación directa sobre el fake de la API
 * (otra ventana escribe en la misma DB) seguida del evento `storage`, que es
 * literalmente lo que cruza entre ventanas.
 */

const db: Task[] = [
  {
    id: 1,
    title: "Tarea del martes",
    notes: null,
    categoryId: null,
    objectiveId: null,
    scheduledDate: todayISO(),
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
    createdAt: "2026-08-11T09:00:00Z",
    updatedAt: "2026-08-11T09:00:00Z",
  },
];

vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    listCategories: vi.fn(async () => []),
    listObjectives: vi.fn(async () => []),
    listTasksForRange: vi.fn(async () => db.map((t) => ({ ...t }))),
    dayWork: vi.fn(async () => []),
    demotePending: vi.fn(async () => 0),
    getActiveTimer: vi.fn(async () => null),
    getTask: vi.fn(async () => null),
    setTaskStatus: vi.fn(async () => null),
    moveTask: vi.fn(async () => null),
    updateTask: vi.fn(async () => null),
    setActualSeconds: vi.fn(async () => null),
    startTimer: vi.fn(),
    stopTimer: vi.fn(async () => null),
    playBell: vi.fn(),
  },
}));

/** Monta el listener igual que hace `Shell` en la app real. */
function App() {
  useDataSync();
  return <TodayView />;
}

describe("TodayView · sincronización entre ventanas", () => {
  beforeEach(() => {
    useAppStore.setState({ dataVersion: 0 });
    db[0].status = "TODO";
  });

  it("refleja una tarea completada desde la otra ventana", async () => {
    render(<App />);

    // Arranca pendiente: el check ofrece completarla.
    expect(
      await screen.findByRole("button", { name: "Marcar como completada" }),
    ).toBeInTheDocument();

    // La otra ventana la completa y avisa por el canal.
    db[0].status = "DONE";
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: DATA_CHANNEL,
          newValue: String(Date.now()),
        }),
      );
    });

    // Sin el listener de `useDataSync` esto se queda en "Marcar como
    // completada" para siempre: era el bug reportado.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Marcar como pendiente" }),
      ).toBeInTheDocument();
    });
  });

  it("no recarga si el aviso es de otra clave", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Marcar como completada" });

    db[0].status = "DONE";
    window.dispatchEvent(
      new StorageEvent("storage", { key: "sunrise-theme", newValue: "dark" }),
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(
      screen.getByRole("button", { name: "Marcar como completada" }),
    ).toBeInTheDocument();
  });
});
