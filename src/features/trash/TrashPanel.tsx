import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";
import { api } from "../../lib/ipc";
import { shortDate, toISODate } from "../../lib/date";
import { useAppStore } from "../../lib/store";
import type { TrashedTask } from "../../lib/types";

interface Props {
  onClose: () => void;
  /** Se está cerrando: dispara la animación de salida (ver `usePanelPresence`). */
  leaving?: boolean;
}

/**
 * El basurero (#11) como panel de la tira, después de Agenda y Backlog.
 *
 * Lista lo eliminado —lo más reciente primero— con el día de la tarea y el día
 * en que se elimina sola, y deja restaurar. **No elimina definitivamente**: los
 * 30 días alcanzan, y un botón así sería el único gesto irreversible de la app.
 *
 * Fuera del `DndContext`, como la agenda: no recibe drops. Arrastrar al basurero
 * sería un borrado sin pasar por la confirmación del modal.
 *
 * Usa el armazón de `.backlog-panel` (posición, sombra, animación) para que los
 * tres paneles de la tira se alternen en el mismo lugar sin saltos.
 */
export function TrashPanel({ onClose, leaving }: Props) {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const bumpData = useAppStore((s) => s.bumpData);
  const [items, setItems] = useState<TrashedTask[] | null>(null);

  const load = useCallback(async () => {
    setItems(await api.listTrash());
  }, []);

  useEffect(() => {
    void load();
  }, [load, dataVersion]);

  async function restore(id: number) {
    await api.restoreTask(id);
    await load();
    bumpData();
  }

  return (
    <aside
      className={`backlog-panel trash-panel${leaving ? " is-leaving" : ""}`}
      aria-label="Trash"
    >
      <header className="panel-head">
        <div className="panel-head__row">
          <Trash2 size={14} aria-hidden className="panel-head__icon" />
          <h2 className="panel-head__title">Trash</h2>
          <button className="panel-head__close" aria-label="Cerrar basurero" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <p className="trash-panel__hint">Lo eliminado se borra solo a los 30 días.</p>
      </header>

      <div className="backlog-panel__body">
        {items != null && items.length === 0 && (
          <p className="trash-panel__empty">El basurero está vacío.</p>
        )}
        <ul className="trash-panel__list">
          {items?.map(({ task, purgeAt }) => (
            <li className="trash-panel__item" key={task.id}>
              <div className="trash-panel__info">
                <span className="trash-panel__title">{task.title}</span>
                <span className="trash-panel__meta">
                  {task.scheduledDate ? shortDate(task.scheduledDate) : "Backlog"}
                  {" · "}se elimina el {shortDate(toISODate(new Date(purgeAt)))}
                </span>
              </div>
              <button
                className="trash-panel__restore"
                aria-label={`Restaurar ${task.title}`}
                title="Restaurar"
                onClick={() => restore(task.id)}
              >
                <RotateCcw size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
