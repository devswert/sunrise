import { useEffect, useState } from "react";

/**
 * Cuánto espera antes de desmontar un panel que se está yendo.
 *
 * **Es más que los 160 ms de `panel-out` en `week.css`, y la holgura es el
 * punto.** El temporizador arranca cuando corre el efecto; la animación arranca
 * en el pintado siguiente, uno o dos frames después. Con el mismo número los dos,
 * el desmontaje llega antes de que la salida termine y se ve un corte — que es
 * exactamente cómo se veía: como si no hubiera animación.
 *
 * Los 80 ms de más no se ven: con `animation-fill-mode: forwards` el panel se
 * queda quieto en su último fotograma, ya invisible y sin recibir el puntero.
 */
const MS = 240;

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Mantiene un panel montado mientras se va, para que pueda animar la salida.
 *
 * Un panel que se dibuja con `{abierto && <Panel/>}` entra animado y **desaparece
 * de golpe**: al cerrarse React lo desmonta en el mismo frame y no queda nada
 * sobre lo que correr la animación. Este hook separa las dos cosas: `mounted`
 * sigue en `true` durante la salida, y `leaving` es lo que la dispara.
 *
 * Con `prefers-reduced-motion` no hay animación que esperar, así que desmonta al
 * instante: quedarse montado 140 ms sin moverse sería una demora y nada más.
 */
export function usePanelPresence(open: boolean): { mounted: boolean; leaving: boolean } {
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
    }, MS);
    return () => clearTimeout(id);
  }, [open, mounted]);

  return { mounted, leaving };
}
