import { Markdown } from "../../components/Markdown";
import { Dialog } from "../../components/Dialog";
import { announcementFor, releaseDateFor } from "../../lib/changelog";
import { dateLabel } from "../../lib/date";
import { useUpdateStore } from "./updateStore";
import { Cordillera } from "./Cordillera";

/**
 * "Lo nuevo en vX.Y.Z": el anuncio de la versión que se acaba de instalar.
 *
 * **No se abre solo.** Lo levanta el aviso del sidebar (`UpdateBanner`), que es lo
 * que aparece al volver de un update y dura 30 segundos, o el botón de Configs →
 * Actualizaciones cuando ese aviso ya se fue. Un modal encima de la app al arrancar
 * es justo la interrupción que §4.21 decidió no hacer: el aviso espera en el
 * sidebar y tú decides si lo lees.
 *
 * El texto sale de `docs/CHANGELOG.md` y es **el mismo** que se lee en Configs →
 * Actualizaciones antes de instalar (§4.22). Eso es deliberado: lo que se promete y
 * lo que se anuncia no pueden ser dos textos distintos.
 *
 * **La cabecera es el amanecer de la marca**, no un adorno cualquiera: el sol que
 * sube es el del icono de la app, y es lo que hace que llegar a una versión nueva
 * se sienta como algo y no como un aviso del sistema. Va como hijo del diálogo y
 * sube sobre el título con `order`, porque el `<h2>` lo dibuja `Dialog` primero y
 * meter un bloque dentro de un encabezado para ganarle al orden es peor.
 */
export function WhatsNew() {
  const open = useUpdateStore((s) => s.whatsNewOpen);
  const setOpen = useUpdateStore((s) => s.setWhatsNewOpen);
  const version = useUpdateStore((s) => s.updatedTo);

  if (!open || !version) return null;
  const anuncio = announcementFor(version);
  if (!anuncio) return null;
  const fecha = releaseDateFor(version);

  return (
    <Dialog
      variant="announcement"
      title={
        <>
          Lo nuevo en {version}
          {fecha && <span className="nuevo__fecha">{dateLabel(fecha)}</span>}
        </>
      }
      label={`Lo nuevo en la ${version}`}
      onClose={() => setOpen(false)}
      onEnter={() => setOpen(false)}
      actions={
        <button className="btn-primary" onClick={() => setOpen(false)} autoFocus>
          Entendido
        </button>
      }
    >
      <div className="nuevo__cielo" aria-hidden>
        <span className="nuevo__rayos" />
        <span className="nuevo__sol" />
        <Cordillera />
      </div>
      <div className="dialog__body nuevo__texto">
        <Markdown gfm={false}>{anuncio}</Markdown>
      </div>
    </Dialog>
  );
}
