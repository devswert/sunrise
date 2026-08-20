/**
 * Los atributos que apagan el corrector del webview en un campo que no es prosa.
 *
 * En macOS el webview corrige, subraya en rojo y **capitaliza al salir del
 * campo** todos los `input`, y en un nombre de canal o en el buscador de un
 * dropdown eso no ayuda: no hay nada que corregir y el autocorrector llega a
 * cambiar lo escrito. Se spreadea (`{...PLAIN_INPUT}`) en vez de repetir los
 * tres atributos, así el conjunto es uno solo y se puede grepear.
 *
 * **Se deja el corrector solo donde hay prosa de verdad**: el título y las notas
 * de una tarea. Si dudas de un campo nuevo, la pregunta no es si molesta el
 * subrayado, es si alguien escribiría ahí una frase.
 */
export const PLAIN_INPUT = {
  spellCheck: false,
  autoCorrect: "off",
  autoCapitalize: "off",
} as const;
