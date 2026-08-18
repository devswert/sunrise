import type { ReactNode } from "react";

export interface DockItem {
  id: string;
  /** Nombre del panel. Es el `aria-label` y el tooltip: el botón es solo icono. */
  label: string;
  icon: ReactNode;
  active: boolean;
  onToggle: () => void;
}

/**
 * Barra vertical de paneles, pegada al borde derecho de la vista semana.
 *
 * Es una tira **permanente** —no se superpone a nada— y cada icono abre y cierra
 * su panel, que sí se monta encima del board. Hoy tiene un solo botón, la
 * agenda; los otros dos que va a recibir (objetivos de la semana y backlog
 * arrastrable) llegan con sus milestones, y por eso esto recibe una lista en vez
 * de tener el botón cableado adentro.
 *
 * No se dibujan botones para lo que todavía no existe: un icono que no hace nada
 * al apretarlo enseña que la barra no responde.
 */
export function SideDock({ items }: { items: DockItem[] }) {
  return (
    <nav className="dock" aria-label="Paneles">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`dock__btn${it.active ? " is-active" : ""}`}
          aria-label={it.label}
          aria-pressed={it.active}
          title={it.label}
          onClick={it.onToggle}
        >
          {it.icon}
        </button>
      ))}
    </nav>
  );
}
