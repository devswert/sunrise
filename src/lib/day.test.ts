import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { checkDayChange, useDayWatcher, useToday } from "./day";
import { useAppStore } from "./store";

/** La noche del escenario real: se suspende a las 19:00, despierta a las 9:00. */
const ANOCHE = new Date("2026-08-12T19:00:00");
const MANANA = new Date("2026-08-13T09:00:00");

describe("cambio de día", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ANOCHE);
    // Deja el módulo anclado a ANOCHE con su propia API, en vez de exportar un
    // reset que en producción no usa nadie y cualquiera podría llamar.
    checkDayChange();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no avisa mientras siga siendo el mismo día", () => {
    vi.setSystemTime(new Date("2026-08-12T23:59:00"));
    expect(checkDayChange()).toBe(false);
  });

  it("detecta el salto una sola vez", () => {
    vi.setSystemTime(MANANA);
    expect(checkDayChange()).toBe(true);
    // La segunda revisión ya no tiene nada que anunciar.
    expect(checkDayChange()).toBe(false);
  });

  it("`useToday` re-renderiza con el día nuevo", () => {
    const { result } = renderHook(() => useToday());
    expect(result.current).toBe("2026-08-12");

    act(() => {
      vi.setSystemTime(MANANA);
      checkDayChange();
    });

    expect(result.current).toBe("2026-08-13");
  });

  it("el intervalo lo detecta sin que nadie toque la app", () => {
    // El caso que motivó todo esto: la ventana nunca se ocultó ni perdió el
    // foco, así que `visibilitychange` y `focus` no se disparan nunca.
    const before = useAppStore.getState().dataVersion;
    renderHook(() => useDayWatcher());

    act(() => {
      vi.setSystemTime(MANANA);
      vi.advanceTimersByTime(60_000);
    });

    expect(useAppStore.getState().dataVersion).toBeGreaterThan(before);
  });

  it("volver a la app también lo detecta", () => {
    const before = useAppStore.getState().dataVersion;
    renderHook(() => useDayWatcher());

    act(() => {
      vi.setSystemTime(MANANA);
      window.dispatchEvent(new Event("focus"));
    });

    expect(useAppStore.getState().dataVersion).toBeGreaterThan(before);
  });

  it("no invalida datos si el día no cambió", () => {
    renderHook(() => useDayWatcher());
    const before = useAppStore.getState().dataVersion;

    act(() => {
      vi.advanceTimersByTime(60_000 * 5);
      window.dispatchEvent(new Event("focus"));
    });

    // Invalidar cada minuto recargaría el board sin motivo, y el carry-over
    // volvería a mirar la DB una y otra vez.
    expect(useAppStore.getState().dataVersion).toBe(before);
  });
});
