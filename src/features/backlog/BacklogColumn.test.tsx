import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { Task } from "../../lib/types";
import { BacklogColumn } from "./BacklogColumn";

function tarea(id: number, title: string): Task {
  return {
    id,
    title,
    status: "TODO",
    source: "MANUAL",
    sourceState: "ACTIVE",
    scheduledDate: null,
    position: id,
    actualSeconds: 0,
  } as Task;
}

function pintar(tasks: Task[], rescued: Map<number, string>) {
  return render(
    <DndContext>
      <BacklogColumn
        tasks={tasks}
        rescued={rescued}
        categoryMap={new Map()}
        categories={[]}
        onToggle={() => {}}
      />
    </DndContext>,
  );
}

const rotulos = () =>
  [...document.querySelectorAll(".col-grupo")].map((e) => e.textContent!.trim());

describe("BacklogColumn · el grupo de las rescatadas", () => {
  it("la fecha va una vez en el rótulo, no repetida bajo cada card", () => {
    pintar(
      [tarea(1, "una"), tarea(2, "otra"), tarea(3, "guardada")],
      new Map([
        [1, "2026-08-18"],
        [2, "2026-08-18"],
      ]),
    );

    // Un solo rótulo para las dos del mismo día, y el de las guardadas después.
    expect(rotulos()).toEqual(["Desde el 18 ago", "Guardadas"]);
    // Y ningún badge por card, que es lo que se leía mal: en la columna la fecha
    // va una sola vez, en el rótulo del grupo.
    expect(document.querySelectorAll(".backlog__from, .backlog-panel__from")).toHaveLength(0);
  });

  it("dos días distintos son dos grupos", () => {
    pintar(
      [tarea(1, "del 18"), tarea(2, "del 17")],
      new Map([
        [1, "2026-08-18"],
        [2, "2026-08-17"],
      ]),
    );

    expect(rotulos()).toEqual(["Desde el 18 ago", "Desde el 17 ago"]);
  });

  /**
   * El orden es el de `position` y no la fecha, a propósito: reordenar por debajo
   * lo que acabás de mover a mano sería peor. Si el orden intercala, el día
   * vuelve a rotular — y el rótulo repetido es más honesto que una lista que
   * salta.
   */
  it("si el orden intercala los días, el rótulo se repite en vez de reordenar", () => {
    pintar(
      [tarea(1, "a"), tarea(2, "b"), tarea(3, "c")],
      new Map([
        [1, "2026-08-18"],
        [2, "2026-08-17"],
        [3, "2026-08-18"],
      ]),
    );

    expect(rotulos()).toEqual(["Desde el 18 ago", "Desde el 17 ago", "Desde el 18 ago"]);
    // El orden de las cards no se toca.
    expect([...document.querySelectorAll(".tc__title")].map((e) => e.textContent)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  /**
   * El caso que tumbaba la vista a pantalla en blanco: la clave estaba y la fecha
   * no, porque `Rescue.fromDate` viajaba con otro nombre del que leía el front.
   * Pasaba **solo dentro de Tauri** —el mock devolvía el nombre que el front
   * esperaba—, así que el contrato lo fija además un test en `models.rs`.
   */
  it("una clave sin fecha no rompe la vista: se ignora", () => {
    const roto = new Map([[1, undefined]]) as unknown as Map<number, string>;
    expect(() => pintar([tarea(1, "rescatada"), tarea(2, "guardada")], roto)).not.toThrow();
    expect(rotulos()).toEqual([]);
    expect(screen.getByText("rescatada")).toBeInTheDocument();
  });
});
