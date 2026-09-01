import { Clock, StickyNote } from "lucide-react";
import type { Task } from "../../lib/types";
import { MeetingLink } from "./MeetingLink";
import { AttendeeList } from "./Participantes";
import { readableDescription } from "./descripcion";

/** '2026-08-13T19:00:00Z' → '4:00 PM' en hora local. */
function hora12(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // `en-US` y no el locale del usuario: es el formato del diseño (4:00 PM), y
  // `es-CL` daría 16:00, que no es lo pedido.
  return d
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })
    .replace(/ /g, " ");
}

/** '4:00 PM - 4:30 PM', o solo el inicio si no hay fin. */
export function timeRange(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const a = hora12(start);
  if (!a) return null;
  const b = end ? hora12(end) : "";
  return b ? `${a} - ${b}` : a;
}

/**
 * Si la tarea trae algo del calendario, y por lo tanto la tarjeta se dibuja.
 *
 * Se exporta porque quien la muestra a veces necesita saberlo antes: en Focus,
 * la línea que separa las notas solo tiene sentido si hay una tarjeta arriba de
 * la que separarlas.
 */
export function hasCalendarData(task: Task): boolean {
  const range = timeRange(task.eventStart, task.eventEnd);
  const description = task.eventDescription ? readableDescription(task.eventDescription) : "";
  return Boolean(range || task.meetingUrl || task.attendees.length > 0 || description);
}

/**
 * Bloque de datos del evento en el detalle de una tarea importada.
 *
 * Todo lo de acá es **de solo lectura**: lo escribe el feed, no tú. Va arriba de
 * las notas y separado por una línea, porque el orden en que uno lo necesita
 * antes de una reunión es: a qué hora, por dónde entro, quién viene, de qué se
 * trata. Las notas propias van después.
 *
 * No se renderiza si la tarea no trae nada del calendario — que es el caso de
 * cualquier tarea escrita a mano, y también de una reunión importada de un
 * calendario compartido "ocultando los detalles".
 */
export function CalendarEventCard({ task }: { task: Task }) {
  const range = timeRange(task.eventStart, task.eventEnd);
  const description = task.eventDescription ? readableDescription(task.eventDescription) : "";
  if (!hasCalendarData(task)) return null;

  return (
    <div className="evento">
      {range && (
        <div className="evento__fila">
          <Clock size={14} className="evento__icono" aria-hidden />
          <span className="evento__hora">{range}</span>
        </div>
      )}

      <MeetingLink url={task.meetingUrl} />

      <AttendeeList gente={task.attendees} />

      {description && (
        <div className="evento__fila evento__desc">
          <StickyNote size={14} className="evento__icono" aria-hidden />
          {/* Texto y no markdown ni HTML: la descripción de Google llega con
           * etiquetas dentro. Se convierte a texto legible (ver `descripcion.ts`)
           * y el salto de línea lo respeta el CSS. Inyectarla como HTML sería un
           * agujero de XSS por una invitación de calendario. */}
          <span>{description}</span>
        </div>
      )}
    </div>
  );
}
