import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Crosshair,
  Home,
  Inbox,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Settings as SettingsIcon,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useProfile } from "../lib/profile";
import { useSidebarCollapsed } from "../lib/sidebar";
import { useTheme } from "../lib/theme";
import { SunriseMark } from "./SunriseMark";
import { ThemeToggle } from "./ThemeToggle";
import { UpdateBanner } from "../features/updates/UpdateBanner";
import { api } from "../lib/ipc";
import { useAppStore } from "../lib/store";
import {
  SHORTCUT_ACTIONS,
  ariaKeyshortcuts,
  displayCombo,
  resolveShortcuts,
} from "../lib/shortcuts";
import { useSettingsStore } from "../lib/settings";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const TOP: NavItem[] = [
  { to: "/", label: "Home", icon: Home },
  { to: "/today", label: "Today", icon: CalendarDays },
  { to: "/focus", label: "Focus", icon: Crosshair },
];

const DAILY: NavItem[] = [
  { to: "/daily-planning", label: "Daily planning", icon: ClipboardList },
  { to: "/daily-shutdown", label: "Daily shutdown", icon: Moon },
  { to: "/daily-highlights", label: "Daily highlights", icon: Sparkles },
];

const WEEKLY: NavItem[] = [
  { to: "/weekly-planning", label: "Weekly planning", icon: CalendarRange },
  { to: "/weekly-review", label: "Weekly review", icon: PieChart },
];

/**
 * Atajo vigente de la ruta, si tiene uno. Se muestra al lado del nombre para que
 * se aprendan sin ir a buscarlos: el atajo se lee justo cuando estás haciendo el
 * click que reemplaza.
 */
function useShortcutFor(path: string): string | null {
  const values = useSettingsStore((s) => s.values);
  const resolved = useMemo(() => resolveShortcuts(values), [values]);
  const action = SHORTCUT_ACTIONS.find((a) => a.path === path);
  return action ? resolved[action.id] : null;
}

function NavRow({
  item,
  collapsed,
  count,
}: {
  item: NavItem;
  collapsed?: boolean;
  /** Pendientes de esa ruta. Se dibuja **en vez** del atajo: son el mismo lugar. */
  count?: number;
}) {
  const Icon = item.icon;
  const shortcut = useShortcutFor(item.to);
  return (
    <NavLink
      to={item.to}
      end={item.to === "/"}
      aria-keyshortcuts={shortcut ? ariaKeyshortcuts(shortcut) : undefined}
      /* Colapsado el nombre no se ve, así que el tooltip nativo es lo único que
         queda para distinguir nueve iconos. Expandido estorbaría: el nombre ya
         está ahí, escrito. */
      title={collapsed ? item.label : undefined}
      className={({ isActive }) => (isActive ? "sidebar__link is-active" : "sidebar__link")}
    >
      {/* Sin `size`: el tamaño lo pone el CSS, porque colapsado los iconos crecen
          y un prop no sabe en qué estado está el sidebar. */}
      <Icon className="sidebar__icon" strokeWidth={2} aria-hidden />
      <span className="sidebar__label">{item.label}</span>
      {/* El conteo gana el lugar del atajo cuando hay: el atajo se aprende una
       * vez y el número cambia todo el tiempo. Colapsado no va: al lado de un
       * icono sin nombre, un número suelto no dice de qué es. */}
      {count != null && count > 0 && !collapsed ? (
        <span className="sidebar__count" aria-hidden>
          {count}
        </span>
      ) : (
        /* Decorativo: el nombre accesible del link es solo la etiqueta. */
        shortcut && (
          <span className="sidebar__key" aria-hidden>
            {displayCombo(shortcut)}
          </span>
        )
      )}
    </NavLink>
  );
}

/**
 * Cuántas tareas hay en el backlog, para el badge del item.
 *
 * **Cuenta todo**, incluidas las tareas sin canal: el número tiene que coincidir
 * con la lista que abre el item, o el desajuste no se explica solo.
 *
 * Los canales **no** se listan acá. Se ven en la vista, que es donde además se
 * pueden abrir y editar: repetirlos en el sidebar sumaba una segunda lista que
 * mantener sincronizada y alargaba la columna con nombres sobre los que no se
 * puede hacer nada.
 */
function useBacklogTotal() {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      const backlog = await api.listBacklog();
      if (alive) setTotal(backlog.length);
    })();
    return () => {
      alive = false;
    };
  }, [dataVersion]);

  return total;
}

export function Sidebar() {
  const { theme, toggle } = useTheme();
  const { collapsed, toggle: toggleCollapsed } = useSidebarCollapsed();
  const backlogTotal = useBacklogTotal();
  const profile = useProfile();

  return (
    <nav className={`sidebar${collapsed ? " is-collapsed" : ""}`} aria-label="Navegación principal">
      {/* La marca arranca bajo los botones nativos de macOS, que flotan sobre el
       * contenido desde que la ventana no tiene barra de título. El espacio lo
       * pone el padding del sidebar (`--titlebar-h`), no un hueco acá.
       *
       * El botón de colapsar va acá y no al final de la columna: es un ajuste
       * del marco, y el marco se maneja arriba, donde uno ya está mirando por
       * los botones de la ventana. Abajo quedaba entre los items de navegación,
       * pareciendo uno más. */}
      <div className="sidebar__top">
        <div className="sidebar__brand">
          <SunriseMark className="sidebar__brand-mark" />
          <span className="sidebar__brand-text">sunrise</span>
          {/* Dev y la versión instalada se ven idénticas y usan bases distintas
              (§4.20). Sin esto, con las dos abiertas no sabes en cuál estás. */}
          {profile?.dev && (
            <span className="sidebar__perfil" title={`Base en uso: ${profile.dbFile}`}>
              dev
            </span>
          )}
        </div>
        <button
          type="button"
          className="sidebar__collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expandir" : "Colapsar"}
          title={collapsed ? "Expandir el sidebar" : "Colapsar el sidebar"}
          onClick={toggleCollapsed}
        >
          {collapsed ? (
            <PanelLeftOpen className="sidebar__icon" aria-hidden />
          ) : (
            <PanelLeftClose className="sidebar__icon" aria-hidden />
          )}
        </button>
      </div>

      <div className="sidebar__group">
        {TOP.map((it) => (
          <NavRow key={it.to} item={it} collapsed={collapsed} />
        ))}
      </div>

      <div className="sidebar__group">
        <div className="sidebar__section-label">Daily rituals</div>
        {DAILY.map((it) => (
          <NavRow key={it.to} item={it} collapsed={collapsed} />
        ))}
      </div>

      <div className="sidebar__group">
        <div className="sidebar__section-label">Weekly rituals</div>
        {WEEKLY.map((it) => (
          <NavRow key={it.to} item={it} collapsed={collapsed} />
        ))}
      </div>

      <div className="sidebar__group">
        <NavRow
          item={{ to: "/backlog", label: "Backlog", icon: Inbox }}
          collapsed={collapsed}
          count={backlogTotal}
        />
      </div>

      {/* Footer: aviso del updater, switch de tema y Settings al final. El aviso
       * va acá arriba y no junto a la navegación: no es un lugar al que ir. */}
      <div className="sidebar__footer">
        <UpdateBanner />
        <div className="sidebar__theme-row">
          <span className="sidebar__theme-label">Tema</span>
          <ThemeToggle theme={theme} onToggle={toggle} />
        </div>
        <NavRow
          item={{ to: "/settings", label: "Configs", icon: SettingsIcon }}
          collapsed={collapsed}
        />
      </div>
    </nav>
  );
}
