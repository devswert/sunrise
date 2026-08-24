import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { Category, Task } from "../../lib/types";
import { BacklogPanel } from "./BacklogPanel";

function category(id: number, name: string, parentId: number | null = null): Category {
  return { id, parentId, name, color: "sky", position: id, archived: false };
}

function task(id: number, title: string, categoryId: number | null = null): Task {
  return {
    id,
    title,
    categoryId,
    status: "TODO",
    source: "MANUAL",
    sourceState: "ACTIVE",
    scheduledDate: null,
    position: id,
    actualSeconds: 0,
  } as Task;
}

const WORK = category(1, "Trabajo");
const DEPLOY = category(2, "Deploy", 1);
const HOME = category(3, "Casa");

function renderPanel(tasks: Task[], rescued = new Map<number, string>()) {
  return render(
    <DndContext>
      <BacklogPanel
        tasks={tasks}
        rescued={rescued}
        categoryMap={new Map([WORK, DEPLOY, HOME].map((c) => [c.id, c]))}
        categories={[WORK, DEPLOY, HOME]}
        onToggle={() => {}}
        onOpen={() => {}}
        onClose={() => {}}
      />
    </DndContext>,
  );
}

const groupHeads = () =>
  [...document.querySelectorAll(".backlog-panel__group-head")].map((e) => e.textContent!.trim());

describe("BacklogPanel", () => {
  it("agrupa por contexto, resolviendo el channel a su carpeta", () => {
    renderPanel([task(1, "Subir la release", DEPLOY.id), task(2, "Comprar pan", HOME.id)]);

    expect(groupHeads()).toEqual(["Trabajo", "Casa"]);
  });

  it("no dibuja los contextos vacíos: 300px no se gastan en nombres sin tareas", () => {
    renderPanel([task(1, "Comprar pan", HOME.id)]);

    expect(groupHeads()).toEqual(["Casa"]);
  });

  it("las tareas sin categoría van a su propio grupo, al final", () => {
    renderPanel([task(1, "Suelta"), task(2, "Comprar pan", HOME.id)]);

    expect(groupHeads()).toEqual(["Casa", "Sin contexto"]);
  });

  it("dice de qué día se cayó una tarea, que es lo que explica por qué está acá", () => {
    renderPanel([task(1, "Quedó pendiente", HOME.id)], new Map([[1, "2026-08-14"]]));

    expect(screen.getByText(/Desde el/)).toBeInTheDocument();
  });

  it("cuenta los pendientes en la cabecera, con el plural que corresponde", () => {
    renderPanel([task(1, "Una", HOME.id)]);
    expect(screen.getByText("1 pendiente")).toBeInTheDocument();
  });

  it("vacío lo dice, en vez de quedar como un panel en blanco", () => {
    renderPanel([]);

    expect(screen.getByText(/No hay nada en el backlog/)).toBeInTheDocument();
    expect(groupHeads()).toEqual([]);
  });

  /**
   * En el backlog la mayoría de las tareas todavía no tiene estimado, y el
   * `--:--` de relleno llenaba el panel de guiones donde deberían ir números. En
   * una columna de día sí se muestra: ahí "sin estimar" es información, porque es
   * lo que no está contando para la capacidad.
   */
  it("una tarea sin ningún tiempo no muestra el badge de relleno", () => {
    renderPanel([task(1, "Sin estimar", HOME.id)]);

    expect(screen.queryByLabelText("Ver tiempos")).toBeNull();
    // El reloj del pie abre el mismo panel, así que no se pierde el acceso.
    expect(screen.getByLabelText("Tiempos")).toBeInTheDocument();
  });

  it("pero una con estimado sí lo muestra", () => {
    const t = { ...task(1, "Estimada", HOME.id), estimatedMinutes: 45 } as Task;
    renderPanel([t]);

    expect(screen.getByLabelText("Ver tiempos")).toHaveTextContent("0:45");
  });

  it("separa las cards en vez de apilarlas pegadas", () => {
    // El aire lo pone el `gap` de la lista; sin ella las cards se tocaban.
    renderPanel([task(1, "Una", HOME.id), task(2, "Otra", HOME.id)]);

    expect(document.querySelector(".backlog-panel__list")).not.toBeNull();
  });

  it("no usa la clase de las columnas del board", () => {
    // `.day-col` es lo que cuenta las 21 columnas de la semana; el panel con esa
    // clase encima entraría en ese conteo con `dataset.date` en undefined.
    renderPanel([task(1, "Una", HOME.id)]);

    expect(document.querySelectorAll(".day-col")).toHaveLength(0);
  });
});
