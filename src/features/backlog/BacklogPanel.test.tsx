import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import type { Category, Task } from "../../lib/types";
import { Priority } from "../../lib/enums";
import { BacklogPanel } from "./BacklogPanel";

function category(id: number, name: string, parentId: number | null = null): Category {
  return { id, parentId, name, color: "sky", position: id, archived: false };
}

function task(
  id: number,
  title: string,
  categoryId: number | null = null,
  priority: Priority | null = null,
): Task {
  return {
    id,
    title,
    categoryId,
    priority,
    status: "TODO",
    source: "MANUAL",
    sourceState: "ACTIVE",
    scheduledDate: null,
    position: id,
    actualSeconds: 0,
    // El orden del panel desempata por fecha de creación, así que el molde la
    // necesita: sin ella, `sortTasks` compara contra `undefined`.
    createdAt: `2026-08-${String(id).padStart(2, "0")}T09:00:00`,
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

  const titulos = () =>
    [...document.querySelectorAll(".tc__title")].map((e) => e.textContent!.trim());

  it("filtra por prioridad, y con el filtro puesto lo dice en el contador", async () => {
    renderPanel([
      task(1, "Arde", HOME.id, Priority.P1),
      task(2, "Puede esperar", HOME.id, Priority.P5),
      task(3, "Sin priorizar", HOME.id),
    ]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("button", { name: "P1" }));

    expect(titulos()).toEqual(["Arde"]);
    expect(screen.getByText(/1 de/)).toBeInTheDocument();
  });

  it("filtra por canal, y un contexto arrastra a sus channels", async () => {
    renderPanel([task(1, "Subir la release", DEPLOY.id), task(2, "Comprar pan", HOME.id)]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("option", { name: "Trabajo" }));

    expect(groupHeads()).toEqual(["Trabajo"]);
    expect(titulos()).toEqual(["Subir la release"]);
  });

  it("de fábrica ordena por antigüedad, la más vieja arriba", () => {
    // El molde fecha por id, así que la 1 es más vieja que la 3.
    renderPanel([task(3, "Nueva", HOME.id), task(1, "Vieja", HOME.id)]);

    expect(titulos()).toEqual(["Vieja", "Nueva"]);
  });

  it("por prioridad sube los P1 y deja las sin priorizar al final", async () => {
    renderPanel([
      task(1, "Sin priorizar", HOME.id),
      task(2, "Puede esperar", HOME.id, Priority.P5),
      task(3, "Arde", HOME.id, Priority.P1),
    ]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("button", { name: "Prioridad" }));

    expect(titulos()).toEqual(["Arde", "Puede esperar", "Sin priorizar"]);
  });

  /**
   * **Ordenar por prioridad aplana**: la pregunta que responde ese orden es qué es
   * lo más urgente, y cruza los contextos. Agrupado, el P1 de Casa quedaba debajo
   * de los de Trabajo solo porque Trabajo va antes en la lista de categorías.
   */
  it("ordenar por prioridad deshace los grupos y ordena de punta a punta", async () => {
    renderPanel([
      task(1, "Casa urgente", HOME.id, Priority.P1),
      task(2, "Trabajo tranquilo", DEPLOY.id, Priority.P4),
      task(3, "Casa tranquila", HOME.id, Priority.P5),
      task(4, "Trabajo urgente", DEPLOY.id, Priority.P2),
    ]);
    expect(groupHeads()).toEqual(["Trabajo", "Casa"]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("button", { name: "Prioridad" }));

    expect(groupHeads()).toEqual([]);
    expect(titulos()).toEqual([
      "Casa urgente",
      "Trabajo urgente",
      "Trabajo tranquilo",
      "Casa tranquila",
    ]);
  });

  it("volver a antigüedad devuelve los grupos", async () => {
    renderPanel([
      task(1, "Casa urgente", HOME.id, Priority.P1),
      task(2, "Trabajo tranquilo", DEPLOY.id, Priority.P4),
    ]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("button", { name: "Prioridad" }));
    await userEvent.click(screen.getByRole("button", { name: "Antigüedad" }));

    expect(groupHeads()).toEqual(["Trabajo", "Casa"]);
  });

  it("volver a hacer click en un nivel lo saca, sin botón de limpiar", async () => {
    renderPanel([
      task(1, "Arde", HOME.id, Priority.P1),
      task(2, "Puede esperar", HOME.id, Priority.P5),
    ]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("button", { name: "P1" }));
    expect(titulos()).toEqual(["Arde"]);

    await userEvent.click(screen.getByRole("button", { name: "P1" }));
    expect(titulos()).toEqual(["Arde", "Puede esperar"]);
    expect(screen.queryByRole("button", { name: "Ver todas" })).toBeNull();
  });

  it("volver a hacer click en el canal marcado lo desmarca", async () => {
    renderPanel([task(1, "Subir la release", DEPLOY.id), task(2, "Comprar pan", HOME.id)]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("option", { name: /Deploy/ }));
    expect(titulos()).toEqual(["Subir la release"]);

    await userEvent.click(screen.getByRole("option", { name: /Deploy/ }));
    expect(titulos()).toEqual(["Subir la release", "Comprar pan"]);
  });

  it("con los filtros puestos y nada que mostrar, lo dice en vez de parecer vacío", async () => {
    renderPanel([task(1, "Sin priorizar", HOME.id)]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("button", { name: "P1" }));

    expect(screen.getByText(/Nada en el backlog pasa esos filtros/)).toBeInTheDocument();
  });

  /**
   * Tres botones en fila envolvían a dos líneas en cuanto el canal elegido tenía
   * nombre largo, y en 300px eso rompía la caja de la cabecera. Con uno solo, el
   * ancho deja de depender de lo aplicado.
   */
  it("los controles son un solo botón, no tres", () => {
    renderPanel([task(1, "Una", HOME.id)]);

    expect(document.querySelectorAll(".panel-head .bfilter")).toHaveLength(1);
    // Y va en la fila del contador, que es lo que los filtros cambian.
    expect(document.querySelector(".panel-head__meta .bfilter")).not.toBeNull();
  });

  it("el contador del botón cuenta niveles y canal, pero no el orden", async () => {
    renderPanel([task(1, "Arde", DEPLOY.id, Priority.P1)]);
    const boton = screen.getByLabelText("Filtrar y ordenar");

    await userEvent.click(boton);
    await userEvent.click(screen.getByRole("button", { name: "P1" }));
    expect(boton).toHaveTextContent("1");

    await userEvent.click(screen.getByRole("option", { name: /Deploy/ }));
    expect(boton).toHaveTextContent("2");

    // Siempre hay un orden, así que sumarlo dejaría un contador que nunca baja de 1.
    await userEvent.click(screen.getByRole("button", { name: "Prioridad" }));
    expect(boton).toHaveTextContent("2");
  });

  /**
   * El buscador del select vive **dentro** del popover del panel. Si el cierre
   * por click afuera contara ese input como afuera, escribir cerraría el popover
   * y el canal sería inelegible desde acá.
   */
  it("se puede buscar el canal sin que el popover se cierre", async () => {
    renderPanel([task(1, "Subir la release", DEPLOY.id), task(2, "Comprar pan", HOME.id)]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.type(screen.getByPlaceholderText("Buscar canal…"), "depl");
    await userEvent.click(screen.getByRole("option", { name: /Deploy/ }));

    expect(titulos()).toEqual(["Subir la release"]);
  });

  it("filtrar y ordenar salen del mismo popover, sin reabrirlo", async () => {
    renderPanel([
      task(1, "Casa tranquila", HOME.id, Priority.P4),
      task(2, "Casa urgente", HOME.id, Priority.P1),
      task(3, "Sin priorizar", HOME.id),
    ]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));
    await userEvent.click(screen.getByRole("button", { name: "P1" }));
    await userEvent.click(screen.getByRole("button", { name: "P4" }));
    await userEvent.click(screen.getByRole("button", { name: "Prioridad" }));

    expect(titulos()).toEqual(["Casa urgente", "Casa tranquila"]);
  });

  /**
   * El único limpiar que queda. Los toggles sacan un filtro; esto responde otra
   * pregunta —"déjame esto como estaba"— que con tres controles son tres clicks.
   */
  it("Restablecer deja los tres controles como estaban", async () => {
    renderPanel([
      task(1, "Subir la release", DEPLOY.id, Priority.P1),
      task(2, "Comprar pan", HOME.id, Priority.P5),
    ]);
    const boton = screen.getByLabelText("Filtrar y ordenar");

    await userEvent.click(boton);
    await userEvent.click(screen.getByRole("button", { name: "P1" }));
    await userEvent.click(screen.getByRole("option", { name: /Deploy/ }));
    await userEvent.click(screen.getByRole("button", { name: "Prioridad" }));
    expect(titulos()).toEqual(["Subir la release"]);

    await userEvent.click(screen.getByRole("button", { name: "Restablecer" }));

    expect(titulos()).toEqual(["Subir la release", "Comprar pan"]);
    expect(groupHeads()).toEqual(["Trabajo", "Casa"]);
    expect(boton).not.toHaveTextContent("1");
  });

  it("sin nada puesto no hay nada que restablecer, así que el botón no está", async () => {
    renderPanel([task(1, "Una", HOME.id)]);

    await userEvent.click(screen.getByLabelText("Filtrar y ordenar"));

    expect(screen.queryByRole("button", { name: "Restablecer" })).toBeNull();
  });
});