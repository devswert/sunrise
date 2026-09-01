import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { TIME_PRESETS, formatMinutes, parseDuration } from "../lib/capacity";
import { PLAIN_INPUT } from "./plainInput";

interface TimePickerProps {
  /** Minutos actuales (null = sin valor). */
  value: number | null;
  onSelect: (minutes: number | null) => void;
  clearLabel?: string;
}

/**
 * Selector de duración: presets + **escritura libre**.
 * Acepta "22", "00:22", "1:30", "45m", "1h30"… (ver `parseDuration`).
 * Se usa tanto para Planned como para Actual.
 */
export function TimePicker({ value, onSelect, clearLabel = "Sin estimar" }: TimePickerProps) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  // El foco inicial lo da `Popover`, no este efecto: montado dentro del portal,
  // el input está `visibility: hidden` mientras se mide la posición y un
  // `focus()` ahí no hace nada. Ver el comentario en `Popover.tsx`.
  const inputRef = useRef<HTMLInputElement>(null);

  const typed = useMemo(() => parseDuration(query), [query]);

  const options = useMemo(() => {
    const q = query.trim();
    if (!q) return TIME_PRESETS;
    // Filtra presets por texto y por su equivalente formateado.
    return TIME_PRESETS.filter((m) => String(m).includes(q) || formatMinutes(m).includes(q));
  }, [query]);

  /** Lo escrito va primero si es válido y no coincide con un preset. */
  const showTyped = typed != null && !options.includes(typed);
  const selectable: number[] = showTyped ? [typed, ...options] : options;

  useEffect(() => {
    setCursor(0);
  }, [query]);

  return (
    <div
      className="ss"
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, selectable.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          const pick = selectable[cursor];
          if (pick != null) onSelect(pick);
        }
      }}
    >
      <div className="ss__search">
        <Search size={14} aria-hidden />
        <input
          ref={inputRef}
          value={query}
          placeholder="00:22, 45m, 1h30…"
          aria-label="Escribe una duración"
          onChange={(e) => setQuery(e.target.value)}
          {...PLAIN_INPUT}
        />
      </div>

      <div className="ss__list" role="listbox">
        {!query && (
          <button className="ss__opt ss__opt--clear" onClick={() => onSelect(null)}>
            {clearLabel}
          </button>
        )}

        {showTyped && (
          <button
            className={`ss__opt ss__opt--typed${cursor === 0 ? " is-cursor" : ""}`}
            onMouseEnter={() => setCursor(0)}
            onClick={() => onSelect(typed)}
          >
            <span className="ss__label">Usar {formatMinutes(typed)}</span>
            <span className="ss__hint">{typed} min</span>
          </button>
        )}

        {options.length === 0 && !showTyped && (
          <div className="ss__empty">Escribe una duración (ej. 00:22)</div>
        )}

        {options.map((m) => {
          const idx = selectable.indexOf(m);
          return (
            <button
              key={m}
              role="option"
              aria-selected={value === m}
              className={`ss__opt${idx === cursor ? " is-cursor" : ""}${
                value === m ? " is-selected" : ""
              }`}
              onMouseEnter={() => setCursor(idx)}
              onClick={() => onSelect(m)}
            >
              <span className="ss__label">{formatMinutes(m)}</span>
              <span className="ss__hint">{m} min</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
