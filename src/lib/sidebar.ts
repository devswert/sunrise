/**
 * Estado colapsado del sidebar, con persistencia en localStorage.
 *
 * Va en localStorage y no en la tabla `settings` por la misma razón que el tema:
 * describe **esta ventana en esta máquina**, no los datos. En `settings` viajaría
 * dentro de los respaldos, y restaurar un zip viejo cambiaría el ancho del
 * sidebar sin que nadie lo haya pedido.
 */
import { useEffect } from "react";
import { create } from "zustand";

const STORAGE_KEY = "sunrise-sidebar-collapsed";

export function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

interface SidebarState {
  collapsed: boolean;
  toggle: () => void;
}

/**
 * El colapso vive en un store y no en un `useState` del sidebar porque hay **dos**
 * cosas que lo mueven: el botón de la propia columna y el atajo de teclado, que se
 * dispara desde el listener global (`useShortcuts`), fuera de este árbol. Con dos
 * estados el botón y el atajo se desincronizan a la primera.
 *
 * Se siembra al crearse el módulo, o sea una vez por ventana. Lo que **no** se
 * mueve de acá es dónde se guarda: sigue en localStorage y no en `settings`, por
 * lo dicho arriba.
 */
export const useSidebarStore = create<SidebarState>((set) => ({
  collapsed: getStoredCollapsed(),
  toggle: () => set((s) => ({ collapsed: !s.collapsed })),
}));

/**
 * Hook del sidebar: devuelve si está colapsado y un toggle.
 *
 * Estampa `data-sidebar` en <html> además de la clase del sidebar: la clase es la
 * que dibuja, y el atributo es para que cualquier vista pueda saber en qué estado
 * está sin importar dónde cuelgue del árbol. La persistencia va acá y no en el
 * store para que se escriba una sola vez por cambio, venga de donde venga.
 */
export function useSidebarCollapsed() {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);

  useEffect(() => {
    document.documentElement.setAttribute("data-sidebar", collapsed ? "collapsed" : "expanded");
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return { collapsed, toggle };
}
