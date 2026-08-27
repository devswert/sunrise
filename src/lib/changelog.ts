/**
 * Lee `docs/CHANGELOG.md` y saca de ahí el anuncio de una versión.
 *
 * **Una sola fuente para los dos textos que ve el equipo.** La misma sección del
 * changelog alimenta el cuerpo del Release —que es lo que `AppUpdate.notes`
 * muestra en Configs *antes* de actualizar— y el modal "Lo nuevo" que aparece
 * *después*. Si fueran dos textos separados, se prometería una cosa y se anunciaría
 * otra, y nadie se daría cuenta hasta que ya está publicado.
 *
 * El `?raw` mete el archivo entero al bundle. Es lo que permite que el modal
 * funcione sin red —el updater ya reinició la app, no es momento de pedir una
 * petición HTTP— al precio de cargar todas las versiones anteriores, que son unas
 * pocas decenas de líneas por release.
 */
import changelog from "../../docs/CHANGELOG.md?raw";

/** El encabezado de una versión: `## v0.2.0 — 2026-09-01`. */
const TITULO = /^##\s+v(\d+\.\d+\.\d+)\s*(?:—.*)?$/;
/** El mismo encabezado, quedándose con la fecha. */
const TITULO_CON_FECHA = /^##\s+v(\d+\.\d+\.\d+)\s*—\s*(\d{4}-\d{2}-\d{2})/;

/**
 * El texto completo de la sección de una versión, sin su encabezado.
 *
 * Devuelve `null` si esa versión no está en el changelog, que es un caso real y
 * no un error: una build local puede tener una versión que nadie publicó.
 */
export function sectionFor(version: string, md: string = changelog): string | null {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => TITULO.exec(l.trim())?.[1] === version);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  // Hasta el siguiente `##` (otra versión) o el fin del archivo. Los `###` de
  // adentro son parte de la sección.
  const end = rest.findIndex((l) => /^##\s/.test(l.trim()));
  const cuerpo = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return cuerpo || null;
}

/**
 * El anuncio: el primer párrafo de la sección, que es lo que se muestra en el
 * modal.
 *
 * Corta en el primer subtítulo o en la primera lista, así que el detalle técnico se
 * queda fuera. Eso es a propósito: el anuncio lo lee alguien que solo quiere saber
 * si le conviene actualizar, y una lista de veinte viñetas no responde esa
 * pregunta.
 */
export function announcementFor(version: string, md: string = changelog): string | null {
  const sec = sectionFor(version, md);
  if (!sec) return null;
  const parrafos: string[] = [];
  for (const bloque of sec.split(/\n\s*\n/)) {
    const t = bloque.trim();
    if (!t) continue;
    if (/^#{3,}\s/.test(t) || /^[-*]\s/.test(t)) break;
    parrafos.push(t);
  }
  const anuncio = parrafos.join("\n\n").trim();
  return anuncio || null;
}

/** La versión más nueva escrita en el changelog, o `null` si no hay ninguna. */
export function latestVersion(md: string = changelog): string | null {
  for (const l of md.split("\n")) {
    const v = TITULO.exec(l.trim())?.[1];
    if (v) return v;
  }
  return null;
}

/**
 * El día que se publicó una versión, según su encabezado del changelog.
 *
 * `null` si el encabezado no la trae, que es un caso real: la fecha es opcional en
 * el formato (`TITULO` la deja pasar) y una build local puede no tenerla. Quien la
 * muestre tiene que aguantar que falte, no rellenarla con hoy.
 *
 * No sale del `latest.json` a propósito: el anuncio se lee **después** de
 * reiniciar, cuando ya no hay a quién preguntarle.
 */
export function releaseDateFor(version: string, md: string = changelog): string | null {
  for (const l of md.split("\n")) {
    const m = TITULO_CON_FECHA.exec(l.trim());
    if (m && m[1] === version) return m[2];
  }
  return null;
}
