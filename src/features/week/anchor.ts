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

/** Lo que hay que medir del board y de la columna para posicionar el scroll. */
export interface ScrollTarget {
  /** Borde izquierdo de la columna, en coordenadas de viewport. */
  colLeft: number;
  colWidth: number;
  /** Borde izquierdo del contenedor con scroll, en las mismas coordenadas. */
  boardLeft: number;
  /** Ancho visible del contenedor (`clientWidth`), no el de su contenido. */
  boardWidth: number;
  /** Centrar la columna; si no, pegarla al borde izquierdo. */
  center: boolean;
}

/**
 * Cuánto hay que **sumarle** a `scrollLeft` para dejar la columna donde va.
 *
 * Se calcula a mano y contra los rectángulos, sin `scrollIntoView` ni scroll
 * suave: el nativo no está en todos los webviews (ya pasó con las tabs de
 * Configs). Vive acá y no dentro del componente porque es la única parte
 * testeable: jsdom no implementa `scrollLeft` ni devuelve rectángulos, así que un
 * test sobre la posición real pasaría o fallaría por el motivo equivocado.
 *
 * No hace falta acotar el resultado: asignar `scrollLeft` fuera de rango lo
 * recorta el navegador, así que centrar un día de la primera semana simplemente
 * llega al principio.
 */
export function scrollDelta(t: ScrollTarget): number {
  const offset = t.colLeft - t.boardLeft;
  if (!t.center) return offset;
  return offset - (t.boardWidth - t.colWidth) / 2;
}
