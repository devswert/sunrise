import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category, Task } from "../../lib/types";
import { CalendarRail } from "./CalendarRail";

const DIA = "2026-08-17";
/** Un día distinto de `DIA`, para que el rail no se considere "hoy". */
const OTRO_DIA = "2026-08-20";

function task(over: Partial<Task> & { id: number; title: string }): Task {
  return {
    notes: null,
    categoryId: null,
    objectiveId: null,
    scheduledDate: DIA,
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
    createdAt: `${DIA}T09:00:00Z`,
    updatedAt: `${DIA}T09:00:00Z`,
    ...over,
  };
}

/**
 * Por defecto renderiza un día que **no es hoy**. En el día de hoy la proyección
 * arranca en la hora del reloj, así que estos tests pasarían o fallarían según
 * la hora a la que se corran —de noche no queda día por delante y no se proyecta
 * nada—. Lo que depende de "hoy" se monta aparte, más abajo.
 */
function renderRail(tasks: Task[], over: { date?: string; today?: string } = {}) {
  const onOpen = vi.fn();
  const categoryMap = new Map<number, Category>();
  render(
    <CalendarRail
      date={over.date ?? DIA}
      today={over.today ?? OTRO_DIA}
      tasks={tasks}
      categoryMap={categoryMap}
      workStart="09:00"
      workEnd="18:00"
      onOpen={onOpen}
    />,
  );
  return { onOpen };
}

describe("CalendarRail", () => {
  it("muestra la reunión con su hora y abre el detalle al clickearla", async () => {
    const { onOpen } = renderRail([
      task({ id: 7, title: "Weekly de equipo", scheduledTime: "10:00", estimatedMinutes: 60 }),
    ]);

    const block = screen.getByRole("button", { name: /Weekly de equipo/ });
    expect(block).toHaveTextContent("10:00 AM");

    await userEvent.click(block);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  it("un evento de día completo va a la franja de arriba, no a la grilla", () => {
    renderRail([
      task({
        id: 1,
        title: "Feriado",
        source: "CALENDAR",
        scheduledTime: null,
        estimatedMinutes: null,
      }),
    ]);
    // Aparece, pero sin hora: no tiene dónde caer en la escala del día.
    const chip = screen.getByRole("button", { name: "Feriado" });
    expect(chip).toHaveClass("rail__chip");
  });

  it("una tarea sin hora se proyecta, marcada como proyección", () => {
    // El rail proyecta el día completo, no solo lo comprometido. Pero un bloque
    // proyectado tiene que verse distinto: la hora la puso el rail, no el
    // usuario, y confundirlos sería peor que no mostrarlo.
    renderRail([task({ id: 1, title: "Escribir el informe", estimatedMinutes: 60 })]);
    const block = screen.getByRole("button", { name: /Escribir el informe/ });
    expect(block).toHaveClass("is-proyectado");
    expect(block).toHaveAttribute("title", expect.stringContaining("proyectado"));
  });

  it("una tarea partida deja los dos tramos, marcados 1/2 y 2/2", () => {
    // Sin la clave compuesta React se quedaría con un solo bloque, y sin la
    // marca los dos se leerían como tareas distintas con el mismo título.
    const { onOpen } = renderRail([
      task({
        id: 9,
        title: "Weekly",
        source: "CALENDAR",
        scheduledTime: "09:30",
        estimatedMinutes: 60,
      }),
      task({ id: 1, title: "Escribir el informe", position: 0, estimatedMinutes: 60 }),
    ]);

    const segments = screen.getAllByRole("button", { name: /Escribir el informe/ });
    expect(segments).toHaveLength(2);
    expect(segments[0]).toHaveTextContent("1/2");
    expect(segments[1]).toHaveTextContent("2/2");

    // Los dos abren la misma tarea.
    return userEvent.click(segments[1]).then(() => {
      expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    });
  });

  it("el día sin nada muestra el vacío", () => {
    renderRail([]);
    expect(screen.getByText(/El día está en blanco/)).toBeInTheDocument();
  });

  it("la línea de 'ahora' solo se dibuja en el día de hoy", () => {
    const conHora = [task({ id: 1, title: "Daily", scheduledTime: "09:30", estimatedMinutes: 15 })];

    const today = render(<Rail tasks={conHora} date={DIA} today={DIA} />);
    expect(today.container.querySelector(".rail__ahora")).not.toBeNull();
    today.unmount();

    // En otro día la línea mentiría: marcaría una hora que no es de ese día.
    const otro = render(<Rail tasks={conHora} date={OTRO_DIA} today={DIA} />);
    expect(otro.container.querySelector(".rail__ahora")).toBeNull();
  });
});

/** El rail con la jornada completa visible, para que "ahora" caiga dentro. */
function Rail({ tasks, date, today }: { tasks: Task[]; date: string; today: string }) {
  return (
    <CalendarRail
      date={date}
      today={today}
      tasks={tasks}
      categoryMap={new Map<number, Category>()}
      workStart="00:00"
      workEnd="23:59"
    />
  );
}
