/**
 * Agrupar tiempo por channel o por contexto, con su nombre y su color.
 *
 * Vive en `lib/` y no en una feature porque lo usan la weekly review (barras y
 * donut de la semana) y la bitácora (donut del día), y las dos tienen que pintar
 * el mismo channel del mismo color.
 */
import type { Category, RollupCell } from "./types";

/** Un trozo de barra o de donut: una categoría con su tiempo. */
export interface Segmento {
  /** `cat-3` o `sin-categoria`. Sirve de `key` de React. */
  key: string;
  name: string;
  /** Token de la paleta, ya como `var(--x)`. */
  color: string;
  seconds: number;
}

const SIN_CATEGORIA: Omit<Segmento, "seconds"> = {
  key: "sin-categoria",
  name: "Sin channel",
  // El gris de la UI, no un color de la paleta: no es un channel, es su
  // ausencia. Pintarlo como uno más haría creer que existe.
  color: "var(--faint)",
};

/** Nombre y color de una categoría, con respaldo si ya no existe. */
function etiquetaDe(id: number | null, cats: Map<number, Category>): Omit<Segmento, "seconds"> {
  if (id == null) return SIN_CATEGORIA;
  const c = cats.get(id);
  // Una categoría archivada o borrada deja horas huérfanas: se muestran igual,
  // porque el tiempo ocurrió. Perderlas dejaría el donut sin sumar el total.
  if (!c) return { key: `cat-${id}`, name: "Sin nombre", color: "var(--faint)" };
  return { key: `cat-${id}`, name: c.name, color: `var(--${c.color})` };
}

/**
 * Suma celdas en segmentos, de mayor a menor.
 *
 * `byContext` agrupa por la categoría raíz (`parentId ?? id`), que es como se
 * lee un día o una semana de un vistazo; con `false` agrupa por channel, que es
 * el detalle.
 */
export function groupBy(
  cells: RollupCell[],
  cats: Map<number, Category>,
  byContext: boolean,
): Segmento[] {
  const acc = new Map<string, Segmento>();
  for (const celda of cells) {
    const base = etiquetaDe(byContext ? celda.contextId : celda.categoryId, cats);
    const previo = acc.get(base.key);
    if (previo) previo.seconds += celda.seconds;
    else acc.set(base.key, { ...base, seconds: celda.seconds });
  }
  return [...acc.values()].sort((a, b) => b.seconds - a.seconds);
}
