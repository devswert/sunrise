/**
 * La etiqueta de un channel, en un solo lugar (#9).
 *
 * El `#` lo pone la app, no el nombre: un channel creado como "#foo" se veía
 * "##foo" o "# #foo" según la vista, porque cada chip sumaba el suyo. Crear y
 * renombrar ya quitan los `#` del comienzo, pero los nombres guardados antes
 * siguen con el suyo, así que mostrar también los tolera — sin migración.
 */
import type { Category } from "./types";

/** El nombre sin los `#` del comienzo: lo que se guarda y lo que va sin numeral. */
export function bareName(name: string): string {
  return name.trim().replace(/^#+/, "").trim();
}

/** `#nombre`, con un solo numeral aunque el nombre ya traiga el suyo. */
export function channelLabel(name: string): string {
  return `#${bareName(name)}`;
}

/** El `#` lo llevan los channels, no los contextos (la regla de `channelOptions`). */
export function categoryLabel(category: Pick<Category, "name" | "parentId">): string {
  return category.parentId != null ? channelLabel(category.name) : bareName(category.name);
}
