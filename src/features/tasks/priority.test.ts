import { describe, expect, it } from "vitest";
import { Priority } from "../../lib/enums";
import type { Task } from "../../lib/types";
import { BacklogSort, comparePriority, filterByPriority, priorityVar, sortTasks } from "./priority";

function task(id: number, priority: Priority | null, createdAt: string): Task {
  return {
    id,
    title: `t${id}`,
    notes: null,
    categoryId: null,
    objectiveId: null,
    priority,
    scheduledDate: null,
    scheduledTime: null,
    position: 0,
    estimatedMinutes: null,
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
    createdAt,
    updatedAt: createdAt,
  };
}

const ids = (ts: Task[]) => ts.map((t) => t.id);

describe("prioridad · color", () => {
  it("cada nivel apunta a su token", () => {
    expect(priorityVar(Priority.P1)).toBe("var(--prio-p1)");
    expect(priorityVar(Priority.P5)).toBe("var(--prio-p5)");
  });
});

describe("prioridad · orden de la escala", () => {
  it("P1 va antes que P5", () => {
    expect(comparePriority(Priority.P1, Priority.P5)).toBeLessThan(0);
  });

  it("sin prioridad va al final, no entre los P5", () => {
    expect(comparePriority(null, Priority.P5)).toBeGreaterThan(0);
    expect(comparePriority(Priority.P5, null)).toBeLessThan(0);
    expect(comparePriority(null, null)).toBe(0);
  });
});

describe("prioridad · ordenar el backlog", () => {
  const lista = [
    task(1, Priority.P3, "2026-08-03"),
    task(2, null, "2026-08-01"),
    task(3, Priority.P1, "2026-08-04"),
    task(4, Priority.P3, "2026-08-02"),
  ];

  it("por fecha de creación va de la más vieja a la más nueva", () => {
    expect(ids(sortTasks(lista, BacklogSort.CREATED))).toEqual([2, 4, 1, 3]);
  });

  it("por prioridad, y dentro del nivel la más vieja primero", () => {
    expect(ids(sortTasks(lista, BacklogSort.P))).toEqual([3, 4, 1, 2]);
  });

  it("no muta el arreglo que recibe", () => {
    const original = [...lista];
    sortTasks(lista, BacklogSort.P);
    expect(lista).toEqual(original);
  });

  it("dos tareas creadas en el mismo instante desempatan por id", () => {
    const mismo = [task(9, null, "2026-08-01"), task(7, null, "2026-08-01")];
    expect(ids(sortTasks(mismo, BacklogSort.CREATED))).toEqual([7, 9]);
  });
});

describe("prioridad · filtrar", () => {
  const lista = [
    task(1, Priority.P1, "2026-08-01"),
    task(2, Priority.P4, "2026-08-01"),
    task(3, null, "2026-08-01"),
  ];

  it("sin niveles elegidos no filtra nada", () => {
    expect(ids(filterByPriority(lista, new Set()))).toEqual([1, 2, 3]);
  });

  it("deja solo los niveles elegidos", () => {
    expect(ids(filterByPriority(lista, new Set([Priority.P1, Priority.P4])))).toEqual([1, 2]);
  });

  it("las sin prioridad no pasan ningún filtro de nivel", () => {
    expect(ids(filterByPriority(lista, new Set([Priority.P1])))).toEqual([1]);
  });
});
