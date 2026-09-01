import type { Priority } from "../../lib/enums";
import { priorityVar } from "./priority";

/**
 * La marca de un nivel: **punto de color + la etiqueta**, en los cuatro lugares
 * donde aparece (card, detalle, y los dos filtros del backlog).
 *
 * Punto y etiqueta, y no la etiqueta escrita encima del color, por una razón
 * concreta: escribir sobre el color obliga a calibrar un `-ink` por nivel contra
 * las superficies de los dos temas, que es la deuda que dejó la paleta de canales
 * (ver `tokens.css`). Con el punto al lado, el texto es el del tema y el color no
 * tiene que sostener ningún contraste — y de paso el nivel sigue siendo legible
 * para quien no distingue estos cinco matices entre sí.
 *
 * Sin prioridad **no dibuja nada**. Es la misma regla del canal vacío en la card:
 * un punto gris con un guion no es "poner prioridad", es un glifo raro.
 */
export function PriorityTag({
  priority,
  className,
}: {
  priority: Priority | null | undefined;
  className?: string;
}) {
  if (!priority) return null;
  return (
    <span className={`prio-tag${className ? ` ${className}` : ""}`}>
      <span className="prio-tag__dot" style={{ background: priorityVar(priority) }} aria-hidden />
      {priority}
    </span>
  );
}
