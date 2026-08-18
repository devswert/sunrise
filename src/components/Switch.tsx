/**
 * Interruptor de encendido/apagado para Configs.
 *
 * Existe aparte de `ThemeToggle` porque ese no es un interruptor genérico: tiene
 * un sol y una luna dibujados dentro y un track que cambia de degradado según el
 * tema. Este es el switch neutro, del tamaño de los campos de la sección.
 *
 * Es un `<button role="switch">` y no un `<input type="checkbox">` a propósito:
 * el checkbox nativo no se puede estilar en macOS sin apagarlo con
 * `appearance: none` y redibujarlo igual, y de paso el botón deja el estado
 * accesible en `aria-checked`, que es lo que leen los tests.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  /** Nombre accesible: es un control sin texto adentro. */
  label: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`switch${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className="switch__knob" />
    </button>
  );
}
