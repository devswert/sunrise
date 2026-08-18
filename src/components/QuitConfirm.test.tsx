import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useAppStore } from "../lib/store";
import { useTimerStore } from "../features/timer/timerStore";
import { QuitConfirm } from "./QuitConfirm";

const confirmQuit = vi.fn(async () => {});

vi.mock("../lib/ipc", () => ({
  isTauri: () => false,
  api: {
    confirmQuit: () => confirmQuit(),
    getActiveTimer: vi.fn(async () => null),
    getTask: vi.fn(async () => null),
    stopTimer: vi.fn(async () => null),
    playBell: vi.fn(),
  },
}));

function abrirDialogo() {
  act(() => useAppStore.getState().setQuitOpen(true));
}

describe("QuitConfirm", () => {
  beforeEach(() => {
    confirmQuit.mockClear();
    useAppStore.setState({ quitOpen: false });
    useTimerStore.setState({ active: null, elapsed: 0 });
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
    useTimerStore.setState({
      active: {
        entryId: 1,
        taskId: 7,
        title: "Revisar PRs",
        startedAt: "2026-08-11T10:00:00Z",
        baseSeconds: 0,
        estimatedMinutes: 30,
      },
      elapsed: 754,
    });
    render(<QuitConfirm />);
    abrirDialogo();

    expect(screen.getByText("Revisar PRs")).toBeInTheDocument();
    expect(screen.getByText(/0:12:34/)).toBeInTheDocument();
    expect(screen.getByText(/sigue\s+corriendo y va a seguir contando/i)).toBeInTheDocument();
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
