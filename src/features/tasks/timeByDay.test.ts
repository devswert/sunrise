import { describe, expect, it } from "vitest";
import type { TimeEntry } from "../../lib/types";
import { duracionCorta, tiempoPorDia } from "./timeByDay";

/** Entrada cerrada que arranca ese día a la hora local indicada. */
function entrada(over: {
  id?: number;
  dia: string;
  hora?: number;
  seconds: number;
  abierta?: boolean;
}): TimeEntry {
  const inicio = new Date(`${over.dia}T${String(over.hora ?? 9).padStart(2, "0")}:00:00`);
  return {
    id: over.id ?? 1,
    taskId: 1,
    startedAt: inicio.toISOString(),
    endedAt: over.abierta ? null : new Date(inicio.getTime() + over.seconds * 1000).toISOString(),
    seconds: over.seconds,
  };
}

describe("tiempoPorDia", () => {
  it("agrupa y suma por fecha, en orden", () => {
    const dias = tiempoPorDia([
      entrada({ id: 1, dia: "2026-08-12", seconds: 600 }),
      entrada({ id: 2, dia: "2026-08-11", seconds: 2700 }),
      entrada({ id: 3, dia: "2026-08-12", hora: 15, seconds: 900 }),
    ]);

    expect(dias).toEqual([
      { date: "2026-08-11", seconds: 2700 },
      { date: "2026-08-12", seconds: 1500 },
    ]);
  });

  it("agrupa por la fecha LOCAL, no cortando el timestamp UTC", () => {
    // Una corrida a las 21:00 en Chile se guarda como el día siguiente en UTC.
    // Cortar `startedAt.slice(0, 10)` la mandaría al día equivocado.
    const dias = tiempoPorDia([entrada({ dia: "2026-08-12", hora: 21, seconds: 600 })]);
    expect(dias).toEqual([{ date: "2026-08-12", seconds: 600 }]);
  });

  it("suma la corrida en curso al día de hoy", () => {
    const dias = tiempoPorDia(
      [entrada({ dia: "2026-08-11", seconds: 2700 })],
      120,
      "2026-08-13",
    );
    expect(dias).toEqual([
      { date: "2026-08-11", seconds: 2700 },
      { date: "2026-08-13", seconds: 120 },
    ]);
  });

  it("ignora la entrada abierta: su tiempo entra por `extraHoy`", () => {
    // Si se contara, se sumaría dos veces (o se contaría con `seconds = 0`).
    const dias = tiempoPorDia([entrada({ dia: "2026-08-13", seconds: 0, abierta: true })], 300, "2026-08-13");
    expect(dias).toEqual([{ date: "2026-08-13", seconds: 300 }]);
  });

  it("un día que queda en negativo por un ajuste se muestra en 0, no se esconde", () => {
    // El delta de un ajuste manual hacia abajo puede superar lo del día. Mostrar
    // "-13h" no significa nada, y borrar la fila escondería que ahí pasó algo.
    const dias = tiempoPorDia([
      entrada({ id: 1, dia: "2026-08-13", seconds: 600 }),
      entrada({ id: 2, dia: "2026-08-13", hora: 10, seconds: -5000 }),
    ]);
    expect(dias).toEqual([{ date: "2026-08-13", seconds: 0 }]);
  });

  it("aguanta un timestamp ilegible sin romper la lista", () => {
    const roto = { ...entrada({ dia: "2026-08-11", seconds: 60 }), startedAt: "cualquier cosa" };
    const dias = tiempoPorDia([roto, entrada({ id: 2, dia: "2026-08-12", seconds: 60 })]);
    expect(dias).toEqual([{ date: "2026-08-12", seconds: 60 }]);
  });
});

describe("duracionCorta", () => {
  it("formatea en unidades legibles", () => {
    expect(duracionCorta(0)).toBe("0m");
    expect(duracionCorta(45 * 60)).toBe("45m");
    expect(duracionCorta(90 * 60)).toBe("1h 30m");
    expect(duracionCorta(2 * 3600)).toBe("2h");
  });

  it("redondea al minuto más cercano", () => {
    expect(duracionCorta(89)).toBe("1m");
    expect(duracionCorta(29)).toBe("0m");
  });
});
