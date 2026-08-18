import { ArrowUpCircle, Check, Sparkles } from "lucide-react";
import { useUpdateStore } from "./updateStore";
import { api } from "../../lib/ipc";

/**
 * La franja del updater en el sidebar, arriba del switch de tema.
 *
 * Tiene **dos estados y ninguno interrumpe**, que es la regla de §4.21: uno espera
 * a que quieras actualizar, el otro cuenta que ya lo hiciste y se va solo.
 *
 * - **Hay versión nueva** → invita a instalarla. Se queda hasta que la aprietes.
 * - **Estás al día** (después de actualizarse) → dura 30 segundos y desaparece.
 *   Apretarlo abre el modal con lo nuevo, y también lo hace desaparecer.
 *
 * Los dos no pueden coexistir: si acabas de actualizarte no hay versión nueva que
 * ofrecer, y el sondeo devolvería `null`. Aun así el orden es explícito —"al día"
 * gana— para que un `latest.json` desfasado no muestre las dos franjas.
 */
export function UpdateBanner() {
  const available = useUpdateStore((s) => s.available);
  const installing = useUpdateStore((s) => s.installing);
  const fake = useUpdateStore((s) => s.fake);
  const error = useUpdateStore((s) => s.error);
  const updatedTo = useUpdateStore((s) => s.updatedTo);
  const bannerVisible = useUpdateStore((s) => s.bannerVisible);
  const setInstalling = useUpdateStore((s) => s.setInstalling);
  const setError = useUpdateStore((s) => s.setError);
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
        <span className="upd-banner__icono">
          <Check size={13} aria-hidden />
        </span>
        <span className="upd-banner__texto">
          <strong>Estás al día</strong>
          <span className="upd-banner__sub">Mira lo nuevo en la {updatedTo}</span>
        </span>
        <Sparkles size={12} className="upd-banner__chispa" aria-hidden />
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
      setTimeout(() => {
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

  return (
    <button
      type="button"
      className={`upd-banner upd-banner--nueva${installing ? " is-installing" : ""}`}
      onClick={() => void instalar()}
      disabled={installing}
      title={
        error
          ? `No se pudo instalar: ${error}`
          : `Instalar la ${available.version} y reiniciar`
      }
    >
      <span className="upd-banner__icono">
        <ArrowUpCircle size={13} aria-hidden />
      </span>
      <span className="upd-banner__texto">
        <strong>{installing ? "Instalando…" : `Versión ${available.version}`}</strong>
        <span className="upd-banner__sub">
          {error ? "No se pudo. Reintenta." : installing ? "Se reinicia sola" : "Actualizar ahora"}
        </span>
      </span>
    </button>
  );
}
