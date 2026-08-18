import {
  pointerWithin,
  rectIntersection,
  closestCorners,
  type CollisionDetection,
} from "@dnd-kit/core";

/**
 * Detección de colisión robusta para el board.
 *
 * Prioriza lo que está bajo el puntero (así la columna entera acepta el drop,
 * incluida su mitad superior donde están el header y "Add task"); si el puntero
 * quedó fuera de todo, cae a intersección de rectángulos y luego a la esquina
 * más cercana, para que la card nunca "se pierda" al arrastrarla entre columnas.
 */
export const boardCollision: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  if (byPointer.length > 0) return byPointer;

  const byRect = rectIntersection(args);
  if (byRect.length > 0) return byRect;

  return closestCorners(args);
};
