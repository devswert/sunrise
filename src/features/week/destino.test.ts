import { describe, expect, it } from "vitest";
import type { Task } from "../../lib/types";
import { resolveDrop, taskIdFrom } from "./destino";

const LUNES = "2026-08-17";
const MARTES = "2026-08-18";

function tarea(id: number, scheduledDate: string | null, status: Task["status"] = "TODO"): Task {
  return { id, title: `t${id}`, scheduledDate, status, position: id } as Task;
}

const A = tarea(1, LUNES);
const B = tarea(2, LUNES);
const C = tarea(3, LUNES);
const DEL_BACKLOG = tarea(9, null);

const POR_FECHA = { [LUNES]: [A, B, C] };
const nadaPlegado = (_d: string) => false;

function soltar(
  over: { id?: string | number; type?: "column" | "task"; date: string | null },
  task: Task | null,
  isCollapsed: (date: string) => boolean = nadaPlegado,
) {
  return resolveDrop({
    task,
    overId: over.id ?? "col",
    overData: over.type == null ? undefined : { type: over.type, date: over.date },
    tasksByDate: POR_FECHA,
    isCollapsed,
  });
}

describe("resolveDrop · hacia un día", () => {
  it("del backlog a un día: al final de la columna", () => {
    expect(soltar({ type: "column", date: LUNES }, DEL_BACKLOG)).toEqual({ date: LUNES, index: 3 });
  });

  it("soltar sobre una card toma el índice de esa card", () => {
    expect(soltar({ type: "task", id: "task-2", date: LUNES }, DEL_BACKLOG)).toEqual({
      date: LUNES,
      index: 1,
    });
  });

  it("soltar en la columna propia mantiene el índice, no manda al final", () => {
    // La cascada de colisión resuelve la columna al pasar por el header o los
    // márgenes; ahí "al final" era un movimiento que nadie pidió.
    expect(soltar({ type: "column", date: LUNES }, B)).toEqual({ date: LUNES, index: 1 });
  });

  it("a un día vacío entra en 0", () => {
    expect(soltar({ type: "column", date: MARTES }, DEL_BACKLOG)).toEqual({
      date: MARTES,
      index: 0,
    });
  });

  it("a un día plegado no pasa nada", () => {
    // No tiene ref de droppable, pero el fallback por esquina más cercana no
    // distingue y lo puede devolver igual.
    expect(soltar({ type: "column", date: LUNES }, DEL_BACKLOG, (d) => d === LUNES)).toBeNull();
  });
});

describe("resolveDrop · hacia el backlog", () => {
  it("de un día al backlog entra en 0", () => {
    expect(soltar({ type: "column", date: null }, A)).toEqual({ date: null, index: 0 });
  });

  it("soltar sobre una card del panel también es 'al backlog', no un reordenamiento", () => {
    // El panel no se reordena por dentro: la `position` del backlog es global y
    // `list_backlog` ordena por categoría, así que un índice no significa nada.
    expect(soltar({ type: "task", id: "task-9", date: null }, A)).toEqual({
      date: null,
      index: 0,
    });
  });

  it("del backlog al backlog no pasa nada", () => {
    // Con el panel superpuesto el arrastre empieza adentro: un empujón de 5px
    // resolvería el panel y reescribiría la position de todo el bucket.
    expect(soltar({ type: "column", date: null }, DEL_BACKLOG)).toBeNull();
  });

  it("una tarea completada no entra al backlog", () => {
    // `list_backlog` filtra TODO: saldría del día sin entrar al panel y quedaría
    // inalcanzable en toda la app.
    expect(soltar({ type: "column", date: null }, tarea(4, LUNES, "DONE"))).toBeNull();
  });

  it("pero una completada sí se puede mover entre días", () => {
    expect(soltar({ type: "column", date: MARTES }, tarea(4, LUNES, "DONE"))).toEqual({
      date: MARTES,
      index: 0,
    });
  });
});

describe("resolveDrop · lo que no reconoce", () => {
  it("sin datos en el droppable no mueve nada", () => {
    expect(soltar({ date: LUNES }, A)).toBeNull();
  });

  it("sin tarea no inventa un movimiento", () => {
    expect(soltar({ type: "column", date: LUNES }, null)).toBeNull();
  });
});

describe("taskIdFrom", () => {
  it("saca el id numérico del id de dnd-kit", () => {
    expect(taskIdFrom("task-42")).toBe(42);
  });
});
