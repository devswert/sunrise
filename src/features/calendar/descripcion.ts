/**
 * Convierte la descripción de un evento a texto legible.
 *
 * Google manda el `DESCRIPTION` con **HTML crudo dentro**: `<br>`, `<ul>`,
 * `<li>`, `<b>`… Mostrarlo tal cual deja la pantalla llena de etiquetas a la
 * vista, y renderizarlo como markdown tampoco sirve porque markdown no es HTML.
 * Tampoco se puede inyectar como HTML: viene de un tercero y sería un agujero de
 * XSS por una descripción de calendario.
 *
 * Así que se convierte a texto: las etiquetas que significan un salto se vuelven
 * salto, las viñetas se vuelven "•", el resto se descarta y las entidades se
 * decodifican.
 *
 * Se hace **al mostrar y no al importar** para no perder el original: si algún
 * día se quiere renderizar de verdad, el dato sigue completo en la base.
 */
export function descripcionLegible(html: string): string {
  let t = html;

  // Bloques que separan párrafos, antes de borrar el resto de las etiquetas.
  t = t.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  t = t.replace(/<\s*\/\s*(p|div|tr|h[1-6])\s*>/gi, "\n");
  t = t.replace(/<\s*\/\s*(ul|ol)\s*>/gi, "\n");
  // Cada item de lista arranca con viñeta; el cierre solo salta de línea.
  t = t.replace(/<\s*li[^>]*>/gi, "• ");
  t = t.replace(/<\s*\/\s*li\s*>/gi, "\n");

  // El resto de las etiquetas se va: negritas y links no aportan en texto plano,
  // y el href ya aparece como texto en las descripciones de Google.
  t = t.replace(/<[^>]*>/g, "");

  t = decodificarEntidades(t);

  // ICS escapa comas, punto y coma y saltos con backslash (RFC 5545 §3.3.11).
  t = t.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

  // Deja como mucho una línea en blanco seguida: Google mete varias.
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

  return t.trim();
}

/** Las entidades que aparecen en la práctica, más las numéricas. */
function decodificarEntidades(s: string): string {
  const nombradas: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&apos;": "'",
    "&nbsp;": " ",
    "&hellip;": "…",
    "&mdash;": "—",
    "&ndash;": "–",
  };
  let out = s.replace(/&[a-z]+;|&#39;/gi, (m) => nombradas[m.toLowerCase()] ?? m);
  // Numéricas: `&#8226;` y `&#x1F44B;`. Un código inválido se deja como está en
  // vez de romper el texto entero.
  out = out.replace(/&#(\d+);/g, (m, n) => seguro(() => String.fromCodePoint(Number(n))) ?? m);
  out = out.replace(/&#x([0-9a-f]+);/gi, (m, n) =>
    seguro(() => String.fromCodePoint(Number.parseInt(n, 16))) ?? m,
  );
  return out;
}

function seguro(f: () => string): string | null {
  try {
    return f();
  } catch {
    return null;
  }
}
