import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeetingLink } from "./MeetingLink";

vi.mock("../../lib/ipc", () => ({ isTauri: () => false, api: {} }));

describe("MeetingLink", () => {
  beforeEach(() => {
    vi.stubGlobal("open", vi.fn());
  });

  it("no renderiza nada si la tarea no tiene reunión", () => {
    const { container } = render(<MeetingLink url={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("dice a qué servicio lleva", () => {
    // "Entrar a la reunión" a secas no dice si abre Meet o Zoom, y eso importa
    // cuando tienes las dos cosas en el mismo día.
    render(<MeetingLink url="https://meet.google.com/abc-defg-hij" />);
    expect(screen.getByRole("button", { name: /Entrar a Google Meet/ })).toBeInTheDocument();
  });

  it("reconoce Zoom y Teams", () => {
    const { unmount } = render(<MeetingLink url="https://acme.zoom.us/j/123" />);
    expect(screen.getByRole("button", { name: /Entrar a Zoom/ })).toBeInTheDocument();
    unmount();
    render(<MeetingLink url="https://teams.microsoft.com/l/meetup-join/x" />);
    expect(screen.getByRole("button", { name: /Entrar a Teams/ })).toBeInTheDocument();
  });

  it("es un button y no un link", () => {
    // Dentro del webview un `<a target=\"_blank\">` no navega a ninguna parte: el
    // click se traga sin error. Un link que no lleva a nada es peor que un botón.
    render(<MeetingLink url="https://meet.google.com/abc" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("abre la URL al hacer click", async () => {
    const user = userEvent.setup();
    render(<MeetingLink url="https://meet.google.com/abc-defg-hij" />);

    await user.click(screen.getByRole("button"));

    expect(window.open).toHaveBeenCalledWith(
      "https://meet.google.com/abc-defg-hij",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("entrar a la reunión no dispara el click de la tarjeta que lo contiene", async () => {
    // El botón vive dentro del modal y de la card: sin `stopPropagation`,
    // unirse a la reunión abriría además el detalle.
    const alPadre = vi.fn();
    const user = userEvent.setup();
    render(
      <div onClick={alPadre}>
        <MeetingLink url="https://meet.google.com/abc" />
      </div>,
    );

    await user.click(screen.getByRole("button"));

    expect(alPadre).not.toHaveBeenCalled();
  });

  it("muestra el código de la sala, que es lo que uno dicta por teléfono", () => {
    render(<MeetingLink url="https://meet.google.com/pfk-togr-qwo" />);
    expect(screen.getByText(/pfk-togr-qwo/)).toBeInTheDocument();
  });

  it("no muestra como sala un token larguísimo", () => {
    const largo = "https://acme.zoom.us/j/" + "a".repeat(40);
    render(<MeetingLink url={largo} />);
    expect(screen.queryByText(/Sala:/)).toBeNull();
  });
});
