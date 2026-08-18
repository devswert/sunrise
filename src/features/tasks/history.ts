import type { TaskEvent } from "../../lib/types";
import { relativeTime, shortDate } from "../../lib/date";

/**
 * Texto del evento: "Moviste la fecha de inicio al 6 ago".
 *
 * **Sin sujeto explícito.** Hubo un "Tú" al frente de cada línea (y antes que
 * eso, un nombre propio hardcodeado), y leído en fila sonaba a robot llenando
 * un formulario. El español conjuga la persona en el verbo, así que "Moviste"
 * ya dice quién sin necesidad del pronombre — y donde no importa quién fue, la
 * línea se vuelve impersonal ("Se creó la tarea").
 */
export function describeTaskEvent(e: TaskEvent): string {
  // Sin fecha no hay "fecha de inicio" que mover: la tarea se fue al backlog, y
  // decirlo así evita el "…la fecha de inicio al backlog" que salía de traducir
  // la plantilla en inglés tal cual.
  const move = (s: string | null) =>
    s ? `Moviste la fecha de inicio al ${shortDate(s)}` : "Moviste la tarea al backlog";
  switch (e.type) {
    case "CREATED":
      return "Se creó la tarea";
    // Los dos comparten texto a propósito: para quien lee el historial, fijar
    // la fecha por primera vez y cambiarla después son el mismo hecho.
    case "START_DATE_SET":
      return move(e.toDate);
    case "MOVED":
      return move(e.toDate);
    // La app como sujeto explícito, que es lo que este evento vino a distinguir:
    // "Moviste" diría que fuiste tú, y no fuiste tú.
    case "CARRIED_OVER":
      return e.fromDate
        ? `sunrise la arrastró sola desde el ${shortDate(e.fromDate)}`
        : "sunrise la arrastró sola";
    default:
      return e.type;
  }
}

/** Línea completa del historial, con antigüedad: "… · hace 1 sem". */
export function taskEventLine(e: TaskEvent, now?: Date): string {
  const rel = relativeTime(e.at, now);
  return rel ? `${describeTaskEvent(e)} · ${rel}` : describeTaskEvent(e);
}

/** Extrae URLs de un texto (para mostrar links detectados en las notas). */
export function extractLinks(text: string | null): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s)]+/g);
  return matches ? Array.from(new Set(matches)) : [];
}
