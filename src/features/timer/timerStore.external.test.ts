/**
 * La fila **en pausa** del taxímetro cuando el tiempo cambia por fuera del store
 * (#38): un `stop_timer` o un `log_time` del MCP, que escribe en la base desde
 * otro proceso y llega como `markDataStale()` (`useExternalChanges`).
 *
 * Contra el `mockDb` real y escribiendo en él **sin pasar por el store**, que es
 * exactamente lo que hace el MCP: el store no se entera de la escritura, solo del
 * aviso, y lo único que puede hacer es releer.
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
const fila = () => timerRows(useTimerStore.getState())[0];

/** Avisa como lo hace `useExternalChanges` al recibir `sunrise://data-changed`. */
const avisoExterno = () => act(() => useAppStore.getState().markDataStale());

describe("la fila en pausa tras un cambio de tiempo hecho por fuera (#38)", () => {
  // Mediodía de hoy en la zona del usuario: lejos de la medianoche, para que
  // "lo de hoy" no dependa de la hora a la que corran los tests (ni de que
  // `bin/gates` los corra otra vez en UTC).
  let ahora = 0;
  const avanzar = (ms: number) => {
    ahora += ms;
    vi.setSystemTime(ahora);
  };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    ahora = startOfDayAt(Date.now()).getTime() + 12 * 60 * MIN;
    vi.setSystemTime(ahora);
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

  it("un stop_timer de afuera deja la fila con lo trabajado hoy, no con la foto de cuando arrancó", async () => {
    const { id } = await api.createTask({ title: "con el agente", scheduledDate: todayISO() });
    renderHook(() => useTimerRuntime());
    await act(() => useTimerStore.getState().start(id));
    expect(fila()).toMatchObject({ taskId: id });

    // Diez minutos después el MCP la detiene, sin pasar por este store.
    avanzar(10 * MIN);
    await api.stopTimer(id);
    avisoExterno();

    // El bug: la fila pasaba a pausa con los segundos del arranque (0:00:00).
    await waitFor(() => expect(useTimerStore.getState().actives).toHaveLength(0));
    await waitFor(() => expect(fila()).toMatchObject({ taskId: id, seconds: 600 }));
  });

  it("un log_time de afuera sobre la tarea en pausa le suma al contador", async () => {
    const { id } = await api.createTask({ title: "pausada", scheduledDate: todayISO() });
    renderHook(() => useTimerRuntime());
    await act(() => useTimerStore.getState().start(id));
    avanzar(5 * MIN);
    await act(async () => {
      await useTimerStore.getState().stop(id);
    });
    expect(fila()).toMatchObject({ taskId: id, seconds: 300 });

    // El MCP registra un tramo cerrado de diez minutos de hoy. En la base queda
    // igual que una corrida del taxímetro, que es como lo simula el mock.
    await api.startTimer(id);
    avanzar(10 * MIN);
    await api.stopTimer(id);
    avisoExterno();

    // El bug: la fila seguía en 0:05:00.
    await waitFor(() => expect(fila()).toMatchObject({ taskId: id, seconds: 900 }));
  });
});
