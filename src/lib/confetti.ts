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
    origin: { y: 0.65 },
    disableForReducedMotion: true,
  });
}
