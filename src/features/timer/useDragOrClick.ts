import { useRef } from "react";
import { isTauri } from "../../lib/ipc";

/**
 * Distingue **click** de **arrastre** en la tarjeta.
 *
 * El arrastre nativo (`data-tauri-drag-region`) se dispara en el mousedown, así
 * que no dejaba forma de detectar un click simple. Aquí el drag se inicia solo
 * cuando el puntero se movió más que el umbral; si se suelta sin moverse, es un
 * click y abrimos Focus.
 */
export function useDragOrClick(onClick: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const dragging = useRef(false);

  const THRESHOLD = 4; // px

  // El panel de opciones cuenta como control aunque se pulse en su relleno: se
  // superpone al título, así que un click que empieza en el título puede
  // terminar soltándose encima de él (aparece deslizándose bajo el cursor). Sin
  // esto, ese `pointerup` abriría Focus y saltaría la ventana principal.
  const CONTROLES = "button, .tax__opts";

  return {
    onPointerDown: (e: React.PointerEvent) => {
      // Ignora los controles (tienen sus propios handlers).
      if ((e.target as HTMLElement).closest(CONTROLES)) return;
      start.current = { x: e.clientX, y: e.clientY };
      dragging.current = false;
    },
    onPointerMove: async (e: React.PointerEvent) => {
      if (!start.current || dragging.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      if (Math.hypot(dx, dy) < THRESHOLD) return;

      dragging.current = true;
      if (!isTauri()) return;
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        // A partir de aquí el arrastre lo maneja el sistema.
        await getCurrentWindow().startDragging();
      } catch {
        /* ignore */
      }
    },
    onPointerUp: (e: React.PointerEvent) => {
      const wasDrag = dragging.current;
      const had = start.current !== null;
      start.current = null;
      dragging.current = false;
      if (!had || wasDrag) return;
      if ((e.target as HTMLElement).closest(CONTROLES)) return;
      onClick();
    },
  };
}
