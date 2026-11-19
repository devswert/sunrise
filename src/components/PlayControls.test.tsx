/**
 * `PlayControls` contra el store y el `mockDb` reales: lo que hay que probar es
 * que el clásico pause a las demás y el paralelo no, y eso lo decide el gemelo de
 * `repo.rs`, no el componente. Un doble del store estaría de acuerdo con todo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "../lib/ipc";
import { todayISO } from "../lib/date";
import { useTimerStore } from "../features/timer/timerStore";
import { PlayControls } from "./PlayControls";

async function newTask(title: string): Promise<number> {
  const t = await api.createTask({ title, scheduledDate: todayISO() });
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

const runningIds = async () => (await api.getActiveTimers()).map((t) => t.taskId);

/** Dos controles, cada uno en su región con nombre para buscar dentro. */
function renderTwo(a: number, b: number) {
  render(
    <>
      <section aria-label="A">
        <PlayControls taskId={a} />
      </section>
      <section aria-label="B">
        <PlayControls taskId={b} />
      </section>
    </>,
  );
  return {
    a: within(screen.getByRole("region", { name: "A" })),
    b: within(screen.getByRole("region", { name: "B" })),
  };
}

describe("PlayControls", () => {
  beforeEach(async () => {
    await api.stopAllTimers();
    reset();
  });
  afterEach(async () => {
    await api.stopAllTimers();
  });

  it("detenida muestra el play y el play en paralelo, sin pausa", async () => {
    const a = await newTask("una");
    render(<PlayControls taskId={a} />);
    expect(screen.getByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    const paralelo = screen.getByRole("button", { name: "Iniciar en paralelo" });
    expect(paralelo).toHaveAttribute("title", "Iniciar en paralelo");
    expect(screen.queryByRole("button", { name: "Pausar" })).toBeNull();
  });

  it("corriendo muestra solo la pausa, y pausar la detiene", async () => {
    const user = userEvent.setup();
    const a = await newTask("una");
    render(<PlayControls taskId={a} />);

    await user.click(screen.getByRole("button", { name: "Iniciar" }));
    expect(await screen.findByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Iniciar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar en paralelo" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Pausar" }));
    expect(await screen.findByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    expect(await runningIds()).toEqual([]);
  });

  it("el play en paralelo no pausa la otra tarea", async () => {
    const user = userEvent.setup();
    const a = await newTask("agente 1");
    const b = await newTask("agente 2");
    const { a: ra, b: rb } = renderTwo(a, b);

    await user.click(ra.getByRole("button", { name: "Iniciar" }));
    await ra.findByRole("button", { name: "Pausar" });
    await user.click(rb.getByRole("button", { name: "Iniciar en paralelo" }));

    expect(await rb.findByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(ra.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(await runningIds()).toEqual([a, b]);
  });

  it("el play clásico pausa todas las que corrían", async () => {
    const user = userEvent.setup();
    const a = await newTask("agente 1");
    const b = await newTask("agente 2");
    const c = await newTask("reunión");
    render(
      <div>
        {[a, b, c].map((id, i) => (
          <section key={id} aria-label={"ABC"[i]}>
            <PlayControls taskId={id} />
          </section>
        ))}
      </div>,
    );
    const r = (n: string) => within(screen.getByRole("region", { name: n }));

    await user.click(r("A").getByRole("button", { name: "Iniciar" }));
    await r("A").findByRole("button", { name: "Pausar" });
    await user.click(r("B").getByRole("button", { name: "Iniciar en paralelo" }));
    await r("B").findByRole("button", { name: "Pausar" });
    await user.click(r("C").getByRole("button", { name: "Iniciar" }));

    await r("C").findByRole("button", { name: "Pausar" });
    expect(await r("A").findByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    expect(await r("B").findByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    expect(await runningIds()).toEqual([c]);
  });

  it("un doble click abre un solo timer", async () => {
    const a = await newTask("una");
    const spy = vi.spyOn(api, "startTimer");
    try {
      render(<PlayControls taskId={a} />);
      const btn = screen.getByRole("button", { name: "Iniciar en paralelo" });
      fireEvent.click(btn);
      fireEvent.click(btn);
      await screen.findByRole("button", { name: "Pausar" });
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("el pointerdown no llega a la card (no arranca el arrastre)", async () => {
    const a = await newTask("una");
    const onPointerDown = vi.fn();
    render(
      <div onPointerDown={onPointerDown}>
        <PlayControls taskId={a} />
      </div>,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Iniciar en paralelo" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "Iniciar" }));
    expect(onPointerDown).not.toHaveBeenCalled();
  });

  it("el play clásico pausa la que corría", async () => {
    const user = userEvent.setup();
    const a = await newTask("reunión");
    const b = await newTask("código");
    const { a: ra, b: rb } = renderTwo(a, b);

    await user.click(ra.getByRole("button", { name: "Iniciar" }));
    await ra.findByRole("button", { name: "Pausar" });
    await user.click(rb.getByRole("button", { name: "Iniciar" }));

    await rb.findByRole("button", { name: "Pausar" });
    expect(await ra.findByRole("button", { name: "Iniciar" })).toBeInTheDocument();
    expect(await runningIds()).toEqual([b]);
  });

  it("pausar una de dos deja la otra corriendo", async () => {
    const user = userEvent.setup();
    const a = await newTask("agente 1");
    const b = await newTask("agente 2");
    const { a: ra, b: rb } = renderTwo(a, b);

    await user.click(ra.getByRole("button", { name: "Iniciar" }));
    await ra.findByRole("button", { name: "Pausar" });
    await user.click(rb.getByRole("button", { name: "Iniciar en paralelo" }));
    await rb.findByRole("button", { name: "Pausar" });

    await user.click(ra.getByRole("button", { name: "Pausar" }));
    await ra.findByRole("button", { name: "Iniciar" });
    expect(rb.getByRole("button", { name: "Pausar" })).toBeInTheDocument();
    expect(await runningIds()).toEqual([b]);
  });

  it("onStart dice con qué play se arrancó, y la pausa no lo llama", async () => {
    const user = userEvent.setup();
    const a = await newTask("una");
    const onStart = vi.fn();
    render(<PlayControls taskId={a} onStart={onStart} />);

    await user.click(screen.getByRole("button", { name: "Iniciar en paralelo" }));
    await waitFor(() => expect(onStart).toHaveBeenCalledWith(true));
    await user.click(await screen.findByRole("button", { name: "Pausar" }));
    await user.click(await screen.findByRole("button", { name: "Iniciar" }));
    await waitFor(() => expect(onStart).toHaveBeenLastCalledWith(false));
    expect(onStart).toHaveBeenCalledTimes(2);
  });

  it("el click no llega a la card que lo contiene", async () => {
    const user = userEvent.setup();
    const a = await newTask("una");
    const onCardClick = vi.fn();
    render(
      // biome-ignore lint/a11y/useKeyWithClickEvents: es el doble de la card
      // biome-ignore lint/a11y/noStaticElementInteractions: es el doble de la card
      <div onClick={onCardClick}>
        <PlayControls taskId={a} />
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "Iniciar en paralelo" }));
    await screen.findByRole("button", { name: "Pausar" });
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
