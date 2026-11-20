import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../lib/store";
import { Toast, TOAST_MS } from "../../components/Toast";
import { TrashPanel } from "./TrashPanel";

/** Vacía el basurero del mock entre tests restaurando lo que quede. */
async function emptyTrash() {
  for (const t of await api.listTrash()) await api.restoreTask(t.task.id);
}

describe("basurero · mockDb (#11)", () => {
  beforeEach(emptyTrash);

  it("mandar al basurero la saca de las listas y restaurar la devuelve", async () => {
    const dia = await api.createTask({ title: "del día", scheduledDate: "2031-03-03" });
    const back = await api.createTask({ title: "del backlog" });

    expect(await api.trashTask(dia.id)).toBe(true);
    expect(await api.trashTask(back.id)).toBe(true);
    expect(await api.trashTask(dia.id)).toBe(false);

    expect((await api.listTasksForDate("2031-03-03")).map((t) => t.id)).not.toContain(dia.id);
    expect((await api.listBacklog()).map((t) => t.id)).not.toContain(back.id);
    const trash = await api.listTrash();
    expect(trash.map((t) => t.task.title)).toEqual(["del backlog", "del día"]);
    // Se elimina sola a los 30 días.
    const { deletedAt, purgeAt } = trash[0];
    expect(new Date(purgeAt).getTime() - new Date(deletedAt).getTime()).toBe(30 * 86_400_000);

    const vuelta = await api.restoreTask(dia.id);
    expect(vuelta?.scheduledDate).toBe("2031-03-03");
    expect((await api.listTasksForDate("2031-03-03")).map((t) => t.id)).toContain(dia.id);
    expect(await api.restoreTask(dia.id)).toBeNull();
  });
});

describe("TrashPanel (#11)", () => {
  beforeEach(emptyTrash);

  it("sin nada, dice que está vacío", async () => {
    render(<TrashPanel onClose={vi.fn()} />);
    expect(await screen.findByText("El basurero está vacío.")).toBeInTheDocument();
  });

  it("lista lo eliminado y lo restaura", async () => {
    const t = await api.createTask({ title: "Escribir informe", scheduledDate: "2031-03-04" });
    await api.trashTask(t.id);
    render(<TrashPanel onClose={vi.fn()} />);

    expect(await screen.findByText("Escribir informe")).toBeInTheDocument();
    expect(screen.getByText(/se elimina el/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Restaurar Escribir informe" }));

    await waitFor(() => expect(screen.queryByText("Escribir informe")).toBeNull());
    expect((await api.listTasksForDate("2031-03-04")).map((x) => x.id)).toContain(t.id);
  });
});

describe("Toast (#11)", () => {
  beforeEach(() => useAppStore.setState({ toast: null }));
  afterEach(() => vi.useRealTimers());

  it("la acción corre y cierra el aviso", async () => {
    const run = vi.fn();
    render(<Toast />);
    act(() =>
      useAppStore.getState().showToast({ text: "Se fue", action: { label: "Deshacer", run } }),
    );

    expect(screen.getByRole("status")).toHaveTextContent("Se fue");
    await userEvent.click(screen.getByRole("button", { name: "Deshacer" }));

    expect(run).toHaveBeenCalledOnce();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("se cierra solo pasado su plazo", () => {
    vi.useFakeTimers();
    render(<Toast />);
    act(() => useAppStore.getState().showToast({ text: "Se fue" }));
    expect(screen.getByRole("status")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(TOAST_MS));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
