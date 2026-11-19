import { useRef } from "react";
import { ListPlus, Pause, Play } from "lucide-react";
import { useTimer } from "../features/timer/useTimer";
import "./play-controls.css";

interface Props {
  taskId: number;
  /** `sm` = 26px (la card), `md` = 34px (el detalle). */
  size?: "sm" | "md";
  className?: string;
  /**
   * Después de arrancar —clásico o en paralelo—, ya con el timer abierto. Lo usa
   * el detalle para decidir si cierra y lleva a Focus; la pausa no lo llama.
   */
  onStart?: (parallel: boolean) => void;
}

const ICON = { sm: 13, md: 14 } as const;

/**
 * El play de una tarea, en todas las vistas que lo tienen (§7, §4.6).
 *
 * - **Si la tarea corre, solo la pausa** (`stop(taskId)`): pausa esa y nada más.
 * - Si no, un botón partido: el **play clásico** (`start(taskId)`), que pausa todo
 *   lo que corra y arranca esta —es el gesto de "entro a una reunión"—, y pegado
 *   a su derecha el **play en paralelo** (`ListPlus`), que la suma sin tocar a
 *   las demás.
 *
 * Lee el timer él mismo con `useTimer()` y no por props: así cada vista que lo
 * monta no puede quedar mirando un "en curso" distinto. Va por `useTimer` y no
 * por `useTimerStore` directo para que los tests que reemplazan ese hook (el
 * del detalle) lo reemplacen también acá.
 *
 * No llama `bumpData()`: `start`/`stop` del store ya avisan a la otra ventana, y
 * un segundo aviso en la misma vuelta deja abandonada la recarga anterior.
 */
export function PlayControls({ taskId, size = "sm", className, onStart }: Props) {
  const timer = useTimer();
  const running = timer.isRunning(taskId);
  // Un doble click no abre dos timers ni pausa y re-arranca: mientras la llamada
  // anterior no termina, el siguiente click se ignora.
  const busy = useRef(false);
  const icon = ICON[size];

  // Viven dentro de cards arrastrables y clickeables: ni el arrastre ni el
  // "abrir detalle" pueden llevarse el gesto.
  const swallow = (e: React.SyntheticEvent) => e.stopPropagation();

  async function run(e: React.MouseEvent, fn: () => Promise<unknown>, after?: () => void) {
    e.stopPropagation();
    if (busy.current) return;
    busy.current = true;
    try {
      await fn();
      after?.();
    } catch (err) {
      // Un IPC que falla no puede quedar como promesa sin manejar en un
      // `onClick`; el estado no cambió, así que el botón sigue como estaba.
      console.error("PlayControls:", err);
    } finally {
      busy.current = false;
    }
  }

  const cls = `play-controls play-controls--${size}${className ? ` ${className}` : ""}`;

  if (running) {
    return (
      <div className={cls} onPointerDown={swallow}>
        <button
          type="button"
          className="play-controls__btn play-controls__pause is-running"
          aria-label="Pausar"
          title="Pausar"
          onClick={(e) => run(e, () => timer.stop(taskId))}
        >
          <Pause size={icon} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <div className={`${cls} is-split`} onPointerDown={swallow}>
      <button
        type="button"
        className="play-controls__btn play-controls__play"
        aria-label="Iniciar"
        aria-description="Pausa las demás"
        title="Iniciar (pausa las demás)"
        // Exactamente `start(taskId)`: el default del store es el play clásico.
        onClick={(e) =>
          run(
            e,
            () => timer.start(taskId),
            () => onStart?.(false),
          )
        }
      >
        <Play size={icon} aria-hidden />
      </button>
      <button
        type="button"
        className="play-controls__btn play-controls__parallel"
        aria-label="Iniciar en paralelo"
        title="Iniciar en paralelo"
        onClick={(e) =>
          run(
            e,
            () => timer.start(taskId, { parallel: true }),
            () => onStart?.(true),
          )
        }
      >
        <ListPlus size={icon} aria-hidden />
      </button>
    </div>
  );
}
