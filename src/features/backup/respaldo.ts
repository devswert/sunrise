import { SettingKey, backupSettings, type SettingsMap } from "../../lib/settings";

/**
 * Si corresponde hacer el respaldo automático ahora.
 *
 * Es la misma forma que `tocaAvisarCierre` (M3.6) y por la misma razón: la
 * decisión es pura y se prueba sola, y el hook solo la consulta.
 *
 * Cuatro cortes, en orden de qué tan barato es descartarlos:
 *
 * 0. **En dev no corre.** Dev y producción tienen bases distintas pero la carpeta
 *    de respaldos es una ruta en el disco, no un dato de la base: si restauras un
 *    zip de producción en dev —que es justo el puente entre las dos— dev hereda
 *    `backup_dir`, empieza a escribir zips ahí y **la retención borra los
 *    respaldos de verdad** para dejar los de prueba. El botón manual sigue
 *    funcionando: eso lo pides tú, esto pasa solo.
 * 1. **Sin carpeta configurada no hay respaldo.** No es un error ni algo que
 *    avisar cada minuto: es el estado de fábrica.
 * 2. **Una vez al día.** `backup_ran_on` guarda una fecha y no un booleano —el
 *    mismo patrón de `planned_on`— porque una sesión abierta que cruza la
 *    medianoche tiene que volver a respaldar al día siguiente.
 * 3. **Recién pasada la hora.** La comparación de `HH:mm` como texto es
 *    lexicográfica, y por eso alcanza.
 *
 * El efecto de los dos últimos juntos es que el respaldo **se pone al día**: si
 * la app estaba cerrada a las 20:00 y se abre a las 23:00, se hace ahí mismo. Si
 * se abre al otro día, la fecha guardada ya no es hoy y también se hace. Lo único
 * que no cubre es un día en que la app no se abrió nunca — ver SPECS §4.17.
 */
export function tocaRespaldar(opciones: {
  nowHhmm: string;
  values: SettingsMap;
  hoy: string;
  esDev: boolean;
}): boolean {
  const { nowHhmm, values, hoy, esDev } = opciones;
  if (esDev) return false;
  const { activo, hora } = backupSettings(values);
  if (!activo) return false;
  if (values[SettingKey.BACKUP_RAN_ON]?.trim() === hoy) return false;
  return nowHhmm >= hora;
}

/** `HH:mm` de un `Date`, en hora local. */
export function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Tamaño legible. Base 1024 y una decimal desde los MB: la diferencia entre
 * "1.4 MB" y "1.42 MB" no le dice nada a nadie, pero la que hay entre "900 KB" y
 * "1.4 MB" sí — es cómo se nota que la base creció.
 */
export function formatoBytes(bytes: number): string {
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

export function fechaLegible(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const mes = MESES[Number(m[2]) - 1] ?? m[2];
  return `${Number(m[3])} ${mes}, ${m[4]}:${m[5]}`;
}

/**
 * Igual que `fechaLegible` pero para las marcas **con zona**: el `created_at` del
 * manifest (`to_rfc3339`, con offset) y los `started_at` de `time_entries` (UTC
 * con `Z`).
 *
 * Acá sí se usa `Date`, y justamente porque esas cadenas declaran su zona:
 * convertirlas a la hora local del usuario es lo correcto, no un bug como sería
 * en `fechaLegible`. Incluye el año: la gracia de este dato es enterarse de que
 * el respaldo era más viejo de lo que se creía.
 */
export function momentoLegible(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MESES[d.getMonth()]} ${d.getFullYear()}, ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}`;
}
