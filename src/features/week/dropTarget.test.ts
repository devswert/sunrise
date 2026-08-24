import { describe, expect, it } from "vitest";
import type { Task } from "../../lib/types";
import { resolveDrop, taskIdFrom } from "./dropTarget";

const MONDAY = "2026-08-17";
const TUESDAY = "2026-08-18";

function task(id: number, scheduledDate: string | null, status: Task["status"] = "TODO"): Task {
  return { id, title: `t${id}`, scheduledDate, status, position: id } as Task;
}

const A = task(1, MONDAY);
const B = task(2, MONDAY);
const C = task(3, MONDAY);
const FROM_BACKLOG = task(9, null);

const BY_DATE = { [MONDAY]: [A, B, C] };
const nothingCollapsed = (_d: string) => false;

function drop(
  over: { id?: string | number; type?: "column" | "task"; date: string | null },
  task: Task | null,
  isCollapsed: (date: string) => boolean = nothingCollapsed,
) {
  return resolveDrop({
    task,
    overId: over.id ?? "col",
    overData: over.type == null ? undefined : { type: over.type, date: over.date },
    tasksByDate: BY_DATE,
    isCollapsed,
  });
}

describe("resolveDrop · hacia un día", () => {
  it("del backlog a un día: al final de la columna", () => {
    expect(drop({ type: "column", date: MONDAY }, FROM_BACKLOG)).toEqual({ date: MONDAY, index: 3 });
  });

  it("soltar sobre una card toma el índice de esa card", () => {
    expect(drop({ type: "task", id: "task-2", date: MONDAY }, FROM_BACKLOG)).toEqual({
      date: MONDAY,
      index: 1,
    });
  });

  it("soltar en la columna propia mantiene el índice, no manda al final", () => {
    // La cascada de colisión resuelve la columna al pasar por el header o los
    // márgenes; ahí "al final" era un movimiento que nadie pidió.
    expect(drop({ type: "column", date: MONDAY }, B)).toEqual({ date: MONDAY, index: 1 });
  });

  it("a un día vacío entra en 0", () => {
    expect(drop({ type: "column", date: TUESDAY }, FROM_BACKLOG)).toEqual({
      date: TUESDAY,
      index: 0,
    });
  });

  it("a un día plegado no pasa nada", () => {
    // No tiene ref de droppable, pero el fallback por esquina más cercana no
    // distingue y lo puede devolver igual.
    expect(drop({ type: "column", date: MONDAY }, FROM_BACKLOG, (d) => d === MONDAY)).toBeNull();
  });
});

describe("resolveDrop · hacia el backlog", () => {
  it("de un día al backlog entra en 0", () => {
    expect(drop({ type: "column", date: null }, A)).toEqual({ date: null, index: 0 });
  });

  it("soltar sobre una card del panel también es 'al backlog', no un reordenamiento", () => {
    // El panel no se reordena por dentro: la `position` del backlog es global y
    // `list_backlog` ordena por categoría, así que un índice no significa nada.
    expect(drop({ type: "task", id: "task-9", date: null }, A)).toEqual({
      date: null,
      index: 0,
    });
  });

  it("del backlog al backlog no pasa nada", () => {
    // Con el panel superpuesto el arrastre empieza adentro: un empujón de 5px
    // resolvería el panel y reescribiría la position de todo el bucket.
    expect(drop({ type: "column", date: null }, FROM_BACKLOG)).toBeNull();
  });

  it("una tarea completada no entra al backlog", () => {
    // `list_backlog` filtra TODO: saldría del día sin entrar al panel y quedaría
    // inalcanzable en toda la app.
    expect(drop({ type: "column", date: null }, task(4, MONDAY, "DONE"))).toBeNull();
  });

  it("pero una completada sí se puede mover entre días", () => {
    expect(drop({ type: "column", date: TUESDAY }, task(4, MONDAY, "DONE"))).toEqual({
      date: TUESDAY,
      index: 0,
    });
  });
});

describe("resolveDrop · lo que no reconoce", () => {
  it("sin datos en el droppable no mueve nada", () => {
    expect(drop({ date: MONDAY }, A)).toBeNull();
  });

  it("sin tarea no inventa un movimiento", () => {
    expect(drop({ type: "column", date: MONDAY }, null)).toBeNull();
  });
});

describe("taskIdFrom", () => {
  it("saca el id numérico del id de dnd-kit", () => {
    expect(taskIdFrom("task-42")).toBe(42);
  });
});
