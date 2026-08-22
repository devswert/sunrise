/**
 * **La decisión de cuándo respaldar ya no vive acá: está en Rust**
 * (`backup::should_backup`), con sus mismos cuatro cortes y sus tests.
 *
 * Se movió con el vigilante, y por la razón de la invariante I6: esto corría en
 * un `setInterval` del webview de `main`, que **no corre sus timers cuando la
 * ventana no se ve**, así que el respaldo llegaba cuando alguien miraba la app y
 * no a la hora que pediste. Lo que queda en este archivo es solo formato.
 */

/**
 * Tamaño legible. Base 1024 y una decimal desde los MB: la diferencia entre
 * "1.4 MB" y "1.42 MB" no le dice nada a nadie, pero la que hay entre "900 KB" y
 * "1.4 MB" sí — es cómo se nota que la base creció.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * `2026-08-17T20:03:15` → `17 ago, 20:03`.
 *
 * Se parsea a mano y no con `new Date()`: la cadena viene sin zona (el nombre del
 * archivo no la guarda), y `Date` la interpretaría como hora local en algunos
 * motores y como UTC en otros. Un respaldo de las 20:03 no puede mostrarse como
 * las 16:03 según el navegador.
 */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function readableDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const mes = MESES[Number(m[2]) - 1] ?? m[2];
  return `${Number(m[3])} ${mes}, ${m[4]}:${m[5]}`;
}

/**
 * Igual que `readableDate` pero para las marcas **con zona**: el `created_at` del
 * manifest (`to_rfc3339`, con offset) y los `started_at` de `time_entries` (UTC
 * con `Z`).
 *
 * Acá sí se usa `Date`, y justamente porque esas cadenas declaran su zona:
 * convertirlas a la hora local del usuario es lo correcto, no un bug como sería
 * en `readableDate`. Incluye el año: la gracia de este dato es enterarse de que
 * el respaldo era más viejo de lo que se creía.
 */
export function readableMoment(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}
