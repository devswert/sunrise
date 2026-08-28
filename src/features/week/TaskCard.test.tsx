import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { TaskCard } from "./TaskCard";
import type { Task } from "../../lib/types";
import { Priority } from "../../lib/enums";

function makeTask(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Demo task",
    notes: null,
    categoryId: null,
    objectiveId: null,
    priority: null,
    scheduledDate: "2026-08-10",
    scheduledTime: null,
    position: 0,
    estimatedMinutes: 30,
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
    createdAt: "2026-08-10T09:00:00Z",
    updatedAt: "2026-08-10T09:00:00Z",
    ...over,
  };
}

function renderCard(task: Task, onToggle = vi.fn(), onOpen = vi.fn()) {
  render(
    <DndContext>
      <SortableContext items={[`task-${task.id}`]}>
        <TaskCard task={task} category={null} onToggle={onToggle} onOpen={onOpen} />
      </SortableContext>
    </DndContext>,
  );
  return { onToggle, onOpen };
}

describe("TaskCard", () => {
  it("muestra título y estimado", () => {
    renderCard(makeTask());
    expect(screen.getByText("Demo task")).toBeInTheDocument();
    expect(screen.getByText("0:30")).toBeInTheDocument();
  });

  // El recorte a dos líneas es CSS y jsdom no lo aplica; lo que sí se puede
  // sostener acá es que el texto entero sigue disponible para leerlo.
  it("un título largo queda completo en el tooltip", () => {
    const largo =
      "Revisar el informe trimestral de capacidad y dejarlo listo para la reunión del lunes";
    renderCard(makeTask({ title: largo }));
    expect(screen.getByText(largo)).toHaveAttribute("title", largo);
  });

  it("el check dispara onToggle sin abrir el detalle", async () => {
    const user = userEvent.setup();
    const { onToggle, onOpen } = renderCard(makeTask());
    await user.click(
      screen.getByRole("button", { name: "Marcar como completada" }),
    );
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("una tarea DONE se marca visualmente", () => {
    renderCard(makeTask({ status: "DONE" }));
    const card = screen.getByText("Demo task").closest(".task-card");
    expect(card).toHaveClass("is-done");
    expect(
      screen.getByRole("button", { name: "Marcar como pendiente" }),
    ).toBeInTheDocument();
  });
});

describe("TaskCard · origen calendario", () => {
  it("una tarea colgada de un objetivo lleva su marca, sin el nombre", () => {
    // El nombre del objetivo compite con el título de la tarea en una card de
    // 200px; de cuál se trata es una pregunta del detalle.
    renderCard(makeTask({ objectiveId: 7 }));
    expect(screen.getByLabelText("Cuelga de un objetivo")).toBeInTheDocument();
  });

  it("una tarea sin objetivo no lleva ningún relleno en su lugar", () => {
    // No es un placeholder: un glifo apagado en cada card sería una columna de
    // marcas que no dicen nada, que es el problema que ya tuvo el chip de canal.
    renderCard(makeTask());
    expect(screen.queryByLabelText("Cuelga de un objetivo")).toBeNull();
  });

  it("una reunión importada se distingue de una tarea escrita a mano", () => {
    // Una reunión no se planifica igual: no la puedes achicar ni moverla sin
    // avisarle a alguien. El icono lo dice sin ocupar una línea.
    renderCard(makeTask({ source: "CALENDAR", scheduledTime: "16:00" }));
    expect(screen.getByLabelText("Viene del calendario")).toBeInTheDocument();
    // El icono va junto a la hora, no al título: la hora es justamente lo que no
    // se puede tocar en una reunión.
    expect(screen.getByText("16:00")).toBeInTheDocument();
  });

  it("una tarea normal no lo lleva", () => {
    renderCard(makeTask({ scheduledTime: "16:00" }));
    expect(screen.queryByLabelText("Viene del calendario")).toBeNull();
  });

  it("un evento de día completo igual se marca, aunque no tenga hora", () => {
    // Al mover el icono junto a la hora, un evento sin hora perdía su marca de
    // origen por completo. La fila aparece igual y dice "todo el día".
    renderCard(makeTask({ source: "CALENDAR", scheduledTime: null }));
    expect(screen.getByLabelText("Viene del calendario")).toBeInTheDocument();
    expect(screen.getByText("todo el día")).toBeInTheDocument();
  });

  it("la prioridad se ve en la card, con su punto de color", () => {
    renderCard(makeTask({ priority: Priority.P2 }));

    const marca = document.querySelector(".prio-tag");
    expect(marca).toHaveTextContent("P2");
    expect(marca!.querySelector<HTMLElement>(".prio-tag__dot")!.style.background).toBe(
      "var(--prio-p2)",
    );
  });

  /**
   * Y no un punto gris con un guion: es una marca que está o no está, igual que
   * la banderita del objetivo. Por eso tampoco depende de `hidePlaceholders`.
   */
  it("sin prioridad no dibuja nada", () => {
    renderCard(makeTask({ priority: null }));

    expect(document.querySelector(".prio-tag")).toBeNull();
  });
});