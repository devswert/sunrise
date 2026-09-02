/**
 * Las reglas del sugeridor del modal de crear: **qué palabra significa cuántos
 * minutos, y qué palabra significa qué canal** (§4.31).
 *
 * Son ajustes y no constantes porque el vocabulario es de quien escribe: quien
 * trabaja con tickets quiere que `soporte`, `issues` y `tickets` caigan en su
 * canal de incidencias, y eso no hay forma de adivinarlo. La lista de tiempos
 * arranca con un default razonable; la de canales arranca **vacía**, porque los
 * canales los inventa cada uno.
 *
 * **Una palabra por idea alcanza**: el que compara es `mismaPalabra`, que ya
 * perdona el plural y un typo. Llenar la lista con cada variante no la mejora, la
 * vuelve imposible de mantener.
 *
 * Se guardan como JSON en un `setting` por lista, con la doctrina de
 * `collapsed_weekdays`: **ausente ⇒ el default, presente ⇒ lo que diga, incluso
 * vacío**. Vaciar la lista de tiempos es una decisión válida —"no me adivines el
 * tiempo"— y tiene que sobrevivir a un reinicio.
 */

export interface TimeRule {
  minutes: number;
  words: string[];
}

export interface ChannelRule {
  categoryId: number;
  words: string[];
}

export interface SuggestRules {
  time: TimeRule[];
  channel: ChannelRule[];
}

/**
 * El vocabulario de fábrica: **veintiuna palabras, no cincuenta**.
 *
 * Corta a propósito. Una lista larga se lee como algo cerrado —"esto ya está
 * resuelto"— y lo que hay que invitar es lo contrario: agregar las palabras
 * propias, que son las que de verdad se escriben. Cada fila trae los verbos que
 * aparecen en casi cualquier tarea y nada más; los sinónimos no hacen falta
 * (`contestar` junto a `responder`) porque el que quiera ese los agrega en dos
 * segundos, y el plural y los typos ya los toma `mismaPalabra`.
 *
 * Se equivoca **a la baja** a propósito: corregir 15 → 60 es un click, y una
 * agenda inflada por defecto hace que el número deje de mirarse.
 *
 * Ninguna palabra se parece a otra de la lista por encima del umbral (la más
 * cercana es `correo`/`ajustar`, lejos). Si agregas una acá, verificá lo mismo: dos
 * palabras parecidas con tiempos distintos hacen que el chip lo decida el
 * desempate y no lo que se escribió.
 */
export const DEFAULT_TIME_RULES: TimeRule[] = [
  { minutes: 15, words: ["llamar", "responder", "avisar", "agendar", "correo", "mensaje"] },
  { minutes: 30, words: ["revisar", "reunión", "leer", "actualizar", "ajustar", "probar"] },
  {
    minutes: 60,
    words: ["escribir", "preparar", "documentar", "diseñar", "investigar", "informe"],
  },
  { minutes: 120, words: ["implementar", "migrar", "refactorizar"] },
];

/** Limpia una lista escrita a mano: sin vacíos, sin repetidas, sin espacios. */
export function cleanWords(words: readonly string[]): string[] {
  const out: string[] = [];
  for (const w of words) {
    const t = w.trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/**
 * Lo tecleado en el campo de una fila, convertido en palabras. Corta por coma
 * porque pegar `issues, soporte, tickets` de una vez tiene que dejar tres pills y
 * no una sola con comas adentro.
 */
export function textToWords(text: string): string[] {
  return cleanWords(text.split(","));
}

/**
 * Un JSON de ajustes **nunca se confía**: puede estar a mano, venir de una
 * versión vieja o traer basura. Todo lo que no calce con la forma esperada se
 * descarta en silencio, regla por regla — una fila rota no puede apagar la lista
 * entera.
 */
function parseArray(raw: string | undefined): unknown[] | null {
  if (raw == null) return null;
  const t = raw.trim();
  if (t === "") return [];
  try {
    const v = JSON.parse(t);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function parseTimeRules(raw: string | undefined): TimeRule[] {
  const arr = parseArray(raw);
  if (arr === null) return DEFAULT_TIME_RULES;
  const out: TimeRule[] = [];
  for (const it of arr) {
    if (typeof it !== "object" || it === null) continue;
    const { minutes, words } = it as { minutes?: unknown; words?: unknown };
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) continue;
    if (!Array.isArray(words)) continue;
    const clean = cleanWords(words.filter((w): w is string => typeof w === "string"));
    if (clean.length === 0) continue;
    out.push({ minutes: Math.round(minutes), words: clean });
  }
  return out;
}

/**
 * Los canales arrancan vacíos, así que acá **ausente y vacío significan lo
 * mismo**: no hay ninguna palabra mapeada todavía. No hay default que proteger.
 */
export function parseChannelRules(raw: string | undefined): ChannelRule[] {
  const arr = parseArray(raw) ?? [];
  const out: ChannelRule[] = [];
  for (const it of arr) {
    if (typeof it !== "object" || it === null) continue;
    const { categoryId, words } = it as { categoryId?: unknown; words?: unknown };
    if (typeof categoryId !== "number" || !Number.isInteger(categoryId)) continue;
    if (!Array.isArray(words)) continue;
    const clean = cleanWords(words.filter((w): w is string => typeof w === "string"));
    if (clean.length === 0) continue;
    out.push({ categoryId, words: clean });
  }
  return out;
}

/** Lo que se guarda. Una regla sin palabras no se escribe: no dice nada. */
export function serializeRules(rules: Array<TimeRule | ChannelRule>): string {
  return JSON.stringify(rules.filter((r) => cleanWords(r.words).length > 0));
}
