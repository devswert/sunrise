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
    // Dos excepciones legítimas, y ninguna es de categoría: `accent` es el color
    // de la app, y `selection` es el texto seleccionado (fondo fijo, así que su
    // ink tampoco puede seguir al tema).
    const SIN_CANAL = ["accent", "selection"];
    const conInk = [...tokens.matchAll(/--([a-z]+)-ink:/g)].map((m) => m[1]);
    const huerfanos = conInk.filter((c) => !SIN_CANAL.includes(c) && !PALETTE.includes(c as never));
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

  /**
   * Los sólidos y el ink de la selección son fondos **fijos**: si siguieran al
   * tema, en oscuro quedaría blanco sobre claro (los sólidos) o el marrón de la
   * selección sobre un damasco que nunca cambió.
   */
  it("los sólidos y el ink de la selección no siguen al tema", () => {
    const oscuro = tokens.slice(tokens.indexOf("/* --- Tema oscuro"));
    for (const token of ["mint-solid", "sage-solid", "apricot-solid", "selection-ink"]) {
      expect(tokens, `falta --${token}`).toMatch(new RegExp(`--${token}:\\s*#[0-9a-f]{6}`));
      expect(oscuro, `--${token} no debería redefinirse por tema`).not.toContain(`--${token}:`);
    }
  });
});

/**
 * **El color entero con su `-ink` encima no se lee**, y es un error que no avisa:
 * compila, se ve "verde sobre verde" y hay que medirlo para descubrir que son 2.0
 * de contraste. Pasó en tres lugares a la vez —el botón de confirmar, el icono del
 * diálogo de ritual y el texto seleccionado— porque los `-ink` están calibrados
 * contra el chip **al 35%** y nadie escribió que el 35% era parte del cálculo.
 *
 * Este test lee todos los CSS del proyecto, no solo `tokens.css`: el par se arma
 * lejos de donde se declaran los tokens. Busca el caso exacto —`background:
 * var(--x)` con un `color: var(--x-ink)` en la misma regla— y no las mezclas, que
 * sí son legítimas. Si necesitas el color a full con texto encima, va un sólido.
 */
describe("tokens · el color entero no lleva su propio `-ink`", () => {
  const hojas = import.meta.glob("../**/*.css", { query: "?raw", import: "default", eager: true });

  // Sin esto el test pasa aunque el glob no lea nada, que es el modo de falla del
  // que se entera nadie: verde para siempre y sin vigilar ni un archivo.
  it("lee las hojas de estilo del proyecto", () => {
    expect(Object.keys(hojas).length).toBeGreaterThan(8);
  });

  it("ninguna regla pinta un color de la paleta a full y le pone su `-ink` de texto", () => {
    const culpables: string[] = [];
    for (const [ruta, hoja] of Object.entries(hojas)) {
      // Sin comentarios: si no, uno arriba de la regla se cuela en el selector, y
      // un par comentado se contaría como si estuviera vivo.
      const css = (hoja as string).replace(/\/\*[\s\S]*?\*\//g, "");
      const re = /([^{}]+)\{([^{}]*)\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(css))) {
        const [, selector, cuerpo] = m;
        for (const color of PALETTE) {
          const aFull = new RegExp(`background(-color)?:\\s*var\\(--${color}\\)`).test(cuerpo);
          const inkEncima = new RegExp(`color:\\s*var\\(--${color}-ink\\)`).test(cuerpo);
          if (aFull && inkEncima) culpables.push(`${ruta} → ${selector.trim()} (${color})`);
        }
      }
    }
    expect(culpables).toEqual([]);
  });
});
