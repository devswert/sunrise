import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { displayCombo } from "../lib/shortcuts";

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Sidebar · atajos", () => {
  it("muestra el atajo junto al ítem, sin meterlo en el nombre del link", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    // Visible para quien mira. Se pide vía `displayCombo` porque el símbolo
    // depende de la plataforma (⌘ en macOS, Ctrl fuera).
    expect(screen.getByText(displayCombo("Mod+3"))).toBeInTheDocument();
    // ...pero el link se sigue llamando "Focus", no "Focus ⌘ 3".
    const link = screen.getByRole("link", { name: "Focus" });
    expect(link).toHaveAttribute("aria-keyshortcuts", "Meta+3 Control+3");
  });

  it("los ítems sin atajo no muestran nada", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Backlog" })).not.toHaveAttribute(
      "aria-keyshortcuts",
    );
  });
});

describe("Sidebar", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("renderiza la marca y los links de navegación clave", () => {
    renderSidebar();
    expect(screen.getByText("sunrise")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Weekly review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Focus" })).toBeInTheDocument();
    expect(screen.getByText("Daily rituals")).toBeInTheDocument();
  });

  /**
   * El distintivo `dev` es **toda** la protección de §4.20 del lado del usuario:
   * las bases están separadas, pero nada impide tener las dos versiones abiertas
   * a la vez, y se ven idénticas. Si el distintivo desaparece, el aislamiento
   * sigue funcionando y el error humano —editar en la ventana equivocada— vuelve
   * intacto. El mock devuelve `dev: true`, que es lo correcto: fuera de Tauri no
   * estás en un `.dmg` instalado.
   */
  it("avisa que es dev y dice qué base está usando", async () => {
    renderSidebar();
    const chip = await screen.findByText("dev");
    expect(chip).toHaveAttribute("title", "Base en uso: sunrise-dev.sqlite");
  });

  it("alterna el tema claro/oscuro y persiste la elección", async () => {
    const user = userEvent.setup();
    renderSidebar();

    // jsdom sin matchMedia => tema inicial 'light' => switch sin marcar.
    const toggle = screen.getByRole("switch", { name: "Cambiar a modo oscuro" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    await user.click(toggle);

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("sunrise-theme")).toBe("dark");
    const switched = screen.getByRole("switch", {
      name: "Cambiar a modo claro",
    });
    expect(switched).toHaveAttribute("aria-checked", "true");
  });
});
