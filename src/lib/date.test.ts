import { describe, expect, it } from "vitest";
import {
  dateLabel,
  isoWeekId,
  relativeTime,
  shortDate,
  isoWeekday,
  isoWeekdayLabel,
  threeWeeks,
  toISODate,
  toISOTimestamp,
  weekDates,
  weekdayLabel,
} from "./date";

describe("toISOTimestamp", () => {
  it("fecha y hora locales, sin zona", () => {
    expect(toISOTimestamp(new Date(2026, 7, 21, 0, 20))).toBe("2026-08-21T00:20");
    expect(toISOTimestamp(new Date(2026, 7, 21, 23, 59))).toBe("2026-08-21T23:59");
  });

  it("los primeros diez caracteres son el mismo día que `toISODate`", () => {
    // Es lo que hace comparable la marca del ritual contra el día de hoy. Con
    // `toISOString()` la fecha sería la de UTC, y las últimas horas de cada día
    // en Santiago quedarían marcadas como el día siguiente.
    const d = new Date(2026, 7, 21, 22, 30);
    expect(toISOTimestamp(d).slice(0, 10)).toBe(toISODate(d));
  });
});

describe("threeWeeks", () => {
  it("son tres semanas de 7, con la del ancla al medio", () => {
    const anchor = new Date("2026-08-12T12:00:00"); // miércoles
    const weeks = threeWeeks(anchor);

    expect(weeks).toHaveLength(3);
    expect(weeks.every((s) => s.length === 7)).toBe(true);
    // La del ancla es siempre `[1]`: de ahí sale el rótulo del bloque del medio.
    expect(weeks[1]).toEqual(weekDates(anchor));
    // El ancla cae el miércoles 12, cuya semana arranca el lunes 10.
    expect(weeks[0][0]).toBe("2026-08-03"); // lunes de la semana anterior
    expect(weeks[2][6]).toBe("2026-08-23"); // domingo de la siguiente
  });

  it("no se salta ni repite ningún día en el corte de mes", () => {
    const days = threeWeeks(new Date("2026-09-02T12:00:00")).flat();
    expect(new Set(days).size).toBe(21);
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(`${days[i - 1]}T12:00:00`);
      const current = new Date(`${days[i]}T12:00:00`);
      expect(Math.round((+current - +prev) / 86_400_000)).toBe(1);
    }
    expect(days).toContain("2026-08-31");
    expect(days).toContain("2026-09-01");
  });

  it("cruza el año sin inventar fechas", () => {
    const days = threeWeeks(new Date("2026-12-30T12:00:00")).flat();
    expect(days).toHaveLength(21);
    expect(days).toContain("2026-12-31");
    expect(days).toContain("2027-01-01");
  });

  it("cada semana arranca en lunes", () => {
    for (const week of threeWeeks(new Date("2026-08-16T12:00:00"))) {
      // Un domingo como ancla: `startOfISOWeek` lo mete en la semana que
      // arrancó el lunes anterior, no en la que empieza mañana.
      expect(isoWeekday(week[0])).toBe(1);
      expect(isoWeekday(week[6])).toBe(7);
    }
  });
});

describe("isoWeekday / isoWeekdayLabel", () => {
  it("lunes es 1 y domingo es 7", () => {
    expect(isoWeekday("2026-08-17")).toBe(1);
    expect(isoWeekday("2026-08-23")).toBe(7);
  });

  it("la etiqueta corta sale del locale", () => {
    expect(isoWeekdayLabel(1)).toBe("Lun");
    expect(isoWeekdayLabel(7)).toBe("Dom");
  });
});

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
