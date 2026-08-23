import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../../lib/store";
import { useNotificationActions, type NoticeResponse } from "./useNotificationActions";

/**
 * Lleva a donde el aviso prometía cuando lo accionas.
 *
 * **Los avisos los manda Rust** (`notice.rs` la reunión, `bell.rs` la campana,
 * `useShutdownReminder` el del cierre), por la invariante I6. Lo único que queda en
 * el front es la respuesta, que llega por evento porque el `send()` de macOS
 * bloquea su hilo hasta que la persona hace algo.
 *
 * Cuatro cosas que importan:
 *
 * - **Se monta en `Shell`, que solo existe en `main`.** El evento de Tauri llega a
 *   las dos ventanas; si el taxímetro también navegara, intentaría cambiar de ruta
 *   una ventana que no tiene esas vistas.
 * - **`click` navega igual que `action`.** La alerta ya no lleva botón "Cerrar", así
 *   que hacerle click al aviso entero es el gesto que la gente hace por instinto y
 *   quiere lo mismo que el botón. `close` y `none` son sacarla de encima: no piden
 *   ir a ninguna parte, y llevarte a otra vista por descartar un aviso es peor que
 *   no hacer nada.
 * - **Sin `route` no navega.** Un aviso sin destino no tiene a dónde llevarte, y
 *   adivinarlo sería inventar.
 * - **La tarea es opcional**: la del cierre del día va al shutdown, que no tiene
 *   una. Con `taskId`, además, la vista destino abre en esa tarea.
 */
export function useNoticeNavigation(): void {
  const navigate = useNavigate();
  const requestFocusTask = useAppStore((s) => s.requestFocusTask);

  useNotificationActions(
    useCallback(
      (r: NoticeResponse) => {
        if (r.action !== "action" && r.action !== "click") return;
        if (!r.route) return;
        if (r.taskId != null) requestFocusTask(r.taskId);
        navigate(r.route);
      },
      [navigate, requestFocusTask],
    ),
  );
}
