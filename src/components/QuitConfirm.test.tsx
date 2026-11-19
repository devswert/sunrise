import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../lib/store";
import { derive, useTimerStore } from "../features/timer/timerStore";
import type { ActiveTimer } from "../lib/types";
import { QuitConfirm } from "./QuitConfirm";

const confirmQuit = vi.fn(async () => {});

vi.mock("../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    confirmQuit: () => confirmQuit(),
    getActiveTimers: vi.fn(async () => []),
    stopAllTimers: vi.fn(async () => []),
    getTask: vi.fn(async () => null),
    stopTimer: vi.fn(async () => null),
  },
}));

const NOW = Date.parse("2026-08-11T12:00:00Z");

function timer(taskId: number, title: string, startedAtMs: number): ActiveTimer {
  return {
    entryId: taskId,
    taskId,
    title,
    startedAt: new Date(startedAtMs).toISOString(),
    baseSeconds: 0,
    estimatedMinutes: 30,
    bellRungFor: null,
  };
}

function abrirDialogo() {
  act(() => useAppStore.getState().setQuitOpen(true));
}

describe("QuitConfirm", () => {
  beforeEach(() => {
    confirmQuit.mockClear();
    useAppStore.setState({ quitOpen: false });
    useTimerStore.setState(derive([]));
  });

  it("no se ve hasta que Rust pide cerrar", () => {
    render(<QuitConfirm />);
    expect(screen.queryByRole("alertdialog")).toBeNull();

    abrirDialogo();

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("sin timer corriendo dice que ya está todo guardado", () => {
    render(<QuitConfirm />);
    abrirDialogo();
    expect(screen.getByText(/ya están guardados/i)).toBeInTheDocument();
  });

  it("con timer corriendo avisa qué tarea y que va a seguir contando", () => {
    // 754 s corridos hoy: lo que mide `derive` desde `startedAt`.
    // Un mediodía fijo: `derive` corta en la medianoche, y con `Date.now()` el
    // test caía en los primeros minutos del día.
    const now = NOW;
    useTimerStore.setState(derive([timer(7, "Revisar PRs", now - 754_000)], now));
    render(<QuitConfirm />);
    abrirDialogo();

    expect(screen.getByText("Revisar PRs")).toBeInTheDocument();
    expect(screen.getByText(/0:12:34/)).toBeInTheDocument();
    expect(screen.getByText(/sigue\s+corriendo y va a seguir contando/i)).toBeInTheDocument();
  });

  it("con varios timers en paralelo nombra todos los que siguen corriendo", () => {
    // Un mediodía fijo: `derive` corta en la medianoche, y con `Date.now()` el
    // test caía en los primeros minutos del día.
    const now = NOW;
    useTimerStore.setState(
      derive(
        [timer(7, "Revisar PRs", now - 754_000), timer(8, "Agente de migraciones", now - 61_000)],
        now,
      ),
    );
    render(<QuitConfirm />);
    abrirDialogo();

    expect(screen.getByText("Revisar PRs")).toBeInTheDocument();
    expect(screen.getByText("Agente de migraciones")).toBeInTheDocument();
    expect(screen.getByText(/0:12:34/)).toBeInTheDocument();
    expect(screen.getByText(/0:01:01/)).toBeInTheDocument();
    expect(screen.getByText(/siguen corriendo y van a seguir contando/i)).toBeInTheDocument();
  });

  it("Cancelar cierra el diálogo sin salir", async () => {
    const user = userEvent.setup();
    render(<QuitConfirm />);
    abrirDialogo();

    await user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(confirmQuit).not.toHaveBeenCalled();
    expect(useAppStore.getState().quitOpen).toBe(false);
  });

  it("Cerrar sale por `confirm_quit`", async () => {
    const user = userEvent.setup();
    render(<QuitConfirm />);
    abrirDialogo();

    await user.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(confirmQuit).toHaveBeenCalledTimes(1);
  });

  it("Escape cancela y Enter confirma", async () => {
    render(<QuitConfirm />);
    abrirDialogo();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useAppStore.getState().quitOpen).toBe(false);
    expect(confirmQuit).not.toHaveBeenCalled();

    abrirDialogo();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(confirmQuit).toHaveBeenCalledTimes(1);
  });
});
