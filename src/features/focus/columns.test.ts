import { describe, expect, it } from "vitest";
import { nextColumns } from "./columns";

describe("nextColumns", () => {
  it("sin nada antes, las columnas son lo que corre", () => {
    expect(nextColumns([], [], [1])).toEqual([1]);
    expect(nextColumns([], [], [])).toEqual([]);
  });

  it("un play en paralelo suma una columna al final", () => {
    expect(nextColumns([1], [1], [1, 2])).toEqual([1, 2]);
  });

  it("pausar una mientras otra sigue corriendo la deja en su lugar", () => {
    expect(nextColumns([1, 2, 3], [1, 2, 3], [1, 3])).toEqual([1, 2, 3]);
  });

  it("retomar una pausada no la mueve de lugar", () => {
    expect(nextColumns([1, 2, 3], [1, 3], [1, 3, 2])).toEqual([1, 2, 3]);
  });

  it("el play clásico deja solo la que arrancó", () => {
    // Desde una columna en pausa…
    expect(nextColumns([1, 2, 3], [1, 3], [2])).toEqual([2]);
    // …o desde otra vista, con una tarea que no tenía columna.
    expect(nextColumns([1, 2], [1, 2], [7])).toEqual([7]);
  });

  it("pausar o completar la última que corría no se lleva las columnas en pausa", () => {
    expect(nextColumns([1, 2], [1], [])).toEqual([1, 2]);
    expect(nextColumns([1, 2, 3], [1], [])).toEqual([1, 2, 3]);
  });

  it("con todas en pausa, cualquier play deja solo esa: no se distingue el paralelo del clásico", () => {
    expect(nextColumns([1, 2], [], [2])).toEqual([2]);
    expect(nextColumns([1, 2], [], [7])).toEqual([7]);
  });

  it("con un solo timer, pausarlo deja esa sola columna", () => {
    expect(nextColumns([1], [1], [])).toEqual([1]);
  });
});
