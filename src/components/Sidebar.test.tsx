import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { displayCombo } from "../lib/shortcuts";
import { useSidebarStore } from "../lib/sidebar";

/**
 * El colapso vive en un store de módulo (lo comparte con el atajo de teclado),
 * así que no se resetea solo entre tests: limpiar localStorage ya no alcanza.
 */
function resetSidebar() {
  localStorage.clear();
  useSidebarStore.setState({ collapsed: false });
}

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
    expect(screen.getByRole("link", { name: "Backlog" })).not.toHaveAttribute("aria-keyshortcuts");
  });
});

describe("Sidebar", () => {
  beforeEach(() => {
    resetSidebar();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-sidebar");
  });

  it("renderiza la marca y los links de navegación clave", () => {
    renderSidebar();
    expect(screen.getByText("sunrise")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Weekly review" })).toBeInTheDocument();
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
    resetSidebar();
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
    expect(document.documentElement.getAttribute("data-sidebar")).toBe("collapsed");
    expect(screen.getByRole("button", { name: "Expandir" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  // Se reimporta el módulo en vez de rerenderizar: el store se siembra desde
  // localStorage **al crearse**, que en la app es una vez por ventana. Un
  // `render` más sobre el store ya vivo no probaría el arranque en frío.
  it("recuerda la elección entre sesiones", async () => {
    localStorage.setItem("sunrise-sidebar-collapsed", "1");
    vi.resetModules();
    const { Sidebar: SidebarNuevo } = await import("./Sidebar");
    render(
      <MemoryRouter>
        <SidebarNuevo />
      </MemoryRouter>,
    );
    // `find…` y no `get…`: el sidebar carga los contextos del backlog en un
    // efecto asíncrono, y salir del test antes deja el aviso de `act`.
    expect(await screen.findByRole("button", { name: "Expandir" })).toBeInTheDocument();
    expect(document.documentElement.getAttribute("data-sidebar")).toBe("collapsed");
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

    expect(screen.getByRole("link", { name: "Focus" })).not.toHaveAttribute("title");

    await user.click(screen.getByRole("button", { name: "Colapsar" }));

    expect(screen.getByRole("link", { name: "Focus" })).toHaveAttribute("title", "Focus");
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
    expect(screen.getByRole("switch", { name: "Cambiar a modo oscuro" })).toBeInTheDocument();
  });
});

/**
 * El backlog en el sidebar es **un solo número**: todo lo que hay, incluidas las
 * tareas sin canal, para que coincida con la lista que abre. Los canales se ven
 * en la vista, que es donde además se pueden abrir.
 */
describe("Sidebar · backlog", () => {
  // El estado de colapsado vive en `localStorage` y sobrevive entre tests: sin
  // esto el sidebar arranca colapsado y el conteo no se dibuja.
  beforeEach(() => {
    resetSidebar();
  });

  it("el item Backlog lleva el total de pendientes", async () => {
    renderSidebar();

    // El mock siembra una sola tarea en el backlog.
    const item = await screen.findByRole("link", { name: "Backlog" });
    await waitFor(() => expect(item).toHaveTextContent("1"));
  });

  it("no lista los canales: esos viven en la vista", async () => {
    renderSidebar();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Backlog" })).toHaveTextContent("1"),
    );

    expect(screen.queryByText("Thinking")).toBeNull();
  });

  it("el conteo no se cuela en el nombre accesible del link", async () => {
    renderSidebar();
    // Si el número entrara al nombre, el link pasaría a llamarse "Backlog 1" y
    // dejaría de ser encontrable por su nombre — acá y para un lector de pantalla.
    expect(await screen.findByRole("link", { name: "Backlog" })).toBeInTheDocument();
  });
});
