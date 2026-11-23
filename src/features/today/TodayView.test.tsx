import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { TodayView } from "./TodayView";
import { todayISO } from "../../lib/date";
import { useAppStore } from "../../lib/store";
import { addToRange, ignoredEvent } from "../../test/ignoredEvents";

/**
 * #8: la columna de Today mide contra la capacidad **de hoy** —la jornada menos
 * los eventos ignorados de hoy—, la misma función que la semana. La carga sale de
 * la semilla del mock, que siempre deja tareas estimadas en hoy.
 */
describe("TodayView · capacidad del día", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const cap = () => document.querySelector<HTMLElement>(".day-col__cap");

  it("un evento ignorado de hoy le resta a la capacidad, y desmarcarlo la devuelve", async () => {
    let ignorado = true;
    // Un almuerzo de 13:00 a 14:15: 9 h − 1 h 15 = 7:45.
    addToRange(() => [ignoredEvent(todayISO(), "13:00", 75, { railOnly: ignorado })]);
    render(<TodayView />);

    await waitFor(() => expect(cap()?.title).toMatch(/ de 7:45$/));

    ignorado = false;
    act(() => useAppStore.getState().bumpData());
    await waitFor(() => expect(cap()?.title).toMatch(/ de 9:00$/));
  });
});
