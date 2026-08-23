/**
 * Los colores de categoría que ofrece el picker, **en el mismo orden en que se
 * dibujan**: por matiz, para que la grilla se lea como un espectro.
 *
 * Vive acá y no en `SettingsView` porque son dos cosas a la vez: una lista de
 * opciones de UI y **el dominio de valores de `categories.color`**, que guarda el
 * nombre del token (no un hex) y se usa como `var(--${color})`.
 *
 * Son veinticuatro. Cada nombre necesita sus **dos** tokens en `src/styles/tokens.css` —`--x` y
 * `--x-ink`—, y eso lo vigila `tokens.test.ts`: sin el token, `var(--x)` no
 * resuelve a nada y el punto sale transparente sin un solo error en consola.
 *
 * **Agregar es compatible hacia atrás; renombrar o quitar no**, porque las
 * categorías guardadas quedarían apuntando a un token que ya no existe.
 * Reordenar sí es gratis: el orden no se guarda en ninguna parte.
 */
export const PALETTE = [
  "rose",
  "apricot",
  "peach",
  "amber",
  "butter",
  "khaki",
  "olive",
  "lime",
  "sage",
  "fern",
  "mint",
  "seafoam",
  "jade",
  "aqua",
  "mist",
  "ice",
  "teal",
  "azure",
  "sky",
  "periwinkle",
  "lavender",
  "mauve",
  "lilac",
  "orchid",
] as const;

export type PaletteColor = (typeof PALETTE)[number];
