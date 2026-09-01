import { describe, expect, it } from "vitest";
import type { TimeEntry } from "../../lib/types";
import { shortDuration, timeByDay } from "./timeByDay";

/** Entrada cerrada que arranca ese día a la hora local indicada. */
function entry(over: {
  id?: number;
  day: string;
  hour?: number;
  seconds: number;
  abierta?: boolean;
}): TimeEntry {
  const start = new Date(`${over.day}T${String(over.hour ?? 9).padStart(2, "0")}:00:00`);
  return {
    id: over.id ?? 1,
    taskId: 1,
    startedAt: start.toISOString(),
    endedAt: over.abierta ? null : new Date(start.getTime() + over.seconds * 1000).toISOString(),
    seconds: over.seconds,
  };
}

describe("tiempoPorDia", () => {
  it("agrupa y suma por fecha, en orden", () => {
    const days = timeByDay([
      entry({ id: 1, day: "2026-08-12", seconds: 600 }),
      entry({ id: 2, day: "2026-08-11", seconds: 2700 }),
      entry({ id: 3, day: "2026-08-12", hour: 15, seconds: 900 }),
    ]);

    expect(days).toEqual([
      { date: "2026-08-11", seconds: 2700 },
      { date: "2026-08-12", seconds: 1500 },
    ]);
  });

  it("agrupa por la fecha LOCAL, no cortando el timestamp UTC", () => {
    // Una corrida a las 21:00 en Chile se guarda como el día siguiente en UTC.
    // Cortar `startedAt.slice(0, 10)` la mandaría al día equivocado.
    const days = timeByDay([entry({ day: "2026-08-12", hour: 21, seconds: 600 })]);
    expect(days).toEqual([{ date: "2026-08-12", seconds: 600 }]);
  });

  it("suma la corrida en curso al día de hoy", () => {
    const days = timeByDay([entry({ day: "2026-08-11", seconds: 2700 })], 120, "2026-08-13");
    expect(days).toEqual([
      { date: "2026-08-11", seconds: 2700 },
      { date: "2026-08-13", seconds: 120 },
    ]);
  });

  it("ignora la entrada abierta: su tiempo entra por `extraHoy`", () => {
    // Si se contara, se sumaría dos veces (o se contaría con `seconds = 0`).
    const days = timeByDay(
      [entry({ day: "2026-08-13", seconds: 0, abierta: true })],
      300,
      "2026-08-13",
    );
    expect(days).toEqual([{ date: "2026-08-13", seconds: 300 }]);
  });

  it("un día que queda en negativo por un ajuste se muestra en 0, no se esconde", () => {
    // El delta de un ajuste manual hacia abajo puede superar lo del día. Mostrar
    // "-13h" no significa nada, y borrar la fila escondería que ahí pasó algo.
    const days = timeByDay([
      entry({ id: 1, day: "2026-08-13", seconds: 600 }),
      entry({ id: 2, day: "2026-08-13", hour: 10, seconds: -5000 }),
    ]);
    expect(days).toEqual([{ date: "2026-08-13", seconds: 0 }]);
  });

  it("aguanta un timestamp ilegible sin romper la lista", () => {
    const roto = { ...entry({ day: "2026-08-11", seconds: 60 }), startedAt: "cualquier cosa" };
    const days = timeByDay([roto, entry({ id: 2, day: "2026-08-12", seconds: 60 })]);
    expect(days).toEqual([{ date: "2026-08-12", seconds: 60 }]);
  });
});

describe("duracionCorta", () => {
  it("formatea en unidades legibles", () => {
    expect(shortDuration(0)).toBe("0m");
    expect(shortDuration(45 * 60)).toBe("45m");
    expect(shortDuration(90 * 60)).toBe("1h 30m");
    expect(shortDuration(2 * 3600)).toBe("2h");
  });

  it("redondea al minuto más cercano", () => {
    expect(shortDuration(89)).toBe("1m");
    expect(shortDuration(29)).toBe("0m");
  });
});
