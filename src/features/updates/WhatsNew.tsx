import ReactMarkdown from "react-markdown";
import { Dialog } from "../../components/Dialog";
import { announcementFor, releaseDateFor } from "../../lib/changelog";
import { dateLabel } from "../../lib/date";
import { useUpdateStore } from "./updateStore";

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
        <ReactMarkdown>{anuncio}</ReactMarkdown>
      </div>
    </Dialog>
  );
}

/**
 * La cordillera del amanecer: dos cadenas de cerros por las que asoma el sol.
 *
 * Va en SVG y no en CSS porque una silueta de montañas no se dibuja con
 * degradados, y va **después** del sol en el DOM para taparle la mitad de abajo:
 * de ahí sale que el sol *salga* de atrás de los cerros y no que flote sobre una
 * banda de color.
 *
 * Son dos cadenas y no una para que haya profundidad —la de atrás más clara, la de
 * adelante más oscura—, y la de adelante baja hasta el borde con un degradado que
 * termina en el color del diálogo: es lo que hace que la cabecera se disuelva en el
 * cuerpo en vez de cortarse con una línea.
 *
 * `preserveAspectRatio="none"` a propósito: se estira al ancho del modal, y un
 * cerro estirado sigue siendo un cerro.
 */
function Cordillera() {
  return (
    <svg className="nuevo__cordillera" viewBox="0 0 440 118" preserveAspectRatio="none" aria-hidden>
      {/* La cadena de atrás: cumbres más chicas y en un tono más claro, que es la
       * bruma de la distancia. Va desfasada de la de adelante para que asome por
       * los portezuelos y no quede escondida detrás. */}
      <path
        fill="var(--nuevo-cerro-lejos)"
        d="M0 66L48 76L92 90L146 52L198 82L252 60L308 84L364 56L412 80L440 64L440 118L0 118Z"
      />
      {/* La cadena de adelante: **aristas rectas y cumbres agudas**, no lomas.
       *
       * Las curvas suaves que se probaron primero se leían como dunas; una
       * cordillera es piedra quebrada, y eso son rectas. Lo que la salva de parecer
       * un gráfico de triángulos no es curvarla sino que **ninguna cumbre sea
       * simétrica ni mida lo mismo**: dos cumbres altas desiguales, una falda larga
       * y tendida contra una caída corta y empinada en cada una, y repisas a media
       * ladera que quiebran la recta.
       *
       * Entre las dos cumbres altas hay un **portezuelo casi plano** (y=58, de x=196
       * a x=244, o sea centrado): es por ahí que sale el sol, y su altura es la que
       * fija cuánto disco se ve — ver el comentario de `.nuevo__sol`. */}
      <path
        fill="var(--nuevo-cerro-cerca)"
        d="M0 96L34 88L70 62L92 52L128 18L150 44L166 40L182 52L196 58L244 58L262 50L306 26L330 52L346 46L378 72L406 64L440 82L440 118L0 118Z"
      />
      {/* Las caras iluminadas: **la única sombra que llevan, y no llevan nieve.**
       *
       * Cada cumbre alta parte en dos por su vertical, y la mitad que mira al sol va
       * en el tono claro. Como el sol sale en el portezuelo del medio, la cumbre de
       * la izquierda tiene iluminada su cara derecha y la de la derecha su cara
       * izquierda — o sea las dos miran al centro, que es lo que hace que la luz se
       * lea como *de ese sol* y no como un degradado decorativo. */}
      <path className="nuevo__luz" fill="var(--nuevo-cerro-luz)" d="M128 18L150 44L128 44Z" />
      <path className="nuevo__luz" fill="var(--nuevo-cerro-luz)" d="M306 26L262 50L306 50Z" />
      {/* La hoja del cuerpo, que sube por encima de los cerros: **baja a la izquierda
       * y sube a la derecha**.
       *
       * Va acá dentro y no como un `border-radius` de un `::after` porque un radio
       * hunde las **dos** esquinas por igual, y el borde que se busca es asimétrico.
       *
       * Es **una sola curva y no tramos pegados**. La versión anterior tenía una
       * esquinita redondeada, después un tramo a nivel y después la subida, y en
       * cada junta quedaba un quiebre: tres gestos discutiendo en 440px. Ahora es un
       * cubic con la **tangente horizontal en el borde izquierdo** —de ahí que
       * arranque a nivel, sin ángulo contra el costado de la caja— que va soltando
       * hacia arriba a la derecha. El título se apoya en la parte baja, que es la de
       * la izquierda.
       *
       * Es el mismo color del diálogo, así que no esconde el borde: lo declara. */}
      <path fill="var(--surface-raised)" d="M0 118V90C150 90 250 78 440 52V118Z" />
    </svg>
  );
}
