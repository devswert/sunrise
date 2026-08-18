import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Attendee } from "../../lib/types";
import { AttendeeList } from "./Participantes";

function p(over: Partial<Attendee> = {}): Attendee {
  return { name: null, email: null, status: null, isOrganizer: false, ...over };
}

describe("Participantes", () => {
  it("no renderiza nada sin invitados", () => {
    // Es el caso de un calendario compartido "ocultando los detalles": el feed
    // no trae invitados, y una sección vacía con un título haría parecer que se
    // perdió el dato.
    const { container } = render(<AttendeeList gente={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("marca a quién organiza", () => {
    render(
      <AttendeeList
        gente={[
          p({ name: "Ana Pérez", email: "ana@acme.cl", isOrganizer: true }),
          p({ name: "Beto Soto", email: "beto@acme.cl", status: "ACCEPTED" }),
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
      <AttendeeList
        gente={[
          p({ name: "Sí", status: "ACCEPTED" }),
          p({ name: "No", status: "DECLINED" }),
          p({ name: "Quizás", status: "TENTATIVE" }),
          p({ name: "Nada", status: null }),
        ]}
      />,
    );
    expect(screen.getByLabelText("Asiste")).toBeInTheDocument();
    expect(screen.getByLabelText("No asiste")).toBeInTheDocument();
    expect(screen.getByLabelText("Quizás")).toBeInTheDocument();
    expect(screen.getByLabelText("Sin responder")).toBeInTheDocument();
  });

  it("sin nombre muestra el correo", () => {
    render(<AttendeeList gente={[p({ email: "solo@acme.cl" })]} />);
    expect(screen.getByText("solo@acme.cl")).toBeInTheDocument();
  });

  it("no dibuja avatares ni iniciales", () => {
    // La app no tiene fotos, y unas letras en un círculo compiten con el nombre,
    // que es lo que uno viene a leer. El punto de color lleva todo el estado.
    const { container } = render(
      <AttendeeList gente={[p({ name: "Ana Pérez", status: "ACCEPTED" })]} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByText("AP")).toBeNull();
  });
});
