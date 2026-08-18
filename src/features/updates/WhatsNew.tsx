import { useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Sparkles } from "lucide-react";
import { announcementFor } from "../../lib/changelog";
import { useUpdateStore } from "./updateStore";

/**
 * "Lo nuevo en vX.Y.Z": el anuncio de la versión que se acaba de instalar.
 *
 * **No se abre solo.** Lo levanta el banner del sidebar (`UpdateBanner`), que es lo
 * que aparece al volver de un update y dura 30 segundos. Un modal encima de la app
 * al arrancar es justo la interrupción que §4.21 decidió no hacer: el aviso espera
 * en el sidebar y tú decides si lo lees.
 *
 * El texto sale de `docs/CHANGELOG.md` y es **el mismo** que se lee en Configs →
 * Actualizaciones antes de instalar (§4.22). Eso es deliberado: lo que se promete y
 * lo que se anuncia no pueden ser dos textos distintos.
 */
export function WhatsNew() {
  const open = useUpdateStore((s) => s.whatsNewOpen);
  const setOpen = useUpdateStore((s) => s.setWhatsNewOpen);
  const version = useUpdateStore((s) => s.updatedTo);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, setOpen]);

  if (!open || !version) return null;
  const anuncio = announcementFor(version);
  if (!anuncio) return null;

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div
        className="dialog"
        role="alertdialog"
        aria-label={`Lo nuevo en la ${version}`}
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="dialog__title">
          <Sparkles size={16} aria-hidden /> Lo nuevo en la {version}
        </h2>

        <div className="dialog__body nuevo__texto">
          <ReactMarkdown>{anuncio}</ReactMarkdown>
        </div>

        <div className="dialog__actions">
          <button className="btn-primary" onClick={() => setOpen(false)} autoFocus>
            Entendido
          </button>
        </div>

        <span className="dialog__hint">Enter o Escape para cerrar</span>
      </div>
    </div>
  );
}
