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

function pintar(rescued: Map<number, string>) {
  return render(
    <DndContext>
      <BacklogColumn
        tasks={[tarea(1, "rescatada"), tarea(2, "guardada")]}
        rescued={rescued}
        categoryMap={new Map()}
        categories={[]}
        onToggle={() => {}}
      />
    </DndContext>,
  );
}

describe("BacklogColumn · el grupo de las rescatadas", () => {
  it("una tarea que vino de un día muestra su fecha", () => {
    pintar(new Map([[1, "2026-08-19"]]));
    expect(screen.getByText("Venían de un día")).toBeInTheDocument();
    expect(screen.getByText(/desde el 19 ago/)).toBeInTheDocument();
  });

  /**
   * El caso que tumbaba la vista a pantalla en blanco: la clave estaba y la fecha
   * no, porque `Rescue.fromDate` viajaba con otro nombre del que leía el front.
   * Pasaba **solo dentro de Tauri** —el mock devolvía el nombre que el front
   * esperaba—, así que el contrato lo fija además un test en `models.rs`.
   */
  it("una clave sin fecha no rompe la vista: se ignora", () => {
    const roto = new Map([[1, undefined]]) as unknown as Map<number, string>;
    expect(() => pintar(roto)).not.toThrow();
    expect(screen.queryByText("Venían de un día")).not.toBeInTheDocument();
    expect(screen.queryByText(/desde el/)).not.toBeInTheDocument();
    expect(screen.getByText("rescatada")).toBeInTheDocument();
  });
});
