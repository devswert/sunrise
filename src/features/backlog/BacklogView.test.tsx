import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../../lib/ipc";
import type { Category, Task } from "../../lib/types";
import { BacklogView } from "./BacklogView";

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

async function pintar(tasks: Task[], rescates: { taskId: number; fromDate: string }[] = []) {
  vi.spyOn(api, "listBacklog").mockResolvedValue(tasks);
  vi.spyOn(api, "listCategories").mockResolvedValue([WORK, DEPLOY, HOME]);
  vi.spyOn(api, "listObjectives").mockResolvedValue([]);
  vi.spyOn(api, "rescuedFromBacklog").mockResolvedValue(rescates);
  render(<BacklogView />);
  await waitFor(() => expect(document.querySelectorAll(".backlog__col").length).toBeGreaterThan(0));
}

const columnas = () => [...document.querySelectorAll<HTMLElement>(".backlog__col")];
const rotulos = () =>
  columnas().map((c) => c.querySelector(".backlog__col-name")!.textContent!.trim());
const contadores = () =>
  columnas().map((c) => c.querySelector(".day-col__date")!.textContent!.trim());

describe("BacklogView · un contexto por columna", () => {
  it("una columna por contexto, resolviendo el channel a su carpeta", async () => {
    await pintar([task(1, "Subir la release", DEPLOY.id), task(2, "Comprar pan", HOME.id)]);

    expect(rotulos()).toEqual(["Trabajo", "Casa"]);
    expect(within(columnas()[0]).getByText("Subir la release")).toBeTruthy();
  });

  it("los contextos vacíos también son columna: ahí vive su botón de crear", async () => {
    // Sin la columna no hay "Agregar tarea", y el contexto queda inalcanzable.
    await pintar([task(1, "Comprar pan", HOME.id)]);

    expect(rotulos()).toEqual(["Trabajo", "Casa"]);
    expect(screen.getAllByText("Agregar tarea")).toHaveLength(2);
  });

  it("cada columna dice cuántas tiene, que es lo que se lee de un vistazo", async () => {
    await pintar([
      task(1, "Subir la release", DEPLOY.id),
      task(2, "Revisar el log", WORK.id),
      task(3, "Comprar pan", HOME.id),
    ]);

    expect(contadores()).toEqual(["2", "1"]);
  });

  it("el buscador filtra por título y esconde los contextos sin resultados", async () => {
    await pintar([task(1, "Subir la release", DEPLOY.id), task(2, "Comprar pan", HOME.id)]);

    await userEvent.type(screen.getByLabelText("Buscar en el backlog"), "release");

    // Una sola columna, con su contador ya filtrado, y la cabecera diciendo
    // cuántas de cuántas quedaron.
    expect(rotulos()).toEqual(["Trabajo"]);
    expect(contadores()).toEqual(["1"]);
    expect(screen.getByText(/1 de 2 pendientes/)).toBeTruthy();
  });

  it("una búsqueda sin resultados lo dice, en vez de dejar el tablero vacío", async () => {
    await pintar([task(1, "Comprar pan", HOME.id)]);

    await userEvent.type(screen.getByLabelText("Buscar en el backlog"), "release");

    expect(columnas()).toHaveLength(0);
    expect(screen.getByText('Nada en el backlog dice "release".')).toBeTruthy();
  });

  it("limpiar la búsqueda devuelve los contextos vacíos", async () => {
    await pintar([task(1, "Comprar pan", HOME.id)]);

    await userEvent.type(screen.getByLabelText("Buscar en el backlog"), "pan");
    expect(rotulos()).toEqual(["Casa"]);

    await userEvent.click(screen.getByLabelText("Limpiar la búsqueda"));
    expect(rotulos()).toEqual(["Trabajo", "Casa"]);
  });

  it("la tarea que se cayó de un día lleva el badge de origen, como en el panel", async () => {
    await pintar([task(1, "Comprar pan", HOME.id)], [{ taskId: 1, fromDate: "2026-08-18" }]);

    const badge = document.querySelector(".backlog__from")!;
    expect(badge.textContent).toBe("Desde el 18 ago");
    // El badge va a caballo del borde de **su** card, no suelto en la lista.
    expect(badge.closest(".backlog__item")!.classList).toContain("has-from");
  });

  it("la que se guardó a propósito no lleva badge", async () => {
    await pintar([task(1, "Comprar pan", HOME.id)]);

    expect(document.querySelectorAll(".backlog__from")).toHaveLength(0);
  });

  it("la cabecera cuenta lo que hay, en singular", async () => {
    await pintar([task(1, "Comprar pan", HOME.id)]);

    expect(screen.getByText(/^1 pendiente$/)).toBeTruthy();
  });
});
