import type { Task } from "../../lib/types";

/**
 * Reordena una lista de tareas **en memoria**, igual que `repo::move_task`.
 *
 * Existe para que el tablero se vea reordenado en el mismo frame en que sueltas
 * la card, sin esperar la escritura. Sin esto la card volvía a su lugar viejo al
 * desaparecer el overlay y entraba deslizándose desde arriba cuando llegaban los
 * datos: dos animaciones para un gesto que ya había terminado.
 *
 * Es una copia deliberada de la aritmética de Rust, no una simplificación: si
 * las dos no coinciden, la recarga que viene después corrige la lista a la vista
 * y se ve un salto. `position` es el índice **final**, contando que la tarea ya
 * salió de la lista, y el grupo destino queda renumerado 0..n.
 *
 * Lo que **no** replica —y no puede— es el salteo de las `ORPHANED`: los
 * listados del front ya las filtran (`source_state = 'ACTIVE'`), así que acá no
 * hay ninguna que saltear.
 */
export function reorderLocal(
  tasks: Task[],
  task: Task,
  date: string | null,
  position: number,
): Task[] {
  const resto = tasks.filter((t) => t.id !== task.id);
  const destino = resto.filter((t) => (t.scheduledDate ?? null) === date);
  const at = Math.min(Math.max(position, 0), destino.length);
  const nuevoOrden = [
    ...destino.slice(0, at),
    { ...task, scheduledDate: date, position: at },
    ...destino.slice(at),
  ];
  const posiciones = new Map(nuevoOrden.map((t, i) => [t.id, i]));

  const fuera = resto.filter((t) => (t.scheduledDate ?? null) !== date);
  return [
    ...fuera,
    ...nuevoOrden.map((t) => ({ ...t, position: posiciones.get(t.id) ?? t.position })),
  ];
}
