import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Participante } from "../../lib/types";
import { Participantes } from "./Participantes";

function p(over: Partial<Participante> = {}): Participante {
  return { nombre: null, email: null, estado: null, organizador: false, ...over };
}

describe("Participantes", () => {
  it("no renderiza nada sin invitados", () => {
    // Es el caso de un calendario compartido "ocultando los detalles": el feed
    // no trae invitados, y una sección vacía con un título haría parecer que se
    // perdió el dato.
    const { container } = render(<Participantes gente={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marca a quién organiza", () => {
    render(
      <Participantes
        gente={[
          p({ nombre: "Ana Pérez", email: "ana@acme.cl", organizador: true }),
          p({ nombre: "Beto Soto", email: "beto@acme.cl", estado: "ACCEPTED" }),
        ]}
      />,
    );
    expect(screen.getByText("Ana Pérez")).toBeInTheDocument();
    expect(screen.getByText("organiza")).toBeInTheDocument();
  });

  it("distingue aceptó, rechazó y sin responder", () => {
    // "Sin responder" y "rechazó" no son lo mismo, y con solo color serían
    // indistinguibles para quien no ve bien los colores: cada estado lleva su
    // texto accesible.
    render(
      <Participantes
        gente={[
          p({ nombre: "Sí", estado: "ACCEPTED" }),
          p({ nombre: "No", estado: "DECLINED" }),
          p({ nombre: "Quizás", estado: "TENTATIVE" }),
          p({ nombre: "Nada", estado: null }),
        ]}
      />,
    );
    expect(screen.getByLabelText("Asiste")).toBeInTheDocument();
    expect(screen.getByLabelText("No asiste")).toBeInTheDocument();
    expect(screen.getByLabelText("Quizás")).toBeInTheDocument();
    expect(screen.getByLabelText("Sin responder")).toBeInTheDocument();
  });

  it("sin nombre muestra el correo", () => {
    render(<Participantes gente={[p({ email: "solo@acme.cl" })]} />);
    expect(screen.getByText("solo@acme.cl")).toBeInTheDocument();
  });

  it("no dibuja avatares ni iniciales", () => {
    // La app no tiene fotos, y unas letras en un círculo compiten con el nombre,
    // que es lo que uno viene a leer. El punto de color lleva todo el estado.
    const { container } = render(
      <Participantes gente={[p({ nombre: "Ana Pérez", estado: "ACCEPTED" })]} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("AP")).toBeNull();
  });
});
