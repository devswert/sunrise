import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DailyPlanningView } from "./DailyPlanningView";
import { api } from "../../lib/ipc";
import { toISODate, todayISO } from "../../lib/date";
import { SettingKey, useSettingsStore } from "../../lib/settings";

// El canvas de jsdom no implementa `getContext`: la llamada real reventaría en
// cuanto un test aprete el botón del final. Por eso vive en su propio módulo.
const celebrar = vi.fn();
vi.mock("../../lib/confetti", () => ({ celebrar: () => celebrar() }));

function montar() {
  return render(
    <MemoryRouter initialEntries={["/daily-planning"]}>
      <Routes>
        <Route path="/daily-planning" element={<DailyPlanningView />} />
        <Route path="/" element={<div>La semana</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Hace `n` días. `toISODate` y no `toISOString`: cortar el UTC adelanta el día
 * varias horas antes de medianoche. */
function hace(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
}

const irAHoy = () => userEvent.click(screen.getByRole("button", { name: /Qué hay para hoy/ }));

/**
 * OJO con el orden de los casos, dos veces:
 *
 * 1. El mock guarda los ajustes en memoria del módulo, así que el caso que
 *    comprueba que no se escribe nada tiene que correr **antes** del que cierra
 *    el ritual.
 * 2. `useBoard` corre la degradación **una sola vez por archivo**, en el primer
 *    montaje. Los casos que dejan una tarea en un día pasado dependen de que ya
 *    haya corrido; aislarlos con `-t` los deja pasar en falso, porque ahí sí se
 *    ejecuta y les manda la tarea al backlog.
 */
describe("DailyPlanningView", () => {
  beforeEach(() => {
    celebrar.mockClear();
    useSettingsStore.setState({ values: {}, loaded: true });
  });

  it("arranca en el repaso del día anterior", async () => {
    montar();
    await waitFor(() =>
      expect(screen.getByText(/No hay días anteriores con tareas/)).toBeInTheDocument(),
    );
  });

  it("repasa el último día con tareas, no 'ayer' a secas", async () => {
    // Un lunes, ayer es domingo y está vacío: lo que hay que revisar es el
    // viernes. La ventana mira varios días hacia atrás y elige el último.
    await api.createTask({ title: "Quedó abierta", scheduledDate: hace(3) });
    const hecha = await api.createTask({ title: "Se cerró", scheduledDate: hace(3) });
    await api.setTaskStatus(hecha.id, "DONE");
    montar();

    const cifras = await waitFor(() => {
      const el = document.querySelector(".repaso__cifras");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(cifras.textContent).toMatch(/1\/2\s*cerradas/);
    expect(screen.getByText("Quedó abierta")).toBeInTheDocument();
  });

  it("trae a hoy lo que quedó abierto, que es lo que el carry-over no toca", async () => {
    // Las de calendario se quedan en su día para siempre: `carry_over` solo
    // mueve las MANUAL. Sin este botón no había forma de rescatarlas.
    await api.createTask({ title: "Reunión del sábado", scheduledDate: hace(1) });
    montar();

    await userEvent.click(await screen.findByRole("button", { name: /Traer Reunión del sábado/ }));

    await irAHoy();
    // En la columna del día, no en el rail (que también la dibuja).
    const columna = document.querySelector<HTMLElement>(".daily-plan__col")!;
    await waitFor(() =>
      expect(within(columna).getByText("Reunión del sábado")).toBeInTheDocument(),
    );
  });

  it("abre el detalle de una tarea del día anterior", async () => {
    // `useBoard` solo carga hoy: buscar ahí la tarea del paso 1 dejaba el click
    // sin efecto, que es peor que no ser clickeable.
    await api.createTask({ title: "Vengo de antes", scheduledDate: hace(2) });
    montar();

    await userEvent.click(await screen.findByText("Vengo de antes"));

    expect(await screen.findByRole("dialog", { name: "Detalle de tarea" })).toBeInTheDocument();
  });

  it("lo pendiente de días anteriores al repasado ya está en el backlog", async () => {
    // Ya no se arrastra nada a hoy: la degradación diaria lo baja al backlog en
    // primera posición, y el ritual repasa el último día, que queda intacto.
    await api.createTask({ title: "Del lunes lejano", scheduledDate: hace(6) });
    await api.createTask({ title: "Ancla de ayer", scheduledDate: hace(1) });
    // Explícito y no vía `useBoard`: su guarda corre una sola vez por archivo y
    // para este caso ya se gastó en un test anterior.
    await api.degradarPendientes(todayISO());
    montar();
    await irAHoy();

    const cols = document.querySelectorAll<HTMLElement>(".daily-plan__col");
    await waitFor(() =>
      expect(within(cols[1]).getByText("Del lunes lejano")).toBeInTheDocument(),
    );
    expect(within(cols[1]).getByText(/venían de un día/i)).toBeInTheDocument();
  });

  it("el peso del día se ve en los dos pasos, no en una card aparte", async () => {
    // La semilla del mock deja tareas de hoy: el medidor tiene que contarlas.
    montar();
    await waitFor(() => expect(document.querySelector(".cap-line")).not.toBeNull());
    expect(screen.getByText(/sin comprometer|lleno|pasaste|vac/i)).toBeInTheDocument();

    await irAHoy();
    expect(document.querySelector(".cap-line")).not.toBeNull();
  });

  it("el backlog es una columna del paso 2, para arrastrar en los dos sentidos", async () => {
    // Sacar del día es soltar acá: por eso ya no hay botones que hagan lo mismo.
    await api.createTask({ title: "Algún día" });
    montar();
    await irAHoy();

    expect(await screen.findByText("Backlog")).toBeInTheDocument();
    const col = document.querySelectorAll(".daily-plan__col");
    expect(col).toHaveLength(2);
    expect(within(col[1] as HTMLElement).getByText("Algún día")).toBeInTheDocument();
  });

  it("no guarda nada al entrar: el ritual no es un formulario", async () => {
    // Todo lo que se toca acá ya persiste solo. Si montar la vista escribiera
    // `planned_on`, el sello del final dejaría de significar algo.
    montar();
    await irAHoy();
    await waitFor(() => expect(document.querySelector(".cap-line")).not.toBeNull());

    const pares = await api.listSettings();
    expect(pares.find(([k]) => k === SettingKey.PLANNED_ON)).toBeUndefined();
  });

  it("entrar a un día ya planificado avisa, y deja revisarlo igual", async () => {
    // El sello en la cabecera se leía como decoración. El ritual está para
    // hacerse una vez y volver a entrar suele ser sin querer.
    useSettingsStore.setState({ values: { planned_on: todayISO() }, loaded: true });
    montar();

    const aviso = await screen.findByRole("alertdialog", { name: "Ya planificaste hoy" });
    await userEvent.click(within(aviso).getByRole("button", { name: /Revisar igual/ }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText("La semana")).toBeNull();
  });

  it("desde el aviso se puede salir a la semana", async () => {
    useSettingsStore.setState({ values: { planned_on: todayISO() }, loaded: true });
    montar();

    const aviso = await screen.findByRole("alertdialog");
    await userEvent.click(within(aviso).getByRole("button", { name: /Ir a la semana/ }));

    expect(await screen.findByText("La semana")).toBeInTheDocument();
  });

  it("un día sin planificar no avisa nada", async () => {
    montar();
    await waitFor(() => expect(document.querySelector(".cap-line")).not.toBeNull());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("terminar el ritual marca el día, tira confeti y vuelve a la semana", async () => {
    montar();
    await irAHoy();

    await userEvent.click(await screen.findByRole("button", { name: "Empezar el día" }));

    expect(await screen.findByText("La semana")).toBeInTheDocument();
    expect(celebrar).toHaveBeenCalledTimes(1);
    const pares = await api.listSettings();
    expect(pares.find(([k]) => k === SettingKey.PLANNED_ON)?.[1]).toBe(todayISO());
  });
});
