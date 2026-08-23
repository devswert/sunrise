import type { CSSProperties } from "react";
import type { Category } from "../../lib/types";

/**
 * Las custom properties del chip de un canal: su color y el texto que se lee
 * encima (`--lavender` / `--lavender-ink`).
 *
 * Vive aparte porque **son tres los que dibujan el mismo chip** —la card de la
 * semana, el modal de detalle y `CategoryTag`— y escribir las variables en cada
 * uno es la forma de que se separen con el primer ajuste. El `-ink` sigue al tema
 * (ver el bloque de la paleta en `tokens.css`), así que acá no hay nada que
 * decidir: se nombra el token y el tema resuelve.
 */
export function chipVars(category: Category | null | undefined): CSSProperties | undefined {
  if (!category) return undefined;
  return {
    "--tag-bg": `var(--${category.color})`,
    "--tag-ink": `var(--${category.color}-ink)`,
  } as CSSProperties;
}
