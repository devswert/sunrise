import { useEffect } from "react";
import { api, isTauri } from "../../lib/ipc";
import { announcementFor } from "../../lib/changelog";
import { useUpdateStore } from "./updateStore";
import type { UpdateProgress } from "../../lib/types";

/** El evento con el que Rust cuenta cómo va la descarga (`update::UPDATE_PROGRESS`). */
const UPDATE_PROGRESS = "sunrise://update-progress";

/** Cada cuánto se pregunta por una versión nueva. */
export const POLL_MS = 4 * 60 * 60 * 1000;
/** Cuánto dura en pantalla el aviso "Estás al día". */
export const AL_DIA_MS = 30_000;

/**
 * La versión que la app mostró la última vez. En `localStorage` y **no** en la
 * tabla `settings`, por lo mismo que el inicio automático (§4.18): describe esta
 * instalación, no tus datos. En `settings` viajaría dentro de los respaldos, y
 * restaurar un zip viejo haría reaparecer el aviso de una versión ya leída.
 */
export const CLAVE_VISTA = "sunrise-seen-version";

/**
 * El sondeo del updater y la detección de "vengo de actualizarme".
 *
 * **Se monta una sola vez, en `Shell`** (o sea en la ventana `main`): dos ventanas
 * sondeando serían dos consultas por intervalo, igual que la campana (I6).
 *
 * Sondea al montar y después cada 4 horas. Buscar al arrancar contradice lo que
 * decidió 5.3 —y por eso vale explicarlo—: ahí el argumento era **no
 * interrumpir**, y lo que aparece ahora no interrumpe nada. Es una franja en el
 * sidebar que espera. Sin la consulta al arrancar, además, un intervalo de 4 horas
 * no dispararía nunca para quien cierra la app todos los días.
 *
 * Un fallo no hace nada: sin conexión —o antes de que exista el primer Release— no
 * hay banner. Eso es lo normal, no una avería, y un aviso rojo al abrir la app
 * sería exactamente lo que 5.3 no quiso.
 */
export function useUpdateRuntime() {
  const setAvailable = useUpdateStore((s) => s.setAvailable);
  const setProgress = useUpdateStore((s) => s.setProgress);
  const arrivedFromUpdate = useUpdateStore((s) => s.arrivedFromUpdate);
  const hideBanner = useUpdateStore((s) => s.hideBanner);

  // "Vengo de un update": la versión cambió desde la última vez que se miró.
  useEffect(() => {
    let alive = true;
    let quitar: ReturnType<typeof setTimeout> | undefined;
    void api.appVersion().then((actual) => {
      if (!alive) return;
      const vista = localStorage.getItem(CLAVE_VISTA);
      // Se guarda siempre, incluso cuando no se avisa: si no, una versión sin
      // anuncio escrito dejaría la marca vieja y el aviso saltaría en la
      // siguiente, con el texto equivocado.
      localStorage.setItem(CLAVE_VISTA, actual);
      // Sin marca es una instalación nueva: no hay nada "nuevo" que leer. Y sin
      // anuncio escrito, el aviso llevaría a un modal vacío.
      if (!vista || vista === actual || !announcementFor(actual)) return;
      arrivedFromUpdate(actual);
      quitar = setTimeout(() => alive && hideBanner(), AL_DIA_MS);
    });
    return () => {
      alive = false;
      if (quitar) clearTimeout(quitar);
    };
  }, [arrivedFromUpdate, hideBanner]);

  // El sondeo.
  useEffect(() => {
    let alive = true;
    const mirar = () => {
      void api
        .checkForUpdate()
        .then((u) => alive && setAvailable(u))
        .catch(() => {});
    };
    mirar();
    const id = setInterval(mirar, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setAvailable]);

  // El avance de la descarga. Viene por evento y no por comando porque el que
  // habla primero es Rust: `install_update` no vuelve nunca cuando sale bien.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      unlisten = await listen<UpdateProgress>(UPDATE_PROGRESS, (e) => setProgress(e.payload));
    })();
    return () => unlisten?.();
  }, [setProgress]);
}
