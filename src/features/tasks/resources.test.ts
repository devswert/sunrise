import { describe, expect, it } from "vitest";
import { appendResources, harvestLinks, replaceKeepingCaret } from "./resources";
import { extractLinks } from "./history";

describe("harvestLinks · saca los links del título", () => {
  it("un link pegado sale del texto y queda en la lista", () => {
    const r = harvestLinks("Revisar el PR https://github.com/acme/repo/pull/12");
    expect(r.text).toBe("Revisar el PR");
    expect(r.links).toEqual(["https://github.com/acme/repo/pull/12"]);
  });

  it("dos links salen los dos, sin repetir", () => {
    const r = harvestLinks("Comparar https://uno.example/a con https://uno.example/a y listo");
    expect(r.text).toBe("Comparar con y listo");
    expect(r.links).toEqual(["https://uno.example/a"]);
  });

  // Se cosecha en cada tecla, así que recortar el espacio final pegaría la
  // letra siguiente a la palabra anterior: "Escribir el" + "informe".
  it("mientras se escribe no se come el espacio del final", () => {
    expect(harvestLinks("Escribir el ", true).text).toBe("Escribir el ");
  });

  it("sin links devuelve el texto igual", () => {
    expect(harvestLinks("Escribir el informe")).toEqual({
      text: "Escribir el informe",
      links: [],
    });
  });

  // La trampa de cosechar en cada tecla: `https://g` ya calza con el patrón, así
  // que sin este guard el campo se comería la URL a la novena letra.
  it("mientras se escribe no se lleva la URL a medio escribir", () => {
    const r = harvestLinks("Revisar https://git", true);
    expect(r.text).toBe("Revisar https://git");
    expect(r.links).toEqual([]);
  });

  it("mientras se escribe sí se lleva la que ya quedó cerrada", () => {
    const r = harvestLinks("Revisar https://acme.dev/x y avisar", true);
    expect(r.text).toBe("Revisar y avisar");
    expect(r.links).toEqual(["https://acme.dev/x"]);
  });
});

describe("harvestLinks · el cursor sigue al texto que quedó", () => {
  it("un link sacado antes del cursor lo corre lo que medía", () => {
    // "Ver https://a.dev/x y avisar", cursor después de "y".
    const r = harvestLinks("Ver https://a.dev/x y avisar", true, 21);
    expect(r.text).toBe("Ver y avisar");
    expect(r.caret).toBe(5);
  });

  // Mientras el cursor está en su borde, la URL todavía se está escribiendo
  // aunque tenga un espacio detrás.
  it("la URL con el cursor en su borde no se cosecha", () => {
    const r = harvestLinks("Ver https://a.dev mañana", true, 17);
    expect(r.text).toBe("Ver https://a.dev mañana");
    expect(r.links).toEqual([]);
    expect(r.caret).toBe(17);
  });

  it("el hueco de un link se junta aunque toque el cursor", () => {
    // Se acaba de teclear el espacio que cierra la URL, antes de " mañana".
    const r = harvestLinks("PR https://a.dev  mañana", true, 17);
    expect(r.text).toBe("PR mañana");
    expect(r.caret).toBe(3);
  });

  it("el doble espacio que toca el cursor, sin link, se queda", () => {
    const r = harvestLinks("Si tengo  esta", true, 9);
    expect(r.text).toBe("Si tengo  esta");
    expect(r.caret).toBe(9);
  });

  it("el doble espacio lejos del cursor se junta y lo corre", () => {
    const r = harvestLinks("Si  tengo esta", true, 13);
    expect(r.text).toBe("Si tengo esta");
    expect(r.caret).toBe(12);
  });

  it("al pegar, el recorte del final no deja el cursor fuera del texto", () => {
    const r = harvestLinks("Ver https://a.dev", false, 17);
    expect(r.text).toBe("Ver");
    expect(r.caret).toBe(3);
  });
});

describe("replaceKeepingCaret · reemplaza sin perder el cursor", () => {
  it("un salto aplanado antes del cursor lo corre", () => {
    const r = replaceKeepingCaret("uno\n\n dos tres", /\s*\n\s*/g, () => " ", 11);
    expect(r.text).toBe("uno dos tres");
    // Después de la "t" de "tres", dos caracteres antes que en el original.
    expect(r.caret).toBe(9);
  });

  it("un cursor dentro del tramo queda en lo que sobrevivió", () => {
    const r = replaceKeepingCaret("uno   dos", /[ ]{2,}/g, () => " ", 5);
    expect(r.text).toBe("uno dos");
    expect(r.caret).toBe(4);
  });

  it("lo que está después del cursor no lo mueve", () => {
    const r = replaceKeepingCaret("uno dos   tres", /[ ]{2,}/g, () => " ", 2);
    expect(r.caret).toBe(2);
  });
});

describe("appendResources · los links viven en una sección de las notas", () => {
  it("sin notas escribe la sección", () => {
    expect(appendResources("", ["https://acme.dev/x"])).toBe("# Recursos:\n* https://acme.dev/x");
  });

  it("con notas la agrega al final, separada", () => {
    expect(appendResources("Ojo con el deploy", ["https://acme.dev/x"])).toBe(
      "Ojo con el deploy\n\n# Recursos:\n* https://acme.dev/x",
    );
  });

  it("si la sección ya existe suma un ítem más y no abre otra", () => {
    const notas = "# Recursos:\n* https://acme.dev/x";
    expect(appendResources(notas, ["https://acme.dev/y"])).toBe(
      "# Recursos:\n* https://acme.dev/x\n* https://acme.dev/y",
    );
  });

  // Lo que va debajo de la sección no tiene por qué ser el final de las notas.
  it("los ítems entran al final de su lista, no al final de las notas", () => {
    const notas = "# Recursos:\n* https://acme.dev/x\n\nOtra cosa";
    expect(appendResources(notas, ["https://acme.dev/y"])).toBe(
      "# Recursos:\n* https://acme.dev/x\n* https://acme.dev/y\n\nOtra cosa",
    );
  });

  it("un link que ya está en las notas no se repite", () => {
    const notas = "# Recursos:\n* https://acme.dev/x";
    expect(appendResources(notas, ["https://acme.dev/x"])).toBe(notas);
  });

  // Las dos puntas tienen que coincidir: el detalle dibuja sus chips leyendo las
  // notas, así que un link guardado que `extractLinks` no vea sería invisible.
  it("lo que se escribe en las notas es lo que el detalle dibuja como chip", () => {
    const notas = appendResources("", ["https://acme.dev/x", "https://acme.dev/y"]);
    expect(extractLinks(notas)).toEqual(["https://acme.dev/x", "https://acme.dev/y"]);
  });
});
