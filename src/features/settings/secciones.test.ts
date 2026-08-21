import { describe, expect, it } from "vitest";
import { TABS, visibleTabs } from "./secciones";

/**
 * El resaltado de las tabs lo decide un `IntersectionObserver` sobre las
 * secciones, así que una tab sin su card —o al revés— marca una y muestra otra.
 * Por eso el filtro vive en un solo lugar y se puede probar solo.
 */
describe("visibleTabs", () => {
  it("en producción no ofrece las secciones de dev", () => {
    const ids = visibleTabs(false).map((t) => t.id);
    expect(ids).not.toContain("dev-tools");
    // Respaldo se queda última de las que ve un usuario: es la única que puede
    // destruir datos.
    expect(ids[ids.length - 1]).toBe("respaldo");
  });

  it("en dev las agrega al final, después de Respaldo", () => {
    const ids = visibleTabs(true).map((t) => t.id);
    expect(ids[ids.length - 1]).toBe("dev-tools");
  });

  it("no esconde nada que no esté marcado como dev", () => {
    const normales = TABS.filter((t) => !("dev" in t && t.dev)).length;
    expect(visibleTabs(false)).toHaveLength(normales);
  });
});
