import { useEffect, useRef, useState } from "react";
import { BellRing, ExternalLink, Play, Volume2 } from "lucide-react";
import { Switch } from "../../components/Switch";
import { Popover } from "../../components/Popover";
import { SearchSelect } from "../../components/SearchSelect";
import { api, isTauri } from "../../lib/ipc";
import { sectionIcon } from "../settings/secciones";
import {
  SETTING_DEFAULTS,
  SettingKey,
  noticeMeetingMinutes,
  noticeOn,
  noticeSound,
  useSettingsStore,
} from "../../lib/settings";
import {
  SOUND_OPTIONS,
  SYSTEM_SOUND,
  openNotificationSettings,
  permission,
  type NoticePermission,
} from "./notify";

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
  const [sounds, setSounds] = useState<string[]>([]);
  const [pickingSound, setPickingSound] = useState(false);
  const [soundError, setSoundError] = useState<string | null>(null);
  const soundRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void permission().then(setPerm);
    void api.noticeSounds().then(setSounds);
  }, []);

  const sound = noticeSound(values);

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
        {/* El mismo icono que su tab: sale de `TABS` para que no se separen. */}
        <SectionIcon size={16} aria-hidden className="set-card__icon" />
        <div className="set-card__head-text">
          <h2>Notificaciones</h2>
          <p>Qué quieres que te avise sunrise.</p>
        </div>
      </header>

      {/*
        Arriba de los switches a propósito: el sonido vale para **los tres** avisos, así
        que puesto entre ellos se leería como el de uno solo. Vivía en Dev Tools con
        estado local, o sea que se elegía para probar y se perdía al cerrar.

        Y "Probar" toca el archivo directo (por `afplay` en Rust), no manda un aviso:
        oír el sonido no tiene que depender del permiso de notificaciones ni llenar el
        centro de avisos de pruebas. Con "el que use el sistema" no hay archivo que
        tocar —ese no es un archivo, es un nombre que macOS resuelve al mandar el
        aviso—, así que el botón se apaga en vez de fallar sin explicar nada.
      */}
      <div className="set-field">
        <div className="set-field__text">
          <span className="set-field__label">Sonido de los avisos</span>
          <span className={`set-note${soundError ? " is-error" : ""}`}>
            {soundError ??
              (sound === SYSTEM_SOUND
                ? "Lo elige el sistema, así que no se puede oír por adelantado."
                : "Los del sistema, más lo que haya en ~/Library/Sounds. Un nombre que no existe suena mudo, sin avisar.")}
          </span>
        </div>
        <div className="set-field__control">
          <div className="upd-acciones">
            <div className="chip-wrap" ref={soundRef}>
              <button
                className="chip is-set"
                aria-label="Elegir el sonido de los avisos"
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
                      setSoundError(null);
                      void setSetting(SettingKey.NOTICE_SOUND, v ?? "");
                      setPickingSound(false);
                    }}
                  />
                </Popover>
              )}
            </div>
            <button
              type="button"
              className="resp-btn"
              disabled={!isTauri() || sound === SYSTEM_SOUND}
              onClick={() => {
                setSoundError(null);
                void api.previewNoticeSound(sound).catch((err) => setSoundError(String(err)));
              }}
            >
              <Play size={13} aria-hidden />
              <span className="resp-btn__texto">Probar</span>
            </button>
          </div>
        </div>
      </div>

      <div className="set-field">
        <div className="set-field__text">
          <label className="set-field__label" htmlFor="notice-meeting">
            Evento de tu Calendar importado
          </label>
          {error && <span className="set-note is-error">{error}</span>}
        </div>
        {/* En fila y no apilados: los minutos son el detalle del mismo ajuste que
         * enciende el switch, y debajo se leían como un segundo ajuste. */}
        <div className="set-field__control set-field__control--fila">
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
          {meetingOn && (
            <div className="set-jornada">
              {/* `set-pair` y no dos clases propias: es el mismo par etiqueta +
               * campo corto de la jornada y del respaldo. Las que había acá
               * (`set-input-wrap`, `set-input-label`) no tenían CSS en ninguna
               * hoja, y por eso el número quedaba pegado a su etiqueta. */}
              <label className="set-pair">
                <span className="set-field__label">Minutos antes</span>
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
        </div>
      </div>

      <div className="set-field">
        <div className="set-field__text">
          <label className="set-field__label" htmlFor="notice-shutdown">
            Hora de cerrar el día
          </label>
          <span className="set-note">A la hora de fin de jornada, una vez al día.</span>
        </div>
        <div className="set-field__control">
          <Switch
            id="notice-shutdown"
            label="Avisar a la hora de cerrar el día"
            checked={noticeOn(values, SettingKey.NOTICE_SHUTDOWN)}
            onChange={(v) => toggle(SettingKey.NOTICE_SHUTDOWN, v)}
          />
        </div>
      </div>

      <div className="set-field">
        <div className="set-field__text">
          <label className="set-field__label" htmlFor="notice-bell">
            Se acabó el tiempo estimado
          </label>
          <span className="set-note">
            La campana suena siempre; esto agrega un aviso que lleva a Focus.
          </span>
        </div>
        <div className="set-field__control">
          <Switch
            id="notice-bell"
            label="Tocar la campana al llegar al estimado"
            checked={noticeOn(values, SettingKey.NOTICE_BELL)}
            onChange={(v) => toggle(SettingKey.NOTICE_BELL, v)}
          />
        </div>
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
          Para que los avisos <strong>se queden en pantalla</strong> hasta que los respondas, macOS
          pide su estilo en <em>Persistent</em>. Lo elige el sistema, no sunrise.{" "}
          <button className="set-note__link" onClick={() => void openNotificationSettings()}>
            Abrir Ajustes → Notificaciones
            <ExternalLink size={11} aria-hidden />
          </button>
        </span>
      </p>

      {perm === "unknown" && (
        <span className="set-note is-error">
          macOS todavía no tiene permiso para mostrar avisos de sunrise. Se pide la primera vez que
          hay uno que mandar.
        </span>
      )}
    </section>
  );
}
