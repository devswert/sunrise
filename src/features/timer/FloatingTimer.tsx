import { useEffect } from "react";
import { Check, EyeOff, Pause, Play } from "lucide-react";
import { useTimer, useTimerRuntime, hms } from "./useTimer";
import { useDragOrClick } from "./useDragOrClick";
import { useCursorHover } from "./useCursorHover";
import { formatMinutes } from "../../lib/capacity";
import { api, isTauri } from "../../lib/ipc";

/**
 * Zona que mantiene abierto el panel de opciones: el botón de play/pausa y el
 * propio panel. Constante de módulo para que su identidad no cambie en cada
 * render y `useCursorHover` no reinicie el sondeo.
 */
const ZONA_HOVER = ".tax__controls, .tax__opts";

/**
 * Taxímetro flotante.
 *
 *   ┌──────────────────────────┬────┐
 *   │ Título de la tarea       │ ⏸  │
 *   │ 0:11:10 / 1:00           │    │
 *   │▬▬▬▬▬▬▬                   │    │
 *   └──────────────────────────┴────┘
 *
 * Siempre muestra título y tiempos (sin colapsar), con una barra de progreso
 * respecto del estimado. Click en el título abre Focus Mode.
 */
export function FloatingTimer() {
  useTimerRuntime();
  const { active, display, overEstimate, stop, start, dismissLast, completeAndAdvance } =
    useTimer();
  useKeepOnTop();
  // La ventana se muestra/oculta a sí misma según su contenido. Es más fiable
  // que depender de que la ventana principal la muestre.
  useSelfVisibility(!!display);

  async function openFocus() {
    if (!isTauri()) return;
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const main = await WebviewWindow.getByLabel("main");
      if (main) {
        await main.show();
        await main.unminimize();
        await main.setFocus();
      }
      const { emit } = await import("@tauri-apps/api/event");
      await emit("sunrise://goto", { path: "/focus" });
    } catch {
      /* ignore */
    }
  }

  const running = !!active;
  const seconds = display?.seconds ?? 0;
  const planned = display?.estimatedMinutes ?? null;
  const pct =
    planned && planned > 0 ? Math.min(100, (seconds / (planned * 60)) * 100) : 0;

  const drag = useDragOrClick(openFocus);

  // Hover del botón de opciones sondeado a mano, porque el `:hover` de CSS
  // depende del foco de la ventana y el taxímetro casi nunca lo tiene.
  const hoverControles = useCursorHover(!!display, ZONA_HOVER);

  return (
    // Click simple abre Focus; mantener pulsado y mover arrastra la ventana.
    <div className={`tax${hoverControles ? " is-hover-controls" : ""}`} {...drag}>
      <div className="tax__body">
        <div className="tax__title" title="Click: abrir en Focus · Arrastrar: mover">
          {display?.title || "Sin tarea activa"}
        </div>

        <div className="tax__time">
          <span className={`tax__actual${overEstimate ? " is-over" : ""}`}>{hms(seconds)}</span>
          <span className="tax__sep"> / </span>
          <span className="tax__planned">
            {planned != null ? formatMinutes(planned) : "--:--"}
          </span>
        </div>
      </div>

      {/* Controles: solo el play/pausa es visible en reposo. Las opciones (ojo
       * y check) entran deslizándose desde la derecha al pasar el mouse por
       * ese botón, superpuestas al contenido para no alterar el tamaño de la
       * caja. El detalle está en `timer.css`. */}
      <div className="tax__controls">
        <div className="tax__opts">
        <button
          className="tax__opt"
          aria-label="Ocultar taxímetro"
          title="Ocultar"
          onClick={() => {
            if (running) void stop();
            dismissLast();
          }}
        >
          <EyeOff size={14} />
        </button>

        <button
          className="tax__opt"
          aria-label="Completar y pasar a la siguiente"
          title="Completar tarea"
          disabled={!display}
          onClick={() => void completeAndAdvance()}
        >
          <Check size={14} />
        </button>
        </div>

        <button
          className="tax__btn"
          aria-label={running ? "Pausar" : "Reanudar"}
          disabled={!display}
          onClick={() => {
            if (running) void stop();
            else if (display) void start(display.taskId);
          }}
        >
          {running ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </div>

      {/* Barra de progreso: ocupa todo el ancho de la tarjeta, por debajo de
       * los controles (los iconos del hover nunca la tapan). */}
      <div className="tax__progress">
        <div
          className={`tax__progress-fill${overEstimate ? " is-over" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Se muestra u oculta según tenga algo que mostrar. */
function useSelfVisibility(shouldShow: boolean) {
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;

    (async () => {
      try {
        if (cancelled) return;

        if (shouldShow) {
          // Rust se encarga de mostrarla y de dejarla dentro de pantalla.
          await api.setTaximeterVisible(true, readPos());
        } else {
          await api.setTaximeterVisible(false);
        }
      } catch (err) {
        console.error("[sunrise] taxímetro: no pude alternar visibilidad:", err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shouldShow]);
}

/**
 * Mantiene el taxímetro encima de todo y visible en todos los escritorios
 * (Spaces), y recuerda su posición entre sesiones y monitores.
 */
function useKeepOnTop() {
  useEffect(() => {
    if (!isTauri()) return;
    let unlistenMove: (() => void) | undefined;
    let reassert: (() => void) | undefined;

    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const win = getCurrentWindow();

        // OJO: no marcar la ventana como no-enfocable aquí. En macOS eso puede
        // dejarla sin mostrarse al hacer `show()`. El robo de foco ya se
        // resolvió eliminando el `show()` que se repetía cada segundo.
        await attempt(() => win.setAlwaysOnTop(true));
        await attempt(() => win.setVisibleOnAllWorkspaces(true));

        // La posición inicial y la validación de "fuera de pantalla" las hace
        // Rust (en coordenadas físicas). Aquí solo recordamos dónde la dejaste.
        unlistenMove = await win.onMoved(({ payload }) => {
          writePos({ x: payload.x, y: payload.y });
        });

        // Algunos gestores de ventanas bajan el nivel: lo reafirmamos.
        reassert = () => void win.setAlwaysOnTop(true);
        window.addEventListener("focus", reassert);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      unlistenMove?.();
      if (reassert) window.removeEventListener("focus", reassert);
    };
  }, []);
}

async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch {
    /* capacidad no disponible */
  }
}

const POS_KEY = "sunrise-tax-pos";

function readPos(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    return raw ? (JSON.parse(raw) as { x: number; y: number }) : null;
  } catch {
    return null;
  }
}

function writePos(p: { x: number; y: number }) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

