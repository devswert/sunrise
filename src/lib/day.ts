import { useEffect, useSyncExternalStore } from "react";
import { todayISO } from "./date";
import { useAppStore } from "./store";

/**
 * Qué día es hoy, como estado observable.
 *
 * Antes cada vista lo calculaba al renderizar (`todayISO()`), y una app de
 * escritorio que queda abierta cruza la medianoche sin que nada la vuelva a
 * renderizar. El caso real: el Mac se suspende a las 19:00 y despierta a las
 * 9:00 del día siguiente; Today seguía mostrando ayer, con título y todo, y el
 * carry-over no corría hasta el primer click.
 */
let diaActual = todayISO();
const suscriptores = new Set<() => void>();

/** Definidas a nivel de módulo: `useSyncExternalStore` reintenta la suscripción
 * si la función cambia de identidad, y en línea cambiaría en cada render. */
function suscribir(notify: () => void): () => void {
  suscriptores.add(notify);
  return () => {
    suscriptores.delete(notify);
  };
}

function leer(): string {
  return diaActual;
}

/**
 * ¿Cambió el día desde la última revisión? Si sí, lo actualiza y avisa.
 *
 * Compara **fechas de reloj**, no tiempo transcurrido, y eso es deliberado:
 * macOS suspende y agrupa los temporizadores al dormir, así que el intervalo
 * puede disparar tarde, una sola vez o ninguna hasta después de despertar. Una
 * comparación pura da el resultado correcto se ejecute cuando se ejecute; con
 * lógica de "pasaron N ms" habría que adivinar cuánto durmió la máquina.
 */
export function checkDayChange(): boolean {
  const today = todayISO();
  if (today === diaActual) return false;
  diaActual = today;
  for (const notify of suscriptores) notify();
  return true;
}

/** El día de hoy, y re-renderiza cuando cambia. */
export function useToday(): string {
  return useSyncExternalStore(suscribir, leer);
}

/** Respaldo para cuando la app queda abierta y visible sin que nadie la toque. */
const INTERVALO_MS = 60_000;

/**
 * Vigila el cambio de día. Va montado una sola vez, en `Shell`.
 *
 * Tres disparadores porque ninguno cubre solo todos los casos: `focus` y
 * `visibilitychange` atrapan el "vuelvo a la app por la mañana", pero si la
 * ventana nunca se ocultó —el escenario de la suspensión— no se dispara
 * ninguno de los dos, y ahí entra el intervalo.
 *
 * Invalida con `markDataStale` y no con `bumpData`: esto corre solo en `main`,
 * y el taxímetro no tiene vistas que dependan de `dataVersion`. Avisarle sería
 * ruido. (Ver SPECS §5.2 antes de cambiarlo por reflejo.)
 */
export function useDayWatcher(): void {
  useEffect(() => {
    const review = () => {
      if (!checkDayChange()) return;
      useAppStore.getState().markDataStale();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") review();
    };

    window.addEventListener("focus", review);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const intervalo = setInterval(review, INTERVALO_MS);
    review();

    return () => {
      window.removeEventListener("focus", review);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(intervalo);
    };
  }, []);
}
