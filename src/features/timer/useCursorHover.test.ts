import { describe, expect, it } from "vitest";
import { insideEnvelope, rowUnderCursor, type Caja } from "./useCursorHover";

/** Botón de play: franja de 38px pegada al borde derecho de la tarjeta. */
const BOTON: Caja = { left: 174, right: 212, top: 3, bottom: 67 };
/** Panel de opciones: a su izquierda, con 4px de separación visual. */
const PANEL: Caja = { left: 110, right: 170, top: 17, bottom: 53 };

describe("dentroDeLaEnvolvente", () => {
  it("reconoce el puntero sobre el botón", () => {
    expect(insideEnvelope(190, 35, [BOTON, PANEL])).toBe(true);
  });

  it("reconoce el puntero sobre el panel", () => {
    expect(insideEnvelope(140, 35, [BOTON, PANEL])).toBe(true);
  });

  it("cubre el hueco de 4px entre el botón y el panel", () => {
    // Es el caso que rompía el hover original: al cruzar del botón al panel el
    // puntero no estaba sobre ninguno de los dos y el panel se cerraba.
    expect(insideEnvelope(172, 35, [BOTON, PANEL])).toBe(true);
  });

  it("deja fuera el título, a la izquierda del panel", () => {
    expect(insideEnvelope(60, 35, [BOTON, PANEL])).toBe(false);
  });

  it("deja fuera un puntero por debajo de la tarjeta", () => {
    expect(insideEnvelope(190, 200, [BOTON, PANEL])).toBe(false);
  });

  it("con el panel oculto, solo cuenta el botón", () => {
    // Un elemento fuera del layout mide 0×0 en el origen; si no se descartara,
    // la envolvente llegaría hasta la esquina y el título contaría como hover.
    const oculto: Caja = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(insideEnvelope(60, 35, [BOTON, oculto])).toBe(false);
    expect(insideEnvelope(190, 35, [BOTON, oculto])).toBe(true);
  });

  it("sin cajas no hay hover", () => {
    expect(insideEnvelope(190, 35, [])).toBe(false);
  });

  it("el borde exacto cuenta como dentro", () => {
    // El puntero cae en coordenadas fraccionarias tras dividir por la escala;
    // excluir el borde deja un píxel muerto justo en el filo del botón.
    expect(insideEnvelope(212, 67, [BOTON])).toBe(true);
  });
});

describe("rowUnderCursor", () => {
  /** La segunda fila: las mismas cajas, 56px más abajo. */
  const below = (c: Caja): Caja => ({ ...c, top: c.top + 56, bottom: c.bottom + 56 });
  const rows = [
    { key: "1", boxes: [BOTON, PANEL] },
    { key: "2", boxes: [below(BOTON), below(PANEL)] },
  ];

  it("dice qué fila tiene el puntero, no solo que hay hover", () => {
    expect(rowUnderCursor(190, 35, rows)).toBe("1");
    expect(rowUnderCursor(190, 35 + 56, rows)).toBe("2");
  });

  it("el hueco entre botón y panel sigue contando dentro de su fila", () => {
    expect(rowUnderCursor(172, 35 + 56, rows)).toBe("2");
  });

  it("fuera de los controles de todas las filas no hay fila", () => {
    expect(rowUnderCursor(40, 35, rows)).toBeNull();
  });
});
