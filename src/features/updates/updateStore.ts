import { create } from "zustand";
import type { AppUpdate, UpdateProgress } from "../../lib/types";

/**
 * Estado del updater, compartido entre el banner del sidebar y el modal.
 *
 * Vive en un store y no en el componente porque son **dos** consumidores en ramas
 * distintas del árbol: el banner está en el sidebar y el modal al lado de las
 * rutas. Pasarlo por props obligaría a subir el estado hasta `App` y bajarlo por
 * todo el medio.
 */
interface UpdateState {
  /** Versión nueva encontrada por el sondeo. `null` = no hay, o no se pudo saber. */
  available: AppUpdate | null;
  /** Descargando e instalando. La app se reinicia sola al terminar. */
  installing: boolean;
  /**
   * Lo que va bajando, tal como lo emite Rust. `null` mientras no llegó el primer
   * trozo: `installing` sin progreso es "arrancó, todavía no hay bytes", y eso se
   * dibuja como una barra indeterminada y no como un cero.
   */
  progress: UpdateProgress | null;
  /**
   * Lo disponible lo puso el banco de pruebas de dev (`devFake.ts`), no el sondeo.
   * Apretar la franja finge la instalación en vez de descargar un paquete real y
   * reiniciar la app.
   */
  fake: boolean;
  error: string | null;
  /**
   * La versión a la que se acaba de llegar, o `null` si esta sesión no viene de un
   * update. **Sobrevive a que el aviso desaparezca**: es lo que el modal necesita
   * para saber qué anuncio mostrar, y apretar el banner apaga el aviso pero no
   * borra el dato.
   */
  updatedTo: string | null;
  /** El aviso "Estás al día" está en pantalla. Se apaga a los 30 s o al apretarlo. */
  bannerVisible: boolean;
  /** El modal "Lo nuevo". Se abre desde el banner, nunca solo. */
  whatsNewOpen: boolean;
  /**
   * El modal con el detalle de una instalación fallida.
   *
   * Existe porque **no hay telemetría**: cuando a alguien le falla un update, lo
   * único que puede llegar de vuelta es lo que esa persona logre copiar y pegar.
   * El mensaje del updater ya estaba en `error`, pero solo se veía dejando el
   * mouse quieto sobre el aviso, así que en la práctica el reporte que llegaba era
   * "me dio error" — que no distingue un permiso de escritura de un proxy.
   */
  errorOpen: boolean;

  setAvailable: (u: AppUpdate | null) => void;
  /** Prender la instalación **limpia el progreso viejo**: cada intento cuenta de cero. */
  setInstalling: (v: boolean) => void;
  setProgress: (p: UpdateProgress | null) => void;
  setError: (e: string | null) => void;
  /** Marca que esta sesión viene de un update, y prende el aviso. */
  arrivedFromUpdate: (version: string) => void;
  hideBanner: () => void;
  setWhatsNewOpen: (v: boolean) => void;
  setErrorOpen: (v: boolean) => void;
  /**
   * Abre el anuncio de una versión sin pasar por el aviso del sidebar.
   *
   * Es lo que necesita Configs → Actualizaciones: el aviso dura 30 segundos y
   * después el anuncio quedaba inalcanzable para siempre, aunque el changelog
   * viaje en el bundle. Escribe `updatedTo` porque el modal saca de ahí qué
   * sección mostrar, y **no** prende `bannerVisible`: nadie pidió el aviso.
   */
  showWhatsNew: (version: string) => void;
}

/**
 * El error del updater, como texto legible, venga como venga.
 *
 * `String(err)` alcanza para el camino normal —`invoke` rechaza con el `String`
 * que devolvió Rust— pero tiene un agujero que se paga justo donde más duele: un
 * objeto plano se convierte en `"[object Object]"`, y **sin telemetría eso es todo
 * lo que vuelve** de la máquina de otra persona. Un reporte inútil se ve igual que
 * uno bueno hasta que lo abrís.
 *
 * El orden importa: `Error` antes que objeto —un `Error` serializado a JSON sale
 * como `{}`, porque `message` no es enumerable— y `JSON.stringify` antes que
 * `String`, que es el que produce el `[object Object]`.
 */
export function errorText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || String(err);
  if (err !== null && typeof err === "object") {
    try {
      return JSON.stringify(err);
    } catch {
      // Referencias circulares: queda el `String`, que al menos dice el tipo.
    }
  }
  return String(err);
}

export const useUpdateStore = create<UpdateState>((set) => ({
  available: null,
  installing: false,
  progress: null,
  fake: false,
  error: null,
  updatedTo: null,
  bannerVisible: false,
  whatsNewOpen: false,
  errorOpen: false,

  setAvailable: (available) => set({ available }),
  setInstalling: (installing) => set({ installing, progress: null }),
  setProgress: (progress) => set({ progress }),
  // Un error nuevo **cierra el modal viejo**: si quedara abierto mostrando el
  // texto del intento anterior, el detalle que la persona copia no sería el del
  // problema que acaba de tener.
  setError: (error) => set({ error, errorOpen: false }),
  arrivedFromUpdate: (version) => set({ updatedTo: version, bannerVisible: true }),
  hideBanner: () => set({ bannerVisible: false }),
  setWhatsNewOpen: (whatsNewOpen) => set({ whatsNewOpen }),
  setErrorOpen: (errorOpen) => set({ errorOpen }),
  showWhatsNew: (version) => set({ updatedTo: version, whatsNewOpen: true }),
}));
