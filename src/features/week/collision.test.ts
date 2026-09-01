import { describe, expect, it } from "vitest";
import type { ClientRect, DroppableContainer, UniqueIdentifier } from "@dnd-kit/core";
import { boardCollision } from "./collision";

function rect(left: number, right: number): ClientRect {
  return { left, right, top: 0, bottom: 800, width: right - left, height: 800 };
}

function droppable(id: string, date: string | null): DroppableContainer {
  return {
    id,
    key: id,
    data: { current: { type: "column", date } },
    disabled: false,
    node: { current: null },
    rect: { current: null },
  } as unknown as DroppableContainer;
}

/**
 * El panel se superpone a la columna: sus dos rectángulos se pisan a propósito,
 * porque es la geometría real y es la que destapa el problema.
 */
const COLUMN = droppable("day-2026-08-21", "2026-08-21");
const PANEL = droppable("backlog-panel", null);
const RECTS = new Map<UniqueIdentifier, ClientRect>([
  [COLUMN.id, rect(0, 236)],
  [PANEL.id, rect(0, 300)],
]);

function collide({
  pointer,
  draggedRect = rect(0, 100),
  containers = [COLUMN, PANEL],
}: {
  pointer: { x: number; y: number } | null;
  draggedRect?: ClientRect;
  containers?: DroppableContainer[];
}) {
  return boardCollision({
    active: { id: "task-1", data: { current: {} }, rect: { current: {} } },
    collisionRect: draggedRect,
    droppableRects: RECTS,
    droppableContainers: containers,
    pointerCoordinates: pointer,
  } as never).map((c) => c.id);
}

describe("boardCollision · el panel de backlog superpuesto", () => {
  /**
   * El caso que justifica todo: dnd-kit no sabe nada del `z-index`, así que la
   * columna tapada sigue compitiendo. Con el puntero acá, la columna gana por
   * distancia a las esquinas (420,7 contra 435,5) — o sea que sin la regla la
   * tarea se agendaría en un día que no se ve.
   */
  it("con el puntero dentro del panel gana el panel, aunque la columna tapada esté más cerca", () => {
    expect(collide({ pointer: { x: 60, y: 400 } })).toEqual([PANEL.id]);
  });

  it("y devuelve solo el panel, no el panel y la columna", () => {
    // Devolver las dos dejaría el desempate en manos de dnd-kit otra vez.
    expect(collide({ pointer: { x: 150, y: 400 } })).toHaveLength(1);
  });

  it("con el puntero en una columna que el panel no tapa, gana la columna", () => {
    const uncovered = droppable("day-2026-08-22", "2026-08-22");
    RECTS.set(uncovered.id, rect(400, 636));
    expect(collide({ pointer: { x: 500, y: 400 }, containers: [uncovered, PANEL] })).toEqual([
      uncovered.id,
    ]);
    RECTS.delete(uncovered.id);
  });
});

describe("boardCollision · los fallbacks", () => {
  /**
   * El puntero fuera de todo. `closestCorners` nunca devuelve vacío, así que sin
   * excluir al panel una card soltada sobre espacio muerto podía desagendarse
   * sola. Acá el rectángulo arrastrado pisa **solo** al panel, y aun así el
   * resultado tiene que ser la columna.
   */
  it("con puntero, el backlog no se alcanza por descarte", () => {
    expect(collide({ pointer: { x: 1000, y: 400 }, draggedRect: rect(250, 350) })).toEqual([
      COLUMN.id,
    ]);
  });

  /**
   * Sin coordenadas —el `KeyboardSensor` no las tiene— `pointerWithin` devuelve
   * `[]` y los fallbacks son el **único** camino. Si el backlog quedara excluido
   * también acá, sería inalcanzable arrastrando con el teclado.
   */
  it("sin puntero (teclado) el backlog sí se alcanza por los fallbacks", () => {
    expect(collide({ pointer: null, draggedRect: rect(250, 350) })).toEqual([PANEL.id]);
  });

  it("sin puntero y sin superposición, la columna sigue ganando", () => {
    expect(collide({ pointer: null, draggedRect: rect(0, 200) })[0]).toBe(COLUMN.id);
  });
});
