import { describe, expect, it } from "vitest";
import type { LogDay } from "../../lib/types";
import { SettingKey } from "../../lib/settings";
import {
  highlights,
  visibleDays,
  dayStatus,
  isEmpty,
  segmentSeconds,
  shouldRemindShutdown,
  workedWithRunning,
} from "./dailyLog";

function day(parcial: Partial<LogDay> = {}): LogDay {
  return {
    date: "2026-08-12",
    note: null,
    closedAt: null,
    mood: null,
    cells: [],
    workedSeconds: 0,
    plannedMinutes: 0,
    unestimated: 0,
    done: [],
    timeline: [],
    ...parcial,
  };
}

describe("bitácora", () => {
  it("un día en blanco está vacío; con nota o con cierre, no", () => {
    expect(isEmpty(day())).toBe(true);
    expect(isEmpty(day({ note: "algo" }))).toBe(false);
    expect(isEmpty(day({ closedAt: "2026-08-12T21:00:00Z" }))).toBe(false);
    expect(isEmpty(day({ workedSeconds: 60 }))).toBe(false);
  });

  it("se saltan los días vacíos, pero nunca hoy", () => {
    // Esconder hoy dejaría la bitácora sin la entrada que se viene a escribir.
    const days = [
      day({ date: "2026-08-14" }),
      day({ date: "2026-08-13", workedSeconds: 600 }),
      day({ date: "2026-08-12" }),
    ];

    const visibles = visibleDays(days, "2026-08-14");
    expect(visibles.map((d) => d.date)).toEqual(["2026-08-14", "2026-08-13"]);
  });

  it("incluidas son las que tienen fila, aunque el resumen esté vacío", () => {
    // La cadena vacía es "incluida sin resumen" —el estado justo después de
    // apretar Incluir—, así que no puede quedar afuera.
    const done = [
      { task: { id: 1, title: "con resumen" } as never, note: "algo" },
      { task: { id: 2, title: "recién subida" } as never, note: "" },
      { task: { id: 3, title: "sin subir" } as never, note: null },
    ];

    const { shown, others } = highlights(day({ done }));
    expect(shown.map((h) => h.task.id)).toEqual([1, 2]);
    expect(others.map((h) => h.task.id)).toEqual([3]);
  });

  it("sin ninguna incluida salen todas", () => {
    // Una entrada vacía en un día en que sí trabajaste es peor que mostrar de más.
    const done = [
      { task: { id: 1, title: "a" } as never, note: null },
      { task: { id: 2, title: "b" } as never, note: null },
    ];

    const { shown, others } = highlights(day({ done }));
    expect(shown).toHaveLength(2);
    expect(others).toHaveLength(0);
  });

  it("sin cierre es borrador", () => {
    expect(dayStatus(day())).toBe("BORRADOR");
    expect(dayStatus(day({ closedAt: "2026-08-12T21:00:00Z" }))).toBe("CERRADO");
  });

  it("lo trabajado suma la corrida en curso, y solo si hay una", () => {
    // Los segundos de una entrada abierta todavía no están en la base: los tiene
    // el taxímetro. Sin esto, la tarea que estás haciendo ahora aparece en 0.
    const corriendo = day({
      workedSeconds: 600,
      timeline: [{ taskId: 1, title: "ésta", seconds: 600, running: true }],
    });
    expect(workedWithRunning(corriendo, 120)).toBe(720);

    const idle = day({
      workedSeconds: 600,
      timeline: [{ taskId: 1, title: "ésta", seconds: 600, running: false }],
    });
    expect(workedWithRunning(idle, 120)).toBe(600);
  });

  it("el tramo en curso crece; el cerrado no", () => {
    expect(segmentSeconds({ seconds: 0, running: true }, 90)).toBe(90);
    expect(segmentSeconds({ seconds: 300, running: false }, 90)).toBe(300);
  });
});

describe("tocaAvisarCierre", () => {
  const base = { workEnd: "18:00", values: {}, today: "2026-08-12", alreadyClosed: false };

  it("avisa recién pasada la hora de la jornada", () => {
    expect(shouldRemindShutdown({ ...base, nowHhmm: "17:59" })).toBe(false);
    expect(shouldRemindShutdown({ ...base, nowHhmm: "18:00" })).toBe(true);
    expect(shouldRemindShutdown({ ...base, nowHhmm: "21:30" })).toBe(true);
  });

  it("no avisa dos veces el mismo día", () => {
    const values = { [SettingKey.SHUTDOWN_NOTIFIED_ON]: "2026-08-12" };
    expect(shouldRemindShutdown({ ...base, nowHhmm: "19:00", values })).toBe(false);
    // Pero al día siguiente sí: la marca es una fecha, no un booleano, así que
    // una sesión abierta cruzando la medianoche vuelve a avisar.
    expect(shouldRemindShutdown({ ...base, nowHhmm: "19:00", values, today: "2026-08-13" })).toBe(
      true,
    );
  });

  it("no avisa si ya cerraste el día", () => {
    expect(shouldRemindShutdown({ ...base, nowHhmm: "19:00", alreadyClosed: true })).toBe(false);
  });

  it("apagado desde Configs no avisa, aunque la hora haya pasado", () => {
    const values = { [SettingKey.NOTICE_SHUTDOWN]: "0" };
    expect(shouldRemindShutdown({ ...base, nowHhmm: "19:00", values })).toBe(false);
  });

  it("sin la clave del switch sí avisa: este viene encendido de fábrica", () => {
    // Existía antes de que hubiera dónde apagarlo, así que una clave que falta no
    // puede significar que se apagó solo. Y con basura tampoco: no se inventa una
    // decisión, se cae en el default de la clave.
    expect(shouldRemindShutdown({ ...base, nowHhmm: "19:00", values: {} })).toBe(true);
    expect(
      shouldRemindShutdown({
        ...base,
        nowHhmm: "19:00",
        values: { [SettingKey.NOTICE_SHUTDOWN]: "sí" },
      }),
    ).toBe(true);
  });
});
