import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useAppStore } from "../lib/store";

/** Cuánto queda en pantalla un aviso, en ms. */
export const TOAST_MS = 6000;

/**
 * El aviso de abajo, con una acción opcional (#11: "Deshacer" al eliminar).
 *
 * En portal, como los popovers: dentro de un contenedor con scroll quedaría
 * recortado. Se cierra solo a los `TOAST_MS`, al accionarlo o con la ×. Es
 * `role="status"`: avisa sin robar el foco a lo que estabas haciendo.
 */
export function Toast() {
  const toast = useAppStore((s) => s.toast);
  const dismiss = useAppStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismiss, TOAST_MS);
    return () => window.clearTimeout(t);
  }, [toast, dismiss]);

  if (!toast) return null;
  const { action } = toast;
  return createPortal(
    <div className="toast" role="status" key={toast.id}>
      <span className="toast__text">{toast.text}</span>
      {action && (
        <button
          className="toast__action"
          onClick={async () => {
            dismiss();
            try {
              await action.run();
            } catch (err) {
              // Sin esto el fallo era un rechazo sin dueño y el gesto se sentía
              // muerto: decirlo al menos deja saber que hay que reintentar.
              console.error("[sunrise] la acción del aviso falló", err);
              useAppStore.getState().showToast({ text: "No se pudo deshacer" });
            }
          }}
        >
          {action.label}
        </button>
      )}
      <button className="toast__close" aria-label="Cerrar aviso" onClick={dismiss}>
        ×
      </button>
    </div>,
    document.body,
  );
}
