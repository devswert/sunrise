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
  return chipVarsForColor(category?.color);
}

/**
 * Lo mismo desde el token pelado, para quien no tiene la `Category` a mano: los
 * selectores de canal de Calendarios trabajan sobre `SearchOption`, que lleva el
 * color pero no la categoría entera.
 */
export function chipVarsForColor(color: string | null | undefined): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    "--tag-bg": `var(--${color})`,
    "--tag-ink": `var(--${color}-ink)`,
  } as CSSProperties;
}
