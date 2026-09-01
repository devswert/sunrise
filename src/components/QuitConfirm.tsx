import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { Dialog } from "./Dialog";
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
    <Dialog
      title="¿Cerrar sunrise?"
      label="Confirmar salida"
      hint="Enter para cerrar · Escape para cancelar"
      onClose={() => setQuitOpen(false)}
      onEnter={() => void salir()}
      actions={
        <>
          <button className="btn-ghost" onClick={() => setQuitOpen(false)}>
            Cancelar
          </button>
          <button className="btn-primary" onClick={salir} disabled={saliendo} autoFocus>
            <Power size={14} aria-hidden /> {saliendo ? "Cerrando…" : "Cerrar"}
          </button>
        </>
      }
    >
      {active ? (
        <p className="dialog__body">
          El timer de <strong>{active.title}</strong> ({hms(elapsed)}) sigue corriendo y va a seguir
          contando aunque cierres.
        </p>
      ) : (
        <p className="dialog__body">Tus cambios ya están guardados.</p>
      )}
    </Dialog>
  );
}
