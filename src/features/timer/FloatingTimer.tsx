import { useEffect } from "react";
import { Check, EyeOff, Pause, Play } from "lucide-react";
import { useTimer, useTimerRuntime, hms, isOverEstimate } from "./useTimer";
import { timerRows, useTimerStore, type LastTask } from "./timerStore";
import { useDragOrClick } from "./useDragOrClick";
import { HOVER_KEY_ATTR, useCursorHover } from "./useCursorHover";
import { formatMinutes } from "../../lib/capacity";
import { api, isTauri } from "../../lib/ipc";

/**
 * Zona que mantiene abierto el panel de opciones **de una fila**: su botón de
 * play/pausa y su propio panel. Constantes de módulo para que su identidad no
 * cambie en cada render y `useCursorHover` no reinicie el sondeo.
 */
const ZONA_HOVER = ".tax__controls, .tax__opts";
const ROWS_SELECTOR = ".tax__row";

/**
 * Medidas de la pila, en pixeles lógicos. **Son contrato con `timer.css`**
 * (`.tax` y `.tax__row`): el alto de la ventana se calcula, no se mide, para
 * que dependa solo del número de filas — un número estable, que es lo que
 * §5.4.2 exige de cualquier cosa que llame a la ventana.
 *
 * Con una fila da 70, el alto de siempre (`tauri.conf.json`).
 */
export const ROW_HEIGHT = 56;
/** Margen transparente arriba (6) y abajo (8) de la tarjeta, para la sombra. */
export const WINDOW_CHROME = 14;

/** Alto de la ventana para `rows` filas. Nunca menos de una. */
export function windowHeight(rows: number): number {
  return WINDOW_CHROME + ROW_HEIGHT * Math.max(1, rows);
}

/**
 * Taxímetro flotante: **una fila por timer que corre**, apiladas hacia abajo y
 * sin tope (#19). Si no corre ninguno, una sola fila con la pausada.
 *
 *   ┌──────────────────────────┬────┐
 *   │ Título de la tarea       │ ⏸  │
 *   │ 0:11:10 / 1:00           │    │
 *   │▬▬▬▬▬▬▬                   │    │
 *   ├──────────────────────────┼────┤
 *   │ Otra que corre en paralelo│ ⏸  │
 *   │ 0:02:41 / 0:30           │    │
 *   │▬▬                        │    │
 *   └──────────────────────────┴────┘
 *
 * Cada fila es el taxímetro de siempre: título, hoy contra el estimado, barra,
 * rojo al pasarse y el panel con el ojo y el check. Una fila que corre muestra
 * **solo la pausa** (el play en paralelo no tiene sentido sobre algo que ya
 * corre), y la pausada, que solo existe cuando la pila se vació, solo el play
 * clásico. Click en un título abre Focus Mode.
 */
export function FloatingTimer() {
  useTimerRuntime();
  const { actives, elapsedById, last, stop, start, completeAndAdvance } = useTimer();
  const hideAll = useTimerStore((s) => s.hideAll);
  // Si ya se leyó el timer de la base. Hasta entonces esta ventana no decide
  // nada sobre su propia visibilidad — ver `useSelfVisibility`.
  const loaded = useTimerStore((s) => s.loaded);
  const rows = timerRows({ actives, elapsedById, last });
  const running = actives.length > 0;
  useKeepOnTop();
  // La ventana se muestra/oculta a sí misma según su contenido. Es más fiable
  // que depender de que la ventana principal la muestre.
  useSelfVisibility(rows.length > 0, loaded);
  useWindowHeight(rows.length, loaded);

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

  const drag = useDragOrClick(openFocus);

  // Hover del botón de opciones sondeado a mano, porque el `:hover` de CSS
  // depende del foco de la ventana y el taxímetro casi nunca lo tiene. Dice
  // **qué fila**: el panel se abre solo en esa.
  const hoverRow = useCursorHover(rows.length > 0, ROWS_SELECTOR, ZONA_HOVER);

  return (
    // Click simple abre Focus; mantener pulsado y mover arrastra la ventana.
    <div className="tax" {...drag}>
      {rows.length === 0 ? (
        <TaxRow row={null} running={false} hover={false} />
      ) : (
        rows.map((row) => (
          <TaxRow
            key={row.taskId}
            row={row}
            running={running}
            hover={hoverRow === String(row.taskId)}
            onToggle={() => {
              if (running) void stop(row.taskId);
              else void start(row.taskId);
            }}
            onHide={() => void hideAll()}
            onComplete={() => void completeAndAdvance(row.taskId)}
          />
        ))
      )}
    </div>
  );
}

interface TaxRowProps {
  row: LastTask | null;
  /** Si la fila corre. Todas corren o ninguna: la pausada nunca convive con otras. */
  running: boolean;
  hover: boolean;
  onToggle?: () => void;
  onHide?: () => void;
  onComplete?: () => void;
}

function TaxRow({ row, running, hover, onToggle, onHide, onComplete }: TaxRowProps) {
  const seconds = row?.seconds ?? 0;
  const planned = row?.estimatedMinutes ?? null;
  const pct = planned && planned > 0 ? Math.min(100, (seconds / (planned * 60)) * 100) : 0;
  // Por fila: cada tarea se pasa de **su** estimado.
  const over = isOverEstimate(seconds, planned);

  return (
    <div
      className={`tax__row${hover ? " is-hover-controls" : ""}`}
      role="group"
      aria-label={row?.title || "Sin tarea activa"}
      {...{ [HOVER_KEY_ATTR]: row ? String(row.taskId) : undefined }}
    >
      <div className="tax__body">
        <div className="tax__title" title="Click: abrir en Focus · Arrastrar: mover">
          {row?.title || "Sin tarea activa"}
        </div>

        <div className="tax__time">
          <span className={`tax__actual${over ? " is-over" : ""}`}>{hms(seconds)}</span>
          <span className="tax__sep"> / </span>
          <span className="tax__planned">{planned != null ? formatMinutes(planned) : "--:--"}</span>
        </div>
      </div>

      {/* Controles: solo el play/pausa es visible en reposo. Las opciones (ojo
       * y check) entran deslizándose desde la derecha al pasar el mouse por
       * ese botón, superpuestas al contenido para no alterar el tamaño de la
       * fila. El detalle está en `timer.css`. */}
      <div className="tax__controls">
        <div className="tax__opts">
          <button
            className="tax__opt"
            aria-label="Ocultar taxímetro"
            title="Ocultar"
            onClick={onHide}
          >
            <EyeOff size={14} />
          </button>

          <button
            className="tax__opt"
            aria-label="Completar y pasar a la siguiente"
            title="Completar tarea"
            disabled={!row}
            onClick={onComplete}
          >
            <Check size={14} />
          </button>
        </div>

        <button
          className="tax__btn"
          aria-label={running ? "Pausar" : "Reanudar"}
          disabled={!row}
          onClick={onToggle}
        >
          {running ? <Pause size={15} /> : <Play size={15} />}
        </button>
      </div>

      {/* Barra de progreso: ocupa todo el ancho de la fila, por debajo de los
       * controles (los iconos del hover nunca la tapan). */}
      <div className="tax__progress">
        <div
          className={`tax__progress-fill${over ? " is-over" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Ajusta el alto de la ventana a la pila (#19). Depende del **número** de
 * filas, no de las filas: su identidad cambia en cada tick, y llamar a la
 * ventana una vez por segundo es la trampa de §5.4.2.
 *
 * Con cero filas no toca nada: la ventana se va a esconder, y al volver a
 * mostrarse lo hará con el alto que corresponda. Tampoco antes de `loaded`, por
 * la misma razón que `useSelfVisibility`: "todavía no sé" no es "una fila".
 */
function useWindowHeight(rows: number, loaded: boolean) {
  useEffect(() => {
    if (!isTauri() || !loaded || rows === 0) return;
    api.setTaximeterHeight(windowHeight(rows)).catch((err) => {
      console.error("[sunrise] taxímetro: no pude ajustar el alto:", err);
    });
  }, [rows, loaded]);
}

/**
 * Se muestra u oculta según tenga algo que mostrar.
 *
 * **No hace nada hasta haber leído el timer de la base** (`loaded`), y esa
 * espera es el arreglo de un bug que se veía como "el taxímetro no aparece".
 * `active` empieza en `null` porque vive en la base y se lee asincrónico,
 * mientras que `last` sale de `localStorage` en el acto: con el timer
 * **corriendo** —que no deja `last`— el primer render se veía como "no hay nada
 * que mostrar" y esta ventana **se escondía a sí misma** antes de saber que sí
 * había. Después ya era tarde: un webview oculto en macOS se estrangula (es la
 * razón por la que la campana vive en Rust, I6), así que el `show()` que venía
 * cuando la lectura resolvía podía no ejecutarse nunca.
 *
 * Por eso el guard es "todavía no sé", no "no mostrar": con `loaded` en false
 * no se llama **ni a mostrar ni a esconder**. Un `shouldShow` en falso mientras
 * se carga es una respuesta inventada, no una respuesta.
 */
function useSelfVisibility(shouldShow: boolean, loaded: boolean) {
  useEffect(() => {
    if (!isTauri() || !loaded) return;
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
  }, [shouldShow, loaded]);
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
