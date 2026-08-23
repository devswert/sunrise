import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, ExternalLink, RotateCcw, Send, Volume2 } from "lucide-react";
import { api, isTauri } from "../../lib/ipc";
import { SettingKey, useSettingsStore } from "../../lib/settings";
import { useToday } from "../../lib/day";
import { sectionIcon } from "../settings/secciones";
import { Popover } from "../../components/Popover";
import { SearchSelect, type SearchOption } from "../../components/SearchSelect";
import {
  DEFAULT_SOUND,
  SHUTDOWN_NOTICE,
  SYSTEM_SOUND,
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

/** El de la app primero, y el del sistema como alternativa con nombre propio. */
const SOUND_OPTIONS = (sounds: string[]): SearchOption[] => [
  { value: DEFAULT_SOUND, label: `${DEFAULT_SOUND} — el de sunrise` },
  { value: SYSTEM_SOUND, label: "El que use el sistema" },
  ...sounds.filter((s) => s !== DEFAULT_SOUND).map((s) => ({ value: s, label: s })),
];

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
    <section className="set-card" id="set-dev-tools" data-section="dev-tools">
      <header className="set-card__head">
        <h2>
          <SectionIcon size={16} aria-hidden /> Dev Tools
        </h2>
        <p>
          Herramientas de desarrollo: esta sección existe solo cuando la app corre en dev,
          y no aparece en la versión instalada.
        </p>
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
  const [sound, setSound] = useState(DEFAULT_SOUND);
  const [sounds, setSounds] = useState<string[]>([]);
  const [identity, setIdentity] = useState("");
  const [pickingSound, setPickingSound] = useState(false);
  const soundRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setPerm(await permission());
  }, []);
  // La respuesta a una alerta llega por evento, no como retorno del comando.
  useNotificationActions(useCallback((r: NoticeResponse) => setNotice(ACTION_NOTE[r.action]), []));
  useEffect(() => {
    void refresh();
    void api.noticeSounds().then(setSounds);
    void api.notificationIdentity().then(setIdentity);
  }, [refresh]);

  const notifiedToday = values[SettingKey.SHUTDOWN_NOTIFIED_ON]?.trim() === today;
  const outsideApp = !isTauri();

  async function sendTest(copy: NoticeCopy) {
    const result = await notify(copy, sound);
    setNotice(RESULT_NOTE[result]);
    // Pedir permiso dentro del intento puede haberlo cambiado.
    await refresh();
  }

  return (
    <>
      <div className="set-field">
        <div className="set-field__row">
          <span className="set-field__label">Notificaciones</span>
        </div>
        <span className="set-note">
          Los avisos del sistema son lo único que no se puede ver dentro de la app: llegan
          cuando estás en otra ventana. Acá se prueban sin esperar la hora.
        </span>
      </div>

      <div className="set-field">
        <div className="set-field__row">
          <span className="set-field__label">Permiso del sistema</span>
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
        <span className={`set-note${perm === "unknown" ? " is-error" : ""}`}>
          {perm === "granted"
            ? "Concedido: los avisos llegan."
            : perm === "unknown"
              ? // El plugin solo dice sí o no, así que no hay forma de saber si
                // fue denegado o si nunca se preguntó. La ruta va escrita porque
                // un permiso denegado ya no se puede volver a pedir desde acá.
                "Sin permiso todavía, o denegado. Si al pedirlo no aparece el diálogo de macOS, está denegado: se cambia en Ajustes del sistema → Notificaciones → sunrise."
              : "Los avisos del sistema existen solo en la app; en el browser no hay nada que probar."}
        </span>
      </div>

      <div className="set-field">
        <div className="set-field__row">
          <span className="set-field__label">Sonido</span>
          <div className="chip-wrap" ref={soundRef}>
            <button
              className="chip is-set"
              aria-label="Elegir el sonido del aviso"
              onClick={() => setPickingSound((v) => !v)}
            >
              <Volume2 size={12} aria-hidden />{" "}
              {sound === SYSTEM_SOUND ? "el del sistema" : sound}
            </button>
            {pickingSound && (
              <Popover anchorRef={soundRef} align="right" onClose={() => setPickingSound(false)}>
                <SearchSelect
                  options={SOUND_OPTIONS(sounds)}
                  value={sound}
                  placeholder="Buscar sonido…"
                  onSelect={(v) => {
                    setSound(v ?? DEFAULT_SOUND);
                    setPickingSound(false);
                  }}
                />
              </Popover>
            )}
          </div>
        </div>
        <span className="set-note">
          Los del sistema, más lo que haya en <code>~/Library/Sounds</code>: ahí va uno propio
          y aparece en esta lista con el nombre del archivo. Un nombre que no existe no suena
          y no avisa.
        </span>
      </div>

      <div className="set-field">
        <div className="set-field__row">
          <span className="set-field__label">Probar un aviso</span>
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
        <span className="set-note">
          {notice ??
            "Sale el aviso de verdad, con su mismo texto y su sonido. El de próxima tarea lleva botones; que se quede en pantalla o no depende del Alert Style de abajo, no de la app."}
        </span>
      </div>

      <div className="set-field">
        <div className="set-field__row">
          <span className="set-field__label">Aviso del cierre de hoy</span>
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
        <span className="set-note">
          {notifiedToday
            ? "Hoy ya se dio por avisado, así que no va a volver a llegar. Bórralo para probar el camino real."
            : "Hoy todavía no se ha avisado: el aviso va a llegar cuando pase el fin de tu jornada."}
        </span>
      </div>

      <div className="set-field">
        <div className="set-field__row">
          <span className="set-field__label">
            {identity ? <>Los avisos salen como <code>{identity}</code></> : "Que se queden pegados"}
          </span>
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
        <span className="set-note">
          {identity.startsWith("com.apple")
            ? "macOS no conoce el identificador de sunrise, así que el aviso sale prestado y manda el ajuste de esa app. Instala el .dmg una vez y en dev pasa a salir como sunrise."
            : "Que un aviso se quede en pantalla o se vaya solo lo decide una sola cosa, y no es la app: Ajustes del sistema → Notificaciones → sunrise → Alert Style, en Temporary o Persistent. No hay forma de leerlo ni de cambiarlo desde acá."}
        </span>
      </div>
    </>
  );
}
