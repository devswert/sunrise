import { describe, expect, it } from "vitest";
// `?raw` en vez de `node:fs`, igual que `changelog.ts`: el tsconfig del front no
// trae los tipos de Node, y esto lo resuelve Vite en las dos plataformas.
import tokens from "./tokens.css?raw";

/**
 * Este test lee el CSS como texto y no como estilo aplicado, a propósito: jsdom
 * no dibuja controles nativos, así que no hay forma de comprobar desde acá que
 * la barra de scroll salió oscura. Lo que sí se puede vigilar es que la
 * declaración exista en las tres ramas de tema, que es el error que se comete
 * (agregar una rama nueva y olvidar `color-scheme`, con el síntoma apareciendo
 * recién en la app instalada).
 */
describe("tokens · color-scheme", () => {
  /** Los cuerpos de cada bloque `{ … }`, con su selector. */
  function blocks(): Array<{ selector: string; body: string }> {
    const out: Array<{ selector: string; body: string }> = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tokens))) {
      out.push({ selector: m[1].trim(), body: m[2] });
    }
    return out;
  }

  it("el tema claro declara color-scheme: light", () => {
    const claro = blocks().find((b) => b.selector.includes('[data-theme="light"]'));
    expect(claro?.body).toMatch(/color-scheme:\s*light/);
  });

  /**
   * Son dos ramas y no una: la del sistema (`prefers-color-scheme`) y la del
   * `data-theme` explícito, que es la que gana cuando el usuario eligió oscuro
   * teniendo el sistema en claro. Olvidar la segunda deja el modo oscuro
   * manual con los controles nativos claros, que es justo el caso reportado.
   */
  it("las dos ramas de tema oscuro declaran color-scheme: dark", () => {
    const oscuras = blocks().filter(
      (b) =>
        b.selector.includes('[data-theme="dark"]') ||
        b.selector.includes(':not([data-theme="light"])'),
    );
    expect(oscuras).toHaveLength(2);
    for (const bloque of oscuras) {
      expect(bloque.body).toMatch(/color-scheme:\s*dark/);
    }
  });
});
