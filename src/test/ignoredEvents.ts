import { vi } from "vitest";
import { api } from "../lib/ipc";
import type { Task } from "../lib/types";

let nextId = 900_000;

/**
 * Un evento del calendario marcado "Ignorar como tarea", con hora local y duración.
 *
 * `eventStart`/`eventEnd` van **a propósito** en UTC y a otra hora: la capacidad
 * y el rail leen `scheduledTime` + `estimatedMinutes`, y un test que los use por
 * error se pone rojo.
 */
export function ignoredEvent(
  date: string,
  time: string | null,
  minutes: number | null,
  over: Partial<Task> = {},
): Task {
  nextId += 1;
  return {
    id: nextId,
    title: `Evento ${nextId}`,
    notes: null,
    categoryId: null,
    objectiveId: null,
    priority: null,
    scheduledDate: date,
    scheduledTime: time,
    position: 0,
    estimatedMinutes: minutes,
    actualSeconds: 0,
    status: "TODO",
    completedAt: null,
    source: "CALENDAR",
    sourceState: "ACTIVE",
    feedId: 99,
    calendarUid: `fixture-${nextId}`,
    eventStart: `${date}T03:00:00Z`,
    eventEnd: `${date}T04:00:00Z`,
    meetingUrl: null,
    eventDescription: null,
    attendees: [],
    railOnly: true,
    createdAt: `${date}T09:00:00Z`,
    updatedAt: `${date}T09:00:00Z`,
    ...over,
  };
}

/**
 * Suma `events()` a lo que devuelve `listTasksForRange`, filtrado por el rango.
 *
 * El mock no tiene cómo crear un evento de calendario propio (solo los importa
 * la sincronización), y apoyarse en los de la semilla ataría el test a la data
 * de preview. Es una función y no un arreglo para que el caso pueda cambiar la
 * marca entre lecturas: con un `bumpData()` la vista vuelve a pedir el rango.
 * Se deshace con `vi.restoreAllMocks()`.
 */
export function addToRange(events: () => Task[]) {
  const real = api.listTasksForRange.bind(api);
  return vi.spyOn(api, "listTasksForRange").mockImplementation(async (from, to) => {
    const base = await real(from, to);
    const extra = events().filter(
      (t) => t.scheduledDate != null && t.scheduledDate >= from && t.scheduledDate <= to,
    );
    return [...base, ...extra];
  });
}
