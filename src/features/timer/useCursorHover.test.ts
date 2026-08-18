import { describe, expect, it } from "vitest";
import { dentroDeLaEnvolvente, type Caja } from "./useCursorHover";

/** Botón de play: franja de 38px pegada al borde derecho de la tarjeta. */
const BOTON: Caja = { left: 174, right: 212, top: 3, bottom: 67 };
/** Panel de opciones: a su izquierda, con 4px de separación visual. */
const PANEL: Caja = { left: 110, right: 170, top: 17, bottom: 53 };

describe("dentroDeLaEnvolvente", () => {
  it("reconoce el puntero sobre el botón", () => {
    expect(dentroDeLaEnvolvente(190, 35, [BOTON, PANEL])).toBe(true);
  });

  it("reconoce el puntero sobre el panel", () => {
    expect(dentroDeLaEnvolvente(140, 35, [BOTON, PANEL])).toBe(true);
  });

  it("cubre el hueco de 4px entre el botón y el panel", () => {
    // Es el caso que rompía el hover original: al cruzar del botón al panel el
    // puntero no estaba sobre ninguno de los dos y el panel se cerraba.
    expect(dentroDeLaEnvolvente(172, 35, [BOTON, PANEL])).toBe(true);
  });

  it("deja fuera el título, a la izquierda del panel", () => {
    expect(dentroDeLaEnvolvente(60, 35, [BOTON, PANEL])).toBe(false);
  });

  it("deja fuera un puntero por debajo de la tarjeta", () => {
    expect(dentroDeLaEnvolvente(190, 200, [BOTON, PANEL])).toBe(false);
  });

  it("con el panel oculto, solo cuenta el botón", () => {
    // Un elemento fuera del layout mide 0×0 en el origen; si no se descartara,
    // la envolvente llegaría hasta la esquina y el título contaría como hover.
    const oculto: Caja = { left: 0, right: 0, top: 0, bottom: 0 };
    expect(dentroDeLaEnvolvente(60, 35, [BOTON, oculto])).toBe(false);
    expect(dentroDeLaEnvolvente(190, 35, [BOTON, oculto])).toBe(true);
  });

  it("sin cajas no hay hover", () => {
    expect(dentroDeLaEnvolvente(190, 35, [])).toBe(false);
  });

  it("el borde exacto cuenta como dentro", () => {
    // El puntero cae en coordenadas fraccionarias tras dividir por la escala;
    // excluir el borde deja un píxel muerto justo en el filo del botón.
    expect(dentroDeLaEnvolvente(212, 67, [BOTON])).toBe(true);
  });
});
