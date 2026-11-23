/**
 * Focus cuando el tiempo de la tarea cambia por fuera de la ventana (#38): un
 * `stop_timer` o un `log_time` del MCP, que llega solo como `markDataStale()`.
 *
 * Contra el `mockDb` real, escribiendo en él sin pasar por el store. Focus no
 * guarda foto del contador —muestra `actualSeconds` de la cola más lo corrido— y
 * relee la cola con cada `dataVersion`, así que esto lo deja fijado: si algún día
 * cachea el tiempo, el aviso tiene que seguir alcanzando.
 */
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { startOfDayAt, todayISO } from "../../lib/date";
import { useAppStore } from "../../lib/store";
import { useTimerStore } from "../timer/timerStore";
import { useTimerRuntime } from "../timer/useTimer";
import { FocusView } from "./FocusView";

const MIN = 60_000;

/** Focus con el runtime del timer montado, como en `Shell`. */
function FocusWithTimer() {
  useTimerRuntime();
  return <FocusView />;
}

const actualTime = () => screen.getByRole("button", { name: "Ajustar tiempo real" }).textContent;
const externalNotice = () => act(() => useAppStore.getState().markDataStale());

describe("Focus tras un cambio de tiempo hecho por fuera (#38)", () => {
  let now = 0;
  const advance = (ms: number) => {
    now += ms;
    vi.setSystemTime(now);
  };

  beforeEach(async () => {
    // Mediodía de hoy en la zona del usuario, lejos de la medianoche.
    vi.useFakeTimers({ toFake: ["Date"] });
    now = startOfDayAt(Date.now()).getTime() + 12 * 60 * MIN;
    vi.setSystemTime(now);
    await api.stopAllTimers();
    localStorage.clear();
  });

  afterEach(async () => {
    await api.stopAllTimers();
    vi.useRealTimers();
  });

  it("muestra el total nuevo tras un stop_timer de afuera y tras un tramo cerrado escrito en la base", async () => {
    const { id } = await api.createTask({ title: "con el agente", scheduledDate: todayISO() });
    render(
      <MemoryRouter>
        <FocusWithTimer />
      </MemoryRouter>,
    );
    // El mock trae otras pendientes antes; al darle play, Focus salta a esta.
    await act(() => useTimerStore.getState().start(id));
    await waitFor(() =>
      expect(document.querySelector(".focus__title")?.textContent).toContain("con el agente"),
    );

    // El MCP la detiene diez minutos después.
    advance(10 * MIN);
    await api.stopTimer(id);
    externalNotice();
    await waitFor(() => expect(useTimerStore.getState().actives).toHaveLength(0));
    await waitFor(() => expect(actualTime()).toContain("0:10:00"));

    // Y después un tramo cerrado de cinco minutos, como el que deja un
    // `log_time`: el mock no tiene esa tool, así que se arma con start y stop.
    await api.startTimer(id);
    advance(5 * MIN);
    await api.stopTimer(id);
    externalNotice();
    await waitFor(() => expect(actualTime()).toContain("0:15:00"));
  });
});
