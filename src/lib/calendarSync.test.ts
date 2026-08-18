import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalendarFeed } from "./types";
import { useCalendarSync } from "./calendarSync";

const feeds: CalendarFeed[] = [];
/** Resuelve cuando el test lo diga, para poder mirar el estado "en curso". */
let liberar: (() => void) | null = null;
const syncCalendarFeeds = vi.fn(
  () => new Promise<number>((res) => {
    liberar = () => res(1);
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
    liberar = null;
    syncCalendarFeeds.mockClear();
    useCalendarSync.setState({ sincronizando: false, ultimaSync: null, feeds: 0 });
  });

  it("la antigüedad es la del feed más reciente", async () => {
    // El botón habla de "el calendario" en general, así que con varios feeds
    // mostrar el más viejo diría que está más desactualizado de lo que está.
    feeds.push(feed(1, "2026-08-10T10:00:00Z"), feed(2, "2026-08-13T09:00:00Z"));

    await useCalendarSync.getState().refrescar();

    expect(useCalendarSync.getState().ultimaSync).toBe("2026-08-13T09:00:00Z");
    expect(useCalendarSync.getState().feeds).toBe(2);
  });

  it("un feed que nunca se sincronizó no cuenta como antigüedad", async () => {
    feeds.push(feed(1, null));
    await useCalendarSync.getState().refrescar();
    expect(useCalendarSync.getState().ultimaSync).toBeNull();
  });

  it("no lanza dos sincronizaciones a la vez", async () => {
    // Es la garantía que sostiene los dos botones: si el de Configs está
    // corriendo, el de la semana no puede empezar otra pasada encima.
    feeds.push(feed(1, null));
    const primera = useCalendarSync.getState().sincronizar();

    expect(useCalendarSync.getState().sincronizando).toBe(true);
    await useCalendarSync.getState().sincronizar(); // debería ser un no-op

    expect(syncCalendarFeeds).toHaveBeenCalledTimes(1);

    liberar?.();
    await primera;
    expect(useCalendarSync.getState().sincronizando).toBe(false);
  });

  it("un error deja el botón usable de nuevo", async () => {
    // Sin el `finally`, un feed caído dejaba el botón deshabilitado para siempre
    // y la única salida era reiniciar la app.
    feeds.push(feed(1, null));
    syncCalendarFeeds.mockImplementationOnce(() => Promise.reject(new Error("sin red")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await useCalendarSync.getState().sincronizar();

    expect(useCalendarSync.getState().sincronizando).toBe(false);
  });
});
