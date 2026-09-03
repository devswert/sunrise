import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const abrirExterno = vi.fn(async () => {});
vi.mock("../calendar/MeetingLink", () => ({
  abrirExterno: (...a: unknown[]) => abrirExterno(...(a as [])),
}));

const { NotesEditor } = await import("./NotesEditor");

const notas = "Revisar [el PR](https://github.com/acme/repo/pull/12) hoy";

function montar(value = notas) {
  return render(<NotesEditor value={value} onDebounced={vi.fn()} onBlurSave={vi.fn()} />);
}

/**
 * Las notas son markdown que se vuelve editable al hacer click, así que un link
 * adentro tiene **dos** formas de portarse mal: llevarse la ventana de la app
 * (`<a href>` navega el webview) y, al taparlo, dejar el markdown en modo edición
 * — o sea que volvés del navegador a un textarea abierto.
 */
describe("NotesEditor · un link dentro de las notas", () => {
  it("lo abre afuera y no entra en modo edición", async () => {
    abrirExterno.mockClear();
    montar();

    await userEvent.click(screen.getByRole("link", { name: "el PR" }));

    expect(abrirExterno).toHaveBeenCalledWith("https://github.com/acme/repo/pull/12");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  // Y el click en cualquier otra parte sí edita: el link es la excepción, no la
  // regla, y romper eso dejaría las notas sin forma de escribirse.
  it("el click al lado del link sí abre el editor", async () => {
    montar();

    await userEvent.click(screen.getByText(/hoy/));

    expect(await screen.findByRole("textbox")).toBeInTheDocument();
  });
});
