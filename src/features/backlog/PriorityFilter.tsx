import { useRef, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { PRIORITIES, type Priority } from "../../lib/enums";
import { Popover } from "../../components/Popover";
import { priorityVar } from "../tasks/priority";

interface Props {
  value: Set<Priority>;
  onChange: (next: Set<Priority>) => void;
}

/**
 * La lista de niveles, sin la caja: los cinco, y nada más.
 *
 * **Cada nivel es un toggle y no hay botón de limpiar.** Un "Ver todas" aparte
 * era una sexta cosa que solo existe cuando hay algo puesto —la lista cambiaba de
 * alto al elegir— y a lo ancho pesaba más que los cinco niveles juntos, siendo la
 * acción de deshacer. Sacar un filtro es volver a hacer click donde lo pusiste,
 * que es el mismo gesto en los dos sentidos.
 *
 * Está separada del botón porque tiene dos anfitriones con forma distinta —el
 * botón propio de la vista Backlog y una sección adentro del popover único del
 * panel (`PanelFilters`)— y duplicarla era la promesa de que en algún momento un
 * nivel iba a aparecer en un lado y no en el otro.
 */
export function PriorityLevels({ value, onChange }: Props) {
  function toggle(p: Priority) {
    const next = new Set(value);
    if (!next.delete(p)) next.add(p);
    onChange(next);
  }

  return (
    <div className="prio-menu">
      {PRIORITIES.map((p) => (
        <button
          key={p}
          className={`prio-menu__item${value.has(p) ? " is-active" : ""}`}
          aria-pressed={value.has(p)}
          onClick={() => toggle(p)}
        >
          <span className="prio-tag__dot" style={{ background: priorityVar(p) }} aria-hidden />
          {p}
        </button>
      ))}
    </div>
  );
}

/**
 * El filtro por prioridad **de la vista Backlog**, con su propio botón.
 *
 * **Multiselección, y el vacío significa "todas"** (ver `filterByPriority`). El
 * caso real no es "muéstrame los P1" sino "muéstrame lo que arde", que son dos o
 * tres niveles; con un select de uno solo eso obliga a mirar la lista tres veces.
 *
 * Los niveles se dibujan siempre los cinco, aunque el backlog no tenga ninguno de
 * ese nivel: la escala es fija, así que una lista que cambia de largo según lo
 * que hay adentro haría dudar de si el nivel existe.
 *
 * **En el panel de la semana no se usa este botón**, y no por gusto: ahí son tres
 * controles en 300px y cada uno con su caja envolvía a dos líneas. Ver
 * `PanelFilters`.
 */
export function PriorityFilter({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="chip-wrap" ref={ref}>
      <button
        className={`bfilter${value.size > 0 ? " is-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Filtrar por prioridad"
      >
        <SlidersHorizontal size={12} aria-hidden />
        Prioridad
        {/* Cuántos niveles hay elegidos, no cuáles: con el popover cerrado, "3"
         * alcanza para saber que el filtro está puesto, y las tres etiquetas
         * estirarían el botón fuera de la cabecera. */}
        {value.size > 0 && <span className="bfilter__count">{value.size}</span>}
      </button>
      {open && (
        <Popover anchorRef={ref} className="popover--pad" onClose={() => setOpen(false)}>
          <PriorityLevels value={value} onChange={onChange} />
        </Popover>
      )}
    </div>
  );
}
