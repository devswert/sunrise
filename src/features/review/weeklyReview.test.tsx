import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Donut } from "../../components/Donut";
import type { Category, Task, WeeklyRollup } from "../../lib/types";
import {
  barsByDay,
  closedByDay,
  hours,
  hoursFromMinutes,
  byContext,
  ceilingInMinutes,
} from "./weeklyReview";

const DIAS = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
];

const cats: Category[] = [
  { id: 1, parentId: null, name: "Trabajo", color: "sky", position: 0, archived: false },
  { id: 2, parentId: 1, name: "Dev", color: "mint", position: 0, archived: false },
  { id: 3, parentId: 1, name: "Soporte", color: "lavender", position: 1, archived: false },
];
const catMap = new Map(cats.map((c) => [c.id, c]));

function rollup(parcial: Partial<WeeklyRollup> = {}): WeeklyRollup {
  return {
    weekStart: DIAS[0],
    days: DIAS.map((date) => ({
      date,
      seconds: 0,
      plannedMinutes: 0,
      done: 0,
      unestimated: 0,
    })),
    cells: [],
    completedTasks: [],
    totalSeconds: 0,
    plannedMinutes: 0,
    unestimated: 0,
    objectiveSeconds: 0,
    byObjective: [],
    ...parcial,
  };
}

describe("weeklyReview", () => {
  it("agrupa el donut por contexto, no por channel", () => {
    // Dev y Soporte cuelgan de Trabajo: el donut muestra una sola porción.
    const r = rollup({
      cells: [
        { date: DIAS[1], categoryId: 2, contextId: 1, seconds: 3600 },
        { date: DIAS[1], categoryId: 3, contextId: 1, seconds: 1800 },
      ],
    });

    const donut = byContext(r, catMap);
    expect(donut).toHaveLength(1);
    expect(donut[0].name).toBe("Trabajo");
    expect(donut[0].seconds).toBe(5400);
    expect(donut[0].color).toBe("var(--sky)");
  });

  it("las barras sí separan por channel, de mayor a menor", () => {
    const r = rollup({
      cells: [
        { date: DIAS[1], categoryId: 3, contextId: 1, seconds: 1800 },
        { date: DIAS[1], categoryId: 2, contextId: 1, seconds: 3600 },
      ],
    });

    const [, martes] = barsByDay(r, catMap);
    expect(martes.segments.map((s) => s.name)).toEqual(["Dev", "Soporte"]);
  });

  it("el tiempo sin channel tiene su propio grupo", () => {
    // Descartarlo dejaría el donut sin sumar el total de la semana.
    const r = rollup({
      cells: [{ date: DIAS[0], categoryId: null, contextId: null, seconds: 600 }],
      totalSeconds: 600,
    });

    const donut = byContext(r, catMap);
    expect(donut[0].name).toBe("Sin channel");
    expect(donut[0].seconds).toBe(600);
  });

  it("una categoría borrada no se traga sus horas", () => {
    const r = rollup({
      cells: [{ date: DIAS[0], categoryId: 99, contextId: 99, seconds: 900 }],
    });

    expect(byContext(r, catMap).reduce((a, s) => a + s.seconds, 0)).toBe(900);
  });

  it("la escala es de la semana, no de cada día", () => {
    // Con una escala por día, un sábado de 20 minutos se vería igual de alto
    // que un martes de 8 horas.
    const r = rollup({
      days: DIAS.map((date, i) => ({
        date,
        seconds: i === 1 ? 8 * 3600 : 0,
        plannedMinutes: 0,
        done: 0,
        unestimated: 0,
      })),
    });

    expect(ceilingInMinutes(barsByDay(r, catMap))).toBe(480);
  });

  it("la escala nunca baja de una hora", () => {
    // Si no, cinco minutos de trabajo pintan la barra hasta el techo.
    expect(ceilingInMinutes(barsByDay(rollup(), catMap))).toBe(60);
  });

  it("formatea horas y minutos sin ceros de adorno", () => {
    expect(hours(0)).toBe("0m");
    expect(hours(2700)).toBe("45m");
    expect(hours(3600)).toBe("1h");
    expect(hours(27000)).toBe("7h 30m");
    expect(hoursFromMinutes(90)).toBe("1h 30m");
  });

  it("agrupa lo cerrado por el día local en que se cerró", () => {
    // A las 22:00 locales el timestamp UTC ya es del día siguiente en Chile:
    // cortar el string mandaría la tarea a la columna equivocada.
    const cierre = new Date(2026, 7, 12, 22, 30);
    const t = { id: 1, title: "tarde", completedAt: cierre.toISOString() } as Task;

    const por = closedByDay(rollup({ completedTasks: [t] }));
    expect(por.get("2026-08-12")?.map((x) => x.title)).toEqual(["tarde"]);
    expect(por.get("2026-08-13")).toEqual([]);
  });
});

describe("Donut", () => {
  it("las porciones son contiguas y cubren la vuelta entera", () => {
    // El donut es a mano: si el acumulado se calcula al revés o con otro signo,
    // las porciones se pisan o dejan huecos, y eso no se ve en un test de
    // agregación.
    const segments = [
      { key: "a", name: "A", color: "var(--mint)", seconds: 3600 },
      { key: "b", name: "B", color: "var(--sky)", seconds: 1800 },
      { key: "c", name: "C", color: "var(--rose)", seconds: 1800 },
    ];
    const { container } = render(<Donut segments={segments} total={7200} />);

    const arcos = [...container.querySelectorAll("circle")];
    const C = 2 * Math.PI * 42;
    const largos = arcos.map((c) => Number(c.getAttribute("stroke-dasharray")!.split(" ")[0]));
    const offsets = arcos.map((c) => Number(c.getAttribute("stroke-dashoffset")));

    expect(largos.reduce((a, b) => a + b, 0)).toBeCloseTo(C, 5);
    // Cada porción arranca donde terminó la anterior. La primera, arriba.
    expect(offsets[0]).toBe(0);
    expect(offsets[1]).toBeCloseTo(-largos[0], 5);
    expect(offsets[2]).toBeCloseTo(-(largos[0] + largos[1]), 5);
  });

  it("sin tiempo no dibuja nada", () => {
    const { container } = render(<Donut segments={[]} total={0} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
