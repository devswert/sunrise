import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const setTaximeterVisible = vi.fn(async () => true);

vi.mock("../../lib/ipc", () => ({
  isTauri: () => true,
  api: { setTaximeterVisible: (...a: unknown[]) => setTaximeterVisible(...(a as [])) },
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));

const { useFloatingWindow } = await import("./useFloatingWindow");

/**
 * El bug que este archivo fija: **el taxímetro no aparecía** con una tarea
 * corriendo. `active` vive en la base y se lee asincrónico, así que en el primer
 * render se ve igual que "no hay nada", y quien decide la visibilidad lo
 * escondía antes de saber que sí había algo. Un webview oculto en macOS se
 * estrangula, así que el `show()` posterior podía no llegar nunca.
 */
describe("useFloatingWindow · no decide hasta haber leído el timer", () => {
  it("mientras no cargó, no manda ni mostrar ni esconder", () => {
    setTaximeterVisible.mockClear();
    renderHook(() => useFloatingWindow(false, false));
    expect(setTaximeterVisible).not.toHaveBeenCalled();
  });

  it("una vez cargado sí decide", () => {
    setTaximeterVisible.mockClear();
    const { rerender } = renderHook(({ v, c }) => useFloatingWindow(v, c), {
      initialProps: { v: false, c: false },
    });
    expect(setTaximeterVisible).not.toHaveBeenCalled();

    // Llegó la lectura de la base: había un timer corriendo.
    rerender({ v: true, c: true });
    expect(setTaximeterVisible).toHaveBeenCalledWith(true, null);
  });

  it("cargado y sin nada que mostrar, lo esconde", () => {
    setTaximeterVisible.mockClear();
    renderHook(() => useFloatingWindow(false, true));
    expect(setTaximeterVisible).toHaveBeenCalledWith(false, null);
  });
});
