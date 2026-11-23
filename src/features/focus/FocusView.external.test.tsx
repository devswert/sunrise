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
function FocusConTimer() {
  useTimerRuntime();
  return <FocusView />;
}

const real = () => screen.getByRole("button", { name: "Ajustar tiempo real" }).textContent;
const avisoExterno = () => act(() => useAppStore.getState().markDataStale());

describe("Focus tras un cambio de tiempo hecho por fuera (#38)", () => {
  let ahora = 0;
  const avanzar = (ms: number) => {
    ahora += ms;
    vi.setSystemTime(ahora);
  };

  beforeEach(async () => {
    // Mediodía de hoy en la zona del usuario, lejos de la medianoche.
    vi.useFakeTimers({ toFake: ["Date"] });
    ahora = startOfDayAt(Date.now()).getTime() + 12 * 60 * MIN;
    vi.setSystemTime(ahora);
    await api.stopAllTimers();
    localStorage.clear();
  });

  afterEach(async () => {
    await api.stopAllTimers();
    vi.useRealTimers();
  });

  it("muestra el total nuevo después de un stop_timer y de un log_time de afuera", async () => {
    const { id } = await api.createTask({ title: "con el agente", scheduledDate: todayISO() });
    render(
      <MemoryRouter>
        <FocusConTimer />
      </MemoryRouter>,
    );
    // El mock trae otras pendientes antes; al darle play, Focus salta a esta.
    await act(() => useTimerStore.getState().start(id));
    await waitFor(() =>
      expect(document.querySelector(".focus__title")?.textContent).toContain("con el agente"),
    );

    // El MCP la detiene diez minutos después.
    avanzar(10 * MIN);
    await api.stopTimer(id);
    avisoExterno();
    await waitFor(() => expect(useTimerStore.getState().actives).toHaveLength(0));
    await waitFor(() => expect(real()).toContain("0:10:00"));

    // Y después registra un tramo cerrado de cinco minutos.
    await api.startTimer(id);
    avanzar(5 * MIN);
    await api.stopTimer(id);
    avisoExterno();
    await waitFor(() => expect(real()).toContain("0:15:00"));
  });
});
