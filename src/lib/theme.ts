/** Manejo del tema claro/oscuro con persistencia en localStorage. */
import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "sunrise-theme";

export function systemTheme(): Theme {
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

/** Tema inicial: el guardado por el usuario, o el del sistema. */
export function resolveInitialTheme(): Theme {
  return getStoredTheme() ?? systemTheme();
}

/** Estampa `data-theme` en <html> para que ganen los overrides de tokens.css. */
export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

let transitionTimer: ReturnType<typeof setTimeout> | undefined;

/** Activa por un instante el fade de color en toda la app (durante el toggle). */
export function enableThemeTransition(durationMs = 350) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.add("theme-transition");
  if (transitionTimer) clearTimeout(transitionTimer);
  transitionTimer = setTimeout(() => el.classList.remove("theme-transition"), durationMs + 60);
}

/** Hook de tema: devuelve el tema actual, un toggle y un setter. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(resolveInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => {
    enableThemeTransition();
    setThemeState(t);
  }, []);
  const toggle = useCallback(() => {
    enableThemeTransition();
    setThemeState((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return { theme, setTheme, toggle };
}
