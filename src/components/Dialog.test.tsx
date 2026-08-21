import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "./Dialog";

/**
 * Lo que se prueba acá es el teclado, que es la razón de existir del componente:
 * estaba copiado en cinco lugares y faltaba en dos.
 */
describe("Dialog", () => {
  it("Escape cierra, aunque el foco esté afuera del diálogo", async () => {
    const onClose = vi.fn();
    render(
      <>
        <button>Afuera</button>
        <Dialog title="¿Seguro?" label="Confirmar" actions={null} onClose={onClose}>
          <p>Algo</p>
        </Dialog>
      </>,
    );

    // El foco a propósito **afuera**: con un `onKeyDown` en el div del diálogo,
    // esta tecla no llegaría, y por eso la regla es `window` con capture.
    screen.getByRole("button", { name: "Afuera" }).focus();
    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("sin `onClose` no hay forma de cerrarlo con Escape ni con el click de afuera", async () => {
    // Es el diálogo a mitad de una operación irreversible: restaurando, no se
    // sale ni por accidente.
    render(
      <Dialog title="Restaurando" label="Restaurando" actions={null}>
        <p>Espera</p>
      </Dialog>,
    );

    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("alertdialog").parentElement!);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("Enter dispara lo que se le pase, y nada si no se le pasa", async () => {
    const onEnter = vi.fn();
    const { unmount } = render(
      <Dialog title="Salir" label="Salir" actions={null} onEnter={onEnter}>
        <p>Algo</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Enter}");
    expect(onEnter).toHaveBeenCalledOnce();
    unmount();

    // Sin `onEnter`, Enter no confirma: es lo que protege a la restauración de
    // que una tecla de más reemplace la base.
    const onClose = vi.fn();
    render(
      <Dialog title="Restaurar" label="Restaurar" actions={null} onClose={onClose}>
        <p>Algo</p>
      </Dialog>,
    );
    await userEvent.keyboard("{Enter}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("deja de escuchar al desmontarse", async () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Dialog title="Algo" label="Algo" actions={null} onClose={onClose}>
        <p>Algo</p>
      </Dialog>,
    );
    unmount();
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });
});
