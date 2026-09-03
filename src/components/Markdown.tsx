import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { abrirExterno } from "../features/calendar/MeetingLink";

/**
 * Markdown con **los links atados al navegador del sistema**.
 *
 * Existe por un bug que se ve una sola vez y no se olvida: un `<a href>` dentro
 * del webview **navega la propia ventana de la app**. La ventana de sunrise se
 * convierte en una pestaña de Google, sin barra de direcciones, sin botón de
 * volver y sin forma de salir salvo cerrar. No es un link que "no funciona": es
 * la app que desaparece.
 *
 * Por eso el `href` se conserva —el menú contextual y "copiar dirección" siguen
 * sirviendo, y un lector de pantalla lo anuncia como link— pero el click se
 * intercepta y lo abre `abrirExterno`. El `preventDefault` es lo único que
 * importa acá; todo lo demás es que se siga viendo y leyendo como un link.
 *
 * **Todo markdown de la app pasa por acá.** Las notas de una tarea, el anuncio de
 * una versión: cualquiera puede traer un link, y el que se olvide de envolverlo se
 * lleva la ventana puesta.
 */
export function Markdown({ children, gfm = true }: { children: string; gfm?: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={gfm ? [remarkGfm] : []}
      components={{
        a: ({ href, children: texto }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              // Y no burbujea: en las notas del detalle, el contenedor abre el
              // editor al click, así que sin esto entrar a un link dejaría además
              // el markdown en modo edición.
              e.stopPropagation();
              if (href) void abrirExterno(href);
            }}
          >
            {texto}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
