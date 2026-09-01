import { describe, expect, it } from "vitest";
import type { Category, Task } from "../../lib/types";
import { filterByChannel, folderOf, groupByContext } from "./grouping";

function category(id: number, name: string, parentId: number | null = null): Category {
  return { id, parentId, name, color: "sky", position: id, archived: false };
}

function task(id: number, categoryId: number | null): Task {
  return { id, title: `t${id}`, categoryId, scheduledDate: null, position: id } as Task;
}

/** Un contexto ("Trabajo") con un channel adentro, y otro contexto vacío. */
const WORK = category(1, "Trabajo");
const DEPLOY = category(2, "Deploy", 1);
const HOME = category(3, "Casa");
const CATEGORIES = [WORK, DEPLOY, HOME];

describe("folderOf", () => {
  const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

  it("una tarea en un channel cuenta para el contexto que lo contiene", () => {
    expect(folderOf(task(10, DEPLOY.id), byId)).toBe(WORK.id);
  });

  it("una tarea puesta directo en el contexto cuenta para él mismo", () => {
    expect(folderOf(task(10, WORK.id), byId)).toBe(WORK.id);
  });

  it("sin categoría no tiene contexto", () => {
    expect(folderOf(task(10, null), byId)).toBeNull();
  });

  it("una categoría que ya no existe no tiene contexto, y no revienta", () => {
    // Pasa de verdad: la lista de categorías y la de tareas se leen en dos
    // consultas, así que una tarea puede traer un id que la otra ya no tiene.
    expect(folderOf(task(10, 999), byId)).toBeNull();
  });
});

describe("groupByContext", () => {
  it("agrupa por contexto, resolviendo los channels a su padre", () => {
    const groups = groupByContext(
      [task(10, DEPLOY.id), task(11, WORK.id), task(12, HOME.id)],
      CATEGORIES,
      { includeEmpty: false },
    );

    expect(groups.map((g) => g.folder?.name)).toEqual(["Trabajo", "Casa"]);
    expect(groups[0].items.map((t) => t.id)).toEqual([10, 11]);
  });

  it("con includeEmpty deja los contextos sin tareas, que es lo que da el botón de crear", () => {
    const groups = groupByContext([task(10, WORK.id)], CATEGORIES, { includeEmpty: true });

    expect(groups.map((g) => g.folder?.name)).toEqual(["Trabajo", "Casa"]);
    expect(groups[1].items).toEqual([]);
  });

  it("sin includeEmpty los esconde, que es lo que quieren el sidebar y el panel", () => {
    const groups = groupByContext([task(10, WORK.id)], CATEGORIES, { includeEmpty: false });

    expect(groups.map((g) => g.folder?.name)).toEqual(["Trabajo"]);
  });

  it("las tareas sin contexto van al final, en su propio grupo", () => {
    const groups = groupByContext([task(10, null), task(11, WORK.id)], CATEGORIES, {
      includeEmpty: false,
    });

    expect(groups[groups.length - 1].folder).toBeNull();
    expect(groups[groups.length - 1].items.map((t) => t.id)).toEqual([10]);
  });

  it("el grupo sin contexto no aparece vacío ni siquiera con includeEmpty", () => {
    // No es una categoría, así que no hay nada a lo que colgarle una tarea
    // nueva: el grupo vacío no ofrecería nada, solo ocuparía espacio.
    const groups = groupByContext([task(10, WORK.id)], CATEGORIES, { includeEmpty: true });

    expect(groups.every((g) => g.folder !== null)).toBe(true);
  });
});

describe("filterByChannel", () => {
  it('sin canal elegido no filtra: es "todos", no "los que no tienen"', () => {
    const lista = [task(10, WORK.id), task(11, null)];
    expect(filterByChannel(lista, CATEGORIES, null)).toEqual(lista);
  });

  it("elegir un channel deja solo las de ese channel", () => {
    const lista = [task(10, DEPLOY.id), task(11, WORK.id), task(12, HOME.id)];
    expect(filterByChannel(lista, CATEGORIES, DEPLOY.id).map((t) => t.id)).toEqual([10]);
  });

  /**
   * Y no la coincidencia exacta: el picker ofrece los dos niveles, así que elegir
   * un contexto en un backlog donde todo está en channels devolvería la lista
   * vacía — un filtro que se ve puesto y no muestra nada.
   */
  it("elegir un contexto deja todo lo que cuelga de él, channels incluidos", () => {
    const lista = [task(10, DEPLOY.id), task(11, WORK.id), task(12, HOME.id)];
    expect(filterByChannel(lista, CATEGORIES, WORK.id).map((t) => t.id)).toEqual([10, 11]);
  });
});
