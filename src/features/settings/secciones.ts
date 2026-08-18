import {
  CalendarDays,
  DatabaseBackup,
  Hash,
  Keyboard,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

/**
 * Las secciones de Configs: su orden, su nombre y su icono.
 *
 * Vive en su propio módulo y no en `SettingsView` porque dos de las cards
 * (`FeedsCard`, `BackupCard`) son de otros módulos y también necesitan su icono:
 * importarlo desde la vista sería un ciclo, ya que la vista las importa a ellas.
 *
 * Dos cosas que hay que respetar:
 *
 * - **El orden tiene que ser el mismo que el de las cards** en `SettingsView`. El
 *   resaltado del menú lo decide un `IntersectionObserver` sobre las secciones, así
 *   que si divergen la lista marca una y se ve otra.
 * - **El icono se define acá y solo acá**, y de aquí lo toman las dos partes: la
 *   tab del menú y el título de la card. Definirlo dos veces termina en un menú
 *   que muestra un icono y una sección que muestra otro.
 */
export const TABS = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "calendarios", label: "Calendarios", icon: CalendarDays },
  // Los canales son el `#tag` de las tarjetas, así que el numeral.
  { id: "canales", label: "Canales", icon: Hash },
  { id: "atajos", label: "Atajos", icon: Keyboard },
  // Al final: es la sección que menos se visita y la única que puede destruir
  // datos, así que no debe quedar en el camino de nadie.
  { id: "respaldo", label: "Respaldo", icon: DatabaseBackup },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/** El icono de una sección, para las cards que viven en otros módulos. */
export function iconoDeSeccion(id: TabId): LucideIcon {
  return TABS.find((t) => t.id === id)!.icon;
}
