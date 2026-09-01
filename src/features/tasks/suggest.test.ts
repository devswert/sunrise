import { describe, expect, it } from "vitest";
import type { Category, Objective } from "../../lib/types";
import { TIME_PRESETS } from "../../lib/capacity";
import {
  stripChannelTag,
  suggestCategoryId,
  suggestFromTitle,
  suggestMinutes,
  suggestObjectiveId,
} from "./suggest";

const cat = (id: number, name: string, parentId: number | null = null): Category => ({
  id,
  parentId,
  name,
  color: "sky",
  position: id,
  archived: false,
});

const CATEGORIES: Category[] = [
  cat(1, "Meetings"),
  cat(2, "Docs"),
  cat(3, "Projects"),
  cat(4, "informe-anual", 2),
];

const obj = (id: number, title: string): Objective => ({
  id,
  isoWeek: "2026-W36",
  title,
  categoryId: null,
  position: id,
  completed: false,
});

describe("suggestMinutes · el tiempo que se lee del título", () => {
  it("un número explícito manda sobre el verbo", () => {
    // "revisar" solo valdría 30; el que escribió 90 ya decidió.
    expect(suggestMinutes("revisar el informe 90 min")).toBe(90);
  });

  it("las horas se pasan a minutos", () => {
    expect(suggestMinutes("Taller de onboarding 2h")).toBe(120);
    expect(suggestMinutes("Llamada con el proveedor 1 hora")).toBe(60);
  });

  it("media hora, hora y media y cuarto de hora también son números", () => {
    expect(suggestMinutes("café con Ana media hora")).toBe(30);
    expect(suggestMinutes("planificación 1h y media")).toBe(90);
    expect(suggestMinutes("standup un cuarto de hora")).toBe(15);
  });

  it("un número que no cae en la lista se redondea a un preset", () => {
    // 25 salió del picker: sugerirlo dejaría un chip que no se puede volver a elegir.
    expect(TIME_PRESETS).not.toContain(25);
    expect(TIME_PRESETS).toContain(suggestMinutes("dejar esto en 25 minutos") as number);
  });

  it("sin número, el verbo decide", () => {
    expect(suggestMinutes("Responder el correo de RRHH")).toBe(15);
    expect(suggestMinutes("Reunión con el equipo")).toBe(30);
    expect(suggestMinutes("Escribir la propuesta")).toBe(60);
    expect(suggestMinutes("Implementar el importador")).toBe(120);
  });

  it("las tildes no cambian nada", () => {
    expect(suggestMinutes("reunion de equipo")).toBe(suggestMinutes("reunión de equipo"));
  });

  it("una frase que no dice nada no inventa un tiempo", () => {
    expect(suggestMinutes("Ana y el asunto ese")).toBeUndefined();
  });
});

describe("suggestCategoryId · el canal que nombra el título", () => {
  it("el #canal escrito a mano gana", () => {
    expect(suggestCategoryId("Cerrar el trimestre #docs", CATEGORIES)).toBe(2);
  });

  it("el nombre suelto también alcanza", () => {
    expect(suggestCategoryId("Preparar la meetings del lunes", CATEGORIES)).toBe(1);
  });

  it("gana el nombre más largo que calce", () => {
    // "docs" y "informe-anual" calzan los dos; el segundo dice más.
    expect(suggestCategoryId("Cerrar el informe-anual en docs", CATEGORIES)).toBe(4);
  });

  it("una etiqueta más larga no es el canal corto", () => {
    expect(suggestCategoryId("Ver #docs-api", CATEGORIES)).toBeUndefined();
  });

  it("no calza dentro de otra palabra", () => {
    // "documentar" contiene "docs"… no, pero "docs" no puede salir de "documentación".
    expect(suggestCategoryId("Documentación del importador", CATEGORIES)).toBeUndefined();
  });
});

describe("suggestObjectiveId · el objetivo, o ninguno", () => {
  const objetivos = [
    obj(10, "Cerrar la migración del importador"),
    obj(11, "Bajar la deuda de QA"),
  ];

  it("dos palabras en común alcanzan", () => {
    expect(suggestObjectiveId("Terminar la migración del importador", objetivos)).toBe(10);
  });

  it("una palabra larga sola también", () => {
    expect(suggestObjectiveId("Revisar el importador", objetivos)).toBe(10);
  });

  it("una coincidencia floja no sugiere nada", () => {
    // "bajar" es la única en común y son cinco letras: puede ser casualidad.
    expect(suggestObjectiveId("Bajar el adjunto del correo", objetivos)).toBeUndefined();
  });

  it("si nada calza, nada", () => {
    expect(suggestObjectiveId("Comprar café", objetivos)).toBeUndefined();
  });

  it("sin objetivos en la semana no hay nada que sugerir", () => {
    expect(suggestObjectiveId("Terminar la migración", [])).toBeUndefined();
  });
});

describe("suggestFromTitle · los tres juntos", () => {
  it("un campo que no se deduce queda ausente, no en null", () => {
    const s = suggestFromTitle("Comprar café", CATEGORIES, []);
    expect(s).toEqual({});
    expect("minutes" in s).toBe(false);
  });

  it("la frase típica de una reunión llena los tres chips", () => {
    const objetivos = [obj(10, "Cerrar la migración del importador")];
    expect(suggestFromTitle("Revisar el importador #docs 45 min", CATEGORIES, objetivos)).toEqual({
      minutes: 45,
      categoryId: 2,
      objectiveId: 10,
    });
  });
});

describe("stripChannelTag · la etiqueta sale del título", () => {
  it("el #canal capturado no se guarda además en el texto", () => {
    expect(stripChannelTag("Actualizar el changelog #docs", CATEGORIES[1])).toBe(
      "Actualizar el changelog",
    );
  });

  it("también si viene en el medio", () => {
    expect(stripChannelTag("Cerrar #docs antes del viernes", CATEGORIES[1])).toBe(
      "Cerrar antes del viernes",
    );
  });

  it("el nombre suelto es prosa y se queda", () => {
    // Recortarlo dejaría "Preparar la del lunes".
    expect(stripChannelTag("Preparar la meetings del lunes", CATEGORIES[0])).toBe(
      "Preparar la meetings del lunes",
    );
  });

  it("sin canal elegido no toca nada", () => {
    expect(stripChannelTag("Cerrar el #docs", null)).toBe("Cerrar el #docs");
  });

  it("no se come una etiqueta más larga que empieza igual", () => {
    expect(stripChannelTag("Ver #docs-api", CATEGORIES[1])).toBe("Ver #docs-api");
  });
});

// --- Las reglas configurables (Configs → Sugerencias) ------------------------
describe("las reglas las escribe el usuario, y se comparan con tolerancia", () => {
  const reglasTiempo = [
    { minutes: 30, words: ["review"] },
    { minutes: 120, words: ["implementar"] },
  ];

  it("una palabra agregada por el usuario setea su tiempo", () => {
    expect(suggestMinutes("Hacer el review del PR", reglasTiempo)).toBe(30);
  });

  it("el plural y el typo valen lo mismo que la palabra escrita", () => {
    expect(suggestMinutes("Los reviews de la semana", reglasTiempo)).toBe(30);
    expect(suggestMinutes("Hacer el reviwe del PR", reglasTiempo)).toBe(30);
  });

  // Con dos reglas calzando, la de menos minutos: subir un estimado es un click,
  // y una agenda inflada por defecto deja de mirarse.
  it("entre dos reglas que calzan gana la de menos minutos", () => {
    expect(suggestMinutes("Implementar y review", reglasTiempo)).toBe(30);
  });

  it("la lista vacía es «no me adivines el tiempo»", () => {
    expect(suggestMinutes("Reunión con el equipo", [])).toBeUndefined();
  });

  it("una palabra puede apuntar a un canal que no se llama así", () => {
    const reglas = [{ categoryId: 4, words: ["issues", "soporte", "tickets"] }];
    expect(suggestCategoryId("Revisar los tickets de ayer", CATEGORIES, reglas)).toBe(4);
    // Singular, y con un typo.
    expect(suggestCategoryId("Un ticket nuevo", CATEGORIES, reglas)).toBe(4);
    expect(suggestCategoryId("Revisar el sporte", CATEGORIES, reglas)).toBe(4);
  });

  it("una regla que apunta a un canal borrado se ignora", () => {
    const reglas = [{ categoryId: 999, words: ["issues"] }];
    expect(suggestCategoryId("Ver los issues", CATEGORIES, reglas)).toBeUndefined();
  });

  // El `#canal` escrito a mano es una intención, no una coincidencia: si ese
  // canal no existe, caer en el parecido es peor que no calzar.
  it("el #canal escrito a mano se compara exacto", () => {
    expect(suggestCategoryId("Ver #docs-api", CATEGORIES, [])).toBeUndefined();
  });

  // Un compuesto con guion es un nombre propio: parecerse a un pedazo no basta.
  it("un compuesto con guion no sugiere el canal corto", () => {
    expect(suggestCategoryId("Ver docs-api", CATEGORIES, [])).toBeUndefined();
  });

  it("el nombre del canal también tolera el plural", () => {
    // "Meetings" es el canal; la frase dice "meeting".
    expect(suggestCategoryId("Preparar la meeting del lunes", CATEGORIES, [])).toBe(1);
  });
});
