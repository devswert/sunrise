import { describe, expect, it } from "vitest";
import type { Category, Task } from "../../lib/types";
import { GroupBy } from "../../lib/enums";
import { filterByChannel, folderOf, groupTasks, looseLabel } from "./grouping";

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

describe("groupTasks · por contexto", () => {
  it("agrupa por contexto, resolviendo los channels a su padre", () => {
    const groups = groupTasks(
      [task(10, DEPLOY.id), task(11, WORK.id), task(12, HOME.id)],
      CATEGORIES,
      GroupBy.CONTEXT,
      { includeEmpty: false },
    );

    expect(groups.map((g) => g.folder?.name)).toEqual(["Trabajo", "Casa"]);
    expect(groups[0].items.map((t) => t.id)).toEqual([10, 11]);
  });

  it("con includeEmpty deja los contextos sin tareas, que es lo que da el botón de crear", () => {
    const groups = groupTasks([task(10, WORK.id)], CATEGORIES, GroupBy.CONTEXT, {
      includeEmpty: true,
    });

    expect(groups.map((g) => g.folder?.name)).toEqual(["Trabajo", "Casa"]);
    expect(groups[1].items).toEqual([]);
  });

  it("sin includeEmpty los esconde, que es lo que quieren el sidebar y el panel", () => {
    const groups = groupTasks([task(10, WORK.id)], CATEGORIES, GroupBy.CONTEXT, {
      includeEmpty: false,
    });

    expect(groups.map((g) => g.folder?.name)).toEqual(["Trabajo"]);
  });

  it("las tareas sin contexto van al final, en su propio grupo", () => {
    const groups = groupTasks([task(10, null), task(11, WORK.id)], CATEGORIES, GroupBy.CONTEXT, {
      includeEmpty: false,
    });

    expect(groups[groups.length - 1].folder).toBeNull();
    expect(groups[groups.length - 1].items.map((t) => t.id)).toEqual([10]);
  });

  it("el grupo sin contexto no aparece vacío ni siquiera con includeEmpty", () => {
    // No es una categoría, así que no hay nada a lo que colgarle una tarea
    // nueva: el grupo vacío no ofrecería nada, solo ocuparía espacio.
    const groups = groupTasks([task(10, WORK.id)], CATEGORIES, GroupBy.CONTEXT, {
      includeEmpty: true,
    });

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

describe("groupTasks · por channel", () => {
  it("cada categoría es su propio grupo: un channel ya no se resuelve al padre", () => {
    const groups = groupTasks(
      [task(10, DEPLOY.id), task(11, WORK.id), task(12, HOME.id)],
      CATEGORIES,
      GroupBy.CHANNEL,
      { includeEmpty: false },
    );

    expect(groups.map((g) => g.folder?.name)).toEqual(["Trabajo", "Deploy", "Casa"]);
    expect(groups[0].items.map((t) => t.id)).toEqual([11]);
    expect(groups[1].items.map((t) => t.id)).toEqual([10]);
  });

  /**
   * Un contexto sin hijos es a la vez carpeta y el `#tag` que se ve en la card,
   * así que mandarlo a "sin channel" diría que no tiene uno cuando la card
   * muestra que sí.
   */
  it("una tarea colgada directo de un contexto es su propio channel", () => {
    const groups = groupTasks([task(10, HOME.id)], CATEGORIES, GroupBy.CHANNEL, {
      includeEmpty: false,
    });

    expect(groups.map((g) => g.folder?.name)).toEqual(["Casa"]);
  });

  it("con includeEmpty entran también los channels vacíos, cada uno con su botón", () => {
    const groups = groupTasks([task(10, DEPLOY.id)], CATEGORIES, GroupBy.CHANNEL, {
      includeEmpty: true,
    });

    expect(groups.map((g) => g.folder?.name)).toEqual(["Trabajo", "Deploy", "Casa"]);
  });

  it("las que no tienen categoría van al final igual", () => {
    const groups = groupTasks([task(10, null)], CATEGORIES, GroupBy.CHANNEL, {
      includeEmpty: false,
    });

    expect(groups.map((g) => g.folder)).toEqual([null]);
  });
});

describe("looseLabel", () => {
  it("el cajón de las sin categoría se llama según el nivel", () => {
    expect(looseLabel(GroupBy.CHANNEL)).toBe("Sin channel");
    expect(looseLabel(GroupBy.CONTEXT)).toBe("Sin contexto");
  });
});
