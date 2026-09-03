import { useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { Cordillera } from "./Cordillera";
import { useUpdateStore } from "./updateStore";

/**
 * El detalle de un update que no se pudo instalar.
 *
 * **Existe porque no hay telemetría.** Cuando a alguien del equipo le falla una
 * actualización, lo único que puede volver es lo que esa persona logre copiar y
 * pegar. El mensaje del updater ya se guardaba, pero vivía en el `title` del aviso
 * —o sea, había que dejar el mouse quieto encima para verlo—, así que el reporte
 * que llegaba era "me dio error", que no distingue un permiso de escritura de un
 * proxy corporativo.
 *
 * Por eso el botón de copiar no es un extra: **es la función**. Copia el mensaje
 * junto con las dos versiones y el sistema, que es lo que hace falta para saber si
 * el problema es de esa máquina o de la versión publicada.
 *
 * **Y por eso también la cabecera es bonita.** Es el mismo lugar del amanecer de
 * "Lo nuevo", con el cielo cerrado: un error no tiene por qué verse como una
 * ventana del sistema, y lo que se le está pidiendo a la persona es un favor
 * —copiar esto y mandarlo—, no un castigo.
 */
export function UpdateError() {
  const open = useUpdateStore((s) => s.errorOpen);
  const setOpen = useUpdateStore((s) => s.setErrorOpen);
  const error = useUpdateStore((s) => s.error);
  const available = useUpdateStore((s) => s.available);
  const [copied, setCopied] = useState(false);

  if (!open || !error) return null;

  const detail = [
    `sunrise — no se pudo actualizar`,
    `De la ${available?.currentVersion ?? "?"} a la ${available?.version ?? "?"}`,
    `Sistema: ${navigator.userAgent}`,
    "",
    error,
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
    } catch {
      // Sin portapapeles queda el texto en pantalla, que se puede seleccionar a
      // mano: el modal sirve igual, solo que con un paso más.
      setCopied(false);
    }
  }

  return (
    <Dialog
      variant="failure"
      title="No se pudo actualizar"
      label="Detalle del error al actualizar"
      onClose={() => setOpen(false)}
      actions={
        <>
          <button className="btn-ghost" onClick={() => setOpen(false)}>
            Cerrar
          </button>
          <button className="btn-primary" onClick={() => void copy()}>
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
            {copied ? "Copiado" : "Copiar detalle"}
          </button>
        </>
      }
    >
      <div className="upd-fail__cielo" aria-hidden>
        <span className="upd-fail__nube upd-fail__nube--alta" />
        <span className="upd-fail__nube upd-fail__nube--baja" />
        <Cordillera />
      </div>
      <div className="dialog__body upd-fail__texto">
        <p className="upd-fail__que">
          La versión que tienes sigue funcionando. Esto solo dice que la nueva no se pudo instalar.
        </p>
        {/* El mensaje crudo del updater, sin interpretar: es el dato que distingue
         * un permiso de escritura de un proxy, y traducirlo a "algo salió mal"
         * borraría justo lo único que sirve. Seleccionable, por si el portapapeles
         * no está disponible. */}
        <pre className="upd-fail__crudo">{error}</pre>
        <dl className="upd-fail__datos">
          <div>
            <dt>Versión</dt>
            <dd>
              {available?.currentVersion ?? "?"} → {available?.version ?? "?"}
            </dd>
          </div>
        </dl>
        {/* Reintentar vive acá y no en el aviso: con el aviso en error, apretarlo
         * abre esto. Un solo gesto que a veces reintenta y a veces explica sería
         * el control impredecible. */}
        <button
          type="button"
          className="upd-fail__reintentar"
          onClick={() => {
            setOpen(false);
            useUpdateStore.getState().setError(null);
          }}
        >
          <RefreshCw size={13} aria-hidden /> Volver a intentarlo
        </button>
      </div>
    </Dialog>
  );
}
