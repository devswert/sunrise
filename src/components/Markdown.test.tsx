import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const abrirExterno = vi.fn(async () => {});
vi.mock("../features/calendar/MeetingLink", () => ({
  abrirExterno: (...a: unknown[]) => abrirExterno(...(a as [])),
}));

const { Markdown } = await import("./Markdown");

/**
 * **El bug que este componente evita se ve una sola vez y no se olvida**: un
 * `<a href>` dentro del webview navega la propia ventana de la app. sunrise se
 * convierte en una pestaña de Google, sin barra de direcciones y sin forma de
 * volver. No es un link que no funciona: es la app que desaparece.
 */
describe("Markdown · los links salen al navegador, no se llevan la ventana", () => {
  it("el click no navega y lo abre afuera", async () => {
    abrirExterno.mockClear();
    render(<Markdown>{"Mira [el PR](https://github.com/acme/repo/pull/12)"}</Markdown>);

    await userEvent.click(screen.getByRole("link", { name: "el PR" }));

    expect(abrirExterno).toHaveBeenCalledWith("https://github.com/acme/repo/pull/12");
  });

  // Se conserva el `href` aunque el click esté interceptado: el menú contextual y
  // "copiar dirección" siguen sirviendo, y un lector de pantalla lo anuncia como
  // link y no como un texto cualquiera.
  it("sigue siendo un link de verdad", () => {
    render(<Markdown>{"Mira [el PR](https://github.com/acme/repo/pull/12)"}</Markdown>);
    expect(screen.getByRole("link", { name: "el PR" })).toHaveAttribute(
      "href",
      "https://github.com/acme/repo/pull/12",
    );
  });

  /**
   * En las notas del detalle, el contenedor abre el editor al click. Sin el
   * `stopPropagation`, entrar a un link dejaba además el markdown en modo edición
   * — o sea que volvías del navegador a un textarea abierto.
   */
  it("no dispara el click del contenedor", async () => {
    const alContenedor = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: es el contenedor de la
      // prueba, que imita el `div` clickeable de las notas.
      <div onClick={alContenedor}>
        <Markdown>{"[link](https://x.example)"}</Markdown>
      </div>,
    );

    await userEvent.click(screen.getByRole("link", { name: "link" }));

    expect(alContenedor).not.toHaveBeenCalled();
  });

  it("las tablas de GFM se siguen dibujando", () => {
    render(<Markdown>{"| a | b |\n| - | - |\n| 1 | 2 |"}</Markdown>);
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
});
