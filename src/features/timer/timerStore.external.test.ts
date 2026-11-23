/**
 * La fila **en pausa** del taxímetro cuando el tiempo cambia por fuera del store
 * (#38): un `stop_timer` o un `log_time` del MCP, que escribe en la base desde
 * otro proceso y llega como `markDataStale()` (`useExternalChanges`).
 *
 * Contra el `mockDb` real y escribiendo en él **sin pasar por el store**, que es
 * exactamente lo que hace el MCP: el store no se entera de la escritura, solo del
 * aviso, y lo único que puede hacer es releer.
 *
 * El contador de la pausada es **lo de hoy** (`seconds_today`), tanto al pausar
 * como al refrescar: acá también se fija que los dos digan lo mismo.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { startOfDayAt, todayISO } from "../../lib/date";
import { useAppStore } from "../../lib/store";
import { timerRows, useTimerStore } from "./timerStore";
import { useTimerRuntime } from "./useTimer";

const MIN = 60_000;

/** Lo que muestra el taxímetro en su única fila. */
const row = () => timerRows(useTimerStore.getState())[0];

/** Avisa como lo hace `useExternalChanges` al recibir `sunrise://data-changed`. */
const externalNotice = () => act(() => useAppStore.getState().markDataStale());

let now = 0;
const setNow = (ms: number) => {
  now = ms;
  vi.setSystemTime(now);
};
const advance = (ms: number) => setNow(now + ms);

/** Medianoche de hoy en la zona del usuario, medida al empezar cada test. */
let todayStart = 0;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  todayStart = startOfDayAt(Date.now()).getTime();
  // Mediodía de hoy: lejos de la medianoche, para que "lo de hoy" no dependa de
  // la hora a la que corran los tests (ni de que `bin/gates` los corra en UTC).
  setNow(todayStart + 12 * 60 * MIN);
  await api.stopAllTimers();
  localStorage.clear();
  useTimerStore.setState({
    actives: [],
    elapsedById: {},
    active: null,
    elapsed: 0,
    last: null,
    loaded: false,
  });
});

afterEach(async () => {
  await api.stopAllTimers();
  vi.useRealTimers();
});

describe("la fila en pausa tras un cambio de tiempo hecho por fuera (#38)", () => {
  it("un stop_timer de afuera deja la fila con lo trabajado hoy, no con la foto de cuando arrancó", async () => {
    const { id } = await api.createTask({ title: "con el agente", scheduledDate: todayISO() });
    renderHook(() => useTimerRuntime());
    await act(() => useTimerStore.getState().start(id));
    expect(row()).toMatchObject({ taskId: id });

    // Diez minutos después el MCP la detiene, sin pasar por este store.
    advance(10 * MIN);
    await api.stopTimer(id);
    externalNotice();

    // El bug: la fila pasaba a pausa con los segundos del arranque (0:00:00).
    await waitFor(() => expect(useTimerStore.getState().actives).toHaveLength(0));
    await waitFor(() => expect(row()).toMatchObject({ taskId: id, seconds: 600 }));
  });

  it("un tramo cerrado de hoy escrito en la base (start y stop sin el store) le suma a la pausada", async () => {
    const { id } = await api.createTask({ title: "pausada", scheduledDate: todayISO() });
    renderHook(() => useTimerRuntime());
    await act(() => useTimerStore.getState().start(id));
    advance(5 * MIN);
    await act(async () => {
      await useTimerStore.getState().stop(id);
    });
    expect(row()).toMatchObject({ taskId: id, seconds: 300 });
    // Pausar y refrescar leen lo mismo: el número no se mueve.
    await act(() => useTimerStore.getState().refresh());
    expect(row()).toMatchObject({ taskId: id, seconds: 300 });

    // Lo que deja un `log_time` del MCP es un tramo cerrado de hoy. El mock no
    // tiene esa tool, así que el tramo se arma con start y stop directo en la
    // base: el efecto en `time_entries` es el mismo.
    await api.startTimer(id);
    advance(10 * MIN);
    await api.stopTimer(id);
    externalNotice();

    // El bug: la fila seguía en 0:05:00.
    await waitFor(() => expect(row()).toMatchObject({ taskId: id, seconds: 900 }));
  });
});

describe("el contador de la pausada es lo de hoy", () => {
  it("pausar una corrida que cruzó la medianoche muestra solo lo de hoy, y refrescar no lo mueve", async () => {
    const { id } = await api.createTask({ title: "trasnochada", scheduledDate: todayISO() });
    // Arrancó a las 23:50 de ayer y se pausa a las 00:05 de hoy.
    setNow(todayStart - 10 * MIN);
    await act(() => useTimerStore.getState().start(id));
    setNow(todayStart + 5 * MIN);

    await act(async () => {
      await useTimerStore.getState().stop(id);
    });

    // El bug: `stop_timer` devuelve la corrida entera (15 min) y la fila mostraba
    // 0:15:00, para saltar a 0:05:00 en el `refresh` siguiente.
    expect(row()).toMatchObject({ taskId: id, seconds: 300 });
    await act(() => useTimerStore.getState().refresh());
    expect(row()).toMatchObject({ taskId: id, seconds: 300 });
  });

  it("pausar todo (stopAll) con una corrida que cruzó la medianoche muestra solo lo de hoy", async () => {
    const { id } = await api.createTask({ title: "trasnochada", scheduledDate: todayISO() });
    setNow(todayStart - 10 * MIN);
    await act(() => useTimerStore.getState().start(id));
    setNow(todayStart + 5 * MIN);

    await act(async () => {
      await useTimerStore.getState().stopAll();
    });

    expect(useTimerStore.getState().actives).toHaveLength(0);
    expect(row()).toMatchObject({ taskId: id, seconds: 300 });
    await act(() => useTimerStore.getState().refresh());
    expect(row()).toMatchObject({ taskId: id, seconds: 300 });
  });

  it("si no se puede leer lo de hoy, pausar no lanza: el timer ya se cerró en la base", async () => {
    const { id } = await api.createTask({ title: "sin lectura", scheduledDate: todayISO() });
    await act(() => useTimerStore.getState().start(id));
    advance(5 * MIN);
    const fail = vi.spyOn(api, "secondsToday").mockRejectedValue(new Error("ipc caído"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await act(async () => {
        await expect(useTimerStore.getState().stop(id)).resolves.toEqual([id, 300]);
      });
      // La ventana se entera de la pausa igual, con el respaldo (lo de hoy de
      // cuando arrancó); el próximo `refresh` que pueda leer lo corrige.
      expect(useTimerStore.getState().actives).toHaveLength(0);
      expect(row()).toMatchObject({ taskId: id, seconds: 0 });
    } finally {
      fail.mockRestore();
      quiet.mockRestore();
    }

    await act(() => useTimerStore.getState().refresh());
    expect(row()).toMatchObject({ taskId: id, seconds: 300 });
  });

  it("la pausada de ayer vuelve a 0:00:00 con el primer refresh de hoy", async () => {
    const { id } = await api.createTask({ title: "de ayer", scheduledDate: todayISO() });
    setNow(todayStart - 12 * 60 * MIN);
    await act(() => useTimerStore.getState().start(id));
    advance(10 * MIN);
    await act(async () => {
      await useTimerStore.getState().stop(id);
    });
    expect(row()).toMatchObject({ taskId: id, seconds: 600 });

    // Al día siguiente: lo de ayer sigue en `time_entries`, pero no es de hoy.
    setNow(todayStart + 12 * 60 * MIN);
    await act(() => useTimerStore.getState().refresh());

    expect(row()).toMatchObject({ taskId: id, seconds: 0 });
    expect((await api.listTimeEntries(id)).reduce((s, e) => s + e.seconds, 0)).toBe(600);
  });
});
