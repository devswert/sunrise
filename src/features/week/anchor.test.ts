import { describe, expect, it } from "vitest";
import { toISODate } from "../../lib/date";
import { anchorAfterDayChange, scrollDelta } from "./anchor";

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

/**
 * El posicionamiento del scroll del board. Solo la aritmética: la medición y la
 * asignación de `scrollLeft` se quedan en `WeekView`, porque jsdom no implementa
 * ninguna de las dos y un test sobre la posición real pasaría por el motivo
 * equivocado. Eso se verifica en el browser.
 */
describe("scrollDelta", () => {
  /** Un board de 1110px visibles, con la columna a 400px de su borde. */
  const base = { colLeft: 500, colWidth: 236, boardLeft: 100, boardWidth: 1110 };

  it("sin centrar, pega la columna al borde izquierdo", () => {
    expect(scrollDelta({ ...base, center: false })).toBe(400);
  });

  it("centrando, deja la columna al medio del ancho visible", () => {
    // 400 - (1110 - 236) / 2 = 400 - 437
    expect(scrollDelta({ ...base, center: true })).toBe(-37);
  });

  it("una columna ya centrada no mueve nada", () => {
    // Su borde cae a (1110 - 236) / 2 = 437 del borde del board.
    const centrada = { ...base, colLeft: 100 + 437, center: true };
    expect(scrollDelta(centrada)).toBe(0);
  });

  it("devuelve negativo cuando hay que retroceder, sin acotarlo", () => {
    // No se acota a propósito: asignar `scrollLeft` fuera de rango lo recorta el
    // navegador, así que centrar un día de la primera semana llega al principio.
    expect(scrollDelta({ ...base, colLeft: 120, center: true })).toBeLessThan(0);
  });

  it("con el board más angosto que la columna, la alinea a la izquierda de más", () => {
    // Caso de ventana muy chica: centrar una columna que no cabe daría un delta
    // mayor que el offset, y eso es correcto — se ve la columna, recortada.
    const angosto = { colLeft: 500, colWidth: 300, boardLeft: 100, boardWidth: 200 };
    expect(scrollDelta({ ...angosto, center: true })).toBe(450);
  });
});
