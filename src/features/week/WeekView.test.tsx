import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekView } from "./WeekView";
import { dateLabel, isoWeekday, todayISO, weekDates } from "../../lib/date";
import { api } from "../../lib/ipc";
import { useAppStore } from "../../lib/store";
import { addToRange, ignoredEvent } from "../../test/ignoredEvents";
import { SettingKey, useSettingsStore } from "../../lib/settings";

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

  it("los días de atrás se marcan como pasados, y eso es lo único que cambia en ellos", () => {
    // La marca solo cambia cómo se ve: se apagan el encabezado y lo que ya no pide
    // nada, y una pendiente manual queda a contraste completo (eso lo prueba
    // `DayColumn.test.tsx`). **Siguen recibiendo cards**: bloquearlos sacaba algo
    // que se podía hacer navegando a la semana anterior, y una pendiente que se va
    // al backlog con la degradación del día siguiente aparece ahí con su rótulo
    // "Desde el X", no desaparece.
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
    // Agenda, backlog y trash (#11). El de objetivos de la semana llega con M3.5:
    // un icono que no hace nada al apretarlo enseña que la barra no responde.
    render(<WeekView />);
    const tira = screen.getByRole("navigation", { name: "Paneles" });
    expect(within(tira).getAllByRole("button")).toHaveLength(3);
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
    // `waitFor` y no un assert seco: el panel se queda montado mientras corre su
    // animación de salida (ver `usePresence`).
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull(),
    );

    await userEvent.click(button());
    await userEvent.click(screen.getByRole("button", { name: "Cerrar la agenda" }));
    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull(),
    );
  });

  it("Escape la cierra", async () => {
    render(<WeekView />);
    await userEvent.click(button());

    await userEvent.keyboard("{Escape}");

    await waitFor(() =>
      expect(screen.queryByRole("complementary", { name: "Agenda del día" })).toBeNull(),
    );
  });

  it("abierta, dice qué día está mostrando", async () => {
    // Montada fija en Today no hace falta —la fecha está en la cabecera—, pero
    // un panel sobre siete columnas sí tiene que nombrar su día.
    render(<WeekView />);
    await userEvent.click(button());

    const panel = screen.getByRole("complementary", { name: "Agenda del día" });
    expect(panel.querySelector(".panel-head__sub")?.textContent).toMatch(/\S/);
  });
});

/**
 * El panel de backlog es el primero de la tira que participa del DnD. El
 * arrastre en sí **no se prueba acá** —jsdom no devuelve rectángulos, así que un
 * assert sobre el drop pasaría o fallaría por el motivo equivocado—: la decisión
 * vive en `destino.ts` y el desempate de la colisión en `collision.test.ts`. Lo
 * que se fija acá es el interruptor y su convivencia con la agenda.
 */
describe("WeekView · panel de backlog", () => {
  const backlogButton = () => screen.getByRole("button", { name: /^Backlog$/ });
  const agendaButton = () => screen.getByRole("button", { name: /Agenda/ });
  const panel = () => screen.queryByRole("complementary", { name: "Backlog" });
  const agenda = () => screen.queryByRole("complementary", { name: "Agenda del día" });

  it("arranca cerrado y se abre con su botón", async () => {
    render(<WeekView />);
    expect(backlogButton()).toHaveAttribute("aria-pressed", "false");
    expect(panel()).toBeNull();

    await userEvent.click(backlogButton());

    expect(backlogButton()).toHaveAttribute("aria-pressed", "true");
    expect(panel()).toBeInTheDocument();
  });

  it("abrir uno cierra el otro: los dos se montan en el mismo lugar", async () => {
    render(<WeekView />);

    await userEvent.click(agendaButton());
    expect(agenda()).toBeInTheDocument();

    await userEvent.click(backlogButton());
    expect(panel()).toBeInTheDocument();
    // El que se va sigue montado mientras dura su salida, así que se espera.
    await waitFor(() => expect(agenda()).toBeNull());

    await userEvent.click(agendaButton());
    expect(agenda()).toBeInTheDocument();
    await waitFor(() => expect(panel()).toBeNull());
  });

  it("el mismo botón lo cierra, y también el aspa del panel", async () => {
    render(<WeekView />);

    await userEvent.click(backlogButton());
    await userEvent.click(backlogButton());
    await waitFor(() => expect(panel()).toBeNull());

    await userEvent.click(backlogButton());
    await userEvent.click(screen.getByRole("button", { name: "Cerrar backlog" }));
    await waitFor(() => expect(panel()).toBeNull());
  });

  it("Escape lo cierra", async () => {
    render(<WeekView />);
    await userEvent.click(backlogButton());

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(panel()).toBeNull());
  });

  it("clickear la cabecera de un día trae la agenda, aunque esté el backlog", async () => {
    // El click en la cabecera es un pedido de ver ese día; dejarlo sin efecto
    // visible por tener el backlog abierto sería peor que el cambio de panel.
    render(<WeekView />);
    await userEvent.click(backlogButton());

    const dayHeader = document.querySelector<HTMLElement>(".day-col__head button");
    if (dayHeader) {
      await userEvent.click(dayHeader);
      expect(agenda()).toBeInTheDocument();
      await waitFor(() => expect(panel()).toBeNull());
    }
  });

  /**
   * El panel entraba animado y desaparecía de golpe, que se siente como si se
   * hubiera roto y no como si se hubiera cerrado. Lo que se fija acá es que **no
   * se desmonta en el mismo frame** en que se cierra: la animación necesita que
   * el nodo siga existiendo, y esa es toda la razón de `usePresence`.
   */
  it("al cerrarse se queda un momento marcado como saliendo, y recién después se va", async () => {
    render(<WeekView />);
    await userEvent.click(backlogButton());
    await userEvent.click(screen.getByRole("button", { name: "Cerrar backlog" }));

    // Todavía en el DOM, ya marcado: es lo que dispara `panel-out`.
    expect(panel()).toHaveClass("is-leaving");
    await waitFor(() => expect(panel()).toBeNull());
  });

  it("no contamina el conteo de columnas del board", async () => {
    // El panel **no** reusa `.day-col`: con esa clase encima entraría en la
    // consulta que cuenta las 21 columnas y `dataset.date` saldría undefined.
    render(<WeekView />);
    await userEvent.click(backlogButton());

    expect(document.querySelectorAll(".day-col")).toHaveLength(21);
  });
});

/**
 * #8: cada columna mide contra **su** capacidad —la jornada menos los eventos
 * ignorados de ese día—, no contra un número fijo. El badge de carga lleva en el
 * `title` contra qué se pinta.
 *
 * El evento ignorado es propio (`addToRange`), no uno de la semilla. Lo que sí
 * toca estado del mock —una tarea de carga y la jornada— lo devuelve el
 * `afterEach`, así que los casos no dependen del orden.
 */
describe("WeekView · la capacidad de cada día", () => {
  let created: number[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const id of created) await api.trashTask(id);
    created = [];
    await useSettingsStore.getState().set(SettingKey.WORK_START, "09:00");
    await useSettingsStore.getState().set(SettingKey.WORK_END, "18:00");
  });

  /**
   * Dos días hábiles **futuros** a la vista: nunca van plegados, y la
   * degradación no se lleva su tarea al backlog (pasaría con un día pasado si el
   * caso corre solo, con `-t`, y es el primero en montar la vista).
   */
  function twoWorkdays(): [string, string] {
    const next = new Date();
    next.setDate(next.getDate() + 7);
    const [a, b] = [...weekDates(new Date()), ...weekDates(next)].filter(
      (d) => d > todayISO() && isoWeekday(d) <= 5,
    );
    return [a, b];
  }

  const cap = (date: string) =>
    document.querySelector<HTMLElement>(`.day-col[data-date="${date}"] .day-col__cap`);

  async function withLoad(date: string) {
    const t = await api.createTask({
      title: "Carga de prueba",
      scheduledDate: date,
      estimatedMinutes: 60,
    });
    created.push(t.id);
  }

  it("un día con un evento ignorado y otro sin él miden contra números distintos", async () => {
    const [conAlmuerzo, sinAlmuerzo] = twoWorkdays();
    await withLoad(conAlmuerzo);
    await withLoad(sinAlmuerzo);
    // Un almuerzo de 13:00 a 14:15, ignorado: 9 h − 1 h 15 = 7:45.
    const almuerzo = ignoredEvent(conAlmuerzo, "13:00", 75);
    addToRange(() => [almuerzo]);
    render(<WeekView />);

    await waitFor(() => expect(cap(conAlmuerzo)?.title).toMatch(/ de 7:45$/));
    // Sin ignorados, la jornada completa: 09–18 son 9 horas.
    expect(cap(sinAlmuerzo)?.title).toMatch(/ de 9:00$/);
  });

  it("marcar y desmarcar el evento cambia la capacidad sin recargar la vista", async () => {
    const [dia] = twoWorkdays();
    await withLoad(dia);
    let ignorado = false;
    const reunion = () => ignoredEvent(dia, "10:00", 60, { railOnly: ignorado });
    addToRange(() => [reunion()]);
    render(<WeekView />);
    await waitFor(() => expect(cap(dia)?.title).toMatch(/ de 9:00$/));

    ignorado = true;
    act(() => useAppStore.getState().bumpData());
    await waitFor(() => expect(cap(dia)?.title).toMatch(/ de 8:00$/));

    ignorado = false;
    act(() => useAppStore.getState().bumpData());
    await waitFor(() => expect(cap(dia)?.title).toMatch(/ de 9:00$/));
  });

  it("un ignorado que cubre la jornada deja la columna en OK y sin contra qué pintarse", async () => {
    const [dia] = twoWorkdays();
    // 11 h de carga: contra cualquier capacidad positiva sería OVER, así que si
    // queda en OK es porque la capacidad es 0 y el semáforo se apagó.
    await withLoad(dia);
    const t = await api.createTask({
      title: "Más carga",
      scheduledDate: dia,
      estimatedMinutes: 600,
    });
    created.push(t.id);
    addToRange(() => [ignoredEvent(dia, "09:00", 540)]);
    render(<WeekView />);

    await waitFor(() => expect(cap(dia)).not.toBeNull());
    // Capacidad 0 ⇒ el semáforo se apaga (OK, gris) y el badge no tiene `title`.
    await waitFor(() => expect(cap(dia)!.hasAttribute("title")).toBe(false));
    expect(cap(dia)).toHaveClass("cap--ok");
    expect(cap(dia)).not.toHaveClass("cap--over");
  });

  it("cambiar la jornada repinta todas las columnas", async () => {
    const [a, b] = twoWorkdays();
    await withLoad(a);
    await withLoad(b);
    render(<WeekView />);
    await waitFor(() => expect(cap(a)?.title).toMatch(/ de 9:00$/));

    await act(async () => {
      await useSettingsStore.getState().set(SettingKey.WORK_END, "17:30");
    });

    await waitFor(() => expect(cap(a)?.title).toMatch(/ de 8:30$/));
    expect(cap(b)?.title).toMatch(/ de 8:30$/);
  });
});
