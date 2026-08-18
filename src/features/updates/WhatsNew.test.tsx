import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WhatsNew } from "./WhatsNew";
import { useUpdateStore } from "./updateStore";

describe("WhatsNew", () => {
  beforeEach(() => {
    useUpdateStore.setState({ updatedTo: null, bannerVisible: false, whatsNewOpen: false });
  });

  /**
   * **No se abre solo**, y eso es la decisión, no un detalle: el aviso vive en el
   * sidebar y tú decides si lo lees. Un modal encima de la app al arrancar es la
   * interrupción que §4.21 descartó.
   */
  it("no aparece por tener una versión nueva: hay que abrirlo", () => {
    useUpdateStore.setState({ updatedTo: "0.1.0" });
    render(<WhatsNew />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("abierto, muestra el anuncio del changelog y no el detalle", async () => {
    useUpdateStore.setState({ updatedTo: "0.1.0", whatsNewOpen: true });
    render(<WhatsNew />);

    const dlg = screen.getByRole("alertdialog", { name: "Lo nuevo en la 0.1.0" });
    expect(dlg).toHaveTextContent(/primera versión que se puede instalar/i);
    // El detalle con las referencias se queda en el changelog.
    expect(dlg).not.toHaveTextContent(/Detalle/);

    await userEvent.click(screen.getByRole("button", { name: "Entendido" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("una versión sin entrada en el changelog no abre un modal vacío", () => {
    useUpdateStore.setState({ updatedTo: "9.9.9", whatsNewOpen: true });
    render(<WhatsNew />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
