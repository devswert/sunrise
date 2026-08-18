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
import { minutosDeHora } from "../calendar/railLayout";
import { iconoDeSeccion } from "../settings/secciones";
import type { ArchivoDeBackup, Restauracion } from "../../lib/types";
import { fechaLegible, formatoBytes, momentoLegible } from "./respaldo";

const IconoSeccion = iconoDeSeccion("respaldo");

/**
 * Abre el selector nativo. Devuelve `null` si el usuario cancela o si no
 * estamos en Tauri (en el browser el campo se escribe a mano).
 */
async function elegirEnFinder(opciones: {
  directory: boolean;
  title: string;
}): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import("@tauri-apps/plugin-dialog");
  const elegido = await open({
    directory: opciones.directory,
    multiple: false,
    title: opciones.title,
    filters: opciones.directory ? undefined : [{ name: "Respaldo", extensions: ["zip"] }],
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
  onCancelar,
  onConfirmar,
  restaurando,
}: {
  zip: string;
  onCancelar: () => void;
  onConfirmar: () => void;
  restaurando: boolean;
}) {
  return (
    <div className="modal-overlay" onClick={restaurando ? undefined : onCancelar}>
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
          <button className="btn-ghost" onClick={onCancelar} disabled={restaurando}>
            Cancelar
          </button>
          {/* `is-solid`: es la acción más destructiva de la app y tiene que
              verse como tal, no como un botón secundario más. */}
          <button
            className="btn-danger is-solid"
            onClick={onConfirmar}
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
function RestauracionLista({ r, onCerrar }: { r: Restauracion; onCerrar: () => void }) {
  const otraVersion = r.versionDelRespaldo != null && r.versionDelRespaldo !== r.versionActual;

  return (
    <div className="modal-overlay" onClick={onCerrar}>
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
            {r.creadoEn ? (
              <>
                {momentoLegible(r.creadoEn)} <span className="resp-resumen__hace">
                  ({relativeTime(r.creadoEn)})
                </span>
              </>
            ) : (
              // Un respaldo viejo puede no traer manifest. Se dice, en vez de
              // mostrar la fecha del archivo como si fuera la del snapshot.
              <span className="resp-resumen__hace">
                sin manifest: {r.desde.split("/").pop()}
              </span>
            )}
          </dd>

          <dt>Quedó con</dt>
          <dd>
            {r.tareas} {r.tareas === 1 ? "tarea" : "tareas"}
            {r.ultimaActividad && (
              <>
                {" · "}último trabajo {momentoLegible(r.ultimaActividad)}
              </>
            )}
          </dd>

          {otraVersion && (
            <>
              <dt>Versión</dt>
              <dd>
                hecho en {r.versionDelRespaldo}, migrado a {r.versionActual}
              </dd>
            </>
          )}

          <dt>Tu base anterior</dt>
          <dd>
            <code>{r.copiaDeSeguridad}</code>
          </dd>
        </dl>

        <div className="dialog__actions">
          <button className="btn-primary" onClick={onCerrar} autoFocus>
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
  const ajustes = backupSettings(values);
  const ultimoError = values[SettingKey.BACKUP_LAST_ERROR]?.trim();

  const [archivos, setArchivos] = useState<ArchivoDeBackup[]>([]);
  const [version, setVersion] = useState("");
  const [borrador, setBorrador] = useState<{ dir?: string; hora?: string; conservar?: string }>({});
  const [error, setError] = useState<null | { campo: string; texto: string }>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [respaldando, setRespaldando] = useState(false);
  const [porRestaurar, setPorRestaurar] = useState<string | null>(null);
  const [restaurando, setRestaurando] = useState(false);
  const [restaurado, setRestaurado] = useState<Restauracion | null>(null);

  const cargar = useCallback(async () => {
    setArchivos(await api.listBackups());
  }, []);

  useEffect(() => {
    void cargar();
    void api.appVersion().then(setVersion);
  }, [cargar]);

  async function guardarCarpeta(raw: string) {
    const dir = raw.trim();
    setBorrador((b) => ({ ...b, dir: undefined }));
    if (dir === ajustes.dir) return;
    // Vaciar el campo apaga el respaldo; eso no necesita validarse.
    if (dir === "") {
      setError(null);
      await setSetting(SettingKey.BACKUP_DIR, "");
      await cargar();
      return;
    }
    try {
      await api.probarBackupDir(dir);
    } catch (err) {
      setError({ campo: "dir", texto: String(err) });
      setBorrador((b) => ({ ...b, dir }));
      return;
    }
    setError(null);
    await setSetting(SettingKey.BACKUP_DIR, dir);
    await cargar();
  }

  async function guardarHora(raw: string) {
    setBorrador((b) => ({ ...b, hora: undefined }));
    if (minutosDeHora(raw.trim()) == null) {
      setError({ campo: "hora", texto: "Una hora en formato 24 h, por ejemplo 20:00." });
      setBorrador((b) => ({ ...b, hora: raw }));
      return;
    }
    setError(null);
    await setSetting(SettingKey.BACKUP_TIME, raw.trim());
  }

  async function guardarConservar(raw: string) {
    setBorrador((b) => ({ ...b, conservar: undefined }));
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n < 1) {
      setError({ campo: "conservar", texto: "Un número de respaldos, mínimo 1." });
      setBorrador((b) => ({ ...b, conservar: raw }));
      return;
    }
    setError(null);
    await setSetting(SettingKey.BACKUP_KEEP, String(Math.floor(n)));
  }

  async function respaldarAhora() {
    setRespaldando(true);
    setAviso(null);
    try {
      const hecho = await api.crearBackup();
      // Que el manual limpie el error del automático es lo correcto: si acabó de
      // funcionar, el error de anoche ya no describe nada.
      if (ultimoError) await setSetting(SettingKey.BACKUP_LAST_ERROR, "");
      setError(null);
      setAviso(`Respaldo listo: ${hecho.name} (${formatoBytes(hecho.bytes)})`);
      await cargar();
    } catch (err) {
      setError({ campo: "accion", texto: String(err) });
    } finally {
      setRespaldando(false);
    }
  }

  async function elegirZip() {
    const zip = await elegirEnFinder({ directory: false, title: "Elige el respaldo a restaurar" });
    if (zip) setPorRestaurar(zip);
  }

  async function restaurar() {
    if (!porRestaurar) return;
    setRestaurando(true);
    try {
      const hecho = await api.restaurarBackup(porRestaurar);
      setPorRestaurar(null);
      setError(null);
      setAviso(null);
      // El resultado se muestra en su propio diálogo y no en un aviso que se va
      // solo: es la única acción de la app que no se puede deshacer desde acá.
      setRestaurado(hecho);
      // Toda la app está mirando la base que se acaba de reemplazar.
      bumpData();
      await cargar();
    } catch (err) {
      setPorRestaurar(null);
      setError({ campo: "accion", texto: String(err) });
    } finally {
      setRestaurando(false);
    }
  }

  const campo = (
    id: "hora" | "conservar",
    label: string,
    valor: string,
    guardar: (raw: string) => Promise<void>,
    placeholder: string,
  ) => (
    <div className="set-field set-field--inline">
      <label className="set-field__label" htmlFor={`resp-${id}`}>
        {label}
      </label>
      <input
        id={`resp-${id}`}
        className={`set-input set-input--hora${error?.campo === id ? " is-invalid" : ""}`}
        aria-label={label}
        placeholder={placeholder}
        value={borrador[id] ?? valor}
        onChange={(ev) => {
          setBorrador((b) => ({ ...b, [id]: ev.target.value }));
          setError(null);
        }}
        onBlur={(ev) => void guardar(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
          if (ev.key === "Escape") {
            setBorrador((b) => ({ ...b, [id]: undefined }));
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
            <IconoSeccion size={16} aria-hidden /> Respaldo
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
            onClick={respaldarAhora}
            disabled={respaldando || !ajustes.activo}
            title={ajustes.activo ? undefined : "Elige una carpeta primero"}
          >
            <Archive size={13} aria-hidden />
            <span className="resp-btn__texto">
              {respaldando ? "Respaldando…" : "Respaldar ahora"}
            </span>
          </button>
          <button type="button" className="resp-btn" onClick={elegirZip} disabled={!isTauri()}>
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
            className={`set-input${error?.campo === "dir" ? " is-invalid" : ""}`}
            aria-label="Carpeta de respaldos"
            placeholder="Sin carpeta: el respaldo está apagado"
            value={borrador.dir ?? ajustes.dir}
            onChange={(ev) => {
              setBorrador((b) => ({ ...b, dir: ev.target.value }));
              setError(null);
            }}
            onBlur={(ev) => void guardarCarpeta(ev.target.value)}
            onKeyDown={(ev) => {
              if (ev.key === "Enter") (ev.target as HTMLInputElement).blur();
              if (ev.key === "Escape") {
                setBorrador((b) => ({ ...b, dir: undefined }));
                setError(null);
              }
            }}
          />
        </div>
        <span className={`set-note${error?.campo === "dir" ? " is-error" : ""}`}>
          {error?.campo === "dir"
            ? error.texto
            : ajustes.activo
              ? "Se comprueba que se pueda escribir ahí al guardarla. Vacíala para apagar el respaldo."
              : "Sin carpeta no hay respaldo automático ni manual."}
        </span>
      </div>

      <div className="set-field">
        <span className="set-field__label">Automático</span>
        <div className="set-jornada">
          {campo("hora", "Hora", ajustes.hora, guardarHora, SETTING_DEFAULTS.backupTime)}
          {campo(
            "conservar",
            "Conservar",
            String(ajustes.conservar),
            guardarConservar,
            String(SETTING_DEFAULTS.backupKeep),
          )}
        </div>
        <span
          className={`set-note${
            error?.campo === "hora" || error?.campo === "conservar" ? " is-error" : ""
          }`}
        >
          {error?.campo === "hora" || error?.campo === "conservar"
            ? error.texto
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

      {error?.campo === "accion" && <span className="set-note is-error">{error.texto}</span>}
      {aviso && (
        <p className="resp-ok" role="status">
          <ShieldCheck size={14} aria-hidden /> {aviso}
        </p>
      )}

      {ajustes.activo && (
        <ul className="set-list resp-lista">
          {archivos.length === 0 ? (
            <li className="resp-vacio">Todavía no hay respaldos en esa carpeta.</li>
          ) : (
            archivos.map((a) => (
              <li className="set-row resp-fila" key={a.path}>
                <Archive size={14} aria-hidden className="resp-fila__icono" />
                <span className="resp-fila__fecha">{fechaLegible(a.createdAt)}</span>
                <span className="resp-fila__peso">{formatoBytes(a.bytes)}</span>
                <button
                  className="set-row__icon"
                  aria-label={`Restaurar el respaldo del ${fechaLegible(a.createdAt)}`}
                  title="Restaurar este respaldo"
                  onClick={() => setPorRestaurar(a.path)}
                >
                  <RotateCcw size={14} />
                </button>
              </li>
            ))
          )}
        </ul>
      )}

      {version && <span className="resp-version">versión {version}</span>}

      {porRestaurar && (
        <ConfirmarRestore
          zip={porRestaurar}
          restaurando={restaurando}
          onCancelar={() => setPorRestaurar(null)}
          onConfirmar={restaurar}
        />
      )}

      {restaurado && (
        <RestauracionLista r={restaurado} onCerrar={() => setRestaurado(null)} />
      )}
    </section>
  );
}
