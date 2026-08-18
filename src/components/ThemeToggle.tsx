import { Moon, Sun } from "lucide-react";
import type { Theme } from "../lib/theme";

interface ThemeToggleProps {
  theme: Theme;
  onToggle: () => void;
}

/**
 * Switch de tema: track con sol (izq) y luna (der) fijos y una perilla que
 * se desliza al lado del modo activo mostrando su ícono en color de acento.
 */
export function ThemeToggle({ theme, onToggle }: ThemeToggleProps) {
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
      className={`theme-switch ${isDark ? "is-dark" : "is-light"}`}
      onClick={onToggle}
    >
      <Sun className="theme-switch__corner theme-switch__corner--sun" size={13} aria-hidden />
      <Moon className="theme-switch__corner theme-switch__corner--moon" size={12} aria-hidden />
      <span className="theme-switch__knob">
        {isDark ? (
          <Moon size={13} strokeWidth={2.2} aria-hidden />
        ) : (
          <Sun size={13} strokeWidth={2.2} aria-hidden />
        )}
      </span>
    </button>
  );
}
