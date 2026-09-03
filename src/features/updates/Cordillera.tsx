/**
 * La cordillera de la cabecera de los modales del updater.
 *
 * Vive en su propio archivo porque la usan **dos**: el amanecer de "Lo nuevo" y el
 * cielo nublado del detalle de un update fallido. Los cerros son los mismos —es el
 * mismo lugar—; lo que cambia es la luz, y eso lo ponen los tokens que declara cada
 * variante del diálogo.
 *
 * Dos cadenas de cerros, con un portezuelo al medio por el que asoma el sol.
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
export function Cordillera() {
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
