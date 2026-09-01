import { TIME_PRESETS } from "../../lib/capacity";
import type { Category, Objective } from "../../lib/types";
import { algunaEs, mismaPalabra, normalize } from "./matching";
import {
  DEFAULT_TIME_RULES,
  type ChannelRule,
  type SuggestRules,
  type TimeRule,
} from "./suggestRules";

/**
 * Lo que el modal de crear tarea adivina mientras se escribe el título.
 *
 * Existe porque la tarea se agrega **en medio de una reunión**: lo que se busca
 * ahí es escribir la frase y darle Enter, no recorrer cuatro pickers. Todo lo
 * que se pueda deducir de la frase se deduce, y lo que no se deduce se queda
 * vacío — nunca se rellena "por si acaso".
 *
 * Es un módulo puro por lo de siempre en este proyecto (lo testeable vive
 * aparte), pero también porque las tres reglas son heurísticas y van a moverse:
 * moverlas con tests al lado es la única forma de saber qué se rompió.
 *
 * **Un campo ausente no es lo mismo que `null`.** Ausente es "no sé"; el `null`
 * es una decisión, y la decisión la toma el usuario. El modal solo escribe los
 * campos que todavía no tocó a mano.
 */

export interface Suggestion {
  minutes?: number;
  categoryId?: number;
  objectiveId?: number;
}

/**
 * Palabras que no distinguen nada. Sin esta lista "revisar el informe" y
 * "mandar el correo" comparten "el" y todo calza con todo.
 */
const STOPWORDS = new Set([
  "para",
  "con",
  "por",
  "del",
  "las",
  "los",
  "una",
  "uno",
  "unos",
  "unas",
  "que",
  "como",
  "este",
  "esta",
  "esto",
  "esos",
  "esas",
  "sobre",
  "hasta",
  "desde",
  "entre",
  "antes",
  "despues",
  "cada",
  "todo",
  "toda",
  "todos",
  "todas",
  "hacer",
  "tarea",
  "cosa",
  "cosas",
]);

function tokens(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9#]+/)
    .filter(Boolean);
}

/**
 * Las palabras del título que se pueden comparar **con tolerancia**: las que son
 * una palabra suelta y nada más. Se les saca el `#` de adelante, así `#soporte`
 * vale por `soporte`.
 *
 * Lo que deja afuera es lo importante: un compuesto con guion —`#docs-api`— no
 * entra, y por eso no puede terminar sugiriendo el canal `docs`. Un nombre
 * compuesto es un nombre propio y se compara literal (`calzaNombre`); parecerse
 * a un pedazo de él no dice nada.
 */
function palabrasComparables(text: string): string[] {
  const out: string[] = [];
  for (const crudo of normalize(text).split(/\s+/)) {
    const w = crudo.replace(/^[^a-z0-9#]+/, "").replace(/[^a-z0-9]+$/, "");
    if (!/^#?[a-z0-9]+$/.test(w)) continue;
    out.push(w.startsWith("#") ? w.slice(1) : w);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tiempo
// ---------------------------------------------------------------------------

/** El preset más cercano, para que el chip muestre algo que el picker sabe elegir. */
function snapToPreset(minutes: number): number {
  return TIME_PRESETS.reduce((best, p) =>
    Math.abs(p - minutes) < Math.abs(best - minutes) ? p : best,
  );
}

/**
 * Los minutos que se leen del título.
 *
 * **Lo explícito manda.** Si la frase dice "30 min" o "1 hora", eso es lo que
 * vale: el que escribió el número ya decidió, y pisarlo con el verbo sería
 * discutirle. Solo si no hay número se cae a las palabras clave.
 */
export function suggestMinutes(
  title: string,
  rules: TimeRule[] = DEFAULT_TIME_RULES,
): number | undefined {
  const t = normalize(title);

  const horaYMedia = /\b(?:1|una)\s*h(?:ora)?\s*y\s*media\b/.test(t);
  if (horaYMedia) return 90;
  if (/\bmedia\s+hora\b/.test(t)) return 30;
  if (/\b(?:un\s+)?cuarto\s+de\s+hora\b/.test(t)) return 15;

  const horas = t.match(/\b(\d+(?:[.,]\d+)?)\s*(?:h|hs|hr|hrs|horas?)\b/);
  if (horas) {
    const n = Number(horas[1].replace(",", "."));
    if (n > 0 && n <= 12) return snapToPreset(Math.round(n * 60));
  }

  const mins = t.match(/\b(\d+)\s*(?:m|min|mins|minutos?)\b/);
  if (mins) {
    const n = Number(mins[1]);
    if (n > 0 && n <= 600) return snapToPreset(n);
  }

  // Las palabras clave se comparan con tolerancia (`mismaPalabra`): `issues` y
  // `reviwe` tienen que valer lo mismo que `issue` y `review`, o la lista de
  // Configs habría que llenarla con cada variante. Gana la regla de **menos
  // minutos** entre las que calzan, por lo mismo que el default se equivoca a la
  // baja: subir un estimado es un click, y una agenda inflada deja de mirarse.
  const palabras = palabrasComparables(title);
  let elegido: number | undefined;
  for (const regla of rules) {
    if (!regla.words.some((k) => algunaEs(palabras, k))) continue;
    if (elegido === undefined || regla.minutes < elegido) elegido = regla.minutes;
  }
  return elegido;
}

// ---------------------------------------------------------------------------
// Canal
// ---------------------------------------------------------------------------

/**
 * El canal que nombra el título. Tres formas, en este orden:
 *
 * 1. **El `#canal` escrito a mano.** Es una intención, no una coincidencia, y va
 *    primero por eso. Se compara **exacto**: si alguien escribe `#docs-api` y ese
 *    canal no existe, caer en `docs` es peor que no calzar.
 * 2. **Una palabra mapeada en Configs** (`issues`, `soporte`, `tickets` →
 *    `#incidencias`). Con tolerancia, así que el singular y un typo también.
 * 3. **El nombre del canal**, aparecido en la frase. Entre varios gana el más
 *    largo: entre el contexto `Projects` y su canal `#projects-api`, el segundo
 *    dice más.
 */
export function suggestCategoryId(
  title: string,
  categories: Category[],
  rules: ChannelRule[] = [],
): number | undefined {
  const t = normalize(title);

  const etiquetado = categories.find((c) => calzaNombre(t, normalize(c.name), true));
  if (etiquetado) return etiquetado.id;

  const palabras = palabrasComparables(title);
  for (const regla of rules) {
    if (!categories.some((c) => c.id === regla.categoryId)) continue;
    if (regla.words.some((w) => algunaEs(palabras, w))) return regla.categoryId;
  }

  let mejor: Category | undefined;
  for (const c of categories) {
    const nombre = normalize(c.name);
    if (nombre.length < 3) continue;
    // Un nombre de una sola palabra se compara con tolerancia, igual que las
    // reglas; uno compuesto (`docs-api`, `Weekly review`) se busca literal, que
    // es donde los bordes importan y la tolerancia solo agregaría falsos.
    const calza = /^[a-z0-9]+$/.test(nombre)
      ? palabras.some((w) => mismaPalabra(w, nombre))
      : calzaNombre(t, nombre);
    if (calza && (!mejor || nombre.length > normalize(mejor.name).length)) mejor = c;
  }
  return mejor?.id;
}

/**
 * Si el nombre aparece **entero** en el título. Los bordes son lo que importa:
 * sin ellos el canal `Docs` se activaría dentro de "documentación", que no habla
 * de él. Con `conNumeral`, solo cuenta si viene escrito como `#docs`.
 */
function calzaNombre(tituloNorm: string, nombre: string, conNumeral = false): boolean {
  const esc = nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const antes = conNumeral ? "#" : "#?";
  // El guion cuenta como parte del nombre en los dos bordes: `#docs-api` no es
  // el canal `docs`, y `sub-docs` tampoco.
  return new RegExp(`(?:^|[^a-z0-9_-])${antes}${esc}(?![a-z0-9_-])`).test(tituloNorm);
}

/**
 * El título sin el `#canal` que ya quedó guardado en su propio campo.
 *
 * Es la misma regla que los links del título (§4.4): lo que se capturó en un
 * campo sale del texto, o la tarea se llama "Actualizar el changelog #docs" y
 * arrastra el canal escrito dos veces en cada card. Se limita al `#etiqueta`
 * —una anotación, no prosa— y **no** toca el nombre suelto: "reunión con
 * Meetings" es una frase, y recortarla la rompe.
 *
 * Se aplica **al crear y no al tipear**, por lo mismo que la cosecha de links
 * espera a que la URL esté cerrada: borrarle el `#docs` a alguien que todavía
 * está escribiendo `#docs-api` le come lo que acaba de teclear.
 */
export function stripChannelTag(title: string, category: Category | null | undefined): string {
  if (!category) return title;
  const esc = category.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Sobre el título crudo y no sobre el normalizado: lo que se devuelve es el
  // texto tal cual lo escribió el usuario, menos la etiqueta.
  const re = new RegExp(`(?:^|\\s)#${esc}(?![\\p{L}\\p{N}_-])`, "iu");
  return title
    .replace(re, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Objetivo
// ---------------------------------------------------------------------------

/**
 * El objetivo de la semana que calza con el título, **o ninguno**.
 *
 * El umbral es lo importante y no la métrica: dos palabras significativas en
 * común, o una sola si es larga (≥6). Con menos que eso el objetivo aparecería
 * puesto por casualidad, y un objetivo equivocado es peor que ninguno — se
 * guarda igual y nadie lo revisa.
 */
export function suggestObjectiveId(title: string, objectives: Objective[]): number | undefined {
  const propios = new Set(tokens(title).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
  if (propios.size === 0) return undefined;

  let mejor: { id: number; score: number; largo: number } | undefined;
  for (const o of objectives) {
    const suyos = tokens(o.title).filter((w) => w.length >= 4 && !STOPWORDS.has(w));
    // La misma tolerancia que las palabras clave: "importadores" y "importador"
    // son la misma palabra, y quien escribe rápido no elige cuál le sale.
    const comunes = [...new Set(suyos)].filter((w) => [...propios].some((p) => mismaPalabra(p, w)));
    if (comunes.length === 0) continue;
    const largo = Math.max(...comunes.map((w) => w.length));
    if (comunes.length < 2 && largo < 6) continue;
    if (
      !mejor ||
      comunes.length > mejor.score ||
      (comunes.length === mejor.score && largo > mejor.largo)
    ) {
      mejor = { id: o.id, score: comunes.length, largo };
    }
  }
  return mejor?.id;
}

/**
 * Todo junto, que es como lo consume el modal: una función del título actual, no
 * un acumulado. Borrar "reunión" del título tiene que **sacar** los 30 minutos,
 * y eso solo pasa si la sugerencia se recalcula entera en cada tecla.
 */
export function suggestFromTitle(
  title: string,
  categories: Category[],
  objectives: Objective[],
  rules: SuggestRules = { time: DEFAULT_TIME_RULES, channel: [] },
): Suggestion {
  const out: Suggestion = {};
  const minutes = suggestMinutes(title, rules.time);
  if (minutes !== undefined) out.minutes = minutes;
  const categoryId = suggestCategoryId(title, categories, rules.channel);
  if (categoryId !== undefined) out.categoryId = categoryId;
  const objectiveId = suggestObjectiveId(title, objectives);
  if (objectiveId !== undefined) out.objectiveId = objectiveId;
  return out;
}
