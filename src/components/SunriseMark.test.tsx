import { describe, expect, it } from "vitest";
// `?raw` en vez de `node:fs`: el proyecto no tiene `@types/node`, y de paso el
// test se cae al correr si alguien mueve o renombra estos archivos. Al compilar no
// —el `declare module "*?raw"` de `vite/client` matchea cualquier ruta, no la
// verifica—, así que esto lo agarra Vitest, no `tsc`.
import iconoSvg from "../../public/app-icon.svg?raw";
import indexHtml from "../../index.html?raw";
import timerHtml from "../../timer.html?raw";
import { render } from "@testing-library/react";
import { SunriseMark } from "./SunriseMark";

describe("SunriseMark", () => {
  /**
   * Dos marcas montadas a la vez tienen que tener ids distintos de degradado. Si
   * colisionan, el navegador resuelve **las dos** referencias al primer `<defs>`
   * que encuentra: no explota nada, simplemente una de las dos deja de responder
   * a su propio degradado. Es el fallo que uno no ve hasta que ya está en un
   * screenshot.
   */
  it("no repite el id del degradado entre instancias", () => {
    const { container } = render(
      <>
        <SunriseMark />
        <SunriseMark />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });
});

/**
 * El SVG del icono no lo renderiza React: lo leen `pnpm tauri icon` (que genera
 * el `.icns` del `.app` y del `.dmg`) y la pestaña del navegador. O sea que un
 * error ahí no rompe ningún test de UI y aparece recién al empaquetar.
 *
 * Estos dos casos son los que de verdad pasaron o pueden pasar:
 *
 * - **XML inválido.** Los comentarios de este proyecto son largos y nombran
 *   tokens de CSS; escribirlos con los dos guiones (`--ink`) es XML ilegal, y
 *   `rsvg`/`tauri icon` fallan con un error de parseo que no dice logo.
 * - **La ruta del favicon.** Vive en dos `.html` que nadie importa, así que
 *   renombrar el archivo deja las dos pestañas sin icono en silencio.
 */
describe("public/app-icon.svg", () => {
  it("es XML válido", () => {
    const doc = new DOMParser().parseFromString(iconoSvg, "image/svg+xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.documentElement.tagName).toBe("svg");
  });

  it("es el favicon de las dos ventanas", () => {
    for (const html of [indexHtml, timerHtml]) {
      expect(html).toContain('href="/app-icon.svg"');
    }
  });
});
