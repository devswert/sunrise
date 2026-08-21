import { useEffect } from "react";
import { api, isTauri } from "../../lib/ipc";
import { useToday } from "../../lib/day";
import { SettingKey, useSettingsStore, workHours } from "../../lib/settings";
import { shouldRemindShutdown } from "./dailyLog";
import { SHUTDOWN_NOTICE, notify, type NotifyResult } from "../notifications/notify";

/**
 * Si el día queda marcado como avisado según cómo terminó el intento.
 *
 * Se marca cuando **se mandó** y cuando el permiso está **denegado**: sin
 * permiso, reintentar cada minuto no cambia nada y deja la app pidiendo lo mismo
 * toda la tarde. No se marca cuando **falló**, porque puede ser pasajero y el
 * próximo tick lo reintenta. Las tres son políticas distintas, y por eso
 * `notify` devuelve cuál fue en vez de `void`.
 */
export function markAfter(result: NotifyResult): boolean {
  return result === "sent" || result === "denied";
}

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
 * no hay notificaciones nativas. Lo que sí está testeado son las dos decisiones:
 * si avisar (`shouldRemindShutdown`) y si marcar el día después (`markAfter`).
 * Y adentro de Tauri ya no hay que esperar la hora: Configs → Notificaciones
 * prueba el aviso y borra la marca del día (SPECS §4.24).
 */
export function useShutdownReminder() {
  const values = useSettingsStore((s) => s.values);
  const loaded = useSettingsStore((s) => s.loaded);
  const setSetting = useSettingsStore((s) => s.set);
  const today = useToday();

  useEffect(() => {
    if (!loaded || !isTauri()) return;

    let alive = true;
    const look = async () => {
      const { end } = workHours(values);
      const ahora = ahoraHhmm();
      // Los dos cortes baratos, antes de tocar la base.
      if (values[SettingKey.SHUTDOWN_NOTIFIED_ON]?.trim() === today) return;
      if (ahora < end) return;

      const [day] = await api.dailyLog(today, 1);
      if (!alive) return;
      if (
        !shouldRemindShutdown({
          nowHhmm: ahora,
          workEnd: end,
          values,
          today,
          alreadyClosed: day?.closedAt != null,
        })
      ) {
        return;
      }

      // El texto sale de `notifications/notify`, que es también de donde lo saca
      // el botón "Probar" de Configs: si cada uno escribiera el suyo, la prueba
      // diría una cosa y el aviso de verdad otra.
      if (markAfter(await notify(SHUTDOWN_NOTICE))) {
        await setSetting(SettingKey.SHUTDOWN_NOTIFIED_ON, today);
      }
    };

    void look();
    const id = setInterval(look, INTERVALO_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [loaded, values, today, setSetting]);
}
