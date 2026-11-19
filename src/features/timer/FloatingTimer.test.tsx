/**
 * El taxímetro apilado (#19): una fila por timer que corre. Contra el `mockDb`
 * real, igual que `timerStore.parallel.test.ts`: lo que importa es que la pila
 * que se dibuja sea la que dice la base después de cada gesto.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../lib/ipc";
import { todayISO } from "../../lib/date";
import { FloatingTimer, windowHeight } from "./FloatingTimer";
import { useTimerStore } from "./timerStore";

async function newTask(title: string, estimatedMinutes = 30, scheduledDate = todayISO()) {
  const t = await api.createTask({ title, scheduledDate, estimatedMinutes });
  return t.id;
}

function reset() {
  localStorage.clear();
  useTimerStore.setState({
    actives: [],
    elapsedById: {},
    active: null,
    elapsed: 0,
    last: null,
    loaded: false,
  });
}

/** Las filas que dibuja el taxímetro, por su título. */
const rowTitles = () => screen.getAllByRole("group").map((g) => g.getAttribute("aria-label") ?? "");

const row = (title: string) => screen.getByRole("group", { name: title });

/** Deja todo lo pendiente de hoy en DONE, para controlar qué avanza. */
async function clearToday() {
  for (const t of await api.listTasksForDate(todayISO())) {
    if (t.status !== "DONE") await api.setTaskStatus(t.id, "DONE");
  }
}

describe("FloatingTimer apilado", () => {
  beforeEach(async () => {
    await api.stopAllTimers();
    await clearToday();
    reset();
  });
  afterEach(async () => {
    await api.stopAllTimers();
  });

  it("dibuja una fila por timer que corre, del más antiguo al más nuevo", async () => {
    const a = await newTask("Agente de migraciones");
    const b = await newTask("Agente de tests");
    await useTimerStore.getState().start(a);
    await useTimerStore.getState().start(b, { parallel: true });

    render(<FloatingTimer />);

    await waitFor(() => expect(rowTitles()).toEqual(["Agente de migraciones", "Agente de tests"]));
    // Una fila que corre muestra solo la pausa: ni play ni play en paralelo.
    for (const title of rowTitles()) {
      const r = within(row(title));
      expect(r.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
      expect(r.queryByRole("button", { name: "Reanudar" })).toBeNull();
    }
  });

  it("pausar una de varias la saca de la pila, sin dejarla en pausa", async () => {
    const user = userEvent.setup();
    const a = await newTask("Primera");
    const b = await newTask("Segunda");
    await useTimerStore.getState().start(a);
    await useTimerStore.getState().start(b, { parallel: true });
    render(<FloatingTimer />);
    await waitFor(() => expect(rowTitles()).toHaveLength(2));

    await user.click(within(row("Primera")).getByRole("button", { name: "Pausar" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Segunda"]));
    expect(within(row("Segunda")).getByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect((await api.getActiveTimers()).map((t) => t.taskId)).toEqual([b]);
  });

  it("pausar la última la deja en pausa, como con un solo timer", async () => {
    const user = userEvent.setup();
    const a = await newTask("Primera");
    const b = await newTask("Segunda");
    await useTimerStore.getState().start(a);
    await useTimerStore.getState().start(b, { parallel: true });
    render(<FloatingTimer />);
    await waitFor(() => expect(rowTitles()).toHaveLength(2));

    await user.click(within(row("Primera")).getByRole("button", { name: "Pausar" }));
    await waitFor(() => expect(rowTitles()).toEqual(["Segunda"]));
    await user.click(within(row("Segunda")).getByRole("button", { name: "Pausar" }));

    await waitFor(() =>
      expect(within(row("Segunda")).getByRole("button", { name: "Reanudar" })).toBeInTheDocument(),
    );
    expect(rowTitles()).toEqual(["Segunda"]);
  });

  it("completar una de varias la saca sin adelantar la siguiente", async () => {
    const user = userEvent.setup();
    const a = await newTask("Primera");
    const b = await newTask("Segunda");
    // Pendiente de hoy: es la que aparecería si completar adelantara.
    await newTask("La que sigue");
    await useTimerStore.getState().start(a);
    await useTimerStore.getState().start(b, { parallel: true });
    render(<FloatingTimer />);
    await waitFor(() => expect(rowTitles()).toHaveLength(2));

    const queue = vi.spyOn(api, "focusQueue");
    await user.click(
      within(row("Primera")).getByRole("button", { name: "Completar y pasar a la siguiente" }),
    );

    await waitFor(() => expect(rowTitles()).toEqual(["Segunda"]));
    expect((await api.getTask(a))?.status).toBe("DONE");
    // La otra sigue corriendo, y la siguiente del día no apareció.
    expect(within(row("Segunda")).getByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "La que sigue" })).toBeNull();
    expect((await api.getActiveTimers()).map((t) => t.taskId)).toEqual([b]);
    // Ni siquiera por debajo: no se buscó la siguiente, y la pausada de reserva
    // sigue siendo una de la pila.
    expect(queue).not.toHaveBeenCalled();
    queue.mockRestore();
    expect(useTimerStore.getState().last?.taskId).toBe(b);
  });

  it("completar la última deja la siguiente pendiente en pausa", async () => {
    const user = userEvent.setup();
    const b = await newTask("Segunda");
    await newTask("La que sigue");
    await useTimerStore.getState().start(b);
    render(<FloatingTimer />);
    await waitFor(() => expect(rowTitles()).toEqual(["Segunda"]));

    await user.click(
      within(row("Segunda")).getByRole("button", { name: "Completar y pasar a la siguiente" }),
    );

    await waitFor(() => expect(rowTitles()).toEqual(["La que sigue"]));
    expect(
      within(row("La que sigue")).getByRole("button", { name: "Reanudar" }),
    ).toBeInTheDocument();
    expect(await api.getActiveTimers()).toEqual([]);
    expect((await api.getTask(b))?.status).toBe("DONE");
  });

  it("completar la última sin nada pendiente deja la pila vacía", async () => {
    const user = userEvent.setup();
    const b = await newTask("Única");
    await useTimerStore.getState().start(b);
    render(<FloatingTimer />);
    await waitFor(() => expect(rowTitles()).toEqual(["Única"]));

    await user.click(
      within(row("Única")).getByRole("button", { name: "Completar y pasar a la siguiente" }),
    );

    // Sin filas el taxímetro se oculta (`useSelfVisibility`); acá queda el
    // marcador vacío, que es lo que la ventana oculta tendría dentro.
    await waitFor(() => expect(rowTitles()).toEqual(["Sin tarea activa"]));
    expect(useTimerStore.getState().last).toBeNull();
  });

  it("cada fila se pone roja al pasarse de SU estimado", async () => {
    const a = await newTask("Pasada", 1);
    const b = await newTask("A tiempo", 60);
    // Dos minutos de hoy contra un estimado de uno.
    await api.setActualSeconds(a, 120);
    await useTimerStore.getState().start(a);
    await useTimerStore.getState().start(b, { parallel: true });
    render(<FloatingTimer />);
    await waitFor(() => expect(rowTitles()).toHaveLength(2));

    const actual = (title: string) => row(title).querySelector(".tax__actual");
    expect(actual("Pasada")).toHaveClass("is-over");
    expect(actual("A tiempo")).not.toHaveClass("is-over");
  });

  it("el ojo pausa y esconde toda la pila", async () => {
    const user = userEvent.setup();
    const a = await newTask("Primera");
    const b = await newTask("Segunda");
    await useTimerStore.getState().start(a);
    await useTimerStore.getState().start(b, { parallel: true });
    render(<FloatingTimer />);
    await waitFor(() => expect(rowTitles()).toHaveLength(2));

    await user.click(within(row("Segunda")).getByRole("button", { name: "Ocultar taxímetro" }));

    await waitFor(() => expect(rowTitles()).toEqual(["Sin tarea activa"]));
    expect(await api.getActiveTimers()).toEqual([]);
    expect(useTimerStore.getState().last).toBeNull();
  });
});

describe("la pila y la pausada", () => {
  beforeEach(async () => {
    await api.stopAllTimers();
    await clearToday();
    reset();
  });

  it("una pausada que salió de la pila no vuelve si la que corría se completa por otro lado", async () => {
    // A es de otro día, así que no está en la cola de hoy: si volviera, sería
    // solo porque `last` quedó apuntándola.
    const a = await newTask("Dejada a propósito", 30, "2026-01-05");
    const b = await newTask("La que corría");
    const { start } = useTimerStore.getState();
    await start(a);
    await start(b, { parallel: true });
    await useTimerStore.getState().stop(a);

    // B se completa desde una card: Rust detiene su timer y la ventana refresca.
    await api.setTaskStatus(b, "DONE");
    await useTimerStore.getState().refresh();

    expect(useTimerStore.getState().last?.taskId).not.toBe(a);
  });

  it("refresh repara una pausada que quedó fuera de la pila mientras otra corre", async () => {
    const a = await newTask("Pausada en otra ventana", 30, "2026-01-05");
    const b = await newTask("La que corre");
    await useTimerStore.getState().start(b);
    // Lo que dejaría otra ventana con el `stop` de antes: `last` en una que ya no corre.
    localStorage.setItem(
      "sunrise-last-task",
      JSON.stringify({ taskId: a, title: "x", estimatedMinutes: 30, seconds: 0 }),
    );

    await useTimerStore.getState().refresh();

    expect(useTimerStore.getState().last?.taskId).toBe(b);
  });

  it("después del ojo, un refresh de la otra ventana no resucita la pila", async () => {
    const a = await newTask("Primera");
    const b = await newTask("Segunda");
    await useTimerStore.getState().start(a);
    await useTimerStore.getState().start(b, { parallel: true });

    await useTimerStore.getState().hideAll();
    await useTimerStore.getState().refresh();

    expect(useTimerStore.getState().actives).toEqual([]);
    expect(useTimerStore.getState().last).toBeNull();
  });
});

describe("windowHeight", () => {
  it("una fila mide lo de siempre y cada fila suma su alto", () => {
    expect(windowHeight(1)).toBe(70);
    expect(windowHeight(3)).toBe(70 + 2 * 56);
  });

  it("sin filas no encoge por debajo de una", () => {
    expect(windowHeight(0)).toBe(70);
  });
});
