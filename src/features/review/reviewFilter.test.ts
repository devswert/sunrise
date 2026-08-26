import { describe, expect, it } from "vitest";
import { matchesFilter, SIN_FILTRO, toggleId, type ReviewFilter } from "./reviewFilter";
import type { Category, Task } from "../../lib/types";

const cats: Category[] = [
  { id: 1, parentId: null, name: "Trabajo", color: "sky", position: 0, archived: false },
  { id: 2, parentId: 1, name: "Dev", color: "mint", position: 0, archived: false },
  { id: 3, parentId: null, name: "Personal", color: "rose", position: 1, archived: false },
];
const catMap = new Map(cats.map((c) => [c.id, c]));

function task(id: number, categoryId: number | null, objectiveId: number | null): Task {
  return {
    id,
    title: `t${id}`,
    notes: null,
    categoryId,
    objectiveId,
    scheduledDate: "2026-08-11",
    scheduledTime: null,
    position: 0,
    estimatedMinutes: null,
    actualSeconds: 0,
    status: "DONE",
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
    createdAt: "",
    updatedAt: "",
  };
}

const filtro = (p: Partial<ReviewFilter>): ReviewFilter => ({ ...SIN_FILTRO, ...p });

describe("filtro de la weekly review", () => {
  it("sin nada elegido pasa todo", () => {
    expect(matchesFilter(task(1, null, null), SIN_FILTRO, catMap)).toBe(true);
  });

  it("dos objetivos elegidos muestran los dos, no la intersección", () => {
    // OR dentro de una dimensión: con AND, el segundo click vaciaría la vista.
    const f = filtro({ objectiveIds: new Set([10, 11]) });
    expect(matchesFilter(task(1, null, 10), f, catMap)).toBe(true);
    expect(matchesFilter(task(2, null, 11), f, catMap)).toBe(true);
    expect(matchesFilter(task(3, null, 12), f, catMap)).toBe(false);
    // Y una tarea sin objetivo queda fuera cuando se filtra por objetivo.
    expect(matchesFilter(task(4, null, null), f, catMap)).toBe(false);
  });

  it("objetivo y channel se cumplen los dos, no uno u otro", () => {
    // AND entre dimensiones: es lo que significa "filtran en conjunto".
    const f = filtro({ objectiveIds: new Set([10]), categoryIds: new Set([2]) });
    expect(matchesFilter(task(1, 2, 10), f, catMap)).toBe(true);
    expect(matchesFilter(task(2, 2, 99), f, catMap)).toBe(false);
    expect(matchesFilter(task(3, 3, 10), f, catMap)).toBe(false);
  });

  it("elegir un contexto incluye las tareas de sus channels", () => {
    // Las categorías son de dos niveles y una tarea apunta a cualquiera: contra
    // `categoryId` exacto, elegir un contexto no calzaría con nada.
    const f = filtro({ categoryIds: new Set([1]) });
    expect(matchesFilter(task(1, 1, null), f, catMap)).toBe(true);
    expect(matchesFilter(task(2, 2, null), f, catMap)).toBe(true);
    expect(matchesFilter(task(3, 3, null), f, catMap)).toBe(false);
  });

  it("elegir un channel no arrastra a sus hermanos ni al contexto entero", () => {
    const f = filtro({ categoryIds: new Set([2]) });
    expect(matchesFilter(task(1, 2, null), f, catMap)).toBe(true);
    expect(matchesFilter(task(2, 1, null), f, catMap)).toBe(false);
  });

  it("toggleId prende, apaga y no muta el original", () => {
    const a = new Set([1]);
    const b = toggleId(a, 2);
    expect([...b]).toEqual([1, 2]);
    expect([...a]).toEqual([1]);
    expect([...toggleId(b, 1)]).toEqual([2]);
  });
});
