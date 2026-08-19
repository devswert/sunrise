import { describe, expect, it } from "vitest";
import { reorderLocal } from "./reorder";
import type { Task } from "../../lib/types";

/**
 * Espeja `reordenar_dentro_del_mismo_dia_respeta_el_indice_final` (`repo.rs`).
 * Si las dos aritméticas se separan, el board se ve reordenado de una forma y la
 * recarga lo corrige a otra: un salto justo después de soltar.
 */
const DIA = "2026-08-10";

function tarea(id: number, position: number, scheduledDate: string | null = DIA): Task {
  return {
    id,
    title: `t${id}`,
    status: "TODO",
    source: "MANUAL",
    sourceState: "ACTIVE",
    scheduledDate,
    position,
    actualSeconds: 0,
  } as Task;
}

const ids = (list: Task[], date: string | null = DIA) =>
  list
    .filter((t) => (t.scheduledDate ?? null) === date)
    .sort((a, b) => a.position - b.position)
    .map((t) => t.id);

describe("reorderLocal", () => {
  const dia = [tarea(1, 0), tarea(2, 1), tarea(3, 2), tarea(4, 3)];

  it("hacia abajo deja la tarea en el índice final", () => {
    expect(ids(reorderLocal(dia, dia[0], DIA, 2))).toEqual([2, 3, 1, 4]);
    expect(ids(reorderLocal(dia, dia[0], DIA, 3))).toEqual([2, 3, 4, 1]);
  });

  it("hacia arriba también", () => {
    expect(ids(reorderLocal(dia, dia[3], DIA, 1))).toEqual([1, 4, 2, 3]);
    expect(ids(reorderLocal(dia, dia[3], DIA, 0))).toEqual([4, 1, 2, 3]);
  });

  it("renumera el destino sin huecos ni empates", () => {
    const out = reorderLocal(dia, dia[0], DIA, 2);
    const positions = out
      .filter((t) => t.scheduledDate === DIA)
      .map((t) => t.position)
      .sort((a, b) => a - b);
    expect(positions).toEqual([0, 1, 2, 3]);
  });

  it("un índice fuera de rango es al final, y uno negativo al principio", () => {
    expect(ids(reorderLocal(dia, dia[0], DIA, 99))).toEqual([2, 3, 4, 1]);
    expect(ids(reorderLocal(dia, dia[3], DIA, -5))).toEqual([4, 1, 2, 3]);
  });

  it("cambiar de día saca la tarea del origen y no toca a los otros días", () => {
    const otro = "2026-08-11";
    const mezcla = [...dia, tarea(9, 0, otro)];
    const out = reorderLocal(mezcla, dia[1], otro, 0);
    expect(ids(out)).toEqual([1, 3, 4]);
    expect(ids(out, otro)).toEqual([2, 9]);
  });

  it("al backlog es el mismo camino, con la fecha en null", () => {
    const out = reorderLocal(dia, dia[2], null, 0);
    expect(ids(out)).toEqual([1, 2, 4]);
    expect(ids(out, null)).toEqual([3]);
  });
});
