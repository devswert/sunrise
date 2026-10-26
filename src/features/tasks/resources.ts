/**
 * Los links que se pegan en el título de una tarea.
 *
 * Un link pegado en el título **no se queda ahí**: se lo lleva la lista de
 * recursos, y de ahí a las notas, bajo una sección `# Recursos:`. Las notas son
 * el único lugar donde vive un link —el detalle dibuja sus chips con
 * `extractLinks(notes)` (§4.4)—, así que darle una sección propia es lo que hace
 * que el título quede limpio sin que el link se pierda ni haya que inventarle
 * una columna.
 */

/** El encabezado de la sección, tal cual se escribe en las notas. */
const HEADING = "# Recursos:";
/** La misma línea, para reconocerla en unas notas que ya la tienen. */
const HEADING_RE = /^#+\s*Recursos:?\s*$/im;
/** Un link suelto. El mismo patrón que `extractLinks`, o se copiaría algo que después no se dibuja. */
const URL_RE = /https?:\/\/[^\s)]+/g;

export interface Harvest {
  /** El texto sin los links que se cosecharon. */
  text: string;
  /** Los links, en orden y sin repetir. */
  links: string[];
  /** Dónde queda el cursor en `text`, si se pasó uno. */
  caret?: number;
}

/**
 * `String.replace` que además lleva un cursor de un texto al otro.
 *
 * Es lo que deja limpiar el título en cada tecla sin mandar el cursor al final:
 * lo que se quita antes del cursor lo corre lo mismo, y si el cursor cae dentro
 * de un tramo reemplazado queda en lo que sobrevivió de él.
 */
export function replaceKeepingCaret(
  text: string,
  re: RegExp,
  replacer: (match: string, index: number) => string,
  caret?: number,
): { text: string; caret?: number } {
  let moved = caret;
  // El offset es el penúltimo argumento (el último es el texto): leerlo de ahí
  // sigue valiendo si la regex tiene grupos de captura.
  const out = text.replace(re, (match: string, ...args: unknown[]) => {
    const index = args[args.length - 2] as number;
    const repl = replacer(match, index);
    if (caret !== undefined && moved !== undefined && caret > index) {
      const inside = Math.min(caret, index + match.length) - index;
      moved -= inside - Math.min(inside, repl.length);
    }
    return repl;
  });
  return { text: out, caret: moved };
}

/**
 * Saca los links de un texto y los devuelve aparte.
 *
 * `terminatedOnly` es la diferencia entre escribir y pegar, y no es un detalle:
 * `https://g` ya calza con el patrón, así que cosechar en cada tecla se comería
 * la URL a la novena letra y dejaría al que escribe peleando con su propio
 * campo. Mientras se tipea solo cuenta un link **cerrado** —el que tiene un
 * espacio después—; al pegar, el pedazo pegado llega entero y ahí sí se cosecha
 * todo, que es el caso que motivó todo esto.
 *
 * Con `caret`, "cerrado" pide además que el cursor no esté pegado al final de la
 * URL: en la mitad del título siempre hay un espacio después, y sin esto un link
 * escrito entre dos palabras se cosecharía en `https://x`. Y el cursor sale
 * corrido por todo lo que se limpió antes de él.
 */
export function harvestLinks(raw: string, terminatedOnly = false, caret?: number): Harvest {
  const links: string[] = [];
  // Dónde quedó cada link sacado, en coordenadas del texto ya sin ellos.
  const gaps: number[] = [];
  let removed = 0;
  const noLinks = replaceKeepingCaret(
    raw,
    URL_RE,
    (url, index) => {
      if (terminatedOnly) {
        const end = index + url.length;
        const after = raw[end];
        // Sin nada después, o con el cursor en su borde, es una URL que todavía
        // se está escribiendo.
        if (after === undefined || !/\s/.test(after) || end === caret) return url;
      }
      if (!links.includes(url)) links.push(url);
      gaps.push(index - removed);
      removed += url.length;
      return "";
    },
    caret,
  );
  // El hueco que dejó el link no puede quedar como doble espacio. Salvo el que
  // toca el cursor mientras se escribe, si no viene de un link: es el espacio que
  // se acaba de teclear antes de otro, y juntarlo pega la palabra que viene a la
  // siguiente ("el| informe" + " y" → "el yinforme"). `create()` lo junta igual.
  const clean = replaceKeepingCaret(
    noLinks.text,
    /[ \t]{2,}/g,
    (run, index) => {
      const c = noLinks.caret;
      const end = index + run.length;
      const typing =
        terminatedOnly &&
        c !== undefined &&
        c >= index &&
        c <= end &&
        !gaps.some((g) => g >= index && g <= end);
      return typing ? run : " ";
    },
    noLinks.caret,
  );
  // El espacio **final** solo se recorta al pegar: mientras se escribe es el que
  // acaba de cerrar la URL, y comérselo pega la siguiente letra a la palabra
  // anterior ("Escribir el" + "informe" → "Escribir elinforme").
  const text = terminatedOnly ? clean.text : clean.text.replace(/\s+$/, "");
  const moved = clean.caret === undefined ? undefined : Math.min(clean.caret, text.length);
  return caret === undefined ? { text, links } : { text, links, caret: moved };
}

/**
 * Escribe los links en las notas, bajo `# Recursos:`.
 *
 * Si la sección ya está, los suma **como un ítem más** al final de su lista en
 * vez de abrir una segunda sección; si no, la crea al final de las notas. Un
 * link que ya figura en las notas —en la sección o en cualquier párrafo— no se
 * repite: el chip del detalle sale de `extractLinks`, que ya deduplica, así que
 * duplicarlo acá solo ensuciaría el texto.
 */
export function appendResources(notes: string, links: string[]): string {
  const nuevos = links.filter((l) => !notes.includes(l));
  if (nuevos.length === 0) return notes;

  const items = nuevos.map((l) => `* ${l}`).join("\n");
  const base = notes.replace(/\s+$/, "");
  if (!base) return `${HEADING}\n${items}`;

  const heading = base.match(HEADING_RE);
  if (!heading) return `${base}\n\n${HEADING}\n${items}`;

  // Con la sección ya escrita, los ítems van al final de **su** lista: desde el
  // encabezado se avanza mientras las líneas sigan siendo ítems (o estén en
  // blanco), y ahí se corta. Sin eso, una sección seguida de otra cosa se
  // quedaría con los links debajo del párrafo equivocado.
  const lines = base.split("\n");
  let i = lines.findIndex((l) => HEADING_RE.test(l)) + 1;
  let last = i;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*[-*+]\s+/.test(line)) last = i + 1;
    else if (line.trim() !== "") break;
    i++;
  }
  lines.splice(last, 0, items);
  return lines.join("\n");
}
