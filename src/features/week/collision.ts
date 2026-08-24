import {
  pointerWithin,
  rectIntersection,
  closestCorners,
  type Collision,
  type CollisionDescriptor,
  type CollisionDetection,
  type DroppableContainer,
} from "@dnd-kit/core";

/**
 * ¿Este droppable es el backlog?
 *
 * La marca es **el destino nulo**, no un flag aparte, y eso no es un atajo: las
 * cards del panel ya viajan con `date: task.scheduledDate` (ver `TaskCard`), que
 * para una tarea del backlog es `null`, igual que el contenedor del panel. Un
 * flag nuevo habría que enchufárselo también a `TaskCard`, que es compartida con
 * las columnas de día.
 *
 * Se exige que `date` **esté** en los datos: un droppable sin datos daría
 * `undefined == null` y pasaría por backlog sin ser ninguno.
 */
function isBacklog(container: DroppableContainer): boolean {
  const data = container.data.current;
  return data != null && "date" in data && data.date == null;
}

function hitsBacklog(collision: Collision): boolean {
  const container = (collision as CollisionDescriptor).data?.droppableContainer;
  return container != null && isBacklog(container);
}

/**
 * Detección de colisión del board, en dos etapas y con el backlog aparte.
 *
 * La cascada base —puntero, luego intersección de rectángulos, luego esquina más
 * cercana— existe para que la columna entera acepte el drop (incluida su mitad
 * superior, donde están el header y "Agregar tarea") y para que la card **nunca
 * se pierda** al arrastrarla entre columnas. No se simplifica a un solo
 * detector: cada escalón cubre un caso que los otros no.
 *
 * Encima de eso, el panel de backlog necesita dos reglas propias, y las dos
 * salen de que es un panel **superpuesto** a una columna:
 *
 * 1. **Si el puntero está en el backlog, gana el backlog.** dnd-kit ignora por
 *    completo el `z-index`: la columna que el panel tapa sigue teniendo su
 *    rectángulo, así que un drop dentro del panel produce al menos dos
 *    colisiones y `pointerWithin` las ordena por distancia al centro. El panel
 *    mide 300px y la columna 236px, así que la columna escondida puede ganar — y
 *    la tarea terminaría agendada en un día que no se ve. La geometría no puede
 *    resolver esto sola; hay que decidirlo acá.
 * 2. **El backlog no participa de los dos fallbacks... salvo sin puntero.**
 *    `closestCorners` nunca devuelve vacío, así que sin la exclusión una card
 *    soltada sobre espacio muerto puede terminar desagendándose sola, que es
 *    justo el movimiento que nadie pidió. La excepción del puntero **no es
 *    decorativa**: el `KeyboardSensor` no tiene coordenadas, `pointerWithin`
 *    devuelve `[]`, y los fallbacks son el único camino que le queda — con la
 *    exclusión siempre puesta, el backlog sería inalcanzable por teclado.
 */
export const boardCollision: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  const backlogHits = byPointer.filter(hitsBacklog);
  if (backlogHits.length > 0) return backlogHits;
  if (byPointer.length > 0) return byPointer;

  // Sin puntero (teclado) los fallbacks son el único camino, así que no se les
  // saca nada. Con puntero, al backlog solo se llega estando dentro de él.
  const fallbackArgs =
    args.pointerCoordinates == null
      ? args
      : { ...args, droppableContainers: args.droppableContainers.filter((c) => !isBacklog(c)) };

  const byRect = rectIntersection(fallbackArgs);
  if (byRect.length > 0) return byRect;

  return closestCorners(fallbackArgs);
};
