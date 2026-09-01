import { describe, expect, it } from "vitest";
import { describeTaskEvent, extractLinks, taskEventLine } from "./history";
import type { TaskEvent } from "../../lib/types";

function ev(over: Partial<TaskEvent>): TaskEvent {
  return {
    id: 1,
    taskId: 1,
    type: "CREATED",
    fromDate: null,
    toDate: null,
    at: "2026-08-03T09:00:00Z",
    ...over,
  };
}

describe("describeTaskEvent", () => {
  it("CREATED es impersonal: no dice quién la creó", () => {
    // Hubo un sujeto al frente de cada línea —primero un nombre hardcodeado,
    // después un "Tú"— y leído en fila sonaba a robot. La app es de un solo
    // usuario y sin autenticación: no tiene a quién nombrar, y no le hace falta.
    expect(describeTaskEvent(ev({ type: "CREATED" }))).toBe("Se creó la tarea");
  });

  it("ninguna línea empieza con un pronombre", () => {
    // Vale para todos los tipos, para que agregar uno nuevo con "Tú …" falle
    // acá en vez de aparecer suelto en el historial.
    const tipos = ["CREATED", "START_DATE_SET", "MOVED", "CARRIED_OVER"] as const;
    for (const type of tipos) {
      const line = describeTaskEvent(ev({ type, fromDate: "2026-08-05", toDate: "2026-08-06" }));
      // `\s` y no `\b`: en JS `\b` se define con [A-Za-z0-9_], así que después
      // de la "ú" no hay frontera de palabra y la primera versión de este test
      // pasaba igual con "Tú creaste esta tarea".
      expect(line).not.toMatch(/^(Tú|Tu)\s/);
    }
  });

  it("describe START_DATE_SET con fecha corta", () => {
    expect(describeTaskEvent(ev({ type: "START_DATE_SET", toDate: "2026-08-06" }))).toBe(
      "Moviste la fecha de inicio al 6 ago",
    );
  });

  it("describe MOVED como cambio de start date", () => {
    expect(
      describeTaskEvent(ev({ type: "MOVED", fromDate: "2026-08-03", toDate: "2026-08-06" })),
    ).toBe("Moviste la fecha de inicio al 6 ago");
  });

  it("distingue el arrastre automático de un movimiento a mano", () => {
    const line = describeTaskEvent(
      ev({ type: "CARRIED_OVER", fromDate: "2026-08-05", toDate: "2026-08-06" }),
    );
    // De dónde venía, que es lo que uno quiere saber al ver la tarea hoy.
    expect(line).toContain("5 ago");
    // Y con la app como sujeto explícito: no fuiste tú quien la movió, y decir
    // lo contrario haría inútil tener un evento aparte.
    expect(line).toContain("sunrise");
    expect(line).not.toContain("Moviste");
  });

  it("sin fecha destino dice que se fue al backlog", () => {
    // No es la plantilla con la palabra "backlog" metida donde iba la fecha:
    // "Moviste la fecha de inicio al backlog" no significa nada.
    expect(describeTaskEvent(ev({ type: "MOVED", fromDate: "2026-08-05", toDate: null }))).toBe(
      "Moviste la tarea al backlog",
    );
  });
});

describe("taskEventLine", () => {
  it("agrega la antigüedad relativa", () => {
    const now = new Date("2026-08-10T09:00:00Z");
    const line = taskEventLine(ev({ at: "2026-08-03T09:00:00Z" }), now);
    expect(line).toBe("Se creó la tarea · hace 1 sem");
  });

  it("usa días cuando es reciente", () => {
    const now = new Date("2026-08-10T09:00:00Z");
    const line = taskEventLine(ev({ at: "2026-08-06T09:00:00Z" }), now);
    expect(line).toBe("Se creó la tarea · hace 4 d");
  });
});

describe("extractLinks", () => {
  it("extrae y deduplica URLs", () => {
    const links = extractLinks("ver https://a.com y https://b.com y https://a.com");
    expect(links).toEqual(["https://a.com", "https://b.com"]);
  });
  it("vacío para null", () => {
    expect(extractLinks(null)).toEqual([]);
  });
});
