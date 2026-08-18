import { describe, expect, it } from "vitest";
import type { Task } from "../../lib/types";
import { CapacityLevel } from "../../lib/enums";
import {
  mensajeDeCapacidad,
  resumenDelDia,
  repasoDelDia,
  ultimoDiaConTareas,
} from "./dailyPlan";

const DIA = "2026-08-17";

function task(over: Partial<Task> & { id: number }): Task {
  return {
    title: `Tarea ${over.id}`,
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

describe("resumenDelDia", () => {
  it("suma estimados y reparte entre pendiente y hecho", () => {
    const r = resumenDelDia(
      [
        task({ id: 1, estimatedMinutes: 60 }),
        task({ id: 2, estimatedMinutes: 30, status: "DONE" }),
        task({ id: 3, estimatedMinutes: 45 }),
      ],
      480,
      0.85,
    );
    expect(r.planificados).toBe(135);
    expect(r.pendientes).toBe(105);
    expect(r.total).toBe(3);
  });

  it("el semáforo pesa el día entero, no solo lo que queda", () => {
    // Completar tareas no puede ir apagando la alarma: el día siguió siendo
    // igual de largo, y si mañana se repite la carga hay que verlo.
    const tareas = [
      task({ id: 1, estimatedMinutes: 300, status: "DONE" }),
      task({ id: 2, estimatedMinutes: 300 }),
    ];
    const r = resumenDelDia(tareas, 480, 0.85);
    expect(r.planificados).toBe(600);
    expect(r.nivel).toBe(CapacityLevel.OVER);
    expect(r.holgura).toBe(-120);
  });

  it("cuenta las pendientes sin estimado en vez de inventarles duración", () => {
    const r = resumenDelDia(
      [
        task({ id: 1, estimatedMinutes: null }),
        task({ id: 2, estimatedMinutes: 0 }),
        // Una completada sin estimado ya no es un problema del día.
        task({ id: 3, estimatedMinutes: null, status: "DONE" }),
        task({ id: 4, estimatedMinutes: 60 }),
      ],
      480,
      0.85,
    );
    expect(r.sinEstimado).toBe(2);
    expect(r.planificados).toBe(60);
  });

  it("los comprometidos son los que tienen hora, completados o no", () => {
    const r = resumenDelDia(
      [
        task({ id: 1, scheduledTime: "10:00", estimatedMinutes: 30, source: "CALENDAR" }),
        task({ id: 2, scheduledTime: "15:00", estimatedMinutes: 60, status: "DONE" }),
        task({ id: 3, estimatedMinutes: 90 }),
      ],
      480,
      0.85,
    );
    expect(r.comprometidos).toBe(90);
    expect(r.planificados).toBe(180);
  });

  it("sin objetivo configurado no hay holgura, y eso no es holgura cero", () => {
    const r = resumenDelDia([task({ id: 1, estimatedMinutes: 60 })], 0, 0.85);
    expect(r.holgura).toBeNull();
    expect(r.nivel).toBe(CapacityLevel.OK);
  });

  it("un día vacío no está sobrecargado", () => {
    const r = resumenDelDia([], 480, 0.85);
    expect(r.planificados).toBe(0);
    expect(r.total).toBe(0);
    expect(r.nivel).toBe(CapacityLevel.OK);
    expect(r.holgura).toBe(480);
  });
});

describe("mensajeDeCapacidad", () => {
  it("un día vacío pide traer trabajo, no felicita", () => {
    expect(mensajeDeCapacidad(resumenDelDia([], 480, 0.85))).toMatch(/vac[íi]o/i);
  });

  it("dice cuánto te pasaste cuando el día no cabe", () => {
    const r = resumenDelDia([task({ id: 1, estimatedMinutes: 600 })], 480, 0.85);
    expect(mensajeDeCapacidad(r)).toContain("2 h");
  });

  it("dice cuánto queda libre cuando todavía cabe", () => {
    const r = resumenDelDia([task({ id: 1, estimatedMinutes: 60 })], 480, 0.85);
    expect(mensajeDeCapacidad(r)).toContain("7 h");
  });

  it("avisa cuando no hay objetivo en vez de inventar una holgura", () => {
    const r = resumenDelDia([task({ id: 1 })], 0, 0.85);
    expect(mensajeDeCapacidad(r)).toMatch(/sin objetivo/i);
  });
});

describe("ultimoDiaConTareas", () => {
  it("elige el día más reciente con algo, no el inmediatamente anterior", () => {
    // Un lunes, ayer es domingo y está vacío: lo que hay que revisar es el
    // viernes.
    const dias = [
      task({ id: 1, scheduledDate: "2026-08-14" }),
      task({ id: 2, scheduledDate: "2026-08-12" }),
    ];
    expect(ultimoDiaConTareas(dias, "2026-08-17")).toBe("2026-08-14");
  });

  it("ignora el día que se está planificando y lo que venga después", () => {
    const dias = [
      task({ id: 1, scheduledDate: "2026-08-17" }),
      task({ id: 2, scheduledDate: "2026-08-18" }),
      task({ id: 3, scheduledDate: "2026-08-15" }),
    ];
    expect(ultimoDiaConTareas(dias, "2026-08-17")).toBe("2026-08-15");
  });

  it("sin nada atrás devuelve null en vez de una fecha inventada", () => {
    expect(ultimoDiaConTareas([], "2026-08-17")).toBeNull();
    expect(ultimoDiaConTareas([task({ id: 1, scheduledDate: null })], "2026-08-17")).toBeNull();
  });
});

describe("repasoDelDia", () => {
  it("separa lo cerrado de lo que quedó abierto y suma el plan", () => {
    // La cuenta puede ser directa porque la degradación diaria preserva
    // justamente este día: nada se fue de acá sin que lo vieras.
    const r = repasoDelDia([
      task({ id: 1, status: "DONE", estimatedMinutes: 60 }),
      task({ id: 2, estimatedMinutes: 30 }),
      task({ id: 3, status: "DONE", estimatedMinutes: 15 }),
    ]);
    expect(r.cerradas.map((t) => t.id)).toEqual([1, 3]);
    expect(r.abiertas.map((t) => t.id)).toEqual([2]);
    expect(r.total).toBe(3);
    expect(r.planificados).toBe(105);
  });
});
