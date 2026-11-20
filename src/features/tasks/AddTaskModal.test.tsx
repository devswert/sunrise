import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// #9: el chip dibujaba el ícono `#` **y** el texto `#nombre`, y un nombre que ya
// traía su numeral terminaba en "# ##nombre".
describe("AddTaskModal · el chip del canal lleva un solo numeral", () => {
  afterEach(() => vi.restoreAllMocks());

  it("con canal elegido muestra #nombre una vez y sin ícono", async () => {
    vi.spyOn(api, "listCategories").mockResolvedValue([
      { id: 1, parentId: null, name: "Projects", color: "apricot", position: 0, archived: false },
      { id: 2, parentId: 1, name: "#Deploys", color: "sky", position: 0, archived: false },
    ]);
    useAppStore.setState({ composeOpen: true, composeDefaults: { categoryId: 2 } });
    render(<AddTaskModal />);

    const chip = await screen.findByRole("button", { name: "#Deploys" });
    expect(screen.getAllByText("#Deploys")).toHaveLength(1);
    expect(chip.querySelector("svg")).toBeNull();
  });

  it("sin canal queda el ícono # tenue junto a la palabra", async () => {
    useAppStore.setState({ composeOpen: true, composeDefaults: {} });
    render(<AddTaskModal />);

    const chip = await screen.findByRole("button", { name: "canal" });
    expect(chip.querySelector("svg")).not.toBeNull();
  });
});

describe("AddTaskModal · el cursor se queda donde se está escribiendo", () => {
  beforeEach(() => {
    useAppStore.setState({ composeOpen: true, composeDefaults: {} });
  });

  /** Abre el modal con `text` ya escrito y el cursor en `pos`. */
  async function withCaret(text: string, pos: number) {
    const user = userEvent.setup();
    render(<AddTaskModal />);
    const field = (await screen.findByPlaceholderText(
      "Descripción de la tarea…",
    )) as HTMLTextAreaElement;
    await user.click(field);
    await user.paste(text);
    field.setSelectionRange(pos, pos);
    return { user, field };
  }

  it("insertar un espacio en la mitad no manda el cursor al final", async () => {
    const { user, field } = await withCaret("Si tengoesta frase", 8);
    await user.keyboard(" ");

    expect(field.value).toBe("Si tengo esta frase");
    expect(field.selectionStart).toBe(9);
  });

  // El espacio tecleado justo antes de otro no se junta mientras el cursor está
  // ahí: juntarlo pegaba la palabra siguiente a la que venía ("tengoyesta").
  it("escribir una palabra antes de un espacio no la pega a la siguiente", async () => {
    const { user, field } = await withCaret("Si tengo esta frase", 8);
    await user.keyboard(" y");

    expect(field.value).toBe("Si tengo y esta frase");
    expect(field.selectionStart).toBe(10);
  });

  // El doble espacio que quedó sin palabra se junta al crear, como siempre.
  it("un doble espacio que quedó en el título se guarda como uno", async () => {
    const createTask = vi.spyOn(api, "createTask");
    const { user } = await withCaret("Si tengo esta frase", 8);
    await user.keyboard(" ");

    await user.click(screen.getByRole("button", { name: /Crear task/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].title).toBe("Si tengo esta frase");
  });

  // Si la limpieza deja el título igual al de antes, React no vuelve a dibujar y
  // el cursor quedaba donde lo dejó el DOM: al final.
  it("una limpieza que deja el título igual también repone el cursor", async () => {
    const { user, field } = await withCaret("Si tengo esta frase", 13);
    // El salto pegado se aplana en el espacio que ya estaba: el título no cambia.
    await user.paste("\n");

    expect(field.value).toBe("Si tengo esta frase");
    expect(field.selectionStart).toBe(14);
  });

  it("borrar un carácter en la mitad deja el cursor donde estaba", async () => {
    const { user, field } = await withCaret("Si tengoa esta frase", 9);
    await user.keyboard("{Backspace}");

    expect(field.value).toBe("Si tengo esta frase");
    expect(field.selectionStart).toBe(8);
  });

  // Mientras el cursor está pegado al final de la URL se la sigue escribiendo:
  // en la mitad del título siempre hay un espacio después, y sin esta regla el
  // link se cosecharía a la primera letra después de `https://`.
  it("un link escrito en la mitad se cosecha al cerrarlo y el cursor queda en su lugar", async () => {
    const createTask = vi.spyOn(api, "createTask");
    const { user, field } = await withCaret("Revisar el PR mañana", 13);
    await user.keyboard(" https://x.dev/1");

    expect(field.value).toBe("Revisar el PR https://x.dev/1 mañana");
    expect(field.selectionStart).toBe(29);

    await user.keyboard(" ");
    expect(field.value).toBe("Revisar el PR mañana");
    expect(field.selectionStart).toBe(14);
    expect(screen.getByRole("button", { name: "Quitar https://x.dev/1" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /Crear task/i }));
    await waitFor(() => expect(createTask).toHaveBeenCalled());
    expect(createTask.mock.calls[0][0].title).toBe("Revisar el PR mañana");
    expect(createTask.mock.calls[0][0].notes).toBe("# Recursos:\n* https://x.dev/1");
  });

  it("pegar un link en la mitad deja el cursor después de lo pegado", async () => {
    const { user, field } = await withCaret("Revisar el PR mañana", 13);
    await user.paste(" y https://x.dev/1");

    expect(field.value).toBe("Revisar el PR y mañana");
    expect(field.selectionStart).toBe(15);
    expect(screen.getByRole("button", { name: "Quitar https://x.dev/1" })).toBeTruthy();
  });

  // Lo pegado reemplaza lo seleccionado, y el cursor queda después de lo pegado.
  it("pegar un link sobre una selección deja el cursor después de lo pegado", async () => {
    const { user, field } = await withCaret("Revisar el PR mañana", 8);
    field.setSelectionRange(8, 13);
    await user.paste("ese https://x.dev/1");

    expect(field.value).toBe("Revisar ese mañana");
    expect(field.selectionStart).toBe(11);
  });

  // El espacio con el que empieza lo pegado al principio se recorta, y el
  // cursor no puede quedar contándolo.
  it("pegar al principio con espacios delante descuenta el recorte", async () => {
    const { user, field } = await withCaret("mañana", 0);
    await user.paste("  ver https://x.dev/1 ");

    expect(field.value).toBe("vermañana");
    expect(field.selectionStart).toBe(3);
  });
});

describe("AddTaskModal · ⌘Enter doble", () => {
  beforeEach(() => {
    useAppStore.setState({ composeOpen: true, composeDefaults: {} });
  });
  afterEach(() => vi.restoreAllMocks());

  /**
   * `create()` espera a la base antes de cerrar, y el segundo ⌘Enter cae en ese
   * hueco: el modal todavía no empezó a salir, así que su tecla sigue viva.
   */
  it("crea una sola tarea", async () => {
    const user = userEvent.setup();
    const original = api.createTask.bind(api);
    const createTask = vi.spyOn(api, "createTask").mockImplementation(async (draft) => {
      await new Promise((r) => setTimeout(r, 30));
      return original(draft);
    });
    render(<AddTaskModal />);

    await user.click(await screen.findByPlaceholderText("Descripción de la tarea…"));
    await user.keyboard("Una sola vez");
    await user.keyboard("{Meta>}{Enter}{Enter}{/Meta}");

    await waitFor(() => expect(useAppStore.getState().composeOpen).toBe(false));
    expect(createTask).toHaveBeenCalledOnce();
  });
});
