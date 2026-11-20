import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { addDays } from "date-fns";
// `?raw`: el CSS como texto, igual que `tokens.test.ts`. jsdom no aplica estilos,
// así que es la única forma de vigilar que la columna no se vuelva a apagar entera.
import weekCss from "./week.css?raw";
import { DayColumn, fadesInPast } from "./DayColumn";
import type { Task } from "../../lib/types";
import { parseISODate, toISODate, todayISO } from "../../lib/date";

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

/** Fechas relativas a hoy y no fijas: `isToday` mira el reloj de verdad. */
const shift = (days: number) => toISODate(addDays(parseISODate(todayISO()), days));

/** Las cuatro combinaciones que importan, en un mismo día. */
function dayTasks(date: string): Task[] {
  return [
    makeTask({ id: 1, title: "Manual pendiente", scheduledDate: date }),
    makeTask({ id: 2, title: "Manual completada", scheduledDate: date, status: "DONE" }),
    makeTask({ id: 3, title: "Reunión sin cerrar", scheduledDate: date, source: "CALENDAR" }),
    makeTask({
      id: 4,
      title: "Reunión cerrada",
      scheduledDate: date,
      source: "CALENDAR",
      status: "DONE",
    }),
  ];
}

function renderDay(date: string, isPast: boolean) {
  render(
    <DndContext>
      <DayColumn
        date={date}
        tasks={dayTasks(date)}
        categoryMap={new Map()}
        categories={[]}
        capacityTarget={480}
        capacityWarnRatio={0.85}
        onToggle={vi.fn()}
        isPast={isPast}
      />
    </DndContext>,
  );
}

const card = (title: string) => screen.getByText(title).closest(".task-card")!;

/**
 * En la semana, un día pasado no se apaga entero: se apagan el encabezado y lo
 * que ya no pide nada, y una tarea manual pendiente queda a contraste completo
 * (§4.3, #5). Las fixtures son propias y no la semilla del mock, porque cuáles de
 * sus días caen en el pasado depende del día en que corra la suite.
 */
describe("DayColumn · qué se apaga en un día pasado", () => {
  it("una tarea manual pendiente de un día pasado queda a contraste completo", () => {
    renderDay(shift(-1), true);
    expect(card("Manual pendiente")).not.toHaveClass("is-faded");
  });

  it("en un día pasado se apagan las completadas y las reuniones, cerradas o no", () => {
    renderDay(shift(-3), true);
    expect(card("Manual completada")).toHaveClass("is-faded");
    expect(card("Reunión sin cerrar")).toHaveClass("is-faded");
    expect(card("Reunión cerrada")).toHaveClass("is-faded");
  });

  it("el día pasado se marca en la columna, que es la que apaga el encabezado", () => {
    renderDay(shift(-1), true);
    const col = document.querySelector<HTMLElement>(".day-col")!;
    expect(col).toHaveClass("is-past");
    expect(col.querySelector(".day-col__head")).not.toBeNull();
  });

  it("hoy no se apaga nada", () => {
    renderDay(todayISO(), false);
    expect(document.querySelector(".day-col")).not.toHaveClass("is-past");
    expect(document.querySelectorAll(".task-card.is-faded")).toHaveLength(0);
  });

  it("un día futuro tampoco apaga nada", () => {
    renderDay(shift(2), false);
    expect(document.querySelector(".day-col")).not.toHaveClass("is-past");
    expect(document.querySelectorAll(".task-card.is-faded")).toHaveLength(0);
  });

  it("solo una tarea manual pendiente se libra del apagado", () => {
    // La regla sola, sin render: la decide el estado y el origen, no la hora.
    expect(fadesInPast(makeTask())).toBe(false);
    expect(fadesInPast(makeTask({ status: "DONE" }))).toBe(true);
    expect(fadesInPast(makeTask({ source: "CALENDAR" }))).toBe(true);
    // Una reunión que el calendario ya no trae sigue siendo una reunión.
    expect(fadesInPast(makeTask({ source: "CALENDAR", sourceState: "ORPHANED" }))).toBe(true);
  });
});

describe("week.css · el apagado de un día pasado", () => {
  /** El cuerpo de cada bloque `{ … }`, con su selector. */
  function blocks(): Array<{ selector: string; body: string }> {
    const out: Array<{ selector: string; body: string }> = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(weekCss))) {
      out.push({ selector: m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: m[2] });
    }
    return out;
  }

  it("la columna de un día pasado no se apaga entera", () => {
    // Si volviera la opacidad sobre la columna, la pendiente se apagaría con todo
    // lo demás y el resto de los tests seguiría en verde.
    const whole = blocks().filter((b) =>
      b.selector.split(",").some((s) => s.trim() === ".day-col.is-past"),
    );
    for (const b of whole) expect(b.body).not.toMatch(/opacity/);
  });

  it("se apagan el encabezado del día y las cards marcadas", () => {
    const sets = (sel: string) =>
      blocks().some(
        (b) => b.selector.split(",").some((s) => s.trim() === sel) && /opacity/.test(b.body),
      );
    expect(sets(".day-col.is-past .day-col__head")).toBe(true);
    expect(sets(".task-card.is-faded")).toBe(true);
  });
});
