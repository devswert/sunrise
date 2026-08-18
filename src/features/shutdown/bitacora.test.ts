import { describe, expect, it } from "vitest";
import type { DiaDeBitacora } from "../../lib/types";
import { SettingKey } from "../../lib/settings";
import {
  destacadas,
  diasVisibles,
  estadoDelDia,
  estaVacio,
  segundosDelTramo,
  tocaAvisarCierre,
  trabajadoConEnCurso,
} from "./bitacora";

function dia(parcial: Partial<DiaDeBitacora> = {}): DiaDeBitacora {
  return {
    date: "2026-08-12",
    note: null,
    closedAt: null,
    mood: null,
    celdas: [],
    workedSeconds: 0,
    plannedMinutes: 0,
    sinEstimar: 0,
    hechas: [],
    timeline: [],
    ...parcial,
  };
}

describe("bitácora", () => {
  it("un día en blanco está vacío; con nota o con cierre, no", () => {
    expect(estaVacio(dia())).toBe(true);
    expect(estaVacio(dia({ note: "algo" }))).toBe(false);
    expect(estaVacio(dia({ closedAt: "2026-08-12T21:00:00Z" }))).toBe(false);
    expect(estaVacio(dia({ workedSeconds: 60 }))).toBe(false);
  });

  it("se saltan los días vacíos, pero nunca hoy", () => {
    // Esconder hoy dejaría la bitácora sin la entrada que se viene a escribir.
    const dias = [
      dia({ date: "2026-08-14" }),
      dia({ date: "2026-08-13", workedSeconds: 600 }),
      dia({ date: "2026-08-12" }),
    ];

    const visibles = diasVisibles(dias, "2026-08-14");
    expect(visibles.map((d) => d.date)).toEqual(["2026-08-14", "2026-08-13"]);
  });

  it("incluidas son las que tienen fila, aunque el resumen esté vacío", () => {
    // La cadena vacía es "incluida sin resumen" —el estado justo después de
    // apretar Incluir—, así que no puede quedar afuera.
    const hechas = [
      { task: { id: 1, title: "con resumen" } as never, note: "algo" },
      { task: { id: 2, title: "recién subida" } as never, note: "" },
      { task: { id: 3, title: "sin subir" } as never, note: null },
    ];

    const { mostradas, otras } = destacadas(dia({ hechas }));
    expect(mostradas.map((h) => h.task.id)).toEqual([1, 2]);
    expect(otras.map((h) => h.task.id)).toEqual([3]);
  });

  it("sin ninguna incluida salen todas", () => {
    // Una entrada vacía en un día en que sí trabajaste es peor que mostrar de más.
    const hechas = [
      { task: { id: 1, title: "a" } as never, note: null },
      { task: { id: 2, title: "b" } as never, note: null },
    ];

    const { mostradas, otras } = destacadas(dia({ hechas }));
    expect(mostradas).toHaveLength(2);
    expect(otras).toHaveLength(0);
  });

  it("sin cierre es borrador", () => {
    expect(estadoDelDia(dia())).toBe("BORRADOR");
    expect(estadoDelDia(dia({ closedAt: "2026-08-12T21:00:00Z" }))).toBe("CERRADO");
  });

  it("lo trabajado suma la corrida en curso, y solo si hay una", () => {
    // Los segundos de una entrada abierta todavía no están en la base: los tiene
    // el taxímetro. Sin esto, la tarea que estás haciendo ahora aparece en 0.
    const corriendo = dia({
      workedSeconds: 600,
      timeline: [{ taskId: 1, title: "ésta", seconds: 600, running: true }],
    });
    expect(trabajadoConEnCurso(corriendo, 120)).toBe(720);

    const quieto = dia({
      workedSeconds: 600,
      timeline: [{ taskId: 1, title: "ésta", seconds: 600, running: false }],
    });
    expect(trabajadoConEnCurso(quieto, 120)).toBe(600);
  });

  it("el tramo en curso crece; el cerrado no", () => {
    expect(segundosDelTramo({ seconds: 0, running: true }, 90)).toBe(90);
    expect(segundosDelTramo({ seconds: 300, running: false }, 90)).toBe(300);
  });
});

describe("tocaAvisarCierre", () => {
  const base = { workEnd: "18:00", values: {}, hoy: "2026-08-12", yaCerrado: false };

  it("avisa recién pasada la hora de la jornada", () => {
    expect(tocaAvisarCierre({ ...base, nowHhmm: "17:59" })).toBe(false);
    expect(tocaAvisarCierre({ ...base, nowHhmm: "18:00" })).toBe(true);
    expect(tocaAvisarCierre({ ...base, nowHhmm: "21:30" })).toBe(true);
  });

  it("no avisa dos veces el mismo día", () => {
    const values = { [SettingKey.SHUTDOWN_NOTIFIED_ON]: "2026-08-12" };
    expect(tocaAvisarCierre({ ...base, nowHhmm: "19:00", values })).toBe(false);
    // Pero al día siguiente sí: la marca es una fecha, no un booleano, así que
    // una sesión abierta cruzando la medianoche vuelve a avisar.
    expect(tocaAvisarCierre({ ...base, nowHhmm: "19:00", values, hoy: "2026-08-13" })).toBe(true);
  });

  it("no avisa si ya cerraste el día", () => {
    expect(tocaAvisarCierre({ ...base, nowHhmm: "19:00", yaCerrado: true })).toBe(false);
  });
});
