import { create } from "zustand";
import type { AppUpdate } from "../../lib/types";

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

  setAvailable: (u: AppUpdate | null) => void;
  setInstalling: (v: boolean) => void;
  setError: (e: string | null) => void;
  /** Marca que esta sesión viene de un update, y prende el aviso. */
  arrivedFromUpdate: (version: string) => void;
  hideBanner: () => void;
  setWhatsNewOpen: (v: boolean) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  available: null,
  installing: false,
  fake: false,
  error: null,
  updatedTo: null,
  bannerVisible: false,
  whatsNewOpen: false,

  setAvailable: (available) => set({ available }),
  setInstalling: (installing) => set({ installing }),
  setError: (error) => set({ error }),
  arrivedFromUpdate: (version) => set({ updatedTo: version, bannerVisible: true }),
  hideBanner: () => set({ bannerVisible: false }),
  setWhatsNewOpen: (whatsNewOpen) => set({ whatsNewOpen }),
}));
