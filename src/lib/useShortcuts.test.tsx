import { describe, expect, it, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useSidebarStore } from "./sidebar";
import { useAppStore } from "./store";
import { useSettingsStore } from "./settings";
import { shortcutKey, useShortcuts } from "./shortcuts";

/** El cableado real: listener global → navegación / modal. */
function Harness() {
  useShortcuts();
  const loc = useLocation();
  return (
    <>
      <span data-testid="ruta">{loc.pathname}</span>
      <input aria-label="campo" />
    </>
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route path="*" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

function press(k: string, mods: { shift?: boolean } = {}) {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: k,
        metaKey: true,
        shiftKey: mods.shift ?? false,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

describe("useShortcuts", () => {
  beforeEach(() => {
    useSettingsStore.setState({ values: {}, loaded: true });
    useAppStore.setState({ composeOpen: false, quitOpen: false });
    useSidebarStore.setState({ collapsed: false });
  });

  // El colapso no lo toca solo el botón de la columna: como el listener vive
  // fuera del sidebar, el estado es un store compartido y no un `useState`.
  it("⌘S colapsa el sidebar y volver a pulsarlo lo expande", () => {
    renderApp();

    press("s");
    expect(useSidebarStore.getState().collapsed).toBe(true);

    press("s");
    expect(useSidebarStore.getState().collapsed).toBe(false);
  });

  // Misma regla que el resto: escribiendo, ⌘S no hace nada. Es a propósito,
  // para no pisar lo que el campo entienda por esa combinación.
  it("⌘S se ignora con el foco en un campo de texto", () => {
    renderApp();
    screen.getByLabelText("campo").focus();

    press("s");
    expect(useSidebarStore.getState().collapsed).toBe(false);
  });

  it("⌘1 / ⌘2 / ⌘3 navegan a Home, Today y Focus", () => {
    renderApp();
    expect(screen.getByTestId("ruta")).toHaveTextContent("/");

    press("2");
    expect(screen.getByTestId("ruta")).toHaveTextContent("/today");

    press("3");
    expect(screen.getByTestId("ruta")).toHaveTextContent("/focus");

    press("1");
    expect(screen.getByTestId("ruta").textContent).toBe("/");
  });

  it("⌘A abre el modal de nueva tarea", () => {
    renderApp();
    press("A");
    expect(useAppStore.getState().composeOpen).toBe(true);
  });

  it("se ignora mientras se escribe en un campo de texto", () => {
    renderApp();
    screen.getByLabelText("campo").focus();

    press("2");

    // Sin esto, ⌘A pisaría "seleccionar todo" en cualquier input.
    expect(screen.getByTestId("ruta").textContent).toBe("/");
  });

  it("respeta el atajo reasignado por el usuario", () => {
    useSettingsStore.setState({
      values: { [shortcutKey("goto_focus")]: "Mod+Shift+F" },
      loaded: true,
    });
    renderApp();

    // El de fábrica deja de valer...
    press("3");
    expect(screen.getByTestId("ruta").textContent).toBe("/");

    // ...y el nuevo funciona.
    press("F", { shift: true });
    expect(screen.getByTestId("ruta")).toHaveTextContent("/focus");
  });

  it("se suspenden con el diálogo de salida abierto", () => {
    renderApp();
    act(() => useAppStore.getState().setQuitOpen(true));

    press("2");

    // Navegar por debajo de un diálogo modal deja la app en un estado raro
    // cuando el usuario cancela.
    expect(screen.getByTestId("ruta").textContent).toBe("/");

    act(() => useAppStore.getState().setQuitOpen(false));
    press("2");
    expect(screen.getByTestId("ruta")).toHaveTextContent("/today");
  });

  it("un atajo guardado ilegible cae al de fábrica en vez de quedar muerto", () => {
    useSettingsStore.setState({
      values: { [shortcutKey("goto_today")]: "cmd+2" },
      loaded: true,
    });
    renderApp();

    press("2");
    expect(screen.getByTestId("ruta")).toHaveTextContent("/today");
  });
});
