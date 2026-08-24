import { beforeEach, describe, expect, it } from "vitest";
import { applyFonts, cssStack, storedFonts } from "./fonts";
import { FontChoice } from "./enums";

/**
 * Dos cosas que hay que sostener acá, y las dos son casos de vuelta:
 *
 * - Con la fuente de sunrise las propiedades se **borran**, no se reescriben. Si se
 *   escribieran a mano, `tokens.css` dejaría de ser el único lugar donde está
 *   declarada la fuente de la app, y las dos se separarían al primer cambio.
 * - **Toda elección arrastra la pila de respaldo.** Una familia desinstalada no
 *   resuelve, y sin la pila la app se quedaría con la fuente por defecto del webview
 *   —una serif en macOS—: un cambio de tipografía no puede verse como "se rompió".
 *
 * El espejo en `localStorage` tampoco es un detalle de implementación: es el canal
 * por el que el taxímetro —otra ventana, sin store de ajustes— se entera.
 */
describe("fonts", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
  });

  it("la de sunrise no escribe nada; el resto sí, y siempre con respaldo", () => {
    expect(cssStack(FontChoice.SUNRISE)).toBeNull();
    // Sin nombrar familia: `system-ui` es la forma de pedir la del sistema que
    // sigue andando si Apple le cambia el nombre.
    expect(cssStack(FontChoice.SYSTEM)).toContain("system-ui");
    // Entre comillas, que es lo que hace legal un nombre con espacios.
    expect(cssStack("Helvetica Neue")).toMatch(/^"Helvetica Neue", /);
    expect(cssStack("Helvetica Neue")).toContain("sans-serif");
  });

  it("estampa cada rol por separado y los borra al volver a la de sunrise", () => {
    const el = document.documentElement;
    applyFonts({ title: "Optima", body: FontChoice.SYSTEM });
    expect(el.style.getPropertyValue("--font-title")).toContain("Optima");
    expect(el.style.getPropertyValue("--font-body")).toContain("system-ui");

    applyFonts({ title: FontChoice.SUNRISE, body: FontChoice.SUNRISE });
    expect(el.style.getPropertyValue("--font-title")).toBe("");
    expect(el.style.getPropertyValue("--font-body")).toBe("");
  });

  it("queda espejada para la otra ventana, con los dos roles aparte", () => {
    applyFonts({ title: "Optima", body: "Menlo" });
    expect(storedFonts()).toEqual({ title: "Optima", body: "Menlo" });

    localStorage.clear();
    expect(storedFonts()).toEqual({
      title: FontChoice.SUNRISE,
      body: FontChoice.SUNRISE,
    });
  });
});
