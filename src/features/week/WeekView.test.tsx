import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekView } from "./WeekView";

/**
 * La agenda de la semana es un panel que se pide: son siete columnas y el
 * espacio es de las tareas. Lo que se testea acá es el interruptor, no el
 * contenido del rail — eso vive en `railLayout.test.ts` y `CalendarRail.test.tsx`.
 */
describe("WeekView · agenda superpuesta", () => {
  const boton = () => screen.getByRole("button", { name: /Agenda/ });

  it("la tira de la derecha solo trae los paneles que existen", () => {
    // Objetivos y backlog llegan con sus milestones. Un icono que no hace nada
    // al apretarlo enseña que la barra no responde.
    render(<WeekView />);
    const tira = screen.getByRole("navigation", { name: "Paneles" });
    expect(within(tira).getAllByRole("button")).toHaveLength(1);
  });

  it("arranca cerrada y se abre con el botón", async () => {
    render(<WeekView />);
    expect(boton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull();

    await userEvent.click(boton());

    expect(boton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("complementary", { name: "Agenda del día" })).toBeInTheDocument();
  });

  it("el mismo botón la cierra, y también el aspa del panel", async () => {
    render(<WeekView />);

    await userEvent.click(boton());
    await userEvent.click(boton());
    expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull();

    await userEvent.click(boton());
    await userEvent.click(screen.getByRole("button", { name: "Cerrar la agenda" }));
    expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull();
  });

  it("Escape la cierra", async () => {
    render(<WeekView />);
    await userEvent.click(boton());

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull();
  });

  it("abierta, dice qué día está mostrando", async () => {
    // Montada fija en Today no hace falta —la fecha está en la cabecera—, pero
    // un panel sobre siete columnas sí tiene que nombrar su día.
    render(<WeekView />);
    await userEvent.click(boton());

    const panel = screen.getByRole("complementary", { name: "Agenda del día" });
    expect(panel.querySelector(".rail__head-dia")?.textContent).toMatch(/\S/);
  });
});
