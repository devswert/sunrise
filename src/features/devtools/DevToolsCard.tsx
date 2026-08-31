import { useCallback, useEffect, useState } from "react";
import { BellRing, ExternalLink, RotateCcw, Send } from "lucide-react";
import { api, isTauri } from "../../lib/ipc";
import { SettingKey, useSettingsStore } from "../../lib/settings";
import { useToday } from "../../lib/day";
import { sectionIcon } from "../settings/secciones";
import {
  SHUTDOWN_NOTICE,
  askPermission,
  notify,
  openNotificationSettings,
  permission,
  type NoticePermission,
  type NoticeCopy,
  type NotifyResult,
} from "../notifications/notify";
import {
  useNotificationActions,
  type NoticeAction,
  type NoticeResponse,
} from "../notifications/useNotificationActions";

const SectionIcon = sectionIcon("dev-tools");

/** Qué hizo el usuario con una alerta, en palabras. */
const ACTION_NOTE: Record<NoticeAction, string> = {
  action: "Apretaste el botón de la alerta. En un aviso de verdad, eso lleva a Focus.",
  click: "Le hiciste click al aviso mismo, no al botón.",
  close: "La cerraste sin accionarla.",
  reply: "Llegó una respuesta escrita, que este aviso no pide.",
  none: "Se fue sin que hicieras nada.",
};

/** Qué decir de cómo terminó una prueba. */
const RESULT_NOTE: Record<NotifyResult, string> = {
  sent: "Mandado. Si no lo viste, el aviso pudo quedar en el centro de notificaciones.",
  denied: "El sistema no da permiso, así que el aviso no salió.",
  failed: "Algo falló al mandarlo; el detalle quedó en la consola.",
  unavailable: "Los avisos del sistema existen solo en la app, no en el browser.",
};

/**
 * Herramientas para desarrollar, **solo visibles en dev**.
 *
 * No son ajustes: nadie que use la app instalada tiene por qué ver un botón que
 * dispara un aviso de mentira. Quien decide si se dibuja es `SettingsView` con
 * `profile.dev`, y **la misma condición filtra su tab** (`visibleTabs`): una
 * sección en la lista sin su card rompe el resaltado.
 *
 * Hoy la habita una sola herramienta —probar las notificaciones (Mej.16)— y está
 * pensada para que quepan más: cada una es un grupo de `set-field` con su fila de
 * acciones y su nota, sin card propia.
 */
export function DevToolsCard() {
  return (
    <section className="set-card set-card--dev" id="set-dev-tools" data-section="dev-tools">
      <header className="set-card__head">
        <SectionIcon size={16} aria-hidden className="set-card__icon" />
        <div className="set-card__head-text">
          <h2>Dev Tools</h2>
          <p>Solo en dev. No aparece en la versión instalada.</p>
        </div>
      </header>

      <NotificationTools />
    </section>
  );
}

/**
 * Probar los avisos del sistema sin esperar la hora (Mej.16).
 *
 * Los avisos nativos son la única parte de la app que **no se puede ver ni en el
 * browser ni en jsdom**, y encima dependen del reloj: el del cierre llega cuando
 * pasa `work_end`. Sin esto, cada cambio en esa maquinaria se verificaba
 * esperando, o moviendo la hora del sistema.
 *
 * Las tres cosas que ofrece son las tres que faltaban:
 *
 * - **Probar cada aviso**, con el texto de verdad (sale de `notify.ts`).
 * - **El estado del permiso a la vista.** Sin permiso el aviso simplemente no
 *   llega y no hay nada en pantalla que lo diga; peor, el aviso del cierre marca
 *   el día igual a propósito, para no quedar pidiendo permiso toda la tarde.
 * - **Volver a avisar hoy**, que borra esa marca para poder probar el camino real
 *   sin esperar al día siguiente.
 */
function NotificationTools() {
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);
  const today = useToday();
  const [perm, setPerm] = useState<NoticePermission | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [identity, setIdentity] = useState("");

  const refresh = useCallback(async () => {
    setPerm(await permission());
  }, []);
  // La respuesta a una alerta llega por evento, no como retorno del comando.
  useNotificationActions(useCallback((r: NoticeResponse) => setNotice(ACTION_NOTE[r.action]), []));
  useEffect(() => {
    void refresh();
    void api.notificationIdentity().then(setIdentity);
  }, [refresh]);

  const notifiedToday = values[SettingKey.SHUTDOWN_NOTIFIED_ON]?.trim() === today;
  const outsideApp = !isTauri();

  // **Sin pasarle el sonido**: `notify` lee el que está guardado, que es el mismo
  // que va a usar el aviso de verdad. Cuando el selector vivía acá con estado
  // local, el botón probaba un sonido que ningún aviso real usaba — el mismo
  // problema que ya se había arreglado con el texto.
  async function sendTest(copy: NoticeCopy) {
    const result = await notify(copy);
    setNotice(RESULT_NOTE[result]);
    // Pedir permiso dentro del intento puede haberlo cambiado.
    await refresh();
  }

  return (
    <>
      <div className="set-field">
        <div className="set-field__text">
          <span className="set-field__label">Notificaciones</span>
          <span className="set-note">
            Los avisos del sistema llegan cuando estás en otra ventana. Acá se prueban sin
            esperar la hora.
          </span>
        </div>
      </div>

      <div className="set-field">
        <div className="set-field__text">
          <span className="set-field__label">Permiso del sistema</span>
          <span className={`set-note${perm === "unknown" ? " is-error" : ""}`}>
            {perm === "granted"
              ? "Concedido: los avisos llegan."
              : perm === "unknown"
                ? // El plugin solo dice sí o no, así que no hay forma de saber si
                  // fue denegado o si nunca se preguntó. La ruta va escrita porque
                  // un permiso denegado ya no se puede volver a pedir desde acá.
                  "Sin permiso, o denegado. Si al pedirlo no sale el diálogo, está denegado: Ajustes del sistema → Notificaciones → sunrise."
                : "Solo existen dentro de la app; en el browser no hay nada que probar."}
          </span>
        </div>
        <div className="set-field__control">
          {perm !== "granted" && (
            <button
              type="button"
              className="resp-btn"
              disabled={outsideApp}
              onClick={() => void askPermission().then(setPerm)}
            >
              <BellRing size={13} aria-hidden />
              <span className="resp-btn__texto">Pedir permiso</span>
            </button>
          )}
        </div>
      </div>


      <div className="set-field set-field--stack">
        <div className="set-field__text">
          <span className="set-field__label">Probar un aviso</span>
          <span className="set-note">
            {notice ??
              "El aviso de verdad, con su texto y su sonido. Que se quede en pantalla lo decide el Alert Style de abajo, no la app."}
          </span>
        </div>
        <div className="set-field__control">
          <div className="upd-acciones">
            <button
              type="button"
              className="resp-btn"
              disabled={outsideApp}
              onClick={() => void sendTest(SHUTDOWN_NOTICE)}
            >
              <Send size={13} aria-hidden />
              <span className="resp-btn__texto">Cierre del día</span>
            </button>
            <button
              type="button"
              className="resp-btn"
              disabled={outsideApp}
              onClick={() =>
                void api
                  .previewMeetingNotice("Weekly de equipo", "15:00")
                  .then((c) => sendTest({ ...c, target: { route: "/focus" } }))
              }
            >
              <Send size={13} aria-hidden />
              <span className="resp-btn__texto">Próxima reunión</span>
            </button>
            <button
              type="button"
              className="resp-btn"
              disabled={outsideApp}
              onClick={() =>
                void api
                  .previewBellNotice("Weekly de equipo", 90)
                  .then((c) => sendTest({ ...c, target: { route: "/focus" } }))
              }
            >
              <Send size={13} aria-hidden />
              <span className="resp-btn__texto">Se acabó el tiempo</span>
            </button>
          </div>
        </div>
      </div>

      <div className="set-field">
        <div className="set-field__text">
          <span className="set-field__label">Aviso del cierre de hoy</span>
          <span className="set-note">
            {notifiedToday
              ? "Hoy ya se dio por avisado. Bórralo para probar el camino real."
              : "Todavía no se avisó hoy: llega al pasar el fin de tu jornada."}
          </span>
        </div>
        <div className="set-field__control">
          <button
            type="button"
            className="resp-btn"
            disabled={!notifiedToday}
            onClick={() => void setSetting(SettingKey.SHUTDOWN_NOTIFIED_ON, "")}
          >
            <RotateCcw size={13} aria-hidden />
            <span className="resp-btn__texto">Volver a avisar hoy</span>
          </button>
        </div>
      </div>

      <div className="set-field">
        <div className="set-field__text">
          <span className="set-field__label">
            {identity ? <>Los avisos salen como <code>{identity}</code></> : "Que se queden pegados"}
          </span>
          <span className="set-note">
            {identity.startsWith("com.apple")
              ? "macOS no conoce a sunrise, así que el aviso sale prestado y manda el ajuste de esa app. Instala el .dmg una vez y se arregla."
              : "Lo decide Ajustes del sistema → Notificaciones → sunrise → Alert Style, en Temporary o Persistent. No se puede leer ni cambiar desde acá."}
          </span>
        </div>
        <div className="set-field__control">
          <button
            type="button"
            className="resp-btn"
            disabled={outsideApp}
            onClick={() => void openNotificationSettings()}
          >
            <ExternalLink size={13} aria-hidden />
            <span className="resp-btn__texto">Abrir Ajustes del sistema</span>
          </button>
        </div>
      </div>
    </>
  );
}
