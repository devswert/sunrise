import { useEffect } from "react";
import { api } from "../../lib/ipc";
import { announcementFor, latestVersion } from "../../lib/changelog";
import { useUpdateStore } from "./updateStore";

/**
 * Banco de pruebas del updater, **solo en dev**.
 *
 * El problema que resuelve: las dos franjas del sidebar solo aparecen de verdad con
 * dos versiones publicadas y una app instalada más vieja, o sea que no se pueden
 * mirar hasta después de publicar. Y no se puede parchar `mockDb`, porque dentro de
 * `pnpm tauri dev` el front habla con Rust y el mock no participa: esto trabaja
 * sobre el store, que es el mismo en los dos casos.
 *
 * Se maneja desde la consola del webview (clic derecho → Inspeccionar en dev):
 *
 * ```js
 * sunriseDev.hayUpdate()      // franja "Versión 0.2.0 · Actualizar ahora"
 * sunriseDev.alDia()          // franja "Estás al día" (se va a los 30 s)
 * sunriseDev.flujoCompleto()  // las dos, en orden, con la instalación simulada
 * sunriseDev.limpiar()        // apaga todo
 * ```
 *
 * **No llega a producción**: todo cuelga de `import.meta.env.DEV`, que en el build
 * es una constante falsa y se elimina como código muerto. Para sacarlo del todo,
 * borra este archivo y la línea de `useDevFake()` en `App.tsx`.
 *
 * La instalación del flujo simulado **no llama a `installUpdate`**: descargaría un
 * paquete real y reiniciaría la app. Finge dos segundos de trabajo —con su barra de
 * descarga, que es la mitad de lo que la tarjeta muestra— y termina en el estado de
 * llegada, que es lo que hace que se pueda ver el viaje completo sin publicar nada.
 */
export function useDevFake() {
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const st = useUpdateStore;

    // La versión que se anuncia tiene que tener su sección en el changelog, o el
    // modal no abre y el flujo de prueba muere en una franja muda. Dentro de
    // `tauri dev` la versión real la tiene; en el browser el mock devuelve "dev",
    // que no, así que ahí se cae a la más nueva escrita.
    const conAnuncio = async () => {
      const actual = await api.appVersion();
      return announcementFor(actual) ? actual : (latestVersion() ?? actual);
    };

    const hayUpdate = (version = "0.2.0") => {
      void conAnuncio().then((actual) =>
        st.setState({
          available: {
            version,
            currentVersion: actual,
            notes: "Notas de prueba: esto es un update falso.",
            date: "2026-09-01",
          },
          fake: true,
          error: null,
          installing: false,
          bannerVisible: false,
        }),
      );
      return "franja de versión nueva a la vista";
    };

    // Por defecto se anuncia la versión que está corriendo: es la única que con
    // seguridad tiene su sección en el changelog, y sin anuncio el modal no abre.
    const alDia = (version?: string) => {
      void conAnuncio().then((actual) =>
        st.setState({
          available: null,
          updatedTo: version ?? actual,
          bannerVisible: true,
        }),
      );
      return "franja 'Estás al día' a la vista, 30 s";
    };

    const limpiar = () => {
      st.setState({
        available: null,
        fake: false,
        installing: false,
        error: null,
        updatedTo: null,
        bannerVisible: false,
        whatsNewOpen: false,
        errorOpen: false,
      });
      return "limpio";
    };

    const flujoCompleto = () => {
      limpiar();
      hayUpdate();
      return "aprieta la franja: finge la instalación y termina en 'Estás al día'";
    };

    /**
     * Los fallos **tal como los manda Rust**, con su cadena de causas (`chain` en
     * `commands.rs`). Escribir a mano "Permission denied" mostraba un modal más
     * limpio que el real, y lo que hay que poder mirar acá es exactamente lo que
     * va a copiar y pegar la otra persona — incluido lo feo.
     *
     * Los cuatro son los que de verdad ocurren, en orden de probabilidad: la app
     * corriendo desde el `.dmg` montado o desde Descargas, `/Applications` sin
     * permiso de escritura, la red de una oficina, y la firma.
     */
    const FALLOS: Record<string, string> = {
      permiso: "Io error → failed to move the new app into place → Permission denied (os error 13)",
      solo_lectura:
        "Io error → failed to replace /Volumes/sunrise/sunrise.app → Read-only file system (os error 30)",
      red: "Network error → error sending request for url (https://github.com/devswert/sunrise/releases/download/v0.9.0/sunrise_aarch64.app.tar.gz) → error trying to connect → tcp connect error → Operation timed out (os error 60)",
      firma: "Signature error → the signature of the update could not be verified",
    };

    /**
     * El estado que **no se puede provocar a mano**: para verlo de verdad habría
     * que romper el updater. Es justo el que hay que poder mirar, porque es el que
     * le llega a alguien más y no a uno.
     *
     * Acepta la clave de un fallo conocido (`fallo("red")`) o un texto propio.
     */
    const fallo = (cual: keyof typeof FALLOS | string = "permiso") => {
      const mensaje = FALLOS[cual] ?? cual;
      void conAnuncio().then((actual) =>
        st.setState({
          available: {
            version: "0.9.0",
            currentVersion: actual,
            notes: null,
            date: null,
          },
          fake: true,
          installing: false,
          error: mensaje,
          errorOpen: false,
          bannerVisible: false,
        }),
      );
      return `franja en error (${Object.keys(FALLOS).join(" · ")}): apriétala para ver el detalle`;
    };

    (window as unknown as Record<string, unknown>).sunriseDev = {
      hayUpdate,
      alDia,
      fallo,
      flujoCompleto,
      limpiar,
    };
    // eslint-disable-next-line no-console
    console.info(
      "[sunrise] banco de pruebas del updater: sunriseDev.flujoCompleto() · .hayUpdate() · .alDia() · .fallo() · .limpiar()",
    );

    return () => {
      delete (window as unknown as Record<string, unknown>).sunriseDev;
    };
  }, []);
}
