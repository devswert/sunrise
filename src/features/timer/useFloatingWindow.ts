import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { api, isTauri } from "../../lib/ipc";

/** Última posición conocida del taxímetro (la guarda la propia ventana). */
function readTaxPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem("sunrise-tax-pos");
    return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
  } catch {
    return null;
  }
}

/** Ejecuta algo opcional sin que su fallo rompa el resto. */
async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    /* la capacidad no existe en esta plataforma/versión: se ignora */
  }
}

/**
 * Muestra el taxímetro mientras haya tarea en él y lo esconde si no.
 *
 * Cuidado con dos cosas aprendidas a golpes:
 *  1. `show()` va PRIMERO y aislado. Si antes se llama algo no soportado
 *     (p. ej. `setVisibleOnAllWorkspaces`), lanza y la ventana no aparece.
 *  2. El valor de `visible` tiene que ser **estable**: si cambia en cada tick
 *     del reloj, `show()` se ejecuta una vez por segundo y la ventana roba el
 *     foco continuamente.
 *  3. **No decide nada hasta que `loaded`.** El timer activo vive en la base y
 *     se lee asincrónico, así que en el primer render un timer corriendo se ve
 *     igual que no tener nada: sin el guard, esta ventana manda esconder el
 *     taxímetro justo mientras la otra lo está mostrando. Es el mismo arreglo
 *     que en `useSelfVisibility`, y va en las dos porque las dos deciden.
 *
 * Además verifica que realmente quedó visible y reintenta, porque algunos
 * ajustes de ventana (como marcarla no enfocable) pueden dejarla oculta.
 */
export function useFloatingWindow(visible: unknown, loaded = true) {
  useEffect(() => {
    if (!isTauri() || !loaded) return;
    let cancelled = false;

    (async () => {
      try {
        // Camino principal: lo resuelve Rust (sin depender de permisos del
        // webview) y deja rastro en el log de la app.
        await api.setTaximeterVisible(!!visible, readTaxPos());
        if (cancelled || !visible) return;

        // Ajustes best-effort desde el webview; su fallo no impide mostrarla.
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const win = await WebviewWindow.getByLabel("floating-timer");
        if (!win) return;
        await attempt(() => win.setAlwaysOnTop(true));
        await attempt(() => win.setVisibleOnAllWorkspaces(true));
      } catch (err) {
        // Sin esto el fallo sería invisible: la ventana simplemente no saldría.
        console.error("[sunrise] no se pudo mostrar el taxímetro:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, loaded]);
}

/** Escucha `sunrise://goto` (emitido por el taxímetro) y navega. */
export function useGotoListener() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<{ path: string }>("sunrise://goto", (e) => {
        if (e.payload?.path) navigate(e.payload.path);
      });
    })();
    return () => unlisten?.();
  }, [navigate]);
}
