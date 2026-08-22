import { useEffect } from "react";
import { isTauri } from "../../lib/ipc";
import { useSettingsStore } from "../../lib/settings";

/** El evento que emite el vigilante de Rust cuando el respaldo automático corrió. */
const BACKUP_RAN = "sunrise://backup-ran";

/**
 * Relee los ajustes cuando el respaldo automático corrió.
 *
 * Existe porque el respaldo pasó a Rust (`backup.rs`), y lo que escribe —la marca
 * del día y, si falló, el error— no viaja por `setSetting`, que es lo que antes
 * hacía que Configs se enterara. Sin esto la sección seguiría diciendo que hoy no
 * pasó nada, que es justo el síntoma silencioso que se vino a arreglar.
 *
 * La **lista de zips** la recarga `BackupCard`, que es la que la tiene: acá solo
 * van los ajustes, que son de toda la ventana.
 *
 * Se monta desde `Shell`, junto al resto de los listeners de ventana.
 */
export function useBackupListener(): void {
  const load = useSettingsStore((s) => s.load);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen(BACKUP_RAN, () => void load());
    })();
    return () => unlisten?.();
  }, [load]);
}
