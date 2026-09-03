import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UpdateError } from "./UpdateError";
import { errorText, useUpdateStore } from "./updateStore";

const disponible = { version: "0.9.0", currentVersion: "0.8.0", notes: null, date: null };

function abrir(error: string) {
  useUpdateStore.setState({ available: disponible, error, errorOpen: true });
}

describe("UpdateError · el detalle de un update que falló", () => {
  beforeEach(() => {
    useUpdateStore.setState({ available: null, error: null, errorOpen: false });
  });
  afterEach(() => vi.restoreAllMocks());

  it("no se abre solo", () => {
    useUpdateStore.setState({ error: "algo", errorOpen: false });
    const { container } = render(<UpdateError />);
    expect(container).toBeEmptyDOMElement();
  });

  /**
   * **El mensaje crudo, sin interpretar.** Es lo único que distingue un permiso de
   * escritura de un proxy corporativo, y traducirlo a "algo salió mal" borraría
   * justo el dato por el que existe este modal.
   */
  it("muestra el mensaje del updater tal cual", () => {
    abrir("Permission denied (os error 13)");
    render(<UpdateError />);
    expect(screen.getByText("Permission denied (os error 13)")).toBeInTheDocument();
  });

  // Sin telemetría, copiar y pegar es el canal. Por eso el detalle no es solo el
  // mensaje: sin las versiones no se sabe si el problema es de esa máquina.
  it("copia el mensaje junto con las versiones y el sistema", async () => {
    const writeText = vi.fn(async (_texto: string) => {});
    Object.assign(navigator, { clipboard: { writeText } });
    abrir("no route to host");
    render(<UpdateError />);

    await userEvent.click(screen.getByRole("button", { name: /Copiar detalle/ }));

    const copiado = writeText.mock.calls[0][0];
    expect(copiado).toContain("no route to host");
    expect(copiado).toContain("0.8.0");
    expect(copiado).toContain("0.9.0");
    expect(await screen.findByRole("button", { name: /Copiado/ })).toBeInTheDocument();
  });

  // Sin portapapeles el modal sigue sirviendo: el texto está en pantalla y se
  // puede seleccionar. Lo que no puede es romperse.
  it("si el portapapeles falla, no revienta", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("denied");
        }),
      },
    });
    abrir("no route to host");
    render(<UpdateError />);

    await userEvent.click(screen.getByRole("button", { name: /Copiar detalle/ }));

    expect(screen.getByText("no route to host")).toBeInTheDocument();
  });

  it("reintentar limpia el error y cierra", async () => {
    abrir("no route to host");
    render(<UpdateError />);

    await userEvent.click(screen.getByRole("button", { name: /Volver a intentarlo/ }));

    expect(useUpdateStore.getState().error).toBeNull();
    expect(useUpdateStore.getState().errorOpen).toBe(false);
  });
});

/**
 * `String(err)` alcanza para el camino normal —`invoke` rechaza con el `String`
 * que devolvió Rust— pero un objeto plano se convertía en `"[object Object]"`. Sin
 * telemetría, eso es todo lo que vuelve de la máquina de otra persona: un reporte
 * inútil que se ve igual que uno bueno hasta que lo abrís.
 */
describe("errorText · el texto que se copia, venga como venga", () => {
  it("un string de Rust pasa tal cual, con su cadena de causas", () => {
    const rust =
      "Io error → failed to move the new app into place → Permission denied (os error 13)";
    expect(errorText(rust)).toBe(rust);
  });

  it("un Error se queda con su mensaje y no con el «Error:» de adelante", () => {
    expect(errorText(new Error("no route to host"))).toBe("no route to host");
  });

  // El que motivó la función.
  it("un objeto plano no se convierte en «[object Object]»", () => {
    const texto = errorText({ kind: "Io", message: "denied" });
    expect(texto).not.toContain("[object Object]");
    expect(texto).toContain("denied");
  });

  it("una referencia circular no revienta", () => {
    const raro: Record<string, unknown> = {};
    raro.yo = raro;
    expect(() => errorText(raro)).not.toThrow();
  });
});
