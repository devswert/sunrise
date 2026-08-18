import { describe, expect, it } from "vitest";
import { descripcionLegible } from "./descripcion";

describe("descripcionLegible", () => {
  it("convierte el HTML de Google en texto, sin dejar etiquetas a la vista", () => {
    // Tal cual llegó en el feed real: la pantalla quedaba llena de <br> y <li>.
    const crudo =
      "Una descripción<br><br><ol><li>COn lista</li><li>punto 2</li><li>tres</li><li><b>Negrita</b></li></ol><br>👋<b></b>";

    const t = descripcionLegible(crudo);

    expect(t).not.toMatch(/<[a-z/]/i);
    expect(t).toContain("Una descripción");
    expect(t).toContain("• COn lista");
    expect(t).toContain("• punto 2");
    expect(t).toContain("Negrita");
    expect(t).toContain("👋");
  });

  it("cada item de lista queda en su propia línea", () => {
    const t = descripcionLegible("<ul><li>uno</li><li>dos</li></ul>");
    expect(t.split("\n").filter(Boolean)).toEqual(["• uno", "• dos"]);
  });

  it("decodifica entidades", () => {
    expect(descripcionLegible("Ana &amp; Beto &lt;jefes&gt;")).toBe("Ana & Beto <jefes>");
    expect(descripcionLegible("&#8226; punto")).toBe("• punto");
  });

  it("respeta los escapes de ICS", () => {
    // RFC 5545 escapa comas y saltos con backslash.
    expect(descripcionLegible("uno\\, dos\\ntres")).toBe("uno, dos\ntres");
  });

  it("no deja tres líneas en blanco seguidas", () => {
    // Google mete varios <br> juntos y quedaba media pantalla vacía.
    const t = descripcionLegible("uno<br><br><br><br>dos");
    expect(t).toBe("uno\n\ndos");
  });

  it("no inyecta HTML: lo que parece una etiqueta se descarta", () => {
    // La descripción viene de un tercero. Renderizarla como HTML sería un
    // agujero de XSS por una invitación de calendario.
    const t = descripcionLegible('<img src=x onerror="alert(1)">hola');
    expect(t).toBe("hola");
  });

  it("un texto plano pasa igual", () => {
    expect(descripcionLegible("Nos vemos en la oficina")).toBe("Nos vemos en la oficina");
  });

  it("una entidad inválida no rompe el resto del texto", () => {
    const t = descripcionLegible("antes &#999999999; después");
    expect(t).toContain("antes");
    expect(t).toContain("después");
  });
});
