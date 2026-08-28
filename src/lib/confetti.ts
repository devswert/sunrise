import confetti from "canvas-confetti";

/**
 * El confeti del final del ritual de planificación.
 *
 * Vive en un módulo propio por dos razones, las dos aprendidas de golpe:
 *
 * 1. **Se llama imperativamente, no se monta.** `canvas-confetti` crea su propio
 *    `<canvas>` colgado de `document.body`, así que sobrevive al `navigate` que
 *    viene justo después. Un componente React con el canvas adentro se
 *    desmontaría con la ruta y no se vería nada.
 * 2. **Es lo único mockeable en jsdom.** El canvas de jsdom no implementa
 *    `getContext`, así que cualquier test que apriete el botón reventaría (o
 *    llenaría la salida de advertencias) si la llamada estuviera inline en el
 *    componente.
 */
export function celebrate(): void {
  confetti({
    particleCount: 120,
    spread: 70,
    origin: { x: centroDelContenido(), y: 0.65 },
    disableForReducedMotion: true,
  });
}

/**
 * El centro horizontal del área de contenido, en fracción del ancho de ventana.
 *
 * El canvas de `canvas-confetti` cubre la ventana entera, así que el `0.5` que
 * trae por defecto es el centro de la **ventana** y no el de lo que estás
 * mirando: con el sidebar abierto el chorro sale corrido a la izquierda de la
 * vista que lo celebra, y al colapsarlo se corre de nuevo. Se mide en cada
 * llamada porque el sidebar se abre y se cierra (⌘S).
 */
function centroDelContenido(): number {
  const main = document.querySelector(".app-main");
  if (!main || !window.innerWidth) return 0.5;
  const r = main.getBoundingClientRect();
  if (!r.width) return 0.5;
  return (r.left + r.width / 2) / window.innerWidth;
}
