import { describe, expect, it } from "vitest";
import { historyByWeek, streak, weekIdsBackFrom } from "./objectiveHistory";
import type { Objective } from "../../lib/types";

function obj(isoWeek: string, completed: boolean, id = Math.random()): Objective {
  return { id, isoWeek, title: `o${id}`, position: 0, completed, categoryId: null };
}

describe("histórico de objetivos", () => {
  it("las semanas van de la más vieja a la más nueva y terminan en la del ancla", () => {
    // El ancla es un miércoles a mediodía: ni el día de la semana ni la hora
    // pueden correr el rango.
    const ids = weekIdsBackFrom(new Date("2026-08-12T12:00:00"), 4);
    expect(ids).toEqual(["2026-W30", "2026-W31", "2026-W32", "2026-W33"]);
  });

  it("una semana sin objetivos igual aparece, en cero", () => {
    // Saltearla haría ver como continua una racha que tuvo un hueco.
    const filas = historyByWeek(
      ["2026-W30", "2026-W31"],
      [obj("2026-W31", true, 1), obj("2026-W31", false, 2)],
    );
    expect(filas).toEqual([
      { isoWeek: "2026-W30", total: 0, done: 0 },
      { isoWeek: "2026-W31", total: 2, done: 1 },
    ]);
  });

  it("la racha cuenta hacia atrás desde la última semana y se corta al primer incumplido", () => {
    const racha = streak([
      { isoWeek: "2026-W29", total: 2, done: 2 },
      { isoWeek: "2026-W30", total: 3, done: 1 },
      { isoWeek: "2026-W31", total: 2, done: 2 },
      { isoWeek: "2026-W32", total: 1, done: 1 },
    ]);
    expect(racha).toBe(2);
  });

  it("una semana sin objetivos corta la racha en vez de regalarla", () => {
    // Con `total === 0` la condición "todos cumplidos" es verdadera por vacuidad,
    // y eso le daría una racha perfecta a quien no se propuso nada.
    expect(
      streak([
        { isoWeek: "2026-W30", total: 2, done: 2 },
        { isoWeek: "2026-W31", total: 0, done: 0 },
      ]),
    ).toBe(0);
  });
});
