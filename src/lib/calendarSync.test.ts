import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarFeed } from "./types";
import { MIN_AUTO_MS, useCalendarSync } from "./calendarSync";

const feeds: CalendarFeed[] = [];
/** Resuelve cuando el test lo diga, para poder mirar el estado "en curso". */
let release: (() => void) | null = null;
const syncCalendarFeeds = vi.fn(
  () =>
    new Promise<number>((res) => {
      release = () => res(1);
    }),
);

vi.mock("./ipc", () => ({
  isTauri: () => false,
  api: {
    listCalendarFeeds: async () => feeds.map((f) => ({ ...f })),
    syncCalendarFeeds: () => syncCalendarFeeds(),
    syncCalendarFeed: async () => 0,
  },
}));

function feed(id: number, lastSyncedAt: string | null): CalendarFeed {
  return {
    id,
    name: `Feed ${id}`,
    icsUrl: "https://x/y.ics",
    defaultCategoryId: null,
    importAsTasks: true,
    pollMinutes: 5,
    lastSyncedAt,
    lastError: null,
  };
}

describe("useCalendarSync", () => {
  beforeEach(() => {
    feeds.length = 0;
    release = null;
    syncCalendarFeeds.mockClear();
    useCalendarSync.setState({ sincronizando: false, ultimaSync: null, feeds: 0 });
  });

  /**
   * El freno de la sincronización automática. Existe porque `sync()` va con
   * `force` —se saltea el `is_due` de Rust—, así que sin esto cada cambio de foco
   * bajaba todos los feeds enteros, y el feed no tiene validadores que abaraten la
   * pasada.
   */
  describe("syncIfStale", () => {
    /** Marca ISO de hace `ms`, en el formato que escribe Rust (RFC3339). */
    const hace = (ms: number) => new Date(Date.now() - ms).toISOString();

    it("una pasada reciente no sale a la red", async () => {
      feeds.push(feed(1, hace(5_000)));
      await useCalendarSync.getState().refresh();

      await useCalendarSync.getState().syncIfStale();

      expect(syncCalendarFeeds).not.toHaveBeenCalled();
    });

    it("pasado el mínimo, sincroniza", async () => {
      feeds.push(feed(1, hace(MIN_AUTO_MS + 1_000)));
      await useCalendarSync.getState().refresh();

      void useCalendarSync.getState().syncIfStale();

      expect(syncCalendarFeeds).toHaveBeenCalledTimes(1);
      release?.();
    });

    it("un feed que nunca se sincronizó sincroniza", async () => {
      feeds.push(feed(1, null));
      await useCalendarSync.getState().refresh();

      void useCalendarSync.getState().syncIfStale();

      expect(syncCalendarFeeds).toHaveBeenCalledTimes(1);
      release?.();
    });

    it("una marca ilegible o en el futuro no frena nada", async () => {
      // El caso raro tiene que caer del lado de sincronizar: con `NaN` toda
      // comparación da false, y un freno que se equivoca al revés dejaría el
      // calendario mudo para siempre sin ningún síntoma.
      for (const marca of ["ayer", new Date(Date.now() + 3_600_000).toISOString()]) {
        syncCalendarFeeds.mockClear();
        feeds.length = 0;
        feeds.push(feed(1, marca));
        await useCalendarSync.getState().refresh();
        useCalendarSync.setState({ sincronizando: false });

        void useCalendarSync.getState().syncIfStale();

        expect(syncCalendarFeeds).toHaveBeenCalledTimes(1);
        release?.();
      }
    });

    it("sin feeds no sale a la red", async () => {
      await useCalendarSync.getState().refresh();
      await useCalendarSync.getState().syncIfStale();
      expect(syncCalendarFeeds).not.toHaveBeenCalled();
    });

    it("el botón no mira el reloj: pedirlo a mano es pedirlo ahora", async () => {
      feeds.push(feed(1, hace(1_000)));
      await useCalendarSync.getState().refresh();

      void useCalendarSync.getState().sync();

      expect(syncCalendarFeeds).toHaveBeenCalledTimes(1);
      release?.();
    });
  });

  it("la antigüedad es la del feed más reciente", async () => {
    // El botón habla de "el calendario" en general, así que con varios feeds
    // mostrar el más viejo diría que está más desactualizado de lo que está.
    feeds.push(feed(1, "2026-08-10T10:00:00Z"), feed(2, "2026-08-13T09:00:00Z"));

    await useCalendarSync.getState().refresh();

    expect(useCalendarSync.getState().ultimaSync).toBe("2026-08-13T09:00:00Z");
    expect(useCalendarSync.getState().feeds).toBe(2);
  });

  it("un feed que nunca se sincronizó no cuenta como antigüedad", async () => {
    feeds.push(feed(1, null));
    await useCalendarSync.getState().refresh();
    expect(useCalendarSync.getState().ultimaSync).toBeNull();
  });

  it("no lanza dos sincronizaciones a la vez", async () => {
    // Es la garantía que sostiene los dos botones: si el de Configs está
    // corriendo, el de la semana no puede empezar otra pasada encima.
    feeds.push(feed(1, null));
    const primera = useCalendarSync.getState().sync();

    expect(useCalendarSync.getState().sincronizando).toBe(true);
    await useCalendarSync.getState().sync(); // debería ser un no-op

    expect(syncCalendarFeeds).toHaveBeenCalledTimes(1);

    release?.();
    await primera;
    expect(useCalendarSync.getState().sincronizando).toBe(false);
  });

  it("un error deja el botón usable de nuevo", async () => {
    // Sin el `finally`, un feed caído dejaba el botón deshabilitado para siempre
    // y la única salida era reiniciar la app.
    feeds.push(feed(1, null));
    syncCalendarFeeds.mockImplementationOnce(() => Promise.reject(new Error("sin red")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await useCalendarSync.getState().sync();

    expect(useCalendarSync.getState().sincronizando).toBe(false);
  });
});
