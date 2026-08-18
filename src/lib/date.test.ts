import { describe, expect, it } from "vitest";
import { dateLabel, isoWeekId, relativeTime, shortDate, weekDates, weekdayLabel } from "./date";

describe("weekDates", () => {
  it("devuelve lunes→domingo de la semana ISO", () => {
    // 2026-08-12 es miércoles; la semana ISO va del lun 10 al dom 16.
    const days = weekDates(new Date("2026-08-12T12:00:00"));
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-08-10");
    expect(days[6]).toBe("2026-08-16");
  });
});

describe("isoWeekId", () => {
  it("tiene formato YYYY-Www", () => {
    expect(isoWeekId(new Date("2026-08-12T12:00:00"))).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("es igual para días de la misma semana ISO", () => {
    const a = isoWeekId(new Date("2026-08-10T12:00:00"));
    const b = isoWeekId(new Date("2026-08-16T12:00:00"));
    expect(a).toBe(b);
  });
});

// Estas tres no tenían ningún test cuando estaban en inglés, así que traducirlas
// no rompió nada: el idioma de la UI no estaba fijado en ninguna parte.
describe("etiquetas en español", () => {
  it("weekdayLabel capitaliza el día, que en español viene en minúscula", () => {
    expect(weekdayLabel("2026-08-10")).toBe("Lunes");
  });

  it("dateLabel pone el día antes del mes", () => {
    // Con solo cambiar el locale y dejar "MMMM d" saldría "agosto 10".
    expect(dateLabel("2026-08-10")).toBe("10 de agosto");
  });

  it("shortDate abrevia el mes y va después del día", () => {
    expect(shortDate("2026-08-06")).toBe("6 ago");
  });
});

describe("relativeTime", () => {
  const ahora = new Date("2026-08-10T09:00:00Z");
  const hace = (iso: string) => relativeTime(iso, ahora);

  it("usa la unidad más grande que aplique", () => {
    expect(hace("2026-08-10T08:59:30Z")).toBe("recién");
    expect(hace("2026-08-10T08:30:00Z")).toBe("hace 30 min");
    expect(hace("2026-08-10T06:00:00Z")).toBe("hace 3 h");
    expect(hace("2026-08-06T09:00:00Z")).toBe("hace 4 d");
    expect(hace("2026-08-03T09:00:00Z")).toBe("hace 1 sem");
  });

  it("concuerda el singular y el plural", () => {
    expect(hace("2026-07-01T09:00:00Z")).toBe("hace 1 mes");
    expect(hace("2026-05-01T09:00:00Z")).toBe("hace 3 meses");
    expect(hace("2025-01-01T09:00:00Z")).toBe("hace 1 año");
    expect(hace("2023-01-01T09:00:00Z")).toBe("hace 3 años");
  });

  it("string vacío si la fecha no se entiende", () => {
    expect(hace("no es una fecha")).toBe("");
  });
});
