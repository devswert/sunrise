import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekView } from "./WeekView";
import { dateLabel, isoWeekday, todayISO, weekDates } from "../../lib/date";

/**
 * La ventana del board: tres semanas con scroll horizontal, la del ancla al
 * medio. El scroll en sí **no se testea acá** —jsdom no implementa `scrollLeft`
 * ni devuelve rectángulos, así que un assert sobre la posición pasaría o
 * fallaría por el motivo equivocado—: se verifica en el browser.
 */
describe("WeekView · la ventana de tres semanas", () => {
  const columns = () => Array.from(document.querySelectorAll<HTMLElement>(".day-col"));

  it("dibuja 21 columnas, en orden y sin repetir", () => {
    render(<WeekView />);
    const dates = columns().map((c) => c.dataset.date!);

    expect(dates).toHaveLength(21);
    expect(new Set(dates).size).toBe(21);
    expect([...dates].sort()).toEqual(dates);
    // La semana del ancla —hoy— queda al medio, no al borde izquierdo.
    expect(dates.slice(7, 14)).toEqual(weekDates(new Date()));
  });

  it("cada semana lleva su propio rótulo, con su rango y su número", () => {
    // Un solo rótulo arriba nombraría una semana que puede no estar en pantalla.
    // Son tres, y el del medio es el del ancla.
    render(<WeekView />);
    const labels = [...document.querySelectorAll(".board__wk-head")].map((h) => h.textContent!);
    const week = weekDates(new Date());

    expect(labels).toHaveLength(3);
    expect(labels[1]).toContain(dateLabel(week[0]));
    expect(labels[1]).toContain(dateLabel(week[6]));
    // Y los tres números son distintos y consecutivos.
    const numbers = labels.map((r) => Number(/Semana (\d+)/.exec(r)![1]));
    expect(numbers[1] - numbers[0]).toBe(1);
    expect(numbers[2] - numbers[1]).toBe(1);
  });

  it("los días del ajuste van plegados, salvo hoy", () => {
    // El default son sábado y domingo (migración 9, espejada en el mock).
    render(<WeekView />);
    const today = todayISO();

    for (const col of columns()) {
      const d = col.dataset.date!;
      const shouldFold = [6, 7].includes(isoWeekday(d)) && d !== today;
      expect(col.classList.contains("day-col--collapsed"), d).toBe(shouldFold);
    }
  });

  it("una columna plegada se abre y se vuelve a plegar con su botón", async () => {
    // Abrir es la salida para un fin de semana que sí tiene tareas: sin eso,
    // plegarlo sería esconderlas sin manera de llegar a ellas desde acá. Y la
    // vuelta atrás tiene que estar, o el día queda abierto hasta recargar.
    render(<WeekView />);
    const folded = columns().find((c) => c.classList.contains("day-col--collapsed"))!;
    const date = folded.dataset.date!;
    const column = () => columns().find((c) => c.dataset.date === date)!;

    await userEvent.click(within(folded).getByRole("button"));
    expect(column().classList.contains("day-col--collapsed")).toBe(false);

    await userEvent.click(within(column()).getByRole("button", { name: /^Plegar / }));
    expect(column().classList.contains("day-col--collapsed")).toBe(true);
  });

  it("el botón de plegar existe SOLO en un día plegable abierto a mano", async () => {
    // En un día normal no hay nada que plegar: plegar es del ajuste, no de la
    // columna, y un botón que aparece en las siete prometería otra cosa.
    render(<WeekView />);
    expect(screen.queryByRole("button", { name: /^Plegar / })).toBeNull();

    const folded = columns().find((c) => c.classList.contains("day-col--collapsed"))!;
    await userEvent.click(within(folded).getByRole("button"));

    // Uno solo: el que se abrió, no todos los sábados de la ventana.
    expect(screen.getAllByRole("button", { name: /^Plegar / })).toHaveLength(1);
  });

  it("los días de atrás quedan apagados, y eso es lo único que cambia en ellos", () => {
    // Atenuados como información —el pasado es pasado—, pero **siguen recibiendo
    // cards**: bloquearlos sacaba algo que se podía hacer navegando a la semana
    // anterior, y una pendiente que se va al backlog con la degradación del día
    // siguiente aparece ahí con su rótulo "Desde el X", no desaparece.
    render(<WeekView />);
    const today = todayISO();

    for (const col of columns()) {
      const isPast = col.dataset.date! < today;
      expect(col.classList.contains("is-past"), col.dataset.date).toBe(isPast);
    }
  });
});

/**
 * La agenda de la semana es un panel que se pide: el espacio es de las tareas.
 * Lo que se testea acá es el interruptor, no el contenido del rail — eso vive en
 * `railLayout.test.ts` y `CalendarRail.test.tsx`.
 */
describe("WeekView · agenda superpuesta", () => {
  const button = () => screen.getByRole("button", { name: /Agenda/ });

  it("la tira de la derecha solo trae los paneles que existen", () => {
    // Objetivos y backlog llegan con sus milestones. Un icono que no hace nada
    // al apretarlo enseña que la barra no responde.
    render(<WeekView />);
    const tira = screen.getByRole("navigation", { name: "Paneles" });
    expect(within(tira).getAllByRole("button")).toHaveLength(1);
  });

  it("arranca cerrada y se abre con el botón", async () => {
    render(<WeekView />);
    expect(button()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull();

    await userEvent.click(button());

    expect(button()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("complementary", { name: "Agenda del día" })).toBeInTheDocument();
  });

  it("el mismo botón la cierra, y también el aspa del panel", async () => {
    render(<WeekView />);

    await userEvent.click(button());
    await userEvent.click(button());
    expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull();

    await userEvent.click(button());
    await userEvent.click(screen.getByRole("button", { name: "Cerrar la agenda" }));
    expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull();
  });

  it("Escape la cierra", async () => {
    render(<WeekView />);
    await userEvent.click(button());

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull();
  });

  it("abierta, dice qué día está mostrando", async () => {
    // Montada fija en Today no hace falta —la fecha está en la cabecera—, pero
    // un panel sobre siete columnas sí tiene que nombrar su día.
    render(<WeekView />);
    await userEvent.click(button());

    const panel = screen.getByRole("complementary", { name: "Agenda del día" });
    expect(panel.querySelector(".rail__head-dia")?.textContent).toMatch(/\S/);
  });
});
