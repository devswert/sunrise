import { describe, expect, it } from "vitest";
import { computeCapacityLevel, dayCapacity, formatMinutes } from "./capacity";
import { CapacityLevel } from "./enums";
import type { Task } from "./types";

const DIA = "2026-08-17";
let ids = 0;

/** Un evento del calendario marcado "Ignorar como tarea", con hora local y duración. */
function ignored(time: string | null, minutes: number | null, over: Partial<Task> = {}): Task {
  ids += 1;
  return {
    id: ids,
    title: `Evento ${ids}`,
    notes: null,
    categoryId: null,
    objectiveId: null,
    priority: null,
    scheduledDate: DIA,
    scheduledTime: time,
    position: 0,
    estimatedMinutes: minutes,
    actualSeconds: 0,
    status: "TODO",
    completedAt: null,
    source: "CALENDAR",
    sourceState: "ACTIVE",
    feedId: 1,
    calendarUid: `uid-${ids}`,
    // A propósito en UTC y con otra hora: la capacidad no debe leerlos.
    eventStart: `${DIA}T03:00:00Z`,
    eventEnd: `${DIA}T04:00:00Z`,
    meetingUrl: null,
    eventDescription: null,
    attendees: [],
    railOnly: true,
    createdAt: `${DIA}T09:00:00Z`,
    updatedAt: `${DIA}T09:00:00Z`,
    ...over,
  };
}

describe("computeCapacityLevel", () => {
  const target = 480; // 8h

  it("es OK holgadamente bajo el objetivo", () => {
    expect(computeCapacityLevel(300, target)).toBe(CapacityLevel.OK);
  });

  it("es WARN al acercarse al objetivo (>= 85%)", () => {
    expect(computeCapacityLevel(408, target)).toBe(CapacityLevel.WARN); // 85%
    expect(computeCapacityLevel(480, target)).toBe(CapacityLevel.WARN); // 100%
  });

  it("es OVER al superar el objetivo", () => {
    expect(computeCapacityLevel(481, target)).toBe(CapacityLevel.OVER);
  });

  it("sin objetivo (<=0) siempre es OK", () => {
    expect(computeCapacityLevel(999, 0)).toBe(CapacityLevel.OK);
  });
});

describe("formatMinutes", () => {
  it("formatea H:MM", () => {
    expect(formatMinutes(0)).toBe("0:00");
    expect(formatMinutes(75)).toBe("1:15");
    expect(formatMinutes(135)).toBe("2:15");
  });
});

/**
 * Los casos exactos de la issue #8: la capacidad es la jornada menos la unión de
 * los ignorados de ese día, recortados a la jornada.
 */
describe("dayCapacity", () => {
  it("una jornada 09–18 sin ignorados da 540", () => {
    expect(dayCapacity("09:00", "18:00", [])).toBe(540);
  });

  it("un almuerzo de 13:00 a 14:15 resta 75 y deja 465", () => {
    expect(dayCapacity("09:00", "18:00", [ignored("13:00", 75)])).toBe(465);
  });

  it("un evento de 17:30 a 18:30 resta solo los 30 minutos de adentro", () => {
    expect(dayCapacity("09:00", "18:00", [ignored("17:30", 60)])).toBe(510);
  });

  it("un evento entero fuera de la jornada no resta", () => {
    expect(dayCapacity("09:00", "18:00", [ignored("07:00", 60), ignored("19:00", 30)])).toBe(540);
  });

  it("dos ignorados solapados restan la unión, no la suma", () => {
    // 13:00–14:00 y 13:30–14:30: la unión es 13:00–14:30, 90 minutos.
    expect(dayCapacity("09:00", "18:00", [ignored("13:30", 60), ignored("13:00", 60)])).toBe(450);
  });

  it("un evento de día completo no resta", () => {
    expect(dayCapacity("09:00", "18:00", [ignored(null, null)])).toBe(540);
  });

  it("ignorados que cubren la jornada dejan la capacidad en 0", () => {
    expect(dayCapacity("09:00", "18:00", [ignored("08:00", 300), ignored("12:30", 400)])).toBe(0);
  });

  it("una reunión no ignorada no resta: es carga, no hueco", () => {
    expect(dayCapacity("09:00", "18:00", [ignored("10:00", 60, { railOnly: false })])).toBe(540);
  });

  it("un ignorado sin duración no resta", () => {
    expect(dayCapacity("09:00", "18:00", [ignored("13:00", null)])).toBe(540);
  });

  it("una jornada invertida o ilegible da 0", () => {
    expect(dayCapacity("18:00", "09:00", [])).toBe(0);
    expect(dayCapacity("09:00", "09:00", [])).toBe(0);
    expect(dayCapacity("nueve", "18:00", [])).toBe(0);
  });

  it("con capacidad 0 el semáforo se apaga", () => {
    const cap = dayCapacity("09:00", "18:00", [ignored("09:00", 540)]);
    expect(cap).toBe(0);
    expect(computeCapacityLevel(999, cap)).toBe(CapacityLevel.OK);
  });
});
