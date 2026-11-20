import { describe, expect, it } from "vitest";
// `?raw`, como `tokens.test.ts`: se lee la hoja como texto. jsdom no corre
// animaciones ni evalúa `@media`, así que lo que se puede vigilar es que la regla
// exista y apague lo que tiene que apagar.
import modals from "./modal-presence.css?raw";
import popovers from "../features/tasks/add-task-modal.css?raw";

/** El cuerpo del bloque `@media (prefers-reduced-motion: reduce)` de una hoja. */
function reducedMotion(css: string): string {
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(start).toBeGreaterThan(-1);
  // Hasta el `}` que cierra el `@media`: el primero que viene después de otro `}`.
  const rest = css.slice(start);
  const end = rest.search(/\}\s*\}/);
  return rest.slice(0, end + 1);
}

describe("prefers-reduced-motion", () => {
  it("apaga la entrada y la salida de los modales", () => {
    const rule = reducedMotion(modals);
    expect(rule).toContain(".modal-presence > .modal-overlay");
    expect(rule).toContain(".modal-presence.is-leaving > .modal-overlay > *");
    expect(rule).toContain(".modal-presence.is-leaving > .compose-overlay");
    expect(rule).toMatch(/animation:\s*none/);
  });

  it("apaga la entrada de los popovers", () => {
    const rule = reducedMotion(popovers);
    expect(rule).toContain(".popover");
    expect(rule).toContain(".popover--portal");
    expect(rule).toMatch(/animation:\s*none/);
  });
});
