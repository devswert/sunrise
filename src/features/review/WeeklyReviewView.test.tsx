import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WeeklyReviewView } from "./WeeklyReviewView";
import { api } from "../../lib/ipc";
import { isoWeekId, shortWeekday, todayISO, weekDates } from "../../lib/date";
import { hours } from "./weeklyReview";

function mount() {
  return render(
    <MemoryRouter>
      <WeeklyReviewView />
    </MemoryRouter>,
  );
}

const today = () => todayISO();

/** Deja `seconds` trabajados hoy en una tarea nueva y la devuelve. */
async function worked(title: string, seconds: number) {
  const t = await api.createTask({ title: title, scheduledDate: today(), estimatedMinutes: 60 });
  await api.setActualSeconds(t.id, seconds);
  return t;
}

/**
 * Los gráficos no se asertan por su SVG: la matemática está probada en Rust
 * (`weekly_rollup`) y en `weeklyReview.test.ts`. Acá se mira lo que el usuario
 * lee — las cifras y las columnas.
 */
describe("WeeklyReviewView", () => {
  it("muestra las horas trabajadas y lo cerrado de la semana", async () => {
    const t = await worked("análisis", 5400);
    await api.setTaskStatus(t.id, "DONE");
    // El mock arranca sembrado, así que el total se compara contra el rollup,
    // no contra un número fijo.
    const expected = hours((await api.weeklyRollup(weekDates(new Date())[0])).totalSeconds);

    mount();

    const chip = await screen.findByText(/trabajado/);
    expect(within(chip).getByText(expected)).toBeInTheDocument();
    // Y aparece en la columna del día en que se cerró.
    const days = document.querySelectorAll<HTMLElement>(".review__dia");
    const columna = [...days].find((d) => d.textContent?.includes(shortWeekday(today())))!;
    await waitFor(() => expect(within(columna).getByText("análisis")).toBeInTheDocument());
  });

  it("sin objetivos la caja igual está, y lo dice", async () => {
    // Esconder el panel haría pasar por olvido lo que es un dato de la semana.
    mount();

    const vacio = await screen.findByText("Semana sin objetivos");
    expect(vacio.closest(".review__graficos")).not.toBeNull();
  });

  it("los objetivos van junto a los gráficos, no en una banda propia", async () => {
    // Es una lista corta: como banda a lo ancho se comía el alto que necesita
    // "lo que se cerró".
    await api.createObjective(isoWeekId(new Date()), "Cerrar el rollup");

    mount();

    const objective = await screen.findByText("Cerrar el rollup");
    expect(objective.closest(".review__graficos")).not.toBeNull();
    // Y su avance sale arriba, con el resto de las cifras.
    expect(
      within(document.querySelector<HTMLElement>(".review__cifras")!).getByText(/objetivos/),
    ).toBeInTheDocument();
  });

  it("destildar desde el modal no lo hace desaparecer", async () => {
    // La vista solo lista lo cerrado: si el modal saliera de esa lista, se
    // cerraría solo a media edición. Mismo bicho que en el ritual de M3.4.
    const t = await worked("me arrepentí", 600);
    await api.setTaskStatus(t.id, "DONE");
    mount();

    await userEvent.click(await screen.findByText("me arrepentí"));
    const modal = await screen.findByLabelText("Detalle de tarea");
    await userEvent.click(within(modal).getByLabelText("Marcar como pendiente"));

    await waitFor(() =>
      expect(within(modal).getByLabelText("Marcar como completada")).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("Detalle de tarea")).toBeInTheDocument();
  });

  it("una tarea sin cerrar suma horas pero no cuenta como cerrada", async () => {
    // Trabajado y cerrado son dos preguntas distintas: la vista no puede
    // mezclarlas en una sola cifra.
    const before = (await api.weeklyRollup(weekDates(new Date())[0])).completedTasks.length;
    await worked("en curso", 1800);

    mount();

    const chip = await screen.findByText(/cerradas/);
    expect(within(chip).getByText(String(before))).toBeInTheDocument();
  });

  it("avisa cuando hay tareas sin estimar en vez de inventarles minutos", async () => {
    await api.createTask({ title: "sin estimar", scheduledDate: today() });

    mount();

    expect(await screen.findByText(/sin estimar: lo\s+planificado/i)).toBeInTheDocument();
  });

  it("se puede mirar otra semana, y ahí no hay nada de ésta", async () => {
    await worked("de esta semana", 3600);
    mount();
    await screen.findByText(/trabajado/);

    await userEvent.click(screen.getByRole("button", { name: "Semana anterior" }));

    await waitFor(() => expect(screen.queryByText("de esta semana")).toBeNull());
    // Y el botón de volver deja de estar apagado.
    expect(screen.getByRole("button", { name: "Esta semana" })).toBeEnabled();
  });
});
