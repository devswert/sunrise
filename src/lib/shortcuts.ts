import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSidebarStore } from "./sidebar";
import { useAppStore } from "./store";
import { useSettingsStore } from "./settings";

/**
 * Atajos de teclado, configurables desde Settings.
 *
 * Hay un **registro central** (`SHORTCUT_ACTIONS`) y un solo listener que lo
 * consulta, en vez de un hook por atajo: así agregar uno es agregar una fila, y
 * la detección de colisiones tiene todo a la vista.
 *
 * Las combinaciones se guardan normalizadas y portables (`Mod+1`), no `cmd+1`:
 * `Mod` es ⌘ en macOS y Ctrl en el resto. La plataforma solo importa al
 * **mostrar** la combinación, nunca al compararla.
 */

export type ShortcutId =
  | "add_task"
  | "goto_home"
  | "goto_today"
  | "goto_focus"
  | "goto_settings"
  | "toggle_sidebar";

export interface ShortcutAction {
  id: ShortcutId;
  label: string;
  /** Combinación de fábrica, ya normalizada. */
  fallback: string;
  /** Ruta a la que navega, si es un atajo de navegación. */
  path?: string;
}

export const SHORTCUT_ACTIONS: readonly ShortcutAction[] = [
  { id: "add_task", label: "Nueva tarea", fallback: "Mod+A" },
  { id: "goto_home", label: "Ir a Home", fallback: "Mod+1", path: "/" },
  { id: "goto_today", label: "Ir a Today", fallback: "Mod+2", path: "/today" },
  { id: "goto_focus", label: "Ir a Focus", fallback: "Mod+3", path: "/focus" },
  { id: "goto_settings", label: "Ir a Configs", fallback: "Mod+,", path: "/settings" },
  { id: "toggle_sidebar", label: "Mostrar u ocultar el sidebar", fallback: "Mod+S" },
];

/** Clave en la tabla `settings`: una fila por atajo. */
export function shortcutKey(id: ShortcutId): string {
  return `hotkey_${id}`;
}

export interface Combo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  /** Una letra, un dígito o uno de los signos de `PUNCT_KEYS`. */
  key: string;
}

/**
 * Signos aceptados además de letras y dígitos. La coma está porque `⌘,` es el
 * atajo universal de preferencias. `+` queda fuera a propósito: es el separador
 * del formato guardado.
 */
const PUNCT_KEYS = ",./;'[]\\`-=";

function isValidKey(k: string): boolean {
  return /^[A-Z0-9]$/.test(k) || (k.length === 1 && PUNCT_KEYS.includes(k));
}

/**
 * Interpreta una combinación guardada. Devuelve `null` si no se entiende, para
 * que quien la lea caiga al default en vez de dejar la acción sin atajo.
 */
export function parseCombo(raw: string | null | undefined): Combo | null {
  if (!raw) return null;
  const parts = raw
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;

  const combo: Combo = { mod: false, shift: false, alt: false, key: "" };
  for (const part of parts.slice(0, -1)) {
    switch (part.toLowerCase()) {
      case "mod":
        combo.mod = true;
        break;
      case "shift":
        combo.shift = true;
        break;
      case "alt":
        combo.alt = true;
        break;
      default:
        return null; // modificador desconocido
    }
  }

  const key = parts[parts.length - 1].toUpperCase();
  if (!isValidKey(key)) return null;
  combo.key = key;

  // Sin `Mod` chocaría con escribir una letra suelta en cualquier parte.
  if (!combo.mod) return null;
  return combo;
}

/** Forma canónica, que es la que se guarda. */
export function formatCombo(c: Combo): string {
  const parts = ["Mod"];
  if (c.shift) parts.push("Shift");
  if (c.alt) parts.push("Alt");
  parts.push(c.key);
  return parts.join("+");
}

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac/i.test(navigator.platform || navigator.userAgent || "");
}

/** Cómo se le muestra al usuario: `⌘ 1` en macOS, `Ctrl + 1` en el resto. */
export function displayCombo(raw: string): string {
  const c = parseCombo(raw);
  if (!c) return raw;
  const mac = isMac();
  const parts = [mac ? "⌘" : "Ctrl"];
  if (c.shift) parts.push(mac ? "⇧" : "Shift");
  if (c.alt) parts.push(mac ? "⌥" : "Alt");
  parts.push(c.key);
  return parts.join(mac ? " " : " + ");
}

/**
 * Valor para `aria-keyshortcuts`. Se emiten las dos variantes porque el atajo
 * responde a ⌘ **y** a Ctrl; el atributo acepta una lista separada por espacios.
 *
 * Va como atributo y no dentro del texto del link: el atajo no es parte del
 * nombre del elemento, y colarlo ahí hace que un lector de pantalla anuncie
 * "Focus ⌘ 3" como si el nombre fuera eso.
 */
export function ariaKeyshortcuts(raw: string): string | undefined {
  const c = parseCombo(raw);
  if (!c) return undefined;
  const queue = [c.shift ? "Shift" : null, c.alt ? "Alt" : null, c.key].filter(Boolean).join("+");
  return `Meta+${queue} Control+${queue}`;
}

/**
 * ¿Este evento dispara esta combinación?
 *
 * `Mod` acepta ⌘ **o** Ctrl sin mirar la plataforma: es lo que ya hacía el
 * atajo de "nueva tarea" y evita que la app se comporte distinto según cómo se
 * detecte el sistema. Shift y Alt se comparan **exactos**, para que ⌘⇧A no
 * dispare el atajo de ⌘A.
 */
export function matchesCombo(e: KeyboardEvent, raw: string): boolean {
  const c = parseCombo(raw);
  if (!c) return false;
  if (!(e.metaKey || e.ctrlKey)) return false;
  if (e.shiftKey !== c.shift) return false;
  if (e.altKey !== c.alt) return false;
  return e.key.toUpperCase() === c.key;
}

/**
 * Combinación que representa un evento, para la captura en Settings.
 * `null` si no sirve como atajo (falta `Mod`, o es solo un modificador).
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (!(e.metaKey || e.ctrlKey)) return null;
  const key = e.key.toUpperCase();
  if (!isValidKey(key)) return null;
  return formatCombo({ mod: true, shift: e.shiftKey, alt: e.altKey, key });
}

/**
 * El atajo vigente de cada acción: el guardado si se entiende, si no el de
 * fábrica. Un valor vacío también cae al default, que es como se "restaura"
 * un atajo sin necesitar un comando para borrar filas.
 */
export function resolveShortcuts(values: Record<string, string>): Record<ShortcutId, string> {
  const out = {} as Record<ShortcutId, string>;
  for (const a of SHORTCUT_ACTIONS) {
    const stored = values[shortcutKey(a.id)];
    out[a.id] = parseCombo(stored) ? stored : a.fallback;
  }
  return out;
}

/**
 * La acción que ya usa esa combinación, si hay alguna distinta de `self`.
 * Dos atajos iguales harían que uno de los dos nunca se dispare.
 */
export function findConflict(
  resolved: Record<ShortcutId, string>,
  combo: string,
  self: ShortcutId,
): ShortcutAction | null {
  for (const a of SHORTCUT_ACTIONS) {
    if (a.id === self) continue;
    if (resolved[a.id] === combo) return a;
  }
  return null;
}

/**
 * ¿El foco está en un campo de texto? Los atajos se ignoran ahí para no pisar
 * "seleccionar todo" y equivalentes. Mismo criterio que las flechas de Focus.
 */
export function isEditingText(el: Element | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
  );
}

/**
 * Un solo listener para todos los atajos, que consulta el registro resuelto
 * contra los ajustes del usuario. Se llama desde `Shell`, y tiene que estar
 * dentro del Router porque los atajos de navegación usan `useNavigate`.
 *
 * Un listener y no uno por atajo: agregar un atajo pasa a ser agregar una fila
 * en `SHORTCUT_ACTIONS`, y la detección de colisiones tiene todo a la vista.
 */
export function useShortcuts() {
  const openCompose = useAppStore((s) => s.openCompose);
  const toggleSidebar = useSidebarStore((s) => s.toggle);
  const quitOpen = useAppStore((s) => s.quitOpen);
  const values = useSettingsStore((s) => s.values);
  const navigate = useNavigate();

  const resolved = useMemo(() => resolveShortcuts(values), [values]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Respeta "seleccionar todo" y equivalentes en campos de texto.
      if (isEditingText(document.activeElement)) return;
      // Con el diálogo de salida abierto no se navega por debajo de él.
      if (quitOpen) return;

      for (const action of SHORTCUT_ACTIONS) {
        if (!matchesCombo(e, resolved[action.id])) continue;
        e.preventDefault();
        if (action.path) navigate(action.path);
        else if (action.id === "add_task") openCompose();
        else if (action.id === "toggle_sidebar") toggleSidebar();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolved, openCompose, toggleSidebar, navigate, quitOpen]);
}
