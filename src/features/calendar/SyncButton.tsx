import { CalendarSync } from "lucide-react";
import { Spinner } from "../../components/Spinner";
import { useCalendarSync } from "../../lib/calendarSync";
import { relativeTime } from "../../lib/date";

/**
 * Botón de sincronizar el calendario, con cuándo fue la última vez.
 *
 * El mismo componente en la vista semana y en Configs, sobre el mismo store: si
 * uno está corriendo, el otro también se ve corriendo y bloqueado. Antes cada
 * lugar tenía su propio estado local y apretar en Configs dejaba al de la semana
 * como si nada hubiera pasado.
 *
 * No se renderiza si no hay feeds configurados: un botón de sincronizar sin nada
 * que sincronizar es una promesa vacía.
 */
export function SyncButton({ className = "" }: { className?: string }) {
  const { sincronizando, ultimaSync, feeds, sync } = useCalendarSync();

  if (feeds === 0) return null;

  return (
    <button
      type="button"
      className={`sync-btn ${className}`}
      disabled={sincronizando}
      aria-busy={sincronizando}
      onClick={() => void sync()}
      title={
        ultimaSync
          ? `Última sincronización: ${relativeTime(ultimaSync)}`
          : "Todavía no se ha sincronizado"
      }
    >
      {sincronizando ? <Spinner size={13} /> : <CalendarSync size={13} aria-hidden />}
      <span className="sync-btn__texto">
        {sincronizando ? "Sincronizando…" : "Sync"}
      </span>
      {/* La antigüedad va como texto secundario y no en el label: el nombre
        * accesible del botón tiene que ser la acción, no cuándo fue. */}
      {!sincronizando && (
        <span className="sync-btn__cuando" aria-hidden>
          {ultimaSync ? relativeTime(ultimaSync) : "nunca"}
        </span>
      )}
    </button>
  );
}
