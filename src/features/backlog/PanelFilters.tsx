import { useRef, useState } from "react";
import { RotateCcw, SlidersHorizontal } from "lucide-react";
import type { Category } from "../../lib/types";
import type { Priority } from "../../lib/enums";
import { Popover } from "../../components/Popover";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import { BacklogSort } from "../tasks/priority";
import { PriorityLevels } from "./PriorityFilter";

interface Props {
  levels: Set<Priority>;
  onLevels: (next: Set<Priority>) => void;
  channel: number | null;
  onChannel: (next: number | null) => void;
  options: SearchOption[];
  selected: Category | null | undefined;
  sort: BacklogSort;
  onSort: (next: BacklogSort) => void;
  /** Deja los tres controles como estaban. */
  onReset: () => void;
  /** Con las prioridades apagadas quedan solo el canal y nada de orden. */
  priorities: boolean;
}

/**
 * Los controles del panel del backlog: **un solo botón**, con todo adentro.
 *
 * La primera versión eran tres botones en fila —prioridad, canal, orden—, y en
 * los 300px del panel envolvían a dos líneas en cuanto el canal elegido tenía un
 * nombre largo: la cabecera crecía y la caja se rompía. Ensanchar el panel no es
 * opción (se superpone a una columna del board) y recortar los rótulos deja tres
 * iconos que no dicen qué hacen.
 *
 * Con un botón el ancho **no depende de lo aplicado**, que era el origen del
 * problema: el nombre del canal vive adentro del popover, donde hay espacio. Lo
 * que el botón sí tiene que decir de reojo es que hay algo puesto, y eso son dos
 * marcas distintas:
 *
 * - **El contador es de filtros**, niveles más canal. Es lo que recorta la lista,
 *   y sin la señal un panel filtrado se ve igual que uno casi vacío.
 * - **El orden no suma al contador**: siempre hay uno, así que un "1" permanente
 *   no distinguiría nada. Cuando no es el de por defecto, el botón igual se
 *   enciende — está cambiado, aunque no esconda nada.
 *
 * **Hay un solo botón de limpiar y está al final: "Restablecer".** No es lo mismo
 * que los "Ver todas" y "Todos los canales" que se sacaron: aquellos eran uno por
 * sección, metidos entre los controles, y ahí la forma de quitar un filtro
 * competía con la de ponerlo. Este es uno solo, al pie, y responde otra pregunta
 * —"déjame esto como estaba"— que con tres controles puestos es tres clicks. Solo
 * aparece cuando hay algo que deshacer.
 */
export function PanelFilters({
  levels,
  onLevels,
  channel,
  onChannel,
  options,
  selected,
  sort,
  onSort,
  onReset,
  priorities,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activos = levels.size + (channel != null ? 1 : 0);
  const tocado = activos > 0 || sort !== BacklogSort.CREATED;

  return (
    <div className="chip-wrap" ref={ref}>
      <button
        className={`bfilter${tocado ? " is-on" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Filtrar y ordenar"
      >
        <SlidersHorizontal size={12} aria-hidden />
        Filtros
        {activos > 0 && <span className="bfilter__count">{activos}</span>}
      </button>

      {open && (
        <Popover anchorRef={ref} className="popover--pad" onClose={() => setOpen(false)}>
          <div className="bfilters">
            {priorities && (
              <section className="bfilters__sec">
                <span className="bfilters__label">Prioridad</span>
                <PriorityLevels value={levels} onChange={onLevels} />
              </section>
            )}

            {/* El `SearchSelect` va **embebido**, no detrás de un segundo popover:
              * un popover encima de otro se cierra al primer click afuera del de
              * arriba, que acá es el de adentro. Trae su propio buscador, que es
              * el que recibe el foco al abrirse. */}
            <section className="bfilters__sec">
              <span className="bfilters__label">
                Canal
                {selected && <span className="bfilters__value">{selected.name}</span>}
              </span>
              <SearchSelect
                options={options}
                value={channel != null ? String(channel) : null}
                placeholder="Buscar canal…"
                // **Toggle, y sin fila de "Todos los canales"**: igual que los
                // niveles de arriba, volver a hacer click en el canal marcado lo
                // desmarca. La fila de limpiar era un renglón más que además
                // desaparece al escribir en el buscador, así que la forma de
                // sacar el filtro cambiaba según lo que hubieras tecleado.
                onSelect={(v) => {
                  const id = v ? Number(v) : null;
                  onChannel(id === channel ? null : id);
                }}
              />
            </section>

            {priorities && (
              <section className="bfilters__sec">
                <span className="bfilters__label">Orden</span>
                {/* Dos opciones excluyentes y siempre hay una: van como un par de
                  * botones marcados, no como una lista de la que se elige — es la
                  * misma diferencia entre un radio y un menú. */}
                <div className="bfilters__orden">
                  <button
                    className={`bfilters__opt${sort === BacklogSort.CREATED ? " is-active" : ""}`}
                    aria-pressed={sort === BacklogSort.CREATED}
                    onClick={() => onSort(BacklogSort.CREATED)}
                  >
                    Antigüedad
                  </button>
                  <button
                    className={`bfilters__opt${sort === BacklogSort.P ? " is-active" : ""}`}
                    aria-pressed={sort === BacklogSort.P}
                    onClick={() => onSort(BacklogSort.P)}
                  >
                    Prioridad
                  </button>
                </div>
              </section>
            )}

            {tocado && (
              <button className="bfilters__reset" onClick={onReset}>
                <RotateCcw size={12} aria-hidden />
                Restablecer
              </button>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
