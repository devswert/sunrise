import type { Category } from "../../lib/types";
import { chipVars } from "./chipVars";

/**
 * Chip de categoría: el nombre teñido con el color del canal (estilo #tag).
 *
 * **Sin punto adentro.** El chip ya está pintado con el color —fondo al 35% y el
 * `-ink` encima—, así que el punto repetía el mismo dato dos veces en 60px. El
 * punto sigue donde sí hace falta: en las listas sin tinte (las opciones del
 * select, los rótulos de columna del backlog), donde el color no está en ningún
 * otro lado.
 *
 * Las variables salen de `chipVars`, compartido con la card de la semana y el
 * modal de detalle: los tres dibujan el mismo chip y tienen que seguir haciéndolo.
 */
export function CategoryTag({ category }: { category: Category | null | undefined }) {
  if (!category) return null;
  return (
    <span className="cat-tag" style={chipVars(category)}>
      {category.name}
    </span>
  );
}
