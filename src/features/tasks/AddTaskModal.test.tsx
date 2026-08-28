import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AddTaskModal } from "./AddTaskModal";
import { useAppStore } from "../../lib/store";
import { api } from "../../lib/ipc";

describe("AddTaskModal · el título es de una línea aunque el campo crezca", () => {
  beforeEach(() => {
    useAppStore.setState({ composeOpen: true, composeDefaults: {} });
  });

  it("Enter crea la tarea y no mete un salto de línea", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    const campo = await screen.findByPlaceholderText("Descripción de la tarea…");
    await user.click(campo);
    await user.keyboard("Escribir el informe{Enter}");

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].title).toBe("Escribir el informe");
  });

  // El campo es un `textarea`, así que un pegado multilínea sí puede meter un
  // `\n` — que después se vería como un corte raro dentro del recorte de la card.
  it("un pegado multilínea se aplana en una sola línea", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste("Revisar el informe\ny mandarlo el lunes");
    await user.click(screen.getByRole("button", { name: /Crear task/i }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].title).toBe("Revisar el informe y mandarlo el lunes");
  });

  // El link pegado en el título es la forma más rápida de guardar "esto hay que
  // mirarlo": sale del título y queda como recurso, que en las notas es una
  // sección `# Recursos:` — de ahí saca el detalle sus chips.
  it("un link pegado sale del título y queda como recurso", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste("Revisar el PR https://github.com/acme/repo/pull/12");
    await user.click(screen.getByRole("button", { name: /Crear task/i }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].title).toBe("Revisar el PR");
    expect(createTask.mock.calls[0][0].notes).toBe(
      "# Recursos:\n* https://github.com/acme/repo/pull/12",
    );
  });

  it("el recurso se puede quitar antes de crear", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste("Revisar el PR https://github.com/acme/repo/pull/12");

    await user.click(
      screen.getByRole("button", { name: "Quitar https://github.com/acme/repo/pull/12" }),
    );
    await user.click(screen.getByRole("button", { name: /Crear task/i }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].title).toBe("Revisar el PR");
    expect(createTask.mock.calls[0][0].notes).toBeUndefined();
  });

  it("dos links pegados quedan como dos ítems de la misma sección", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste("Comparar https://uno.example/a con https://dos.example/b");
    await user.click(screen.getByRole("button", { name: /Crear task/i }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].notes).toBe(
      "# Recursos:\n* https://uno.example/a\n* https://dos.example/b",
    );
  });

  it("un título sin links no inventa notas", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste("Escribir el informe");
    await user.click(screen.getByRole("button", { name: /Crear task/i }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].notes).toBeUndefined();
  });

  it("un título largo se guarda entero", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    const largo =
      "Revisar el informe trimestral de capacidad y dejarlo listo para la reunión del lunes";
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste(largo);
    await user.click(screen.getByRole("button", { name: /Crear task/i }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].title).toBe(largo);
  });
});
