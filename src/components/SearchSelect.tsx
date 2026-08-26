import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Search } from "lucide-react";
import { PLAIN_INPUT } from "./plainInput";

export interface SearchOption {
  value: string;
  label: string;
  /** Texto secundario / agrupador visual. */
  hint?: string;
  /** Color de la paleta para el punto (ej. "lavender"). */
  color?: string;
  /** Marca la opción como cabecera de grupo (se muestra en negrita). */
  group?: boolean;
}

interface SearchSelectProps {
  options: SearchOption[];
  value: string | null;
  /**
   * Modo multi-selección: los `value` marcados con tilde, en vez de solo el de
   * `value`. Quien lo use sigue recibiendo `onSelect` por cada click y decide si
   * prende o apaga — el dropdown no guarda estado. **Y el popover no se cierra
   * solo**: elegir un segundo filtro sin reabrirlo es todo el punto.
   *
   * Se agregó en vez de escribir un dropdown aparte para los filtros de la
   * review: duplicarlo habría duplicado también la búsqueda, el teclado y el
   * foco dentro del portal, que es donde están las trampas.
   */
  selected?: Set<string>;
  onSelect: (value: string | null) => void;
  placeholder?: string;
  /** Etiqueta de la opción "sin valor". Si se omite no se ofrece limpiar. */
  clearLabel?: string;
  emptyLabel?: string;
  footer?: ReactNode;
}

/**
 * Dropdown con búsqueda local reutilizable (canales, objetivos, tiempos…).
 * Filtra por `label` + `hint`, navegable con ↑/↓/Enter/Esc.
 */
export function SearchSelect({
  options,
  value,
  selected,
  onSelect,
  placeholder = "Buscar…",
  clearLabel,
  emptyLabel = "Sin resultados",
  footer,
}: SearchSelectProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  // El foco inicial lo da `Popover`, no este efecto: montado dentro del portal,
  // el input está `visibility: hidden` mientras se mide la posición y un
  // `focus()` ahí no hace nada. Ver el comentario en `Popover.tsx`.
  const inputRef = useRef<HTMLInputElement>(null);

  const marcado = (v: string) => (selected ? selected.has(v) : value === v);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        !o.group &&
        (o.label.toLowerCase().includes(q) || (o.hint ?? "").toLowerCase().includes(q)),
    );
  }, [options, query]);

  const selectable = filtered.filter((o) => !o.group);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, selectable.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      const opt = selectable[cursor];
      if (opt) onSelect(opt.value);
    }
  }

  return (
    <div className="ss" onKeyDown={onKeyDown}>
      <div className="ss__search">
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          {...PLAIN_INPUT}
        />
      </div>

      <div className="ss__list" role="listbox">
        {clearLabel && !query && (
          <button className="ss__opt ss__opt--clear" onClick={() => onSelect(null)}>
            {clearLabel}
          </button>
        )}

        {filtered.length === 0 && <div className="ss__empty">{emptyLabel}</div>}

        {filtered.map((o) => {
          if (o.group) {
            return (
              <div key={`g-${o.value}`} className="ss__group">
                {o.label}
              </div>
            );
          }
          const idx = selectable.indexOf(o);
          return (
            <button
              key={o.value}
              role="option"
              aria-selected={marcado(o.value)}
              className={`ss__opt${idx === cursor ? " is-cursor" : ""}${
                marcado(o.value) ? " is-selected" : ""
              }`}
              onMouseEnter={() => setCursor(idx)}
              onClick={() => onSelect(o.value)}
            >
              {o.color && (
                <span className="ss__dot" style={{ background: `var(--${o.color})` }} />
              )}
              <span className="ss__label">{o.label}</span>
              {o.hint && <span className="ss__hint">{o.hint}</span>}
              {marcado(o.value) && <Check size={13} className="ss__tick" />}
            </button>
          );
        })}
      </div>

      {footer && <div className="ss__footer">{footer}</div>}
    </div>
  );
}
