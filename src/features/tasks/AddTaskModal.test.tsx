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
