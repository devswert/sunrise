import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CalendarFeed, Category } from "../../lib/types";
import { FeedsCard } from "./FeedsCard";
import { useCalendarSync } from "../../lib/calendarSync";

const feeds: CalendarFeed[] = [];
const createCalendarFeed = vi.fn(
  async (
    name: string,
    icsUrl: string,
    defaultCategoryId: number | null,
    pollMinutes: number,
  ): Promise<CalendarFeed> => {
    const f: CalendarFeed = {
      id: feeds.length + 1,
      name,
      icsUrl,
      defaultCategoryId,
      importAsTasks: true,
      pollMinutes: Math.max(2, pollMinutes),
      lastSyncedAt: null,
      lastError: null,
    };
    feeds.push(f);
    return f;
  },
);
const syncCalendarFeed = vi.fn(async (_id: number) => 3);
const syncCalendarFeeds = vi.fn(async (_forzar?: boolean) => feeds.length);
const deleteCalendarFeed = vi.fn(async (_id: number) => {});
const updateCalendarFeed = vi.fn(async () => null);

vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    listCalendarFeeds: async () => feeds.map((f) => ({ ...f })),
    createCalendarFeed: (n: string, u: string, c: number | null, p: number) =>
      createCalendarFeed(n, u, c, p),
    updateCalendarFeed: () => updateCalendarFeed(),
    deleteCalendarFeed: (id: number) => deleteCalendarFeed(id),
    syncCalendarFeed: (id: number) => syncCalendarFeed(id),
    syncCalendarFeeds: (force?: boolean) => syncCalendarFeeds(force),
    listCategories: async (): Promise<Category[]> => [],
  },
}));

const categories: Category[] = [
  { id: 1, parentId: null, name: "Meetings", color: "sage", position: 0, archived: false },
];

function conFeed(over: Partial<CalendarFeed> = {}) {
  feeds.length = 0;
  feeds.push({
    id: 1,
    name: "Trabajo",
    icsUrl: "https://cal.example/secreto.ics",
    defaultCategoryId: null,
    importAsTasks: true,
    pollMinutes: 5,
    lastSyncedAt: null,
    lastError: null,
    ...over,
  });
}

describe("FeedsCard", () => {
  beforeEach(() => {
    feeds.length = 0;
    createCalendarFeed.mockClear();
    syncCalendarFeed.mockClear();
    syncCalendarFeeds.mockClear();
    deleteCalendarFeed.mockClear();
    useCalendarSync.setState({ sincronizando: false, ultimaSync: null, feeds: 0 });
  });

  it("sin calendarios ofrece agregar el primero", async () => {
    render(<FeedsCard categories={categories} />);
    expect(
      await screen.findByRole("button", { name: /Agregar calendario/ }),
    ).toBeInTheDocument();
  });

  it("el alta es un modal y pide todos los datos de una vez", async () => {
    // Inline era peor por una razón concreta: con cuatro campos y autosave al
    // salir de cada uno, cualquier orden de llenado guardaba a medias.
    const user = userEvent.setup();
    render(<FeedsCard categories={categories} />);

    await user.click(await screen.findByRole("button", { name: /Agregar calendario/ }));
    expect(screen.getByRole("dialog", { name: "Agregar calendario" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Nombre del calendario"), "Trabajo");
    await user.type(
      screen.getByLabelText("URL del calendario"),
      "https://cal.example/secreto.ics",
    );
    await user.click(screen.getByRole("button", { name: "Agregar" }));

    await waitFor(() =>
      expect(createCalendarFeed).toHaveBeenCalledWith(
        "Trabajo",
        "https://cal.example/secreto.ics",
        null,
        5, // POLL_DEFAULT
      ),
    );
  });

  it("no se puede agregar sin URL", async () => {
    // Un feed sin URL no tiene nada que sincronizar: en vez de guardarlo y que
    // falle en cada pasada del poller, el botón queda deshabilitado.
    const user = userEvent.setup();
    render(<FeedsCard categories={categories} />);

    await user.click(await screen.findByRole("button", { name: /Agregar calendario/ }));
    await user.type(screen.getByLabelText("Nombre del calendario"), "Sin URL");

    expect(screen.getByRole("button", { name: "Agregar" })).toBeDisabled();
  });

  it("la URL no se muestra en claro", async () => {
    // Es la dirección secreta del calendario, o sea una credencial: esta
    // pantalla termina en screenshots y en pantallas compartidas.
    const user = userEvent.setup();
    render(<FeedsCard categories={categories} />);
    await user.click(await screen.findByRole("button", { name: /Agregar calendario/ }));

    expect(screen.getByLabelText("URL del calendario")).toHaveAttribute("type", "password");
  });

  it("sincroniza un feed a pedido", async () => {
    const user = userEvent.setup();
    conFeed();
    render(<FeedsCard categories={categories} />);

    await user.click(await screen.findByLabelText("Sincronizar Trabajo"));

    await waitFor(() => expect(syncCalendarFeed).toHaveBeenCalledWith(1));
  });

  it("con una sync en curso, los botones quedan bloqueados", async () => {
    // El estado es compartido con el botón de la vista semana: si uno corre, el
    // otro no puede lanzar una segunda pasada encima.
    conFeed();
    render(<FeedsCard categories={categories} />);
    const button = await screen.findByLabelText("Sincronizar Trabajo");

    useCalendarSync.setState({ sincronizando: true });

    await waitFor(() => expect(button).toBeDisabled());
  });

  it("un feed con error lo dice, en vez de parecer que nunca se sincronizó", async () => {
    // El modo de falla que esto evita: una URL revocada deja `lastSyncedAt`
    // puesto y sin `lastError` la fila se vería idéntica a una sana.
    conFeed({
      lastSyncedAt: "2026-08-13T10:00:00Z",
      lastError: "el feed rechazó la credencial (401/403): revisa la URL secreta",
    });
    render(<FeedsCard categories={categories} />);

    expect(await screen.findByText(/rechazó la credencial/)).toBeInTheDocument();
  });

  it("quitar un feed pide confirmación", async () => {
    const user = userEvent.setup();
    conFeed();
    render(<FeedsCard categories={categories} />);

    await user.click(await screen.findByLabelText("Quitar Trabajo"));
    expect(deleteCalendarFeed).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sí, quitar" }));
    await waitFor(() => expect(deleteCalendarFeed).toHaveBeenCalledWith(1));
  });

  it("la URL no se puede editar desde la lista", async () => {
    // Es lo que identifica al feed, y editarla en un campo `password` con
    // autosave es la receta para apuntar a otro calendario sin darse cuenta.
    conFeed();
    render(<FeedsCard categories={categories} />);
    await screen.findByLabelText("Nombre de Trabajo");

    expect(screen.queryByLabelText("URL del calendario")).toBeNull();
  });
});
