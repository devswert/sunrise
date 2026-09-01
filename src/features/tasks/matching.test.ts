import { describe, expect, it } from "vitest";
import { jaroWinkler, mismaPalabra } from "./matching";

describe("jaroWinkler · la métrica, contra sus valores conocidos", () => {
  // Los dos ejemplos canónicos de la definición de Winkler, que es lo que hace
  // que este test valga: si la implementación se desvía, se desvía acá.
  it("da los valores de la literatura", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 3);
    expect(jaroWinkler("dwayne", "duane")).toBeCloseTo(0.84, 2);
  });

  it("premia el prefijo compartido, que es donde no se cometen typos", () => {
    // Mismas letras distintas, pero una empieza igual y la otra no.
    expect(jaroWinkler("review", "reviwe")).toBeGreaterThan(jaroWinkler("review", "eeview"));
  });
});

describe("mismaPalabra · los dos casos que pidió el usuario", () => {
  it("singular y plural son la misma", () => {
    expect(mismaPalabra("issue", "issues")).toBe(true);
    expect(mismaPalabra("tickets", "ticket")).toBe(true);
  });

  // Así llegan de verdad: el plural y el typo juntos. Medidos enteros están a
  // dos ediciones y no entrarían en ningún umbral sano; en singular queda la
  // transposición sola, que es el error que se cometió.
  // Así llegan de verdad, los dos juntos, y sin ayuda de ninguna regla nuestra:
  // la métrica sola los da por la misma palabra.
  it("el plural y el typo pueden venir juntos", () => {
    expect(mismaPalabra("tikcet", "tickets")).toBe(true);
    expect(mismaPalabra("reviwes", "review")).toBe(true);
  });

  it("un typo de teclado también", () => {
    expect(mismaPalabra("reviwe", "review")).toBe(true);
    expect(mismaPalabra("reunino", "reunion")).toBe(true);
    expect(mismaPalabra("sporte", "soporte")).toBe(true);
  });

  // El plural no se le deja a la métrica: es una certeza, y así no queda sujeto a
  // que dos letras sobre cinco pasen o no pasen el umbral.
  it("el plural calza siempre, sin depender del umbral", () => {
    expect(mismaPalabra("issue", "issues")).toBe(true);
    expect(mismaPalabra("incidencia", "incidencias")).toBe(true);
    expect(mismaPalabra("canal", "canales")).toBe(true);
  });

  // Los pares que el umbral tiene que dejar afuera: palabras cortas que se
  // parecen pero no son. Son las que pondrían un chip de casualidad.
  it("parecerse no alcanza", () => {
    expect(mismaPalabra("mail", "mall")).toBe(false);
    expect(mismaPalabra("docs", "dock")).toBe(false);
    expect(mismaPalabra("leer", "ver")).toBe(false);
    expect(mismaPalabra("casa", "caso")).toBe(false);
  });

  // Jaro normaliza por el largo de las dos, así que una palabra corta no se
  // vuelve el comodín de una larga que empieza igual.
  it("una palabra corta no calza dentro de una larga", () => {
    expect(mismaPalabra("doc", "docente")).toBe(false);
  });
});
