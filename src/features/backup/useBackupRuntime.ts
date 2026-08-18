import { useEffect } from "react";
import { api, isTauri } from "../../lib/ipc";
import { useToday } from "../../lib/day";
import { useProfile } from "../../lib/profile";
import { SettingKey, useSettingsStore } from "../../lib/settings";
import { hhmm, shouldBackup } from "./backup";

/** Cada cuánto se mira el reloj. El respaldo es uno al día, no uno por minuto. */
const INTERVALO_MS = 60_000;

/**
 * Corre el respaldo automático a la hora configurada, una vez al día.
 *
 * Gemelo de `useShutdownReminder`, con las mismas dos razones de fondo:
 *
 * - **Va montado en `Shell`, que solo existe en la ventana principal.** Si
 *   viviera en las dos, el taxímetro haría su propio respaldo al mismo minuto y
 *   quedarían dos zips por día (o peor: dos `VACUUM INTO` compitiendo por el
 *   `Mutex` de la base). Es la misma razón que la invariante I6.
 * - **La decisión es pura y vive en `shouldBackup`.** Acá solo quedan el reloj y
 *   los efectos.
 *
 * **En dev no corre**, y el corte vive en `shouldBackup` con los otros tres: la
 * carpeta de respaldos es una ruta en el disco, no un dato de la base, así que dev
 * podría escribir zips de prueba en la carpeta de verdad y la retención borraría
 * los reales. Se espera a saber el perfil antes de decidir — asumir producción por
 * un instante alcanza para que corra una vez.
 *
 * **El fracaso se guarda, no se traga.** `backup_ran_on` se marca solo cuando el
 * respaldo salió; si falló, se escribe `backup_last_error` y la sección de
 * Configs lo muestra. Un respaldo que dejó de correr en silencio es peor que no
 * tener respaldo: se cuenta con él sin que exista.
 */
export function useBackupRuntime() {
  const values = useSettingsStore((s) => s.values);
  const loaded = useSettingsStore((s) => s.loaded);
  const setSetting = useSettingsStore((s) => s.set);
  const today = useToday();
  const profile = useProfile();

  useEffect(() => {
    // Fuera de Tauri no hay carpeta que escribir: el mock no toca el disco.
    // `perfil` en null es "todavía no sé", no "es producción".
    if (!loaded || !isTauri() || !profile) return;

    let alive = true;
    const look = async () => {
      if (!shouldBackup({ nowHhmm: hhmm(new Date()), values, today, isDev: profile.dev })) return;

      try {
        const hecho = await api.createBackup();
        if (!alive) return;
        await setSetting(SettingKey.BACKUP_RAN_ON, today);
        if (values[SettingKey.BACKUP_LAST_ERROR]) {
          await setSetting(SettingKey.BACKUP_LAST_ERROR, "");
        }
        console.info(`[sunrise] respaldo automático: ${hecho.name}`);
      } catch (err) {
        if (!alive) return;
        // **La fecha primero, el error después.** Cada `setSetting` muta
        // `values`, que está en las dependencias del efecto: escribir el error
        // primero relanza `mirar()` con `backup_ran_on` todavía en ayer, y se
        // dispara un segundo intento. Marcando la fecha antes, el relanzamiento
        // se corta en el primer if de `shouldBackup`.
        //
        // Y sí se marca la fecha: reintentar cada minuto contra una carpeta que
        // no existe (un disco externo desconectado, un Drive sin sesión) es un
        // error por minuto hasta la medianoche. Queda anotado y el usuario puede
        // reintentar a mano desde Configs.
        await setSetting(SettingKey.BACKUP_RAN_ON, today);
        await setSetting(SettingKey.BACKUP_LAST_ERROR, String(err));
        console.error("[sunrise] falló el respaldo automático", err);
      }
    };

    void look();
    const id = setInterval(look, INTERVALO_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [loaded, values, today, setSetting, profile]);
}
