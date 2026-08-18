import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { Task, TimeEntry } from "../../lib/types";
import { TaskModal } from "./TaskModal";

const startTimer = vi.fn(async () => {});
const stopTimer = vi.fn(async () => null);
const updateTask = vi.fn(async (_id: number, _patch: unknown) => null);
const listTimeEntries = vi.fn(async (): Promise<TimeEntry[]> => []);

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
    moveTask: vi.fn(async () => null),
    deleteTask: vi.fn(async () => undefined),
  },
}));

const baseTask: Task = {
  id: 7,
  title: "Revisar PRs",
  notes: null,
  categoryId: null,
  objectiveId: null,
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
});
