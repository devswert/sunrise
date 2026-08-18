import type { CSSProperties } from "react";
import type { Category } from "../../lib/types";

/** Chip de categoría: punto de color + nombre (estilo #tag). */
export function CategoryTag({ category }: { category: Category | null | undefined }) {
  if (!category) return null;
  // Custom properties del token de paleta (ej. --lavender / --lavender-ink).
  const style = {
    "--tag-bg": `var(--${category.color})`,
    "--tag-ink": `var(--${category.color}-ink)`,
  } as CSSProperties;
  return (
    <span className="cat-tag" style={style}>
      <span className="cat-tag__dot" aria-hidden />
      {category.name}
    </span>
  );
}
