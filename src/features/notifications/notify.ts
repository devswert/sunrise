import { api, isTauri } from "../../lib/ipc";

/** Título, cuerpo y —si es una alerta— la etiqueta de su botón. */
export interface NoticeCopy {
  title: string;
  body: string;
  /**
   * Con `action`, el aviso es una **alerta**: queda en pantalla hasta que la
   * saques o aprietes el botón, como el aviso de reunión del Calendario. Sin
   * `action` es un *banner*, que se va solo en unos segundos.
   *
   * Es el botón lo que hace la diferencia, no una bandera de "persistente": en
   * macOS un aviso con botón de acción se muestra como alerta. Y como el plugin
   * de notificaciones no sabe mandar botones, un aviso con `action` viaja por
   * `notify_alert` (Rust) en vez del plugin.
   */
  action?: string;
  /**
   * A dónde lleva el aviso al accionarlo. Viaja de ida y vuelta sin usarse en el
   * envío: es lo que le permite al front saber **a dónde ir** cuando la respuesta
   * llega por el evento. Sin él, "apretó el botón" no dice nada.
   *
   * Es una ruta y no solo un id porque los tres avisos van a lugares distintos:
   * la reunión y la campana a Focus con su tarea, el cierre del día al shutdown,
   * que no tiene tarea.
   */
  target?: { route: string; taskId?: number | null };
}

/**
 * El sonido de los avisos de sunrise: `Blow`, elegido por el dev y **probado en
 * la app**.
 *
 * Es un **nombre de archivo sin extensión**, y macOS lo busca en las carpetas
 * `Sounds`: las del sistema y **`~/Library/Sounds`**, que es dónde va uno propio
 * (`api.noticeSounds()` lista las dos). Ojo: **un nombre que no existe no suena y
 * no falla**, así que un typo deja los avisos mudos sin decir nada. Lo que sí
 * quedó descartado —costó una regresión— es que un sonido con nombre impida la
 * entrega: suena y llega igual que el del sistema.
 */
export const DEFAULT_SOUND = "Blow";

/**
 * El sonido que el sistema use como suyo, que no es un archivo sino este nombre
 * literal. Se ofrece en el selector de Dev Tools; el de la app es `Blow`.
 */
export const SYSTEM_SOUND = "NSUserNotificationDefaultSoundName";

/**
 * El texto de cada aviso vive **acá y solo acá**.
 *
 * Es la misma razón que el changelog (un texto, tres lugares): si el botón
 * "Probar" de Configs escribiera su propia versión, la prueba diría una cosa y
 * el aviso de verdad otra, y nadie lo notaría hasta que llegue el real.
 */
export const SHUTDOWN_NOTICE: NoticeCopy = {
  title: "Hora de cerrar el día",
  body: "Pasa por el shutdown si quieres dejarlo escrito. Si no, queda como borrador.",
  // **Lleva botón, así que es alerta y no banner**, y eso cambió: antes era un
  // banner con el argumento de que si te lo pierdes el shutdown sigue ahí. Cierto,
  // pero el aviso sin botón tampoco llevaba a ninguna parte — había que ir a
  // buscar la vista a mano, que es exactamente el trabajo que el aviso viene a
  // ahorrar.
  action: "Ir al shutdown",
  target: { route: "/daily-shutdown" },
};

/**
 * **El texto del aviso de próxima reunión ya no vive acá: está en `notice::copy`**
 * (Rust), y se pide con `api.previewMeetingNotice`.
 *
 * Se movió porque el que lo manda de verdad es el vigilante de Rust (Mej.4), y
 * dejar la copia en el front obligaba a escribirlo dos veces: el botón de prueba de
 * Dev Tools acabaría probando un texto que el aviso real no usa, que es
 * exactamente lo que esta regla vino a evitar.
 */

/**
 * Si hay permiso para avisar. `unknown` junta **denegado y sin preguntar**, y no
 * es pereza: el plugin solo expone `isPermissionGranted()`, un booleano. La
 * única forma de distinguirlos es pedirlo (`askPermission`), y pedirlo por
 * curiosidad es justo lo que no se puede hacer en un render.
 */
export type NoticePermission = "granted" | "unknown" | "unavailable";

/** Cómo terminó un intento de avisar. */
export type NotifyResult = "sent" | "denied" | "failed" | "unavailable";

async function plugin() {
  return await import("@tauri-apps/plugin-notification");
}

export async function permission(): Promise<NoticePermission> {
  if (!isTauri()) return "unavailable";
  try {
    return (await (await plugin()).isPermissionGranted()) ? "granted" : "unknown";
  } catch {
    return "unavailable";
  }
}

/** Le pide permiso al sistema. Sin permiso previo, abre el diálogo de macOS. */
export async function askPermission(): Promise<NoticePermission> {
  if (!isTauri()) return "unavailable";
  try {
    const notif = await plugin();
    if (await notif.isPermissionGranted()) return "granted";
    return (await notif.requestPermission()) === "granted" ? "granted" : "unknown";
  } catch {
    return "unavailable";
  }
}

/**
 * Manda el aviso, y **devuelve cómo terminó**.
 *
 * Los tres resultados no son informativos: cada uno tiene una política distinta
 * en quien llama. El aviso del cierre marca el día como avisado cuando se mandó
 * **y también cuando el permiso está denegado** —reintentar cada minuto no
 * cambia nada y deja la app pidiendo lo mismo toda la tarde—, pero **no** cuando
 * falló, porque eso puede ser pasajero y el próximo tick lo reintenta. Si esto
 * devolviera `void`, las tres se volverían una.
 */
export async function notify(copy: NoticeCopy, sound = DEFAULT_SOUND): Promise<NotifyResult> {
  if (!isTauri()) return "unavailable";
  try {
    const notif = await plugin();
    if (!(await notif.isPermissionGranted())) {
      if ((await notif.requestPermission()) !== "granted") return "denied";
    }
    if (copy.action) {
      // Alerta: por Rust, porque el plugin no manda botones. El comando **no
      // espera** la respuesta —eso bloquearía hasta que alguien mire la
      // pantalla—; llega después por el evento (ver `useNotificationActions`).
      await api.notifyAlert(copy.title, copy.body, copy.action, sound, copy.target ?? null);
      return "sent";
    }
    notif.sendNotification({ title: copy.title, body: copy.body, sound });
    return "sent";
  } catch (err) {
    // Que falle un aviso no puede tumbar la app.
    console.error("[sunrise] no se pudo mandar el aviso", err);
    return "failed";
  }
}

/**
 * Abre el panel de Notificaciones de Ajustes del sistema.
 *
 * Es el **único** lugar donde se decide si un aviso se queda en pantalla o se va
 * solo (SPECS §4.25), y no hay API para leerlo ni para cambiarlo: lo elige la
 * persona. Lo que sí se puede hacer es dejarla ahí en un click.
 *
 * **Va por un comando de Rust y no por el plugin del front**, y no es capricho:
 * abrir un `x-apple.systempreferences:` desde el front necesita ese esquema en
 * `capabilities/default.json`, y agregarlo ahí dejó a la app **sin ningún aviso
 * del sistema** hasta que se revirtió (SPECS §4.25). Desde Rust el ACL no aplica
 * —la misma razón por la que el updater vive allá— y no hay permiso que tocar.
 */
export async function openNotificationSettings(): Promise<void> {
  if (!isTauri()) return;
  try {
    await api.openNotificationSettings();
  } catch (err) {
    // Nunca en silencio: un botón que no hace nada parece roto sin decir por qué.
    console.error("[sunrise] no pude abrir los ajustes de notificaciones", err);
  }
}
