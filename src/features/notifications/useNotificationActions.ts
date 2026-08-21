import { useEffect } from "react";
import { isTauri } from "../../lib/ipc";

/** El evento que emite Rust cuando el usuario responde una alerta. */
const NOTIFICATION_ACTION = "sunrise://notification-action";

/** Qué hizo el usuario con la alerta. Espeja `response_label` en `commands.rs`. */
export type NoticeAction = "action" | "click" | "close" | "reply" | "none";

/**
 * Escucha la respuesta a una alerta del sistema.
 *
 * La respuesta llega por evento y no como retorno del comando porque el `send()`
 * de macOS **bloquea hasta que la persona hace algo**: eso es exactamente lo que
 * significa que la alerta sea persistente, así que esperarla dentro del comando
 * congelaría la app hasta que alguien mirara la pantalla.
 *
 * Hoy el único consumidor es la card de Dev Tools, que muestra qué volvió. Lo que
 * falta —que apretar el botón lleve a Focus— es de Mej.4, y tiene que engancharse
 * acá en vez de inventar otro camino.
 */
export function useNotificationActions(onAction: (action: NoticeAction) => void): void {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<NoticeAction>(NOTIFICATION_ACTION, (e) => onAction(e.payload));
    })();
    return () => unlisten?.();
  }, [onAction]);
}
