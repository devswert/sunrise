import { useEffect, useState } from "react";
import { BellRing, ExternalLink } from "lucide-react";
import { Switch } from "../../components/Switch";
import { sectionIcon } from "../settings/secciones";
import {
  SETTING_DEFAULTS,
  SettingKey,
  noticeMeetingMinutes,
  noticeOn,
  useSettingsStore,
} from "../../lib/settings";
import { openNotificationSettings, permission, type NoticePermission } from "./notify";

const SectionIcon = sectionIcon("notificaciones");

/**
 * Qué avisos recibir, y el ajuste del sistema del que dependen.
 *
 * **Es sección propia y no un campo dentro de General**, y la razón es la de
 * abajo: acá no solo se elige qué recibir, también hay que explicar que macOS
 * decide si el aviso se queda en pantalla. Eso no cabe como una línea suelta entre
 * la capacidad diaria y la jornada.
 *
 * Los tres switches guardan `"1"` / `"0"` en `settings`, y **una clave ausente es
 * encendido** (`noticeOn`): los avisos ya estaban andando antes de que hubiera
 * dónde apagarlos, así que una clave que falta no puede significar que se apagaron
 * solos.
 */
export function NotificationsCard() {
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);
  const [perm, setPerm] = useState<NoticePermission>("unavailable");
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void permission().then(setPerm);
  }, []);

  const lead = noticeMeetingMinutes(values);
  const meetingOn = lead > 0;

  async function guardarMinutos(raw: string) {
    setDraft(null);
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n < 1 || n > 120) {
      setError("Un número de minutos entre 1 y 120.");
      setDraft(raw);
      return;
    }
    setError(null);
    await setSetting(SettingKey.NOTICE_MEETING_MINUTES, String(Math.floor(n)));
  }

  function toggle(key: SettingKey, value: boolean) {
    void setSetting(key, value ? "1" : "0");
  }

  return (
    // El id y el `data-section` los usa el menú de Configs para navegar y para
    // resaltar la tab activa: el id tiene que ser `set-<tab>` y el atributo el id
    // de la tab, o el click no lleva a ninguna parte.
    <section className="set-card" id="set-notificaciones" data-section="notificaciones">
      <header className="set-card__head">
        <h2>
          {/* El mismo icono que su tab: sale de `TABS` para que no se separen. */}
          <SectionIcon size={16} aria-hidden /> Notificaciones
        </h2>
        <p>
          Qué avisos recibir. Los manda macOS, así que su estilo —si se quedan en
          pantalla o se van solos— lo decide el sistema.
        </p>
      </header>

      <div className="set-field">
        <div className="set-field__row">
          <label className="set-field__label" htmlFor="notice-meeting">
            Evento de tu Calendar importado
          </label>
          <Switch
            id="notice-meeting"
            label="Avisar antes de un evento del calendario"
            checked={meetingOn}
            onChange={(v) =>
              void setSetting(
                SettingKey.NOTICE_MEETING_MINUTES,
                v ? String(SETTING_DEFAULTS.noticeMeetingMinutes) : "0",
              )
            }
          />
        </div>
        {meetingOn && (
          <div className="set-jornada">
            <label className="set-input-wrap">
              <span className="set-input-label">Minutos antes</span>
              <input
                id="notice-lead"
                className={`set-input set-input--hora${error ? " is-invalid" : ""}`}
                value={draft ?? String(lead)}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={(e) => void guardarMinutos(e.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
                  if (ev.key === "Escape") {
                    setDraft(null);
                    setError(null);
                  }
                }}
              />
            </label>
          </div>
        )}
        {error && <span className="set-note is-error">{error}</span>}
      </div>

      <div className="set-field">
        <div className="set-field__row">
          <label className="set-field__label" htmlFor="notice-shutdown">
            Hora de cerrar el día
          </label>
          <Switch
            id="notice-shutdown"
            label="Avisar a la hora de cerrar el día"
            checked={noticeOn(values, SettingKey.NOTICE_SHUTDOWN)}
            onChange={(v) => toggle(SettingKey.NOTICE_SHUTDOWN, v)}
          />
        </div>
        <span className="set-note">
          A la hora de fin de la jornada, y una sola vez al día.
        </span>
      </div>

      <div className="set-field">
        <div className="set-field__row">
          <label className="set-field__label" htmlFor="notice-bell">
            Se acabó el tiempo estimado
          </label>
          <Switch
            id="notice-bell"
            label="Tocar la campana al llegar al estimado"
            checked={noticeOn(values, SettingKey.NOTICE_BELL)}
            onChange={(v) => toggle(SettingKey.NOTICE_BELL, v)}
          />
        </div>
        <span className="set-note">
          La campana suena siempre. Esto agrega una notificación que puedes apretar para ir a
          Focus con la tarea que estabas cronometrando.
        </span>
      </div>

      {/*
        No es un detalle que se pueda omitir: **el estilo de notificación decide si
        el aviso se queda en pantalla, y lo elige el usuario**. La app no puede
        leerlo ni escribirlo, `NSUserNotificationAlertStyle` está reportada como
        inefectiva, y el default de macOS para cualquier app de terceros es banner
        (SPECS §4.25). Una feature que promete avisarte y depende de un switch
        escondido no puede quedarse callada.
      */}
      <p className="resp-nota" role="note">
        <BellRing size={14} aria-hidden />
        <span>
          Para que los avisos <strong>se queden en pantalla</strong> hasta que los
          respondas, macOS pide su estilo en <em>Persistent</em>. Lo elige el sistema, no
          sunrise.{" "}
          <button className="set-note__link" onClick={() => void openNotificationSettings()}>
            Abrir Ajustes → Notificaciones
            <ExternalLink size={11} aria-hidden />
          </button>
        </span>
      </p>

      {perm === "unknown" && (
        <span className="set-note is-error">
          macOS todavía no tiene permiso para mostrar avisos de sunrise. Se pide la primera vez
          que hay uno que mandar.
        </span>
      )}
    </section>
  );
}
