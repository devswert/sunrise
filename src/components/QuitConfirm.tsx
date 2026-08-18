import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { api, isTauri } from "../lib/ipc";
import { useAppStore } from "../lib/store";
import { useTimer, hms } from "../features/timer/useTimer";

/**
 * Escucha el pedido de cierre que manda Rust y abre el diálogo.
 *
 * Rust cancela el cierre (`prevent_close` / `prevent_exit`) y emite
 * `sunrise://close-requested`; la app solo se cierra de verdad cuando el
 * usuario confirma, vía `confirm_quit`, que antes detiene el timer.
 */
export function useQuitListener() {
  const setQuitOpen = useAppStore((s) => s.setQuitOpen);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen("sunrise://close-requested", () => setQuitOpen(true));
    })();
    return () => unlisten?.();
  }, [setQuitOpen]);
}

/**
 * Confirmación antes de cerrar, para que un ⌘Q accidental no baje la app.
 *
 * **No detiene el timer**: dejarlo corriendo entre sesiones es el
 * comportamiento esperado. El diálogo solo lo dice, para que nadie se lleve la
 * sorpresa de volver y encontrar la cuenta más alta de lo que trabajó.
 */
export function QuitConfirm() {
  const quitOpen = useAppStore((s) => s.quitOpen);
  const setQuitOpen = useAppStore((s) => s.setQuitOpen);
  const { active, elapsed } = useTimer();
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    if (!quitOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setQuitOpen(false);
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void salir();
      }
    };
    // `capture` para que ningún otro listener se coma las teclas primero.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quitOpen]);

  if (!quitOpen) return null;

  async function salir() {
    setSaliendo(true);
    try {
      await api.confirmQuit();
    } finally {
      setSaliendo(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => setQuitOpen(false)}>
      <div
        className="dialog"
        role="alertdialog"
        aria-label="Confirmar salida"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="dialog__title">¿Cerrar sunrise?</h2>

        {active ? (
          <p className="dialog__body">
            El timer de <strong>{active.title}</strong> ({hms(elapsed)}) sigue
            corriendo y va a seguir contando aunque cierres.
          </p>
        ) : (
          <p className="dialog__body">Tus cambios ya están guardados.</p>
        )}

        <div className="dialog__actions">
          <button className="btn-ghost" onClick={() => setQuitOpen(false)}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={salir} disabled={saliendo} autoFocus>
            <Power size={14} aria-hidden /> {saliendo ? "Cerrando…" : "Cerrar"}
          </button>
        </div>

        <span className="dialog__hint">Enter para cerrar · Escape para cancelar</span>
      </div>
    </div>
  );
}
