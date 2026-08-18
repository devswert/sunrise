import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { Objective, Task } from "../../lib/types";

interface ObjectivesBarProps {
  objectives: Objective[];
  tasks: Task[];
  onAdd: (title: string) => void;
  onToggle: (o: Objective) => void;
  onRemove: (id: number) => void;
}

export function ObjectivesBar({
  objectives,
  tasks,
  onAdd,
  onToggle,
  onRemove,
}: ObjectivesBarProps) {
  const [value, setValue] = useState("");
  const submit = () => {
    const v = value.trim();
    if (v) {
      onAdd(v);
      setValue("");
    }
  };

  const countFor = (id: number) => tasks.filter((t) => t.objectiveId === id).length;

  return (
    <section className="objectives" aria-label="Objetivos de la semana">
      <div className="objectives__label">Objetivos</div>
      <div className="objectives__list">
        {objectives.map((o) => (
          <div key={o.id} className={`obj-chip${o.completed ? " is-done" : ""}`}>
            <button
              className={`obj-chip__check${o.completed ? " is-checked" : ""}`}
              aria-label={o.completed ? "Marcar pendiente" : "Marcar completado"}
              onClick={() => onToggle(o)}
            >
              {o.completed && <Check size={11} strokeWidth={3} />}
            </button>
            <span className="obj-chip__title">{o.title}</span>
            <span className="obj-chip__count">{countFor(o.id)}</span>
            <button
              className="obj-chip__del"
              aria-label="Eliminar objetivo"
              onClick={() => onRemove(o.id)}
            >
              <X size={12} />
            </button>
          </div>
        ))}

        <div className="obj-add">
          <Plus size={13} aria-hidden />
          <input
            value={value}
            placeholder="Nuevo objetivo"
            aria-label="Nuevo objetivo"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </div>
      </div>
    </section>
  );
}
