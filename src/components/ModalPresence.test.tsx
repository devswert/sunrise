import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ModalPresence } from "./ModalPresence";
import { Dialog } from "./Dialog";

/**
 * Un modal mínimo montado como en la app: lo abre un dato y lo cierra ponerlo en
 * `null`. Los botones de afuera hacen de "la vista de abajo".
 */
function Harness({ onClose = () => {} }: { onClose?: () => void }) {
  const [value, setValue] = useState<string | null>(null);
  return (
    <>
      <button onClick={() => setValue("uno")}>Abrir uno</button>
      <button onClick={() => setValue("dos")}>Abrir dos</button>
      <ModalPresence value={value}>
        {(v) => (
          <Dialog
            title={`Modal ${v}`}
            label="Prueba"
            actions={<Field initial={v} />}
            onClose={() => {
              onClose();
              setValue(null);
            }}
            // Enter también cierra: así un listener que quedara colgado se notaría
            // en el `preventDefault` que le hace a la tecla.
            onEnter={() => setValue(null)}
          >
            <p>Cuerpo</p>
          </Dialog>
        )}
      </ModalPresence>
    </>
  );
}

/** Estado propio, inicializado al montarse: delata si una instancia se reusó. */
function Field({ initial }: { initial: string }) {
  const [text] = useState(initial);
  return <span data-testid="field">{text}</span>;
}

const overlay = () => document.querySelector(".modal-presence");

function reducedMotion(on: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({ matches: on && q.includes("reduce"), media: q })),
  );
}

describe("ModalPresence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("al cerrar queda saliendo, con lo último que mostró, y después se desmonta", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir uno" }));
    expect(overlay()).not.toHaveClass("is-leaving");

    await userEvent.keyboard("{Escape}");

    // El dato ya es `null`, pero el modal sigue en el DOM dibujando el último:
    // es lo que deja correr `modal-out`.
    expect(overlay()).toHaveClass("is-leaving");
    expect(overlay()).toHaveAttribute("inert");
    expect(screen.getByText("Modal uno")).toBeInTheDocument();
    await waitFor(() => expect(overlay()).toBeNull());
  });

  it("mientras sale, un segundo Escape no lo vuelve a cerrar", async () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir uno" }));

    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Escape}");

    expect(overlay()).toHaveClass("is-leaving");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("mientras sale no le roba las teclas a la vista de abajo", async () => {
    // `Dialog` escucha con `capture` y `preventDefault`: colgado durante la
    // salida, se comía el Enter de lo que hubiera debajo.
    const below = vi.fn();
    render(
      <>
        <input
          aria-label="Debajo"
          onKeyDown={(e) => e.key === "Enter" && below(e.defaultPrevented)}
        />
        <Harness />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Abrir uno" }));
    await userEvent.keyboard("{Escape}");

    screen.getByLabelText("Debajo").focus();
    await userEvent.keyboard("{Enter}");

    expect(below).toHaveBeenCalledWith(false);
  });

  it("reabrir mientras sale monta un modal nuevo, sin el estado del que se iba", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir uno" }));
    await userEvent.keyboard("{Escape}");
    expect(overlay()).toHaveClass("is-leaving");

    // Saliendo, el modal no recibe el puntero: el click llega a la vista de abajo.
    await userEvent.click(screen.getByRole("button", { name: "Abrir dos" }));

    expect(overlay()).not.toHaveClass("is-leaving");
    expect(overlay()).not.toHaveAttribute("inert");
    expect(screen.getByTestId("field")).toHaveTextContent("dos");
  });

  it("con movimiento reducido se desmonta al instante", async () => {
    reducedMotion(true);
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir uno" }));

    await userEvent.keyboard("{Escape}");

    expect(overlay()).toBeNull();
  });

  it("`exitAbove` deja una copia saliendo en `body`, que se borra sola", async () => {
    let exitAbove = () => {};
    function Navigates() {
      const [open, setOpen] = useState(true);
      return (
        <>
          {open && (
            <ModalPresence value={true}>
              {(_, exit) => {
                exitAbove = exit.exitAbove;
                return (
                  <div className="modal-overlay">
                    <div role="dialog" aria-label="Detalle">
                      <button>Adentro</button>
                    </div>
                  </div>
                );
              }}
            </ModalPresence>
          )}
          <button onClick={() => setOpen(false)}>Navegar</button>
        </>
      );
    }
    render(<Navigates />);

    // Es lo que hace el play del detalle: la copia primero, después la vista que
    // monta el modal se desmonta entera.
    act(() => exitAbove());
    await userEvent.click(screen.getByRole("button", { name: "Navegar" }));

    const ghost = document.body.querySelector(":scope > .modal-presence.is-ghost");
    expect(ghost).toHaveClass("is-leaving");
    expect(ghost).toHaveAttribute("inert");
    // Fuera del árbol de accesibilidad: no es un modal que se pueda usar.
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(ghost).not.toBeInTheDocument());
  });

  it("la copia de `exitAbove` lleva lo escrito en los campos", async () => {
    let exitAbove = () => {};
    function Form() {
      const [text, setText] = useState("");
      return (
        <ModalPresence value={true}>
          {(_, exit) => {
            exitAbove = exit.exitAbove;
            return (
              <div className="modal-overlay">
                <textarea
                  aria-label="Notas"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            );
          }}
        </ModalPresence>
      );
    }
    render(<Form />);
    await userEvent.type(screen.getByLabelText("Notas"), "a medio escribir");

    act(() => exitAbove());

    const copy = document.querySelector<HTMLTextAreaElement>(".is-ghost textarea");
    expect(copy?.value).toBe("a medio escribir");
  });

  /**
   * Con el mismo `name`, la copia y el original serían un solo grupo de radios:
   * al entrar la copia marcada al documento, el navegador desmarca el original
   * justo antes de que React lo lea o lo desmonte. Por eso la copia va sin `name`.
   */
  it("la copia de `exitAbove` no le desmarca los radios al original", async () => {
    let exitAbove = () => {};
    function Choice() {
      const [level, setLevel] = useState("alta");
      return (
        <ModalPresence value={true}>
          {(_, exit) => {
            exitAbove = exit.exitAbove;
            return (
              <div className="modal-overlay">
                {["baja", "alta"].map((v) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name="nivel"
                      value={v}
                      checked={level === v}
                      onChange={() => setLevel(v)}
                    />
                    {v}
                  </label>
                ))}
              </div>
            );
          }}
        </ModalPresence>
      );
    }
    render(<Choice />);
    const original = screen.getByRole("radio", { name: "alta" });
    expect(original).toBeChecked();

    act(() => exitAbove());

    expect(original).toBeChecked();
    const copy = document.querySelectorAll<HTMLInputElement>(".is-ghost input[type=radio]");
    expect(copy[1].checked).toBe(true);
    for (const radio of copy) expect(radio).not.toHaveAttribute("name");
  });

  it("con movimiento reducido `exitAbove` no deja copia", () => {
    reducedMotion(true);
    let exitAbove = () => {};
    render(
      <ModalPresence value={true}>
        {(_, exit) => {
          exitAbove = exit.exitAbove;
          return <div className="modal-overlay" />;
        }}
      </ModalPresence>,
    );

    act(() => exitAbove());

    expect(document.querySelector(".is-ghost")).toBeNull();
  });
});
