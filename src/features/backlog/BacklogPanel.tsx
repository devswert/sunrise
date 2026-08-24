import { useDroppable } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { Inbox, X } from "lucide-react";
import { shortDate } from "../../lib/date";
import type { Category, Task, TaskPatch } from "../../lib/types";
import { TaskCard } from "../week/TaskCard";
import { groupByContext } from "./agrupar";

interface Props {
  tasks: Task[];
  /** `taskId` → día del que vino, para el rótulo bajo la card. */
  rescued: Map<number, string>;
  categoryMap: Map<number, Category>;
  categories: Category[];
  onToggle: (task: Task) => void;
  onOpen: (task: Task) => void;
  onPatch?: (id: number, patch: TaskPatch) => void;
  onClose: () => void;
  /** Se está cerrando: dispara la animación de salida (ver `usePanelPresence`). */
  leaving?: boolean;
}

/**
 * El backlog como panel de la tira, al lado de las columnas de la semana.
 *
 * Existe para no tener que salir del tablero a planificar: el backlog vive en su
 * propia vista, así que elegir una tarea era ir, elegir, volver y buscar el día.
 * Acá se arrastra directo — y de vuelta, cuando se decide que hoy no.
 *
 * **Es el primer panel de la tira que participa del DnD**, y eso trae dos cosas
 * que conviene tener escritas antes de tocar algo:
 *
 * - **El panel se superpone a la última columna visible, y por lo tanto esa
 *   columna no recibe drops mientras esté abierto.** Peor: dnd-kit ignora el
 *   `z-index`, así que la columna tapada sigue compitiendo por el drop. Quien lo
 *   resuelve es `boardCollision`, que le da prioridad al backlog cuando el
 *   puntero está adentro; no es una optimización, sin eso la tarea se agenda en
 *   un día que no se ve.
 * - **El autoscroll del arrastre no llega al borde tapado.** dnd-kit sigue al
 *   scroller del nodo de destino, y el panel más la tira cubren el borde derecho
 *   del board. Arrastrando no se alcanza un día fuera de las columnas visibles:
 *   hay que cerrar el panel, scrollear y volver a abrirlo. Es una limitación
 *   asumida de este layout, no un bug pendiente.
 *
 * **No se reordena por dentro y no crea tareas.** Lo primero es del modelo: la
 * `position` del backlog es global sobre el bucket `scheduled_date IS NULL`
 * mientras `list_backlog` ordena por `category_id, position, id`, así que un
 * índice dentro de un grupo de contexto no corresponde a ninguna posición
 * global. Todo drop que caiga acá entra en 0, que con el agrupado del lado del
 * cliente significa "primera de su contexto". Crear sigue siendo de la vista
 * Backlog, que es la que tiene el botón por contexto.
 */
export function BacklogPanel({
  tasks,
  rescued,
  categoryMap,
  categories,
  onToggle,
  onOpen,
  onPatch,
  onClose,
  leaving,
}: Props) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: "backlog-panel",
    // Mismo contrato que las columnas: `date: null` **es** el backlog (§3.2), así
    // que el `onDragEnd` no necesita saber que este destino es especial. Y es la
    // marca que `boardCollision` usa para reconocerlo.
    data: { type: "column", date: null },
  });

  const arrastrada = active?.data.current as
    | { date?: string | null; status?: string }
    | undefined;
  /**
   * No se ilumina cuando el drop no va a hacer nada, y son dos casos —los mismos
   * dos que `resolveDrop` descarta—: la tarea ya está en el backlog, o está
   * completada (`list_backlog` filtra TODO, así que entrar acá la dejaría
   * inalcanzable). Un marco que se prende sobre un destino que va a rechazar el
   * drop promete algo que no pasa.
   */
  const yaEstaAca = (arrastrada?.date ?? null) === null;
  const completada = arrastrada?.status === "DONE";
  const resaltar = isOver && !yaEstaAca && !completada;

  const grupos = groupByContext(tasks, categories, { includeEmpty: false });

  return (
    <aside
      ref={setNodeRef}
      className={`backlog-panel${resaltar ? " is-over" : ""}${leaving ? " is-leaving" : ""}`}
      aria-label="Backlog"
    >
      {/* `panel-head` es la cabecera compartida con la agenda superpuesta: los dos
        * paneles se alternan en el mismo lugar, así que dos cabeceras distintas
        * se leerían como un salto. Vive en `week.css`. */}
      <header className="panel-head">
        <div className="panel-head__row">
          <Inbox size={14} aria-hidden className="panel-head__icon" />
          <h2 className="panel-head__title">Backlog</h2>
          <button className="panel-head__close" aria-label="Cerrar backlog" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="panel-head__sub">
          {tasks.length} {tasks.length === 1 ? "pendiente" : "pendientes"}
        </p>
      </header>

      <div className="backlog-panel__body">
        {/**
         * Un solo `SortableContext`, y **sin estrategia**. `useSortable` lo
         * necesita para funcionar, pero `verticalListSortingStrategy` haría que
         * las cards abran un hueco de inserción al pasar por encima — prometiendo
         * un reordenamiento que este panel no hace. Uno por grupo sería peor: el
         * desplazamiento entre grupos no haría nada mientras el drop sí se
         * dispara.
         */}
        <SortableContext items={tasks.map((t) => `task-${t.id}`)} strategy={() => null}>
          {grupos.length === 0 && (
            <p className="backlog-panel__vacio">
              No hay nada en el backlog. Lo que quede pendiente de un día cae acá solo.
            </p>
          )}
          {grupos.map((g) => (
            <div className="backlog-panel__group" key={g.folder?.id ?? "none"}>
              <div className="backlog-panel__group-head">
                {g.folder && (
                  <span
                    className="backlog-panel__dot"
                    style={{ background: `var(--${g.folder.color})` }}
                  />
                )}
                {g.folder?.name ?? "Sin contexto"}
              </div>
              <div className="backlog-panel__list">
                {g.items.map((t) => (
                <div
                  className={`backlog-panel__item${rescued.get(t.id) ? " has-desde" : ""}`}
                  key={t.id}
                >
                  <TaskCard
                    task={t}
                    category={t.categoryId != null ? categoryMap.get(t.categoryId) : null}
                    categories={categories}
                    onToggle={onToggle}
                    onOpen={onOpen}
                    onPatch={onPatch}
                    // Sin los rellenos de los campos vacíos: en el backlog la
                    // mayoría no tiene ni estimado ni canal todavía, y una columna
                    // de guiones y numerales se lee como ruido en vez de datos.
                    hidePlaceholders
                  />
                  {/* De qué día se cayó. Acá no agrupa —el panel agrupa por
                   * contexto— pero saber que esto viene de un día cambia cómo se
                   * lee: no lo guardaste, se degradó solo. */}
                  {!!rescued.get(t.id) && (
                    <span className="backlog-panel__desde">
                      Desde el {shortDate(rescued.get(t.id)!)}
                    </span>
                  )}
                </div>
                ))}
              </div>
            </div>
          ))}
        </SortableContext>
      </div>
    </aside>
  );
}
