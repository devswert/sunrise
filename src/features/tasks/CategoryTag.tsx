import type { Category } from "../../lib/types";
import { chipVars } from "./chipVars";

/**
 * Chip de categoría: punto de color + nombre (estilo #tag).
 *
 * Las variables salen de `chipVars`, compartido con la card de la semana y el
 * modal de detalle: los tres dibujan el mismo chip y tienen que seguir haciéndolo.
 */
export function CategoryTag({ category }: { category: Category | null | undefined }) {
  if (!category) return null;
  return (
    <span className="cat-tag" style={chipVars(category)}>
      <span className="cat-tag__dot" aria-hidden />
      {category.name}
    </span>
  );
}
