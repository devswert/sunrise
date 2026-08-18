import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, Search } from "lucide-react";

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
  onSelect,
  placeholder = "Buscar…",
  clearLabel,
  emptyLabel = "Sin resultados",
  footer,
}: SearchSelectProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
              aria-selected={value === o.value}
              className={`ss__opt${idx === cursor ? " is-cursor" : ""}${
                value === o.value ? " is-selected" : ""
              }`}
              onMouseEnter={() => setCursor(idx)}
              onClick={() => onSelect(o.value)}
            >
              {o.color && (
                <span className="ss__dot" style={{ background: `var(--${o.color})` }} />
              )}
              <span className="ss__label">{o.label}</span>
              {o.hint && <span className="ss__hint">{o.hint}</span>}
              {value === o.value && <Check size={13} className="ss__tick" />}
            </button>
          );
        })}
      </div>

      {footer && <div className="ss__footer">{footer}</div>}
    </div>
  );
}
