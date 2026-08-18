import { parseISODate } from "../../lib/date";

/**
 * Al cambiar el día, ¿hay que mover el ancla de la semana? `null` = dejarla.
 *
 * Dos casos en los que **no** se toca, y los dos importan:
 *
 * 1. El usuario navegó a otra semana a propósito (la visible no contenía el
 *    "hoy" anterior). Saltarle la vista bajo el cursor porque cambió la fecha
 *    sería peor que quedarse quieto.
 * 2. El día nuevo cae en la misma semana visible —dormir el viernes y despertar
 *    el domingo—. Mover el ancla ahí daría las mismas siete fechas, pero con un
 *    objeto `Date` nuevo: `weekDates` y la recarga del board correrían de gusto.
 */
export function anchorAfterDayChange(
  fechasVisibles: string[],
  hoyPrevio: string,
  hoyNuevo: string,
): Date | null {
  if (!fechasVisibles.includes(hoyPrevio)) return null;
  if (fechasVisibles.includes(hoyNuevo)) return null;
  return parseISODate(hoyNuevo);
}
