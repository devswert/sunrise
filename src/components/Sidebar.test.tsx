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
    document.documentElement.removeAttribute("data-sidebar");
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

describe("Sidebar · colapsar", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-sidebar");
  });

  it("arranca expandido y colapsa al apretar el botón", async () => {
    const user = userEvent.setup();
    renderSidebar();

    const boton = screen.getByRole("button", { name: "Colapsar" });
    expect(boton).toHaveAttribute("aria-expanded", "true");

    await user.click(boton);

    // El ancho lo define un token en `:root`, no una clase del shell: si el
    // atributo no se estampa, el sidebar se ve angosto por dentro pero su
    // columna sigue midiendo 232px y queda una franja vacía al lado.
    expect(document.documentElement.getAttribute("data-sidebar")).toBe(
      "collapsed",
    );
    expect(screen.getByRole("button", { name: "Expandir" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("recuerda la elección entre sesiones", async () => {
    localStorage.setItem("sunrise-sidebar-collapsed", "1");
    renderSidebar();
    // `find…` y no `get…`: el sidebar carga los contextos del backlog en un
    // efecto asíncrono, y salir del test antes deja el aviso de `act`.
    expect(
      await screen.findByRole("button", { name: "Expandir" }),
    ).toBeInTheDocument();
    expect(document.documentElement.getAttribute("data-sidebar")).toBe(
      "collapsed",
    );
  });

  /**
   * Colapsado quedan nueve iconos sin una sola palabra. El `title` es lo único
   * que distingue "Daily planning" de "Daily shutdown", así que sin él el rail
   * se vuelve un juego de adivinanzas. Expandido estorba: el nombre ya está
   * escrito al lado.
   */
  it("colapsado los ítems llevan tooltip, y expandido no", async () => {
    const user = userEvent.setup();
    renderSidebar();

    expect(screen.getByRole("link", { name: "Focus" })).not.toHaveAttribute(
      "title",
    );

    await user.click(screen.getByRole("button", { name: "Colapsar" }));

    expect(screen.getByRole("link", { name: "Focus" })).toHaveAttribute(
      "title",
      "Focus",
    );
  });

  /**
   * Colapsado el switch no cabe —mide 60px y el rail tiene 72 menos padding—, así
   * que se encoge a un círculo por CSS. Lo que **no** se hace es reemplazarlo por
   * otro control: sigue siendo el mismo botón, con su `role` y su `aria-checked`,
   * porque dos controles para lo mismo son dos cosas que mantener sincronizadas.
   */
  it("el switch de tema sigue siendo el mismo control al colapsar", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Colapsar" }));
    expect(
      screen.getByRole("switch", { name: "Cambiar a modo oscuro" }),
    ).toBeInTheDocument();
  });
});
