import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_RULES,
  parseChannelRules,
  parseTimeRules,
  serializeRules,
  textToWords,
} from "./suggestRules";

describe("parseTimeRules · ausente, vacío y basura son tres cosas distintas", () => {
  it("ausente son los defaults", () => {
    expect(parseTimeRules(undefined)).toEqual(DEFAULT_TIME_RULES);
  });

  // La decisión que este test protege: vaciar la lista es "no me adivines el
  // tiempo", y tiene que sobrevivir al reinicio en vez de volver a los defaults.
  it("vacío es la lista vacía, no los defaults", () => {
    expect(parseTimeRules("")).toEqual([]);
    expect(parseTimeRules("[]")).toEqual([]);
  });

  it("un JSON roto no devuelve los defaults ni explota", () => {
    expect(parseTimeRules("{no es json")).toEqual([]);
  });

  it("una fila rota se descarta sola, sin llevarse las buenas", () => {
    const raw = JSON.stringify([
      { minutes: 30, words: ["review"] },
      { minutes: -1, words: ["nope"] },
      { minutes: 45 },
      { minutes: 60, words: [] },
      { words: ["sin minutos"] },
      { minutes: 15, words: ["llamar", 7, " ", "llamar"] },
    ]);
    expect(parseTimeRules(raw)).toEqual([
      { minutes: 30, words: ["review"] },
      { minutes: 15, words: ["llamar"] },
    ]);
  });

  it("lo que se guarda se vuelve a leer igual", () => {
    const reglas = [{ minutes: 30, words: ["review", "revisar"] }];
    expect(parseTimeRules(serializeRules(reglas))).toEqual(reglas);
  });
});

describe("parseChannelRules · los canales arrancan vacíos", () => {
  it("ausente y vacío son lo mismo: todavía no hay ninguna palabra mapeada", () => {
    expect(parseChannelRules(undefined)).toEqual([]);
    expect(parseChannelRules("")).toEqual([]);
  });

  it("descarta lo que no es un canal", () => {
    const raw = JSON.stringify([
      { categoryId: 4, words: ["issues", "soporte"] },
      { categoryId: "4", words: ["mal"] },
      { categoryId: 5, words: [] },
    ]);
    expect(parseChannelRules(raw)).toEqual([{ categoryId: 4, words: ["issues", "soporte"] }]);
  });
});

describe("las palabras que se escriben en Configs", () => {
  // Pegar la lista entera de una vez tiene que dejar una pill por palabra.
  it("lo tecleado se corta por coma, sin vacíos ni repetidas", () => {
    expect(textToWords(" issues ,, soporte, ISSUES ,tickets ")).toEqual([
      "issues",
      "soporte",
      "tickets",
    ]);
  });

  it("una regla sin palabras no se guarda: no dice nada", () => {
    expect(serializeRules([{ minutes: 30, words: [] }])).toBe("[]");
  });
});
