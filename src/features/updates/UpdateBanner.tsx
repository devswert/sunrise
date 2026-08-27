import { ArrowUp, Check, ChevronRight, Sparkles } from "lucide-react";
import { useUpdateStore } from "./updateStore";
import { api } from "../../lib/ipc";
import type { UpdateProgress } from "../../lib/types";
import { shortDate } from "../../lib/date";

/**
 * El aviso del updater en el sidebar, arriba del switch de tema.
 *
 * Tiene **dos estados y ninguno interrumpe**, que es la regla de §4.21: uno espera
 * a que quieras actualizar, el otro cuenta que ya lo hiciste y se va solo.
 *
 * - **Hay versión nueva** → invita a instalarla. Se queda hasta que la aprietes, y
 *   mientras baja **muestra cuánto va** (§4.23): el progreso lo emite Rust.
 * - **Estás al día** (después de actualizarse) → dura 30 segundos y desaparece.
 *   Apretarlo abre el modal con lo nuevo, y también lo hace desaparecer.
 *
 * Los dos no pueden coexistir: si acabas de actualizarte no hay versión nueva que
 * ofrecer, y el sondeo devolvería `null`. Aun así el orden es explícito —"al día"
 * gana— para que un `latest.json` desfasado no muestre las dos franjas.
 *
 * **El título no cambia de texto durante la instalación.** Sigue diciendo qué
 * versión es y el estado va en la línea de abajo: el nombre de la cosa que estás
 * mirando no puede convertirse en su estado a mitad de la operación.
 */
export function UpdateBanner() {
  const available = useUpdateStore((s) => s.available);
  const installing = useUpdateStore((s) => s.installing);
  const progress = useUpdateStore((s) => s.progress);
  const fake = useUpdateStore((s) => s.fake);
  const error = useUpdateStore((s) => s.error);
  const updatedTo = useUpdateStore((s) => s.updatedTo);
  const bannerVisible = useUpdateStore((s) => s.bannerVisible);
  const setInstalling = useUpdateStore((s) => s.setInstalling);
  const setError = useUpdateStore((s) => s.setError);
  const setProgress = useUpdateStore((s) => s.setProgress);
  const hideBanner = useUpdateStore((s) => s.hideBanner);
  const setWhatsNewOpen = useUpdateStore((s) => s.setWhatsNewOpen);
  const arrivedFromUpdate = useUpdateStore((s) => s.arrivedFromUpdate);
  const setAvailable = useUpdateStore((s) => s.setAvailable);

  if (bannerVisible && updatedTo) {
    return (
      <button
        type="button"
        className="upd-banner upd-banner--aldia"
        onClick={() => {
          hideBanner();
          setWhatsNewOpen(true);
        }}
        title={`Ver lo nuevo en la ${updatedTo}`}
      >
        <span className="upd-banner__fila">
          <span className="upd-banner__icono">
            <Check size={15} aria-hidden />
            <Sparkles size={9} className="upd-banner__chispa" aria-hidden />
          </span>
          <span className="upd-banner__texto">
            <strong>Estás al día</strong>
            <span className="upd-banner__sub">Mira lo nuevo en la {updatedTo}</span>
          </span>
          <ChevronRight size={14} className="upd-banner__flecha" aria-hidden />
        </span>
        {/* La cuenta de los 30 segundos, dibujada. Quien no la mire no pierde nada;
          * quien la mire sabe que el aviso se va solo y no lo tiene que cerrar. */}
        <span className="upd-banner__cuenta" aria-hidden />
      </button>
    );
  }

  if (!available) return null;

  async function instalar() {
    setInstalling(true);
    setError(null);
    // Update de prueba (`devFake.ts`, solo dev): finge el trabajo y aterriza en el
    // estado de llegada. Llamar al updater de verdad acá descargaría un paquete y
    // reiniciaría la app, que es justo lo que no se quiere al mirar el componente.
    if (fake) {
      // Aterriza en la versión que **está corriendo**, no en la falsa: es la única
      // que con seguridad tiene su sección en el changelog, y sin anuncio escrito
      // el modal no abre y el flujo de prueba termina en nada.
      const version = available!.currentVersion;
      // El progreso también se finge: es la mitad del aviso y sin esto el banco de
      // pruebas no sirve para mirar justamente lo que se vino a arreglar.
      const total = 24 * 1024 * 1024;
      let bajado = 0;
      const pulso = setInterval(() => {
        bajado = Math.min(total, bajado + total / 8);
        setProgress({ downloaded: bajado, total, installing: bajado >= total });
      }, 220);
      setTimeout(() => {
        clearInterval(pulso);
        setInstalling(false);
        setAvailable(null);
        arrivedFromUpdate(version);
      }, 2000);
      return;
    }
    try {
      // Si sale bien no vuelve: la app se reinicia sola en la versión nueva.
      await api.installUpdate();
    } catch (err) {
      setError(String(err));
      setInstalling(false);
    }
  }

  const pct = porcentaje(progress);

  return (
    <button
      type="button"
      className={`upd-banner upd-banner--nueva${installing ? " is-installing" : ""}${
        error ? " is-error" : ""
      }`}
      onClick={() => void instalar()}
      disabled={installing}
      title={
        error
          ? `No se pudo instalar: ${error}`
          : `Instalar la ${available.version} y reiniciar`
      }
    >
      <span className="upd-banner__fila">
        <span className="upd-banner__icono">
          <ArrowUp size={15} aria-hidden />
        </span>
        <span className="upd-banner__texto">
          <strong>Versión {available.version}</strong>
          <span className="upd-banner__sub">{bajada(installing, error, progress)}</span>
        </span>
        {!installing && !error && available.date && (
          <span className="upd-banner__fecha">{shortDate(available.date)}</span>
        )}
      </span>
      {installing && (
        /* Decorativa a propósito: un `role="progressbar"` acá dentro le mete su
         * nombre al del botón que lo contiene, y lo que baja ya lo dice la línea
         * de texto —que es lo que lee un lector de pantalla. */
        <span
          className={`upd-banner__barra${pct == null ? " is-indeterminada" : ""}`}
          aria-hidden
        >
          <span
            className="upd-banner__barra-fill"
            style={pct == null ? undefined : { width: `${pct}%` }}
          />
        </span>
      )}
    </button>
  );
}

/**
 * El porcentaje bajado, o `null` cuando no se puede saber.
 *
 * Son **tres** casos y no dos: sin progreso todavía, con progreso pero sin
 * `Content-Length` (el servidor no lo mandó), y reemplazando el `.app` —que no
 * reporta avance—. Los tres van a barra indeterminada, porque un 0 % o un 100 %
 * clavado dicen algo falso.
 */
function porcentaje(p: UpdateProgress | null): number | null {
  if (!p || p.installing || !p.total) return null;
  return Math.min(100, Math.round((p.downloaded / p.total) * 100));
}

/** La línea de abajo: qué está pasando, en palabras. */
function bajada(
  installing: boolean,
  error: string | null,
  p: UpdateProgress | null,
): string {
  if (error) return "No se pudo. Reintenta.";
  if (!installing) return "Actualizar ahora";
  if (p?.installing) return "Instalando y reiniciando…";
  if (!p) return "Preparando la descarga…";
  const pct = porcentaje(p);
  // Sin total no hay porcentaje, y ahí lo bajado es lo único cierto que se puede
  // decir. Con total va el porcentaje: los MB de un paquete no le importan a
  // nadie cuando existe la fracción.
  return pct == null ? `Bajando · ${enMB(p.downloaded)}` : `Bajando · ${pct} %`;
}

function enMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
