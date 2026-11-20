import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Task, TimeEntry } from "../../lib/types";
import { useAppStore } from "../../lib/store";
import { TaskModal } from "./TaskModal";
import { Priority } from "../../lib/enums";

const startTimer = vi.fn(async () => {});
const stopTimer = vi.fn(async () => null);
const updateTask = vi.fn(async (_id: number, _patch: unknown) => null);
const listTimeEntries = vi.fn(async (): Promise<TimeEntry[]> => []);
const setTaskRailOnly = vi.fn(async (_id: number, _railOnly: boolean) => null);
const moveTask = vi.fn(async (_id: number, _date: string | null, _pos: number) => null);
const trashTask = vi.fn(async (_id: number) => true);
const restoreTask = vi.fn(async (_id: number) => null);

/** Entrada cerrada de `seconds` segundos que arranca ese día a las 09:00 local. */
function entry(id: number, day: string, seconds: number): TimeEntry {
  const start = new Date(`${day}T09:00:00`);
  return {
    id,
    taskId: 7,
    startedAt: start.toISOString(),
    endedAt: new Date(start.getTime() + seconds * 1000).toISOString(),
    seconds,
  };
}

/** Estado del timer que ve el modal. Se reemplaza por test. */
const TIMER_DETENIDO = {
  active: null as { taskId: number } | null,
  elapsed: 0,
  runTotal: 0,
  overEstimate: false,
  start: startTimer,
  stop: stopTimer,
  // Derivados de `active`, como en el store real: corre la que está en `active`.
  /** Lo de hoy por tarea, como `elapsedById` del store. */
  elapsedById: {} as Record<number, number>,
  /** Tareas que corren en paralelo además de `active`. */
  alsoRunning: [] as number[],
  isRunning: (taskId: number) =>
    estadoTimer.active?.taskId === taskId || estadoTimer.alsoRunning.includes(taskId),
  runTotalOf: (taskId: number) =>
    estadoTimer.active?.taskId === taskId ? estadoTimer.runTotal : 0,
};
let estadoTimer: typeof TIMER_DETENIDO = { ...TIMER_DETENIDO };

// `hms` real y no un doble: el test compara el texto que se muestra, así que un
// formateador de mentira probaría el doble en vez del componente.
vi.mock("../timer/useTimer", async () => {
  const real = await vi.importActual<typeof import("../timer/timerStore")>("../timer/timerStore");
  return { hms: real.hms, useTimer: () => estadoTimer };
});

vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    listTaskEvents: vi.fn(async () => []),
    listTimeEntries: () => listTimeEntries(),
    updateTask: (id: number, patch: unknown) => updateTask(id, patch),
    setTaskStatus: vi.fn(async () => null),
    setActualSeconds: vi.fn(async () => null),
    setTaskRailOnly: (id: number, railOnly: boolean) => setTaskRailOnly(id, railOnly),
    moveTask: (id: number, date: string | null, pos: number) => moveTask(id, date, pos),
    trashTask: (id: number) => trashTask(id),
    restoreTask: (id: number) => restoreTask(id),
  },
}));

const baseTask: Task = {
  id: 7,
  title: "Revisar PRs",
  notes: null,
  categoryId: null,
  objectiveId: null,
  priority: null,
  scheduledDate: "2026-08-11",
  scheduledTime: null,
  position: 0,
  estimatedMinutes: 60,
  actualSeconds: 0,
  status: "TODO",
  completedAt: null,
  source: "MANUAL",
  sourceState: "ACTIVE",
  feedId: null,
  calendarUid: null,
  eventStart: null,
  eventEnd: null,
  meetingUrl: null,
  eventDescription: null,
  attendees: [],
  railOnly: false,
  createdAt: "2026-08-11T09:00:00Z",
  updatedAt: "2026-08-11T09:00:00Z",
};

function renderModal(onClose = vi.fn(), task: Task = baseTask) {
  render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route
          path="/"
          element={
            <TaskModal
              task={task}
              categories={[]}
              objectives={[]}
              onClose={onClose}
              onChanged={vi.fn()}
            />
          }
        />
        <Route path="/focus" element={<div>VISTA FOCUS</div>} />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose };
}

describe("TaskModal · cerrar con ⌘Enter", () => {
  beforeEach(() => {
    updateTask.mockClear();
  });

  it("⌘Enter cierra el modal", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByLabelText("Título"));
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onClose).toHaveBeenCalled();
  });

  it("Ctrl+Enter también, para no atarlo a macOS", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByLabelText("Título"));
    await user.keyboard("{Control>}{Enter}{/Control}");

    expect(onClose).toHaveBeenCalled();
  });

  it("el modal toma el foco al abrirse", () => {
    // Abrir con el mouse dejaba el foco en la tarjeta de atrás, que lleva los
    // `listeners` de `useSortable`. El `KeyboardSensor` de dnd-kit arranca un
    // arrastre con Enter o Espacio **sin mirar los modificadores**, así que
    // ⌘Enter levantaba la tarjeta en vez de cerrar el modal.
    renderModal();

    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("⌘Enter cierra aunque el foco esté fuera del modal", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    // El foco fuera del modal es el estado real después de abrir con el mouse,
    // y también el que queda al hacer click en una zona no enfocable. Con el
    // handler colgado del div, el modal no era ancestro del `target` y la tecla
    // no llegaba: el atajo estaba muerto justo en el camino más común.
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(onClose).toHaveBeenCalled();
  });

  it("Escape cierra aunque el foco esté fuera del modal", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });
});

describe("TaskModal · ⌘Enter no pierde lo escrito", () => {
  beforeEach(() => {
    updateTask.mockClear();
  });

  it("guarda la edición pendiente sin esperar el debounce", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByLabelText("Título"));
    await user.keyboard(" urgente");

    // Esta aserción es lo que sostiene la de abajo: confirma que el debounce de
    // 500ms **todavía no venció**. Si la máquina fuera tan lenta que venciera,
    // el test falla acá en vez de pasar por el motivo equivocado. (Una primera
    // versión esperaba con `waitFor` y pasaba incluso sin el `flush`, porque
    // dejaba vencer el debounce sola.)
    expect(updateTask).not.toHaveBeenCalled();

    await user.keyboard("{Meta>}{Enter}{/Meta}");

    // Sin `await`: el guardado tiene que haber arrancado ya, no cuando venza el
    // temporizador que el cierre del modal iba a cancelar.
    expect(updateTask).toHaveBeenCalledWith(baseTask.id, { title: "Revisar PRs urgente" });
  });
});

describe("TaskModal · el título largo se lee entero", () => {
  beforeEach(() => {
    updateTask.mockClear();
  });

  it("el campo tiene el título completo, sin recortar", async () => {
    const largo =
      "Revisar el informe trimestral de capacidad y dejarlo listo para la reunión del lunes con el equipo";
    renderModal(vi.fn(), { ...baseTask, title: largo });

    expect(await screen.findByLabelText("Título")).toHaveValue(largo);
  });

  it("Enter no mete un salto de línea: el título es de una sola línea", async () => {
    const user = userEvent.setup();
    renderModal();

    const campo = screen.getByLabelText("Título");
    await user.click(campo);
    await user.keyboard("{Enter}ya");

    expect(campo).toHaveValue("Revisar PRsya");
  });
});

describe("TaskModal · ACTUAL siempre es el total", () => {
  beforeEach(() => {
    estadoTimer = { ...TIMER_DETENIDO };
    listTimeEntries.mockResolvedValue([]);
  });

  it("con el timer corriendo suma la corrida al acumulado, no lo reemplaza", async () => {
    // El caso del usuario: una tarea que viene de tres días con 2h40 encima.
    // Antes, darle play mostraba solo lo de hoy y el número *bajaba*, como si
    // se hubiera perdido el tiempo anterior.
    const carriedOver: Task = { ...baseTask, actualSeconds: 2 * 3600 + 40 * 60 };
    estadoTimer = {
      ...TIMER_DETENIDO,
      active: { taskId: carriedOver.id },
      elapsed: 30, // lo de HOY, que es lo que mostraba antes
      runTotal: 30,
    };

    renderModal(vi.fn(), carriedOver);

    expect(await screen.findByText("2:40:30")).toBeInTheDocument();
    expect(screen.queryByText("0:00:30")).toBeNull();
  });
});

describe("TaskModal · pasada del estimado con timers en paralelo", () => {
  const realValue = () =>
    screen.getByRole("button", { name: "Ajustar tiempo real" }).lastElementChild;

  it("no se pinta con el exceso de otra tarea que corre", async () => {
    // A (la 99) es `active` y se pasó; la del modal corre en paralelo y no.
    estadoTimer = {
      ...TIMER_DETENIDO,
      active: { taskId: 99 },
      overEstimate: true,
      alsoRunning: [baseTask.id],
      elapsedById: { 99: 3 * 3600, [baseTask.id]: 60 },
    };
    renderModal();
    await screen.findByRole("button", { name: "Pausar" });
    expect(realValue()).not.toHaveClass("is-over");
  });

  it("se pinta con el exceso propio aunque no sea la más antigua", async () => {
    estadoTimer = {
      ...TIMER_DETENIDO,
      active: { taskId: 99 },
      overEstimate: false,
      alsoRunning: [baseTask.id],
      elapsedById: { 99: 60, [baseTask.id]: 2 * 3600 },
    };
    renderModal();
    await screen.findByRole("button", { name: "Pausar" });
    expect(realValue()).toHaveClass("is-over");
  });
});

describe("TaskModal · tiempo por día", () => {
  beforeEach(() => {
    estadoTimer = { ...TIMER_DETENIDO };
    listTimeEntries.mockClear();
  });

  it("lista cuánto se trabajó cada día", async () => {
    // El caso del usuario: una tarea que viene arrastrándose tres días. Antes
    // solo se veía el total y no había forma de saber el reparto.
    listTimeEntries.mockResolvedValueOnce([
      entry(1, "2026-08-11", 45 * 60),
      entry(2, "2026-08-12", 90 * 60),
    ]);
    renderModal();

    expect(await screen.findByText("11 ago")).toBeInTheDocument();
    expect(screen.getByText("45m")).toBeInTheDocument();
    expect(screen.getByText("12 ago")).toBeInTheDocument();
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
  });

  it("no muestra la sección si la tarea no tiene tiempo registrado", async () => {
    listTimeEntries.mockResolvedValueOnce([]);
    renderModal();

    // Se espera a que el modal esté montado para no pasar por no haber cargado.
    expect(await screen.findByLabelText("Título")).toBeInTheDocument();
    expect(screen.queryByText("Tiempo por día")).toBeNull();
  });
});

describe("TaskModal · play", () => {
  beforeEach(() => {
    startTimer.mockClear();
    stopTimer.mockClear();
  });

  it("al iniciar el timer cierra el modal y navega a Focus", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: "Iniciar" }));

    await waitFor(() => expect(startTimer).toHaveBeenCalledWith(baseTask.id));
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText("VISTA FOCUS")).toBeInTheDocument();
  });

  it("el play en paralelo arranca sin cerrar el modal ni ir a Focus", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.click(screen.getByRole("button", { name: "Iniciar en paralelo" }));

    await waitFor(() => expect(startTimer).toHaveBeenCalledWith(baseTask.id, { parallel: true }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText("VISTA FOCUS")).toBeNull();
  });

  it("tras el play en paralelo el modal sigue abierto y muestra la pausa", async () => {
    const user = userEvent.setup();
    // El doble del store: arrancar marca la tarea como en curso y avisa, como el
    // `bumpData()` del store real (el modal escucha `dataVersion`).
    // Otra tarea (la 99) ya corre y es `active`; esta entra en paralelo.
    estadoTimer = { ...TIMER_DETENIDO, active: { taskId: 99 } };
    startTimer.mockImplementationOnce(async () => {
      estadoTimer = { ...TIMER_DETENIDO, active: { taskId: 99 }, alsoRunning: [baseTask.id] };
      useAppStore.getState().bumpData();
    });
    try {
      renderModal();
      await user.click(screen.getByRole("button", { name: "Iniciar en paralelo" }));
      expect(await screen.findByRole("button", { name: "Pausar" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Iniciar en paralelo" })).toBeNull();
    } finally {
      estadoTimer = { ...TIMER_DETENIDO };
    }
  });
});

/**
 * Un evento ignorado (§4.12) no es trabajo, así que el detalle esconde todo lo
 * que lo trataría como tal. El play es el que importa: sobre una tarea sin
 * tarjeta en ninguna columna dejaría el taxímetro corriendo donde no se puede
 * ver ni detener.
 */
describe("TaskModal · un evento ignorado", () => {
  const delCalendario = (railOnly: boolean): Task => ({
    ...baseTask,
    title: "Lunch",
    source: "CALENDAR",
    feedId: 1,
    calendarUid: "lunch@x#1",
    scheduledTime: "13:15",
    railOnly,
  });

  beforeEach(() => setTaskRailOnly.mockClear());

  it("esconde el play, completar y los dos ajustes de tiempo", async () => {
    renderModal(vi.fn(), delCalendario(true));
    // El modal carga historial y entradas al montar: se espera algo del render
    // final para no afirmar sobre un árbol a medio actualizar.
    expect(await screen.findByRole("switch", { name: "Ignorar este evento" })).toBeTruthy();

    expect(screen.queryByLabelText("Iniciar")).toBeNull();
    expect(screen.queryByLabelText("Marcar como completada")).toBeNull();
    expect(screen.queryByLabelText("Ajustar tiempo real")).toBeNull();
    expect(screen.queryByText("Estimado")).toBeNull();
  });

  it("sin ignorar, las acciones de trabajo están donde siempre", async () => {
    renderModal(vi.fn(), delCalendario(false));

    expect(await screen.findByLabelText("Iniciar")).toBeTruthy();
    expect(screen.getByLabelText("Marcar como completada")).toBeTruthy();
    expect(screen.getByLabelText("Ajustar tiempo real")).toBeTruthy();
  });

  it("el switch escribe la marca para toda la serie", async () => {
    renderModal(vi.fn(), delCalendario(false));

    await userEvent.click(screen.getByRole("switch", { name: "Ignorar este evento" }));

    expect(setTaskRailOnly).toHaveBeenCalledWith(7, true);
  });

  it("una tarea a mano no ofrece el switch", async () => {
    renderModal();
    expect(await screen.findByLabelText("Iniciar")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Ignorar este evento" })).toBeNull();
  });
});

describe("TaskModal · sacarle la fecha a una tarea", () => {
  beforeEach(() => {
    moveTask.mockClear();
    estadoTimer = { ...TIMER_DETENIDO };
  });

  // El contador de Backlog del sidebar no se entera por el `onChanged` de la
  // vista: escucha `dataVersion`. Sin el bump, la tarea aparecía en el backlog
  // con el badge todavía en el número viejo.
  it("avisa al resto de la app, para que el contador del sidebar se mueva", async () => {
    const antes = useAppStore.getState().dataVersion;
    renderModal();

    await userEvent.click(screen.getByText("Inicio"));
    await userEvent.click(await screen.findByText("Sin fecha (backlog)"));

    expect(moveTask).toHaveBeenCalledWith(7, null, 0);
    await waitFor(() => expect(useAppStore.getState().dataVersion).toBeGreaterThan(antes));
  });
});

describe("TaskModal · prioridad", () => {
  it('sin prioridad dice "ninguna", como el objetivo', () => {
    renderModal();

    expect(screen.getByText("Prioridad")).toBeInTheDocument();
    expect(screen.getByText("ninguna")).toBeInTheDocument();
  });

  it("elegir un nivel lo guarda y lo muestra", async () => {
    renderModal();

    await userEvent.click(screen.getByText("Prioridad"));
    await userEvent.click(screen.getByRole("button", { name: "P2" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(7, { priority: "P2" }));
    expect(document.querySelector(".prio-tag")).toHaveTextContent("P2");
  });

  it('"Sin prioridad" la quita, y eso viaja como null y no como ausencia', async () => {
    // Ausente en el patch significa "no tocar", así que quitar tiene que mandar
    // el `null` explícito o el nivel se quedaría puesto.
    renderModal(vi.fn(), { ...baseTask, priority: Priority.P1 });

    await userEvent.click(screen.getByText("Prioridad"));
    await userEvent.click(screen.getByRole("button", { name: "Sin prioridad" }));

    await waitFor(() => expect(updateTask).toHaveBeenCalledWith(7, { priority: null }));
  });

  /** La barra se lee de izquierda a derecha, y el orden pedido es prioridad → objetivo. */
  it("el selector va a la izquierda del de objetivos", () => {
    renderModal();

    const rotulos = [...document.querySelectorAll(".tmodal__meta-label")].map((e) => e.textContent);
    expect(rotulos.indexOf("Prioridad")).toBeLessThan(rotulos.indexOf("Objetivo"));
  });
});

describe("TaskModal · eliminar manda al basurero (#11)", () => {
  beforeEach(() => {
    trashTask.mockClear();
    restoreTask.mockClear();
    useAppStore.setState({ toast: null });
  });

  it("eliminar la manda al basurero, cierra y avisa con Deshacer", async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Eliminar tarea" }));
    expect(screen.getByText(/Queda 30 días en el basurero/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sí, eliminar" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(trashTask).toHaveBeenCalledWith(7);
    const toast = useAppStore.getState().toast;
    expect(toast?.text).toContain("Revisar PRs");
    expect(toast?.action?.label).toBe("Deshacer");

    await toast!.action!.run();
    expect(restoreTask).toHaveBeenCalledWith(7);
  });
});

