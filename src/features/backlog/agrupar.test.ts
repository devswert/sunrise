import { describe, expect, it } from "vitest";
import type { Category, Task } from "../../lib/types";
import { folderOf, groupByContext } from "./agrupar";

function categoria(id: number, name: string, parentId: number | null = null): Category {
  return { id, parentId, name, color: "sky", position: id, archived: false };
}

function tarea(id: number, categoryId: number | null): Task {
  return { id, title: `t${id}`, categoryId, scheduledDate: null, position: id } as Task;
}

/** Un contexto ("Trabajo") con un channel adentro, y otro contexto vacío. */
const TRABAJO = categoria(1, "Trabajo");
const DEPLOY = categoria(2, "Deploy", 1);
const CASA = categoria(3, "Casa");
const CATEGORIAS = [TRABAJO, DEPLOY, CASA];

describe("folderOf", () => {
  const byId = new Map(CATEGORIAS.map((c) => [c.id, c]));

  it("una tarea en un channel cuenta para el contexto que lo contiene", () => {
    expect(folderOf(tarea(10, DEPLOY.id), byId)).toBe(TRABAJO.id);
  });

  it("una tarea puesta directo en el contexto cuenta para él mismo", () => {
    expect(folderOf(tarea(10, TRABAJO.id), byId)).toBe(TRABAJO.id);
  });

  it("sin categoría no tiene contexto", () => {
    expect(folderOf(tarea(10, null), byId)).toBeNull();
  });

  it("una categoría que ya no existe no tiene contexto, y no revienta", () => {
    // Pasa de verdad: la lista de categorías y la de tareas se leen en dos
    // consultas, así que una tarea puede traer un id que la otra ya no tiene.
    expect(folderOf(tarea(10, 999), byId)).toBeNull();
  });
});

describe("groupByContext", () => {
  it("agrupa por contexto, resolviendo los channels a su padre", () => {
    const grupos = groupByContext(
      [tarea(10, DEPLOY.id), tarea(11, TRABAJO.id), tarea(12, CASA.id)],
      CATEGORIAS,
      { includeEmpty: false },
    );

    expect(grupos.map((g) => g.folder?.name)).toEqual(["Trabajo", "Casa"]);
    expect(grupos[0].items.map((t) => t.id)).toEqual([10, 11]);
  });

  it("con includeEmpty deja los contextos sin tareas, que es lo que da el botón de crear", () => {
    const grupos = groupByContext([tarea(10, TRABAJO.id)], CATEGORIAS, { includeEmpty: true });

    expect(grupos.map((g) => g.folder?.name)).toEqual(["Trabajo", "Casa"]);
    expect(grupos[1].items).toEqual([]);
  });

  it("sin includeEmpty los esconde, que es lo que quieren el sidebar y el panel", () => {
    const grupos = groupByContext([tarea(10, TRABAJO.id)], CATEGORIAS, { includeEmpty: false });

    expect(grupos.map((g) => g.folder?.name)).toEqual(["Trabajo"]);
  });

  it("las tareas sin contexto van al final, en su propio grupo", () => {
    const grupos = groupByContext([tarea(10, null), tarea(11, TRABAJO.id)], CATEGORIAS, {
      includeEmpty: false,
    });

    expect(grupos[grupos.length - 1].folder).toBeNull();
    expect(grupos[grupos.length - 1].items.map((t) => t.id)).toEqual([10]);
  });

  it("el grupo sin contexto no aparece vacío ni siquiera con includeEmpty", () => {
    // No es una categoría, así que no hay nada a lo que colgarle una tarea
    // nueva: el grupo vacío no ofrecería nada, solo ocuparía espacio.
    const grupos = groupByContext([tarea(10, TRABAJO.id)], CATEGORIAS, { includeEmpty: true });

    expect(grupos.every((g) => g.folder !== null)).toBe(true);
  });
});
