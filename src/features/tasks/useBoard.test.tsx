import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { todayISO } from "../../lib/date";

const demote = vi.fn(async () => 0);
const listTasksForRange = vi.fn(async () => []);

vi.mock("../../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    demotePending: (...a: unknown[]) => demote(...(a as [])),
    listTasksForRange: () => listTasksForRange(),
    listCategories: vi.fn(async () => []),
    listObjectives: vi.fn(async () => []),
  },
}));

/**
 * `useBoard` guarda en el módulo si ya arrastró hoy, así que cada test necesita
 * una instancia limpia: sin esto el segundo test heredaría el flag del primero.
 *
 * El store se importa del MISMO grafo recién creado: `resetModules` también
 * recrea `useAppStore`, y una referencia importada arriba apuntaría a otra
 * instancia, sobre la que el componente no está suscrito.
 */
async function freshBoard() {
  vi.resetModules();
  const { useBoard } = await import("./useBoard");
  const { useAppStore } = await import("../../lib/store");
  function Probe() {
    useBoard(todayISO(), todayISO());
    return null;
  }
  return { Probe, useAppStore };
}

describe("useBoard · degradación", () => {
  beforeEach(() => {
    demote.mockClear();
    listTasksForRange.mockClear();
  });

  it("corre una vez al montar, antes de la primera lectura", async () => {
    const { Probe } = await freshBoard();
    render(<Probe />);

    await waitFor(() => expect(listTasksForRange).toHaveBeenCalled());
    expect(demote).toHaveBeenCalledTimes(1);
    expect(demote).toHaveBeenCalledWith(todayISO());
  });

  it("NO vuelve a correr en cada invalidación de datos", async () => {
    const { Probe, useAppStore } = await freshBoard();
    render(<Probe />);
    await waitFor(() => expect(demote).toHaveBeenCalledTimes(1));

    // Tres mutaciones cualesquiera (o avisos de la otra ventana). Se esperan de
    // a una: varias seguidas se coalescen, porque el cleanup del efecto cancela
    // la recarga en vuelo de la anterior.
    for (let i = 0; i < 3; i++) {
      act(() => useAppStore.getState().markDataStale());
      // El board sí recarga con cada invalidación...
      await waitFor(() => expect(listTasksForRange).toHaveBeenCalledTimes(i + 2));
    }

    // ...pero el degradación, que es una mutación, no se repite.
    expect(demote).toHaveBeenCalledTimes(1);
  });

  it("dos vistas montadas a la vez comparten una sola corrida", async () => {
    const { Probe } = await freshBoard();
    render(
      <>
        <Probe />
        <Probe />
      </>,
    );

    await waitFor(() => expect(listTasksForRange).toHaveBeenCalledTimes(2));
    expect(demote).toHaveBeenCalledTimes(1);
  });
});
