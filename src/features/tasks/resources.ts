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
 */
export function harvestLinks(raw: string, terminatedOnly = false): Harvest {
  const links: string[] = [];
  const text = raw.replace(URL_RE, (url, index: number) => {
    if (terminatedOnly) {
      const after = raw[index + url.length];
      // Sin nada después es una URL que todavía se está escribiendo.
      if (after === undefined || !/\s/.test(after)) return url;
    }
    if (!links.includes(url)) links.push(url);
    return "";
  });
  // El hueco que dejó el link no puede quedar como doble espacio. El espacio
  // **final** solo se recorta al pegar: mientras se escribe es el que acaba de
  // cerrar la URL, y comérselo pega la siguiente letra a la palabra anterior
  // ("Escribir el" + "informe" → "Escribir elinforme").
  const limpio = text.replace(/[ \t]{2,}/g, " ");
  return { text: terminatedOnly ? limpio : limpio.replace(/\s+$/, ""), links };
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
