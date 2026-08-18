import { useEffect } from "react";
import { api, isTauri } from "../../lib/ipc";
import { useToday } from "../../lib/day";
import { SettingKey, useSettingsStore, workHours } from "../../lib/settings";
import { tocaAvisarCierre } from "./bitacora";

/** Cada cuánto se mira el reloj. El aviso es de una vez al día, no al segundo. */
const INTERVALO_MS = 60_000;

/** `HH:mm` local. */
function ahoraHhmm(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Avisa, una vez al día, que llegó la hora de cerrar.
 *
 * Tres cosas que no son obvias:
 *
 * - **Va montado en `Shell`, que solo existe en la ventana principal.** Es la
 *   misma razón que la invariante I6 (una sola ventana toca la campana): el
 *   taxímetro corre sus propios hooks, y si este viviera en los dos llegarían
 *   dos notificaciones con unos ms de diferencia.
 * - **El guardado es una fecha, no un booleano** (`shutdown_notified_on`), igual
 *   que `planned_on`: una sesión abierta cruzando la medianoche tiene que volver
 *   a avisar al día siguiente. `useToday` es lo que hace que este hook se
 *   entere del cambio de día.
 * - **La hora sale de `work_end`**, el mismo ajuste que ya usa el rail. Nunca
 *   una hora hardcodeada: es una decisión del usuario.
 *
 * La consulta al día se hace **solo** cuando ya pasó la hora y no se avisó
 * todavía. Preguntarlo en cada tick sería una consulta por minuto para nada.
 *
 * **Este camino no se puede verificar fuera de Tauri**: en el browser y en jsdom
 * no hay notificaciones nativas. Lo que sí está testeado es la decisión
 * (`tocaAvisarCierre`).
 */
export function useShutdownReminder() {
  const values = useSettingsStore((s) => s.values);
  const loaded = useSettingsStore((s) => s.loaded);
  const setSetting = useSettingsStore((s) => s.set);
  const hoy = useToday();

  useEffect(() => {
    if (!loaded || !isTauri()) return;

    let vivo = true;
    const mirar = async () => {
      const { end } = workHours(values);
      const ahora = ahoraHhmm();
      // Los dos cortes baratos, antes de tocar la base.
      if (values[SettingKey.SHUTDOWN_NOTIFIED_ON]?.trim() === hoy) return;
      if (ahora < end) return;

      const [dia] = await api.bitacora(hoy, 1);
      if (!vivo) return;
      if (
        !tocaAvisarCierre({
          nowHhmm: ahora,
          workEnd: end,
          values,
          hoy,
          yaCerrado: dia?.closedAt != null,
        })
      ) {
        return;
      }

      try {
        const notif = await import("@tauri-apps/plugin-notification");
        if (!(await notif.isPermissionGranted())) {
          const permiso = await notif.requestPermission();
          if (permiso !== "granted") {
            // Se marca igual: sin permiso, reintentar cada minuto no cambia
            // nada y deja la app pidiendo lo mismo toda la tarde.
            await setSetting(SettingKey.SHUTDOWN_NOTIFIED_ON, hoy);
            return;
          }
        }
        notif.sendNotification({
          title: "Hora de cerrar el día",
          body: "Pasa por el shutdown si quieres dejarlo escrito. Si no, queda como borrador.",
        });
        await setSetting(SettingKey.SHUTDOWN_NOTIFIED_ON, hoy);
      } catch (err) {
        // Que falle la notificación no puede tumbar la app. Y no se marca la
        // fecha: si fue algo pasajero, el próximo tick lo vuelve a intentar.
        console.error("[sunrise] no se pudo avisar el cierre del día", err);
      }
    };

    void mirar();
    const id = setInterval(mirar, INTERVALO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [loaded, values, hoy, setSetting]);
}
