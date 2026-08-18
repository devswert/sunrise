import { describe, expect, it } from "vitest";
import { toISODate } from "../../lib/date";
import { anchorAfterDayChange } from "./anchor";

/** Semana ISO del 10 al 16 de agosto de 2026 (lunes a domingo). */
const SEMANA = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
];

describe("anclaTrasCambioDeDia", () => {
  it("sigue al día nuevo cuando cruza a la semana siguiente", () => {
    // Dormir el domingo, despertar el lunes: la vista se quedaría en la semana
    // pasada para siempre.
    const fresh = anchorAfterDayChange(SEMANA, "2026-08-16", "2026-08-17");
    expect(fresh).not.toBeNull();
    expect(toISODate(fresh!)).toBe("2026-08-17");
  });

  it("no mueve nada si el día nuevo sigue en la semana visible", () => {
    // Dormir el viernes y despertar el domingo ya muestra las fechas correctas;
    // reanclar solo obligaría a recargar el board para nada.
    expect(anchorAfterDayChange(SEMANA, "2026-08-14", "2026-08-16")).toBeNull();
  });

  it("no mueve nada si el usuario navegó a otra semana", () => {
    // Está mirando otra semana a propósito: saltarle la vista bajo el cursor
    // porque cambió la fecha es peor que quedarse quieto. La semana visible no
    // contiene ni el día viejo ni el nuevo — si contuviera el nuevo, este caso
    // pasaría igual sin la regla y no probaría nada.
    const otraSemana = ["2026-08-24", "2026-08-25", "2026-08-26"];
    expect(anchorAfterDayChange(otraSemana, "2026-08-16", "2026-08-17")).toBeNull();
  });

  it("cruza varios días de golpe (una suspensión larga)", () => {
    const fresh = anchorAfterDayChange(SEMANA, "2026-08-12", "2026-08-25");
    expect(toISODate(fresh!)).toBe("2026-08-25");
  });
});
