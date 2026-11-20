import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

/**
 * Las copias que deja `exitAbove` (`ModalPresence`) van sueltas en `body`, fuera
 * del contenedor que RTL limpia, y se borran solas a los 240 ms. Un test que da
 * play desde el detalle y termina antes dejaría su copia en el siguiente —con un
 * botón "Iniciar" adentro—, así que se barren al terminar cada test.
 */
afterEach(() => {
  for (const ghost of document.querySelectorAll(".modal-presence.is-ghost")) ghost.remove();
});
