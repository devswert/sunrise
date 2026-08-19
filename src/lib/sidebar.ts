/**
 * Estado colapsado del sidebar, con persistencia en localStorage.
 *
 * Va en localStorage y no en la tabla `settings` por la misma razón que el tema:
 * describe **esta ventana en esta máquina**, no los datos. En `settings` viajaría
 * dentro de los respaldos, y restaurar un zip viejo cambiaría el ancho del
 * sidebar sin que nadie lo haya pedido.
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "sunrise-sidebar-collapsed";

export function getStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Hook del sidebar: devuelve si está colapsado y un toggle.
 *
 * Estampa `data-sidebar` en <html> además de la clase del sidebar: la clase es la
 * que dibuja, y el atributo es para que cualquier vista pueda saber en qué estado
 * está sin importar dónde cuelgue del árbol.
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState<boolean>(getStoredCollapsed);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-sidebar",
      collapsed ? "collapsed" : "expanded",
    );
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return { collapsed, toggle };
}
