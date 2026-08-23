import { useEffect } from "react";
import { isTauri } from "../../lib/ipc";

/** El evento que emite Rust cuando el usuario responde una alerta. */
const NOTIFICATION_ACTION = "sunrise://notification-action";

/** Qué hizo el usuario con la alerta. Espeja `response_label` en `commands.rs`. */
export type NoticeAction = "action" | "click" | "close" | "reply" | "none";

/** Qué apretó **y a dónde iba ese aviso**. Espeja `NoticeResponse` en `commands.rs`. */
export interface NoticeResponse {
  action: NoticeAction;
  route: string | null;
  taskId: number | null;
}

/**
 * Escucha la respuesta a una alerta del sistema.
 *
 * La respuesta llega por evento y no como retorno del comando porque el `send()`
 * de macOS **bloquea hasta que la persona hace algo**: eso es exactamente lo que
 * significa que la alerta sea persistente, así que esperarla dentro del comando
 * congelaría la app hasta que alguien mirara la pantalla.
 *
 * Dos consumidores: `useMeetingNotice`, que con `action` navega a Focus con esa
 * tarea, y la card de Dev Tools, que muestra qué volvió. El evento llega a **las
 * dos ventanas**, así que quien navegue tiene que montarse solo en `main`.
 */
export function useNotificationActions(onAction: (r: NoticeResponse) => void): void {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<NoticeResponse>(NOTIFICATION_ACTION, (e) => onAction(e.payload));
    })();
    return () => unlisten?.();
  }, [onAction]);
}
