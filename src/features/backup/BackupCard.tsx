import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Archive,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { api, isTauri } from "../../lib/ipc";
import { useAppStore } from "../../lib/store";
import { relativeTime } from "../../lib/date";
import { SETTING_DEFAULTS, SettingKey, backupSettings, useSettingsStore } from "../../lib/settings";
import { minutesFromTime } from "../calendar/railLayout";
import { sectionIcon } from "../settings/secciones";
import type { BackupFile, RestoreResult } from "../../lib/types";
import { readableDate, formatBytes, readableMoment } from "./backup";

const SectionIcon = sectionIcon("respaldo");

/**
 * Abre el selector nativo. Devuelve `null` si el usuario cancela o si no
 * estamos en Tauri (en el browser el campo se escribe a mano).
 */
async function elegirEnFinder(options: {
  directory: boolean;
  title: string;
}): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const elegido = await open({
    directory: options.directory,
    multiple: false,
    title: options.title,
    filters: options.directory ? undefined : [{ name: "Respaldo", extensions: ["zip"] }],
  });
  return typeof elegido === "string" ? elegido : null;
}

/**
 * Confirmación antes de restaurar. Reusa `.modal-overlay` / `.dialog`, las
 * mismas clases del diálogo de salida.
 *
 * Dice las tres cosas que el usuario necesita saber y que no son obvias: que se
 * pierde **todo** lo local (no se mezcla nada), que la app guarda igual una
 * copia de lo que va a pisar, y que un timer corriendo queda apuntando a la base
 * nueva.
 */
function ConfirmarRestore({
  zip,
  onCancel,
  onConfirm,
  restaurando,
}: {
  zip: string;
  onCancel: () => void;
  onConfirm: () => void;
  restaurando: boolean;
}) {
  return (
    <div className="modal-overlay" onClick={restaurando ? undefined : onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-label="Confirmar restauración"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="dialog__title">¿Restaurar este respaldo?</h2>
        <p className="dialog__body">
          Se va a reemplazar <strong>toda</strong> tu información actual por la del respaldo.
          Las tareas, notas y tiempos que hayas registrado después de{" "}
          <code>{zip.split("/").pop()}</code> no se pueden recuperar: no se mezcla nada, se
          escribe encima.
        </p>
        <p className="dialog__body">
          Antes de pisarla, sunrise guarda una copia de tu base actual en la carpeta de
          respaldos. Si tenías el timer corriendo, va a quedar apuntando a la base nueva.
          Lo único que se mantiene es esta configuración de respaldo.
        </p>
        <div className="dialog__actions">
          <button className="btn-ghost" onClick={onCancel} disabled={restaurando}>
            Cancelar
          </button>
          {/* `is-solid`: es la acción más destructiva de la app y tiene que
              verse como tal, no como un botón secundario más. */}
          <button
            className="btn-danger is-solid"
            onClick={onConfirm}
            disabled={restaurando}
            autoFocus
          >
            {restaurando ? (
              <Loader2 size={14} className="is-spinning" aria-hidden />
            ) : (
              <HardDriveDownload size={14} aria-hidden />
            )}
            {restaurando ? "Restaurando…" : "Restaurar y reemplazar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Lo que quedó después de restaurar. Reemplaza al snackbar a propósito: un aviso
 * que se va solo no sirve para cerrar la única acción irreversible de la app.
 *
 * **Qué se muestra, y por qué solo eso.** El manifest trae también el tamaño del
 * archivo y el número de esquema; ninguno de los dos le permite a nadie decidir
 * nada, así que no van. Quedan las tres cosas que sí:
 *
 * - **El momento del snapshot**, del manifest y con su zona —más preciso que la
 *   fecha del nombre del archivo— y con la antigüedad al lado: la pregunta real
 *   después de restaurar es "¿cuánto perdí?", y "hace 3 d" la contesta y
 *   "17 ago 2026, 20:03" no.
 * - **Con qué datos quedó**: tareas y lo último trabajado. Es lo que delata haber
 *   abierto el zip equivocado, que es el error que de verdad puede pasar.
 * - **Dónde está la copia de seguridad**: es el deshacer, y con la app corriendo
 *   no hay otra forma de volver.
 *
 * La versión aparece **solo si difiere** de la actual: "0.1.0 → 0.1.0" es ruido,
 * pero venir de otra versión explica por qué hubo migración.
 */
function RestauracionLista({ r, onClose }: { r: RestoreResult; onClose: () => void }) {
  const otraVersion = r.backupVersion != null && r.backupVersion !== r.currentVersion;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="dialog"
        role="alertdialog"
        aria-label="Respaldo restaurado"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
      >
        <h2 className="dialog__title">
          <ShieldCheck size={16} aria-hidden /> Listo, se restauró el respaldo
        </h2>

        <dl className="resp-resumen">
          <dt>Del</dt>
          <dd>
            {r.createdAt ? (
              <>
                {readableMoment(r.createdAt)} <span className="resp-resumen__hace">
                  ({relativeTime(r.createdAt)})
                </span>
              </>
            ) : (
              // Un respaldo viejo puede no traer manifest. Se dice, en vez de
              // mostrar la fecha del archivo como si fuera la del snapshot.
              <span className="resp-resumen__hace">
                sin manifest: {r.from.split("/").pop()}
              </span>
            )}
          </dd>

          <dt>Quedó con</dt>
          <dd>
            {r.tasks} {r.tasks === 1 ? "tarea" : "tareas"}
            {r.lastActivity && (
              <>
                {" · "}último work {readableMoment(r.lastActivity)}
              </>
            )}
          </dd>

          {otraVersion && (
            <>
              <dt>Versión</dt>
              <dd>
                hecho en {r.backupVersion}, migrado a {r.currentVersion}
              </dd>
            </>
          )}

          <dt>Tu base anterior</dt>
          <dd>
            <code>{r.backupCopy}</code>
          </dd>
        </dl>

        <div className="dialog__actions">
          <button className="btn-primary" onClick={onClose} autoFocus>
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Respaldo: carpeta destino, hora del automático, retención, respaldo manual y
 * restauración.
 *
 * Va al final de Configs a propósito: es la sección que menos se visita y la
 * única que puede destruir datos.
 *
 * **La carpeta la elige el usuario y la app no opina de dónde.** Puede ser una
 * carpeta de Drive, Dropbox o iCloud —y así el respaldo sale de la máquina sin
 * que sunrise tenga que hablar con ninguna nube— o una local que después se
 * mande por `scp` a un VPS. Ver SPECS §4.17.
 */
export function BackupCard() {
  const values = useSettingsStore((s) => s.values);
  const setSetting = useSettingsStore((s) => s.set);
  const bumpData = useAppStore((s) => s.bumpData);
  const settings = backupSettings(values);
  const ultimoError = values[SettingKey.BACKUP_LAST_ERROR]?.trim();

  const [files, setArchivos] = useState<BackupFile[]>([]);
  const [version, setVersion] = useState("");
  const [draft, setDraft] = useState<{ dir?: string; hour?: string; keep?: string }>({});
  const [error, setError] = useState<null | { field: string; text: string }>(null);
  const [notice, setAviso] = useState<string | null>(null);
  const [respaldando, setRespaldando] = useState(false);
  const [toRestore, setToRestore] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [restaurado, setRestaurado] = useState<RestoreResult | null>(null);

  const load = useCallback(async () => {
    setArchivos(await api.listBackups());
  }, []);

  useEffect(() => {
    void load();
    void api.appVersion().then(setVersion);
  }, [load]);

  async function guardarCarpeta(raw: string) {
    const dir = raw.trim();
    setDraft((b) => ({ ...b, dir: undefined }));
    if (dir === settings.dir) return;
    // Vaciar el campo apaga el respaldo; eso no necesita validarse.
    if (dir === "") {
      setError(null);
      await setSetting(SettingKey.BACKUP_DIR, "");
      await load();
      return;
    }
    try {
      await api.testBackupDir(dir);
    } catch (err) {
      setError({ field: "dir", text: String(err) });
      setDraft((b) => ({ ...b, dir }));
      return;
    }
    setError(null);
    await setSetting(SettingKey.BACKUP_DIR, dir);
    await load();
  }

  async function saveHour(raw: string) {
    setDraft((b) => ({ ...b, hour: undefined }));
    if (minutesFromTime(raw.trim()) == null) {
      setError({ field: "hour", text: "Una hora en formato 24 h, por ejemplo 20:00." });
      setDraft((b) => ({ ...b, hour: raw }));
      return;
    }
    setError(null);
    await setSetting(SettingKey.BACKUP_TIME, raw.trim());
  }

  async function saveKeep(raw: string) {
    setDraft((b) => ({ ...b, keep: undefined }));
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n < 1) {
      setError({ field: "keep", text: "Un número de respaldos, mínimo 1." });
      setDraft((b) => ({ ...b, keep: raw }));
      return;
    }
    setError(null);
    await setSetting(SettingKey.BACKUP_KEEP, String(Math.floor(n)));
  }

  async function backupNow() {
    setRespaldando(true);
    setAviso(null);
    try {
      const hecho = await api.createBackup();
      // Que el manual limpie el error del automático es lo correcto: si acabó de
      // funcionar, el error de anoche ya no describe nada.
      if (ultimoError) await setSetting(SettingKey.BACKUP_LAST_ERROR, "");
      setError(null);
      setAviso(`Respaldo listo: ${hecho.name} (${formatBytes(hecho.bytes)})`);
      await load();
    } catch (err) {
      setError({ field: "action", text: String(err) });
    } finally {
      setRespaldando(false);
    }
  }

  async function pickZip() {
    const zip = await elegirEnFinder({ directory: false, title: "Elige el respaldo a restaurar" });
    if (zip) setToRestore(zip);
  }

  async function restaurar() {
    if (!toRestore) return;
    setRestaurando(true);
    try {
      const hecho = await api.restoreBackup(toRestore);
      setToRestore(null);
      setError(null);
      setAviso(null);
      // El resultado se muestra en su propio diálogo y no en un aviso que se va
      // solo: es la única acción de la app que no se puede deshacer desde acá.
      setRestaurado(hecho);
      // Toda la app está mirando la base que se acaba de reemplazar.
      bumpData();
      await load();
    } catch (err) {
      setToRestore(null);
      setError({ field: "action", text: String(err) });
    } finally {
      setRestaurando(false);
    }
  }

  const field = (
    id: "hour" | "keep",
    label: string,
    value: string,
    save: (raw: string) => Promise<void>,
    placeholder: string,
  ) => (
    <div className="set-field set-field--inline">
      <label className="set-field__label" htmlFor={`resp-${id}`}>
        {label}
      </label>
      <input
        id={`resp-${id}`}
        className={`set-input set-input--hora${error?.field === id ? " is-invalid" : ""}`}
        aria-label={label}
        placeholder={placeholder}
        value={draft[id] ?? value}
        onChange={(ev) => {
          setDraft((b) => ({ ...b, [id]: ev.target.value }));
          setError(null);
        }}
        onBlur={(ev) => void save(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
          if (ev.key === "Escape") {
            setDraft((b) => ({ ...b, [id]: undefined }));
            setError(null);
          }
        }}
      />
    </div>
  );

  return (
    <section className="set-card" id="set-respaldo" data-section="respaldo">
      {/* Las acciones van en la fila del título, como el sync de Calendarios. */}
      <header className="set-card__head set-card__head--conaccion">
        <div>
          <h2>
            {/* El mismo icono que su tab: sale de `TABS` para que no se separen. */}
            <SectionIcon size={16} aria-hidden /> Respaldo
          </h2>
          <p>
            Una copia comprimida de toda tu información, con un <code>manifest.yml</code> que
            dice de qué versión salió. Elige una carpeta sincronizada (Drive, Dropbox,
            iCloud).
          </p>
        </div>
        {/* `resp-btn` comparte definición con `.sync-btn` (week.css): el mismo
          * botón plano del sync de calendarios, con su mismo icono de 13px. */}
        <div className="resp-acciones">
          <button
            type="button"
            className="resp-btn"
            onClick={backupNow}
            disabled={respaldando || !settings.active}
            title={settings.active ? undefined : "Elige una carpeta primero"}
          >
            <Archive size={13} aria-hidden />
            <span className="resp-btn__texto">
              {respaldando ? "Respaldando…" : "Respaldar ahora"}
            </span>
          </button>
          <button type="button" className="resp-btn" onClick={pickZip} disabled={!isTauri()}>
            <RotateCcw size={13} aria-hidden />
            <span className="resp-btn__texto">Importar</span>
          </button>
        </div>
      </header>

      <div className="set-field">
        {/* La etiqueta y el botón comparten fila, y el campo se lleva el ancho
          * completo abajo: una ruta absoluta de iCloud no entra en menos. */}
        <div className="resp-carpeta__head">
          <label className="set-field__label" htmlFor="resp-dir">
            Carpeta
          </label>
          {isTauri() && (
            <button
              className="btn-ghost"
              onClick={async () => {
                const dir = await elegirEnFinder({
                  directory: true,
                  title: "Elige la carpeta de respaldos",
                });
                if (dir) await guardarCarpeta(dir);
              }}
            >
              <FolderOpen size={14} aria-hidden /> Elegir…
            </button>
          )}
        </div>
        <div className="resp-carpeta">
          <input
            id="resp-dir"
            className={`set-input${error?.field === "dir" ? " is-invalid" : ""}`}
            aria-label="Carpeta de respaldos"
            placeholder="Sin carpeta: el respaldo está apagado"
            value={draft.dir ?? settings.dir}
            onChange={(ev) => {
              setDraft((b) => ({ ...b, dir: ev.target.value }));
              setError(null);
            }}
            onBlur={(ev) => void guardarCarpeta(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
              if (ev.key === "Escape") {
                setDraft((b) => ({ ...b, dir: undefined }));
                setError(null);
              }
            }}
          />
        </div>
        <span className={`set-note${error?.field === "dir" ? " is-error" : ""}`}>
          {error?.field === "dir"
            ? error.text
            : settings.active
              ? "Se comprueba que se pueda escribir ahí al guardarla. Vacíala para apagar el respaldo."
              : "Sin carpeta no hay respaldo automático ni manual."}
        </span>
      </div>

      <div className="set-field">
        <span className="set-field__label">Automático</span>
        <div className="set-jornada">
          {field("hour", "Hora", settings.hour, saveHour, SETTING_DEFAULTS.backupTime)}
          {field(
            "keep",
            "Conservar",
            String(settings.keep),
            saveKeep,
            String(SETTING_DEFAULTS.backupKeep),
          )}
        </div>
        <span
          className={`set-note${
            error?.field === "hour" || error?.field === "keep" ? " is-error" : ""
          }`}
        >
          {error?.field === "hour" || error?.field === "keep"
            ? error.text
            : "Corre una vez al día pasada esa hora, con la app abierta. Si estaba cerrada, se hace al abrirla."}
        </span>
      </div>

      {ultimoError && (
        <p className="resp-alerta" role="status">
          <AlertTriangle size={14} aria-hidden />
          <span>
            El último respaldo automático falló: {ultimoError}. Revisa la carpeta y prueba con
            “Respaldar ahora”.
          </span>
        </p>
      )}

      {error?.field === "action" && <span className="set-note is-error">{error.text}</span>}
      {notice && (
        <p className="resp-ok" role="status">
          <ShieldCheck size={14} aria-hidden /> {notice}
        </p>
      )}

      {settings.active && (
        <ul className="set-list resp-lista">
          {files.length === 0 ? (
            <li className="resp-vacio">Todavía no hay respaldos en esa carpeta.</li>
          ) : (
            files.map((a) => (
              <li className="set-row resp-fila" key={a.path}>
                <Archive size={14} aria-hidden className="resp-fila__icono" />
                <span className="resp-fila__fecha">{readableDate(a.createdAt)}</span>
                <span className="resp-fila__peso">{formatBytes(a.bytes)}</span>
                <button
                  className="set-row__icon"
                  aria-label={`Restaurar el respaldo del ${readableDate(a.createdAt)}`}
                  title="Restaurar este respaldo"
                  onClick={() => setToRestore(a.path)}
                >
                  <RotateCcw size={14} />
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {version && <span className="resp-version">versión {version}</span>}

      {toRestore && (
        <ConfirmarRestore
          zip={toRestore}
          restaurando={restaurando}
          onCancel={() => setToRestore(null)}
          onConfirm={restaurar}
        />
      )}

      {restaurado && (
        <RestauracionLista r={restaurado} onClose={() => setRestaurado(null)} />
      )}
    </section>
  );
}
