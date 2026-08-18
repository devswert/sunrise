import { ChevronRight, Video } from "lucide-react";
import { isTauri } from "../../lib/ipc";

/**
 * Abre una URL en el **navegador del sistema**.
 *
 * Dentro de Tauri un `<a target="_blank">` no hace nada: el webview no abre
 * ventanas nuevas y la navegación externa está bloqueada, así que el click se
 * traga sin error ni aviso. Va por el plugin `opener`, que además necesita su
 * permiso en `capabilities/default.json` (con la lista de esquemas permitidos).
 *
 * Fuera de Tauri —browser, tests— cae a `window.open`, que ahí sí funciona.
 */
export async function abrirExterno(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } catch (err) {
    // Nunca en silencio: si falta el permiso, el botón parecería roto sin decir
    // por qué. Es el mismo modo de falla que costó el hover del taxímetro.
    console.error("[sunrise] no pude abrir el link de la reunión:", err);
  }
}

/** Nombre del servicio, para que el link diga a dónde lleva. */
function servicio(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("meet.google.com")) return "Google Meet";
  if (u.includes("zoom.us")) return "Zoom";
  if (u.includes("teams.")) return "Teams";
  if (u.includes("webex.com")) return "Webex";
  if (u.includes("whereby.com")) return "Whereby";
  if (u.includes("meet.jit.si")) return "Jitsi";
  return "la reunión";
}

/**
 * El código de la sala, que es lo que uno dicta por teléfono cuando alguien no
 * puede entrar. Sale del último tramo de la ruta; `null` si no parece un código
 * (una URL con query larga, por ejemplo).
 */
export function idDeSala(url: string): string | null {
  try {
    const partes = new URL(url).pathname.split("/").filter(Boolean);
    const ultima = partes[partes.length - 1];
    if (!ultima) return null;
    // Un código de Meet es `abc-defg-hij`; el de Zoom, dígitos. Cualquier cosa
    // muy larga probablemente sea un token y no algo que se dicte en voz alta.
    return ultima.length <= 24 ? ultima : null;
  } catch {
    return null;
  }
}

/**
 * Fila para entrar a la videollamada de una tarea importada del calendario.
 *
 * Es un `<button>` y no un `<a>` a propósito: dentro de la app el anchor no
 * navega a ninguna parte (ver `abrirExterno`), y un link que no lleva a nada es
 * peor que un botón. Se **ve** como link porque es lo que hace.
 */
export function MeetingLink({
  url,
  className = "",
}: {
  url: string | null;
  className?: string;
}) {
  if (!url) return null;
  const sala = idDeSala(url);

  return (
    <div className={`meet ${className}`}>
      <button
        type="button"
        className="meet__link"
        title={url}
        onClick={(e) => {
          // Dentro de una card o un modal, entrar a la reunión no debe además
          // abrir el detalle ni disparar el arrastre.
          e.stopPropagation();
          void abrirExterno(url);
        }}
      >
        <Video size={15} className="meet__icono" aria-hidden />
        <span>Entrar a {servicio(url)}</span>
        <ChevronRight size={13} aria-hidden />
      </button>
      {sala && <span className="meet__sala">Sala: {sala}</span>}
    </div>
  );
}
