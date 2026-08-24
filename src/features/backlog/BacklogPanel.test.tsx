import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import type { Category, Task } from "../../lib/types";
import { BacklogPanel } from "./BacklogPanel";

function categoria(id: number, name: string, parentId: number | null = null): Category {
  return { id, parentId, name, color: "sky", position: id, archived: false };
}

function tarea(id: number, title: string, categoryId: number | null = null): Task {
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

const TRABAJO = categoria(1, "Trabajo");
const DEPLOY = categoria(2, "Deploy", 1);
const CASA = categoria(3, "Casa");

function pintar(tasks: Task[], rescued = new Map<number, string>()) {
  return render(
    <DndContext>
      <BacklogPanel
        tasks={tasks}
        rescued={rescued}
        categoryMap={new Map([TRABAJO, DEPLOY, CASA].map((c) => [c.id, c]))}
        categories={[TRABAJO, DEPLOY, CASA]}
        onToggle={() => {}}
        onOpen={() => {}}
        onClose={() => {}}
      />
    </DndContext>,
  );
}

const rotulos = () =>
  [...document.querySelectorAll(".backlog-panel__group-head")].map((e) => e.textContent!.trim());

describe("BacklogPanel", () => {
  it("agrupa por contexto, resolviendo el channel a su carpeta", () => {
    pintar([tarea(1, "Subir la release", DEPLOY.id), tarea(2, "Comprar pan", CASA.id)]);

    expect(rotulos()).toEqual(["Trabajo", "Casa"]);
  });

  it("no dibuja los contextos vacíos: 300px no se gastan en nombres sin tareas", () => {
    pintar([tarea(1, "Comprar pan", CASA.id)]);

    expect(rotulos()).toEqual(["Casa"]);
  });

  it("las tareas sin categoría van a su propio grupo, al final", () => {
    pintar([tarea(1, "Suelta"), tarea(2, "Comprar pan", CASA.id)]);

    expect(rotulos()).toEqual(["Casa", "Sin contexto"]);
  });

  it("dice de qué día se cayó una tarea, que es lo que explica por qué está acá", () => {
    pintar([tarea(1, "Quedó pendiente", CASA.id)], new Map([[1, "2026-08-14"]]));

    expect(screen.getByText(/Desde el/)).toBeInTheDocument();
  });

  it("cuenta los pendientes en la cabecera, con el plural que corresponde", () => {
    pintar([tarea(1, "Una", CASA.id)]);
    expect(screen.getByText("1 pendiente")).toBeInTheDocument();
  });

  it("vacío lo dice, en vez de quedar como un panel en blanco", () => {
    pintar([]);

    expect(screen.getByText(/No hay nada en el backlog/)).toBeInTheDocument();
    expect(rotulos()).toEqual([]);
  });

  /**
   * En el backlog la mayoría de las tareas todavía no tiene estimado, y el
   * `--:--` de relleno llenaba el panel de guiones donde deberían ir números. En
   * una columna de día sí se muestra: ahí "sin estimar" es información, porque es
   * lo que no está contando para la capacidad.
   */
  it("una tarea sin ningún tiempo no muestra el badge de relleno", () => {
    pintar([tarea(1, "Sin estimar", CASA.id)]);

    expect(screen.queryByLabelText("Ver tiempos")).toBeNull();
    // El reloj del pie abre el mismo panel, así que no se pierde el acceso.
    expect(screen.getByLabelText("Tiempos")).toBeInTheDocument();
  });

  it("pero una con estimado sí lo muestra", () => {
    const t = { ...tarea(1, "Estimada", CASA.id), estimatedMinutes: 45 } as Task;
    pintar([t]);

    expect(screen.getByLabelText("Ver tiempos")).toHaveTextContent("0:45");
  });

  it("separa las cards en vez de apilarlas pegadas", () => {
    // El aire lo pone el `gap` de la lista; sin ella las cards se tocaban.
    pintar([tarea(1, "Una", CASA.id), tarea(2, "Otra", CASA.id)]);

    expect(document.querySelector(".backlog-panel__list")).not.toBeNull();
  });

  it("no usa la clase de las columnas del board", () => {
    // `.day-col` es lo que cuenta las 21 columnas de la semana; el panel con esa
    // clase encima entraría en ese conteo con `dataset.date` en undefined.
    pintar([tarea(1, "Una", CASA.id)]);

    expect(document.querySelectorAll(".day-col")).toHaveLength(0);
  });
});
