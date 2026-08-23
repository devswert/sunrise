import { describe, expect, it } from "vitest";
// `?raw` en vez de `node:fs`, igual que `changelog.ts`: el tsconfig del front no
// trae los tipos de Node, y esto lo resuelve Vite en las dos plataformas.
import tokens from "./tokens.css?raw";
import { PALETTE } from "../lib/palette";

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

/**
 * El picker y los tokens no pueden separarse, y la razón es el modo de falla:
 * agregar un color a `PALETTE` y olvidar su token deja `var(--x)` sin resolver, o
 * sea **un punto transparente y ni un error en consola**. Al revés —un token sin
 * entrada en `PALETTE`— es inofensivo pero muerto, así que también se avisa.
 */
describe("tokens · paleta", () => {
  it("cada color del picker tiene sus dos tokens", () => {
    for (const color of PALETTE) {
      expect(tokens, `falta --${color}`).toMatch(new RegExp(`--${color}:\\s*#[0-9a-f]{6}`));
      expect(tokens, `falta --${color}-ink`).toMatch(
        new RegExp(`--${color}-ink:\\s*#[0-9a-f]{6}`),
      );
    }
  });

  it("no hay un color con `-ink` que el picker no ofrezca", () => {
    // `accent` es la excepción legítima: es el color de la app, no de categoría.
    const conInk = [...tokens.matchAll(/--([a-z]+)-ink:/g)].map((m) => m[1]);
    const huerfanos = conInk.filter((c) => c !== "accent" && !PALETTE.includes(c as never));
    expect(huerfanos).toEqual([]);
  });

  it("ningún color del picker se repite", () => {
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });

  it("el color en sí no cambia por tema", () => {
    // El pastel es el mismo en claro y oscuro; lo que cambia es su `-ink`. Darle
    // variante al color además del ink haría que el punto de un canal fuera de
    // dos colores distintos según el tema, y el punto es justamente lo que se
    // usa para reconocerlo.
    const raiz = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf("/* --- Tema claro"));
    for (const color of PALETTE) {
      expect(raiz, `--${color} tendría que estar en :root`).toContain(`--${color}:`);
    }
    const oscuro = tokens.slice(tokens.indexOf("/* --- Tema oscuro"));
    for (const color of PALETTE) {
      expect(oscuro, `--${color} no debería redefinirse por tema`).not.toContain(
        `--${color}: #`,
      );
    }
  });

  /**
   * **Los 24 `-ink` van en las tres ramas de tema, o ninguno.** Es lo que arregló
   * Mej.28: con un solo hex, el chip de canal quedaba en contraste 1.1–1.5 en tema
   * oscuro. Y son tres ramas y no dos por lo mismo que `color-scheme`: la del
   * media query del sistema y la del `data-theme` explícito, que es la que gana
   * cuando el usuario eligió oscuro teniendo el sistema en claro.
   *
   * Si alguien le da variante a uno solo, el chip de un canal se lee y el del
   * canal de al lado no, sin ninguna razón visible. Por eso se exigen los 24.
   */
  it("los 24 `-ink` tienen su versión en las tres ramas de tema", () => {
    const ramas = [
      tokens.slice(tokens.indexOf(":root {"), tokens.indexOf("/* --- Tema claro")),
      ...[':root:not([data-theme="light"])', ':root[data-theme="dark"]'].map((sel) => {
        const desde = tokens.indexOf(sel);
        expect(desde, `no encontré la rama ${sel}`).toBeGreaterThan(-1);
        return tokens.slice(desde, tokens.indexOf("}", tokens.indexOf("{", desde)));
      }),
    ];
    for (const rama of ramas) {
      for (const color of PALETTE) {
        expect(rama, `falta --${color}-ink en una rama de tema`).toMatch(
          new RegExp(`--${color}-ink:\\s*#[0-9a-f]{6}`),
        );
      }
    }
  });

  it("el verde sólido no sigue al tema", () => {
    // `--mint-solid` es el fondo con texto blanco encima (el play de Focus, los
    // checks). Si siguiera al tema, en oscuro quedaría blanco sobre claro.
    expect(tokens).toMatch(/--mint-solid:\s*#[0-9a-f]{6}/);
    const oscuro = tokens.slice(tokens.indexOf("/* --- Tema oscuro"));
    expect(oscuro).not.toContain("--mint-solid:");
  });
});
