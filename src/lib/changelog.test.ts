import { describe, expect, it } from "vitest";
import { announcementFor, latestVersion, releaseDateFor, sectionFor } from "./changelog";
import pkg from "../../package.json";

const MD = `# Cambios

Bla bla de encabezado.

## v0.2.0 — 2026-09-01

El rail muestra los feriados.

Y el backlog se arrastra a la semana.

### Detalle

- Feriados desde el ICS, con su zona

## v0.1.0 — 2026-08-18

La primera que se puede instalar.

### Detalle

- Todo lo demás
`;

describe("changelog", () => {
  it("saca la sección completa de una versión, con su detalle", () => {
    const sec = sectionFor("0.2.0", MD)!;
    expect(sec).toContain("El rail muestra los feriados.");
    expect(sec).toContain("Feriados desde el ICS, con su zona");
    // Y no se lleva la versión de abajo.
    expect(sec).not.toContain("La primera que se puede instalar");
  });

  /**
   * El anuncio corta antes del detalle. Es la distinción que sostiene el diseño:
   * el changelog puede tener veinte viñetas de detalle técnico, y el modal sigue
   * mostrando dos frases que responden "¿me conviene actualizar?".
   */
  it("el anuncio son los párrafos, sin el detalle ni las referencias", () => {
    const a = announcementFor("0.2.0", MD)!;
    expect(a).toBe("El rail muestra los feriados.\n\nY el backlog se arrastra a la semana.");
    expect(a).not.toContain("con su zona");
    expect(a).not.toContain("Detalle");
  });

  it("la más nueva es la primera del archivo", () => {
    expect(latestVersion(MD)).toBe("0.2.0");
    expect(latestVersion("# Cambios\n\nsin versiones\n")).toBeNull();
  });

  /**
   * La fecha es opcional en el formato del encabezado, así que quien la muestre
   * tiene que aguantar que falte en vez de rellenarla con hoy.
   */
  it("saca el día de publicación del encabezado, y aguanta que no esté", () => {
    expect(releaseDateFor("0.2.0", MD)).toBe("2026-09-01");
    expect(releaseDateFor("9.9.9", MD)).toBeNull();
    expect(releaseDateFor("0.3.0", "## v0.3.0\n\nSin fecha.\n")).toBeNull();
  });

  it("una versión que no está no es un error", () => {
    expect(sectionFor("9.9.9", MD)).toBeNull();
    expect(announcementFor("9.9.9", MD)).toBeNull();
  });

  /**
   * El equivalente exacto del test de Rust que compara la versión en los tres
   * archivos, para el modo de falla que abre esta feature: subes la versión, te
   * olvidas de la entrada, y quedan **el modal vacío y las notas del Release
   * vacías** sin que nada se ponga rojo. Se comprueba contra el changelog de
   * verdad, no contra el de prueba.
   */
  it("la versión que se está compilando tiene su anuncio escrito", () => {
    const a = announcementFor(pkg.version);
    expect(a, `falta la sección "## v${pkg.version}" en docs/CHANGELOG.md`).toBeTruthy();
    expect(a!.length).toBeGreaterThan(40);
  });
});
