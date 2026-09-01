import { useEffect, useRef, type ReactNode } from "react";

interface DialogProps {
  /** El título visible. Puede traer su icono. */
  title: ReactNode;
  /** Cómo lo nombra un lector de pantalla, si el título no alcanza solo. */
  label: string;
  /** El cuerpo: párrafos, una `<dl>`, markdown… lo que sea. */
  children: ReactNode;
  /** Los botones, en orden de lectura. El primario va último. */
  actions: ReactNode;
  /** La línea chica de abajo, que dice qué hacen las teclas. */
  hint?: string;
  /**
   * Icono en círculo y todo centrado, para los avisos de ritual. El diálogo
   * seco de ⌘Q no lo usa.
   */
  icon?: ReactNode;
  /**
   * Cerrar sin decidir: Escape y el click afuera. **Ausente = no se puede**, que
   * es lo que necesita un diálogo a mitad de una operación irreversible.
   */
  onClose?: () => void;
  /**
   * Qué hace Enter. Va **aparte del botón primario** a propósito: en un diálogo
   * destructivo el primario no se ata a Enter, porque una tecla de más no puede
   * ser lo que reemplace tu base de datos.
   */
  onEnter?: () => void;
  /**
   * Una variante de aspecto, que agrega `dialog--<variant>` y nada más.
   *
   * Existe para no forkear el componente: la razón por la que este archivo existe
   * es que el diálogo estaba copiado seis veces y una de las copias se había
   * quedado sin teclado. Un panel propio "porque este se ve distinto" vuelve a
   * entrar en esa trampa. Los estilos de la variante los pone la feature que la
   * pide, no `dialog.css`.
   */
  variant?: "announcement";
}

/**
 * El diálogo chico de la app: confirmar, avisar, cerrar algo.
 *
 * Existe porque estaba copiado seis veces. Cada copia rearmaba el overlay, los
 * roles de accesibilidad, el `stopPropagation` y su propio listener de teclado —
 * y como era de esperar, **las dos de Respaldo se habían quedado sin teclado**:
 * la confirmación de restaurar, que es la acción más destructiva de la app, no se
 * cerraba con Escape.
 *
 * **Las teclas van en `window` con `capture`, no en un `onKeyDown` del div.** Es
 * la regla de SPECS §7 y el motivo por el que este componente vale la pena: un
 * `onKeyDown` solo se dispara si el foco está adentro, y basta un click en el
 * overlay para que deje de estarlo. Copiada seis veces, esa regla se olvida una.
 *
 * No cubre `TaskModal` ni `AddFeedModal`: esos no son diálogos de confirmación
 * sino una vista y un formulario, con su propio teclado (⌘Enter, Enter por
 * campo). Comparten el `.modal-overlay` y nada más. Las confirmaciones **en
 * línea** de dos pasos —borrar una tarea, quitar un feed— tampoco: no son
 * modales.
 */
export function Dialog({
  title,
  label,
  children,
  actions,
  hint,
  icon,
  onClose,
  onEnter,
  variant,
}: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) {
        e.preventDefault();
        onClose();
      }
      if (e.key === "Enter" && onEnter) {
        e.preventDefault();
        onEnter();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onEnter]);

  // Si ningún botón se llevó el foco con `autoFocus`, se lo queda el panel: sin
  // foco adentro, un lector de pantalla sigue leyendo la vista de atrás.
  useEffect(() => {
    const el = panel.current;
    if (el && !el.contains(document.activeElement)) el.focus();
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={panel}
        className={`dialog${icon ? " dialog--hero" : ""}${variant ? ` dialog--${variant}` : ""}`}
        role="alertdialog"
        aria-label={label}
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {icon && (
          <div className="dialog__icono" aria-hidden>
            {icon}
          </div>
        )}
        <h2 className="dialog__title">{title}</h2>
        {children}
        <div className="dialog__actions">{actions}</div>
        {hint && <span className="dialog__hint">{hint}</span>}
      </div>
    </div>
  );
}
