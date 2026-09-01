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

// --- Lo que pasa mientras se escribe -----------------------------------------
// El modal se usa en medio de una reunión: la frase se escribe entera y se le da
// Enter. Todo lo que se pueda deducir de la frase tiene que estar puesto ya.
describe("AddTaskModal · los chips se llenan solos", () => {
  beforeEach(() => {
    useAppStore.setState({ composeOpen: true, composeDefaults: {} });
  });

  it("el tiempo estimado sale del título", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste("Reunión con el equipo");

    expect(await screen.findByRole("button", { name: "0:30" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Crear task/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].estimatedMinutes).toBe(30);
  });

  // Escrito a mano y no pegado: en una reunión se teclea, y esa es la ruta que
  // pasa por `onChange` (la del pegado es otra).
  it("el canal sale del título, y la etiqueta no se guarda dos veces", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.keyboard("Actualizar el changelog #docs");

    await user.click(screen.getByRole("button", { name: /Crear task/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    // 3 es Docs en el mock.
    expect(createTask.mock.calls[0][0].categoryId).toBe(3);
    expect(createTask.mock.calls[0][0].title).toBe("Actualizar el changelog");
  });

  // La sugerencia es una función del título de ahora, no un acumulado: si la
  // palabra que la justificaba ya no está, el chip tiene que volver a vacío.
  it("borrar la palabra que la justificaba borra la sugerencia", async () => {
    const user = userEvent.setup();
    render(<AddTaskModal />);

    const campo = await screen.findByPlaceholderText("Descripción de la tarea…");
    await user.click(campo);
    await user.paste("Reunión");
    expect(await screen.findByRole("button", { name: "0:30" })).toBeTruthy();

    await user.clear(campo);
    await user.paste("Ver eso con Ana");
    expect(await screen.findByRole("button", { name: "--:--" })).toBeTruthy();
  });

  // Lo importante de la función: una sugerencia que pisa lo que acabás de elegir
  // deja de ser ayuda.
  it("lo elegido a mano no lo pisa una sugerencia posterior", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    const campo = await screen.findByPlaceholderText("Descripción de la tarea…");
    await user.click(campo);
    await user.paste("Ver eso con Ana");

    await user.click(screen.getByRole("button", { name: "--:--" }));
    await user.click(await screen.findByRole("option", { name: /1:00/ }));

    await user.click(campo);
    await user.paste(" en la reunión del lunes");

    await user.click(screen.getByRole("button", { name: /Crear task/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].estimatedMinutes).toBe(60);
  });

  // El modal abierto desde una columna de canal ya sabe cuál es: adivinarle
  // encima sería pisar al que lo abrió.
  it("el canal que viene por defecto tampoco se pisa", async () => {
    useAppStore.setState({ composeOpen: true, composeDefaults: { categoryId: 2 } });
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste("Actualizar el changelog #docs");

    await user.click(screen.getByRole("button", { name: /Crear task/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].categoryId).toBe(2);
  });
});

describe("AddTaskModal · el resto de la barra", () => {
  beforeEach(() => {
    useAppStore.setState({ composeOpen: true, composeDefaults: {} });
  });

  // Es el único modal donde el click al pasar borra texto que no existe en
  // ningún otro lado.
  it("el click afuera no cierra ni borra lo escrito", async () => {
    const user = userEvent.setup();
    render(<AddTaskModal />);

    const campo = await screen.findByPlaceholderText("Descripción de la tarea…");
    await user.click(campo);
    await user.paste("Escribir el informe");

    const overlay = document.querySelector(".compose-overlay") as HTMLElement;
    await user.click(overlay);

    expect(useAppStore.getState().composeOpen).toBe(true);
    expect((campo as HTMLTextAreaElement).value).toBe("Escribir el informe");
  });

  // El corolario del click bloqueado: Escape pasó a ser la única salida, y el
  // click en el overlay deja el foco en el `body` — con el handler colgado del
  // div del modal la tecla quedaba muerta y no había forma de cerrar.
  it("Escape cierra aunque el foco se haya ido al body", async () => {
    const user = userEvent.setup();
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.click(document.querySelector(".compose-overlay") as HTMLElement);
    await user.keyboard("{Escape}");

    expect(useAppStore.getState().composeOpen).toBe(false);
  });

  it("la prioridad elegida se guarda con la tarea", async () => {
    const user = userEvent.setup();
    const createTask = vi.spyOn(api, "createTask");
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.paste("Escribir el informe");

    await user.click(screen.getByRole("button", { name: /prioridad/i }));
    await user.click(await screen.findByRole("button", { name: "P1" }));

    await user.click(screen.getByRole("button", { name: /Crear task/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].priority).toBe("P1");
  });

  // Con una fecha ya puesta, quitarla no es un estado sino un destino.
  it("el atajo del calendario dice a dónde va la tarea", async () => {
    const user = userEvent.setup();
    render(<AddTaskModal />);

    await user.click(await screen.findByRole("button", { name: /Hoy/ }));
    expect(await screen.findByRole("button", { name: "Al backlog" })).toBeTruthy();
  });
});
