import { useEffect, useState } from "react";

/**
 * Cuánto espera antes de desmontar algo que se está yendo: un panel de la tira o
 * un modal.
 *
 * **Es más que los 160 ms de `panel-out` (`week.css`) y de `modal-out`
 * (`modal-presence.css`), y la holgura es el punto.** El temporizador arranca cuando corre el efecto; la animación arranca
 * en el pintado siguiente, uno o dos frames después. Con el mismo número los dos,
 * el desmontaje llega antes de que la salida termine y se ve un corte — que es
 * exactamente cómo se veía: como si no hubiera animación.
 *
 * Los 80 ms de más no se ven: con `animation-fill-mode: forwards` lo que sale se
 * queda quieto en su último fotograma, ya invisible y sin recibir el puntero.
 */
export const PRESENCE_MS = 240;

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Mantiene algo montado mientras se va, para que pueda animar la salida.
 *
 * Nació para los paneles de la tira y lo reusan los modales (`ModalPresence`):
 * es el mismo problema. Un panel que se dibuja con `{abierto && <Panel/>}` entra animado y **desaparece
 * de golpe**: al cerrarse React lo desmonta en el mismo frame y no queda nada
 * sobre lo que correr la animación. Este hook separa las dos cosas: `mounted`
 * sigue en `true` durante la salida, y `leaving` es lo que la dispara.
 *
 * Con `prefers-reduced-motion` no hay animación que esperar, así que desmonta al
 * instante: quedarse montado 140 ms sin moverse sería una demora y nada más.
 */
export function usePresence(open: boolean): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (open) {
      // Reabrir mientras se iba cancela la salida: el `clearTimeout` del cleanup
      // se encarga del temporizador que había quedado en vuelo.
      setMounted(true);
      setLeaving(false);
      return;
    }
    if (!mounted) return;
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    setLeaving(true);
    const id = setTimeout(() => {
      setMounted(false);
      setLeaving(false);
    }, PRESENCE_MS);
    return () => clearTimeout(id);
  }, [open, mounted]);

  return { mounted, leaving };
}
