import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WeeklyReviewView } from "./WeeklyReviewView";
import { api } from "../../lib/ipc";
import { mock } from "../../lib/mockDb";
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

  it("un objetivo se tildea desde la review", async () => {
    // Es donde uno se acuerda de que cumplió algo: antes la lista era texto plano
    // y había que ir a otra vista a marcarla.
    const o = await api.createObjective(isoWeekId(new Date()), "revisar el rollup");
    mount();

    // Dentro de su propia fila: el mock acumula objetivos entre tests del
    // archivo, así que el label solo no alcanza para distinguirlo.
    const fila = (await screen.findByText("revisar el rollup")).closest("li")!;
    await userEvent.click(within(fila).getByLabelText("Completar objetivo"));

    await waitFor(async () => {
      const [leido] = (await api.listObjectives(isoWeekId(new Date()))).filter(
        (x) => x.id === o.id,
      );
      expect(leido.completed).toBe(true);
    });
  });

  it("hacer click en un objetivo filtra lo que se cerró", async () => {
    const semana = isoWeekId(new Date());
    const o = await api.createObjective(semana, "el que filtra");
    const suya = await worked("tarea del objetivo", 600);
    await api.updateTask(suya.id, { objectiveId: o.id });
    await api.setTaskStatus(suya.id, "DONE");
    const ajena = await worked("tarea sin objetivo", 600);
    await api.setTaskStatus(ajena.id, "DONE");
    mount();
    await screen.findByText("tarea sin objetivo");

    await userEvent.click(screen.getByText("el que filtra"));

    await waitFor(() => expect(screen.queryByText("tarea sin objetivo")).toBeNull());
    expect(screen.getByText("tarea del objetivo")).toBeInTheDocument();

    // Y el mismo click lo apaga.
    await userEvent.click(screen.getByText("el que filtra"));
    expect(await screen.findByText("tarea sin objetivo")).toBeInTheDocument();
  });

  it("el dropdown de channel filtra junto con el de objetivo, no en vez de", async () => {
    const semana = isoWeekId(new Date());
    const cats = await api.listCategories();
    const o = await api.createObjective(semana, "objetivo compartido");
    const calza = await worked("cumple las dos", 600);
    await api.updateTask(calza.id, { objectiveId: o.id, categoryId: cats[0].id });
    await api.setTaskStatus(calza.id, "DONE");
    const soloObjetivo = await worked("solo el objetivo", 600);
    await api.updateTask(soloObjetivo.id, { objectiveId: o.id, categoryId: cats[1].id });
    await api.setTaskStatus(soloObjetivo.id, "DONE");
    mount();
    await screen.findByText("cumple las dos");

    await userEvent.click(screen.getByText("objetivo compartido"));
    await userEvent.click(screen.getByLabelText("Filtrar por channel"));
    // Por rol: el nombre del channel también está en el chip de las cards.
    const lista = await screen.findByRole("listbox");
    await userEvent.click(within(lista).getByRole("option", { name: cats[0].name }));

    await waitFor(() => expect(screen.queryByText("solo el objetivo")).toBeNull());
    expect(screen.getByText("cumple las dos")).toBeInTheDocument();
  });

  it("separa el tiempo de objetivos del de lo demás", async () => {
    // Es la pregunta que trae a la caja de objetivos: qué proporción del rato se
    // fue en lo que uno se había propuesto.
    const o = await api.createObjective(isoWeekId(new Date()), "el objetivo");
    const ligada = await api.createTask({
      title: "ligada",
      scheduledDate: today(),
      objectiveId: o.id,
    });
    await api.setActualSeconds(ligada.id, 3600);
    // Contra el rollup y no contra números fijos: el mock arranca sembrado y los
    // tests de más arriba dejaron sus propias horas de objetivo.
    const r = await api.weeklyRollup(weekDates(new Date())[0]);

    mount();

    const split = await screen.findByText(/en objetivos ·/);
    expect(split).toHaveTextContent(hours(r.objectiveSeconds));
    // Y lo demás es el resto del total, no cero.
    expect(split).toHaveTextContent(hours(r.totalSeconds - r.objectiveSeconds));
    expect(r.objectiveSeconds).toBeGreaterThan(0);
    expect(r.totalSeconds).toBeGreaterThan(r.objectiveSeconds);
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

/**
 * Jornada y paralelismo (#22), por día y en total. Los números los arma Rust (y
 * el gemelo del mock, probado en `workday.test.ts`); acá se sobrescriben sobre lo
 * que devuelve el mock para fijar qué hace la vista con ellos.
 */
describe("jornada y paralelismo en la review", () => {
  // Un `expect` que falla antes del `mockRestore` no puede dejar el spy puesto
  // para el resto del archivo.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const H = 3600;

  function withClock(porDia: Record<string, [number, number]>) {
    const real = mock.weeklyRollup;
    return vi.spyOn(api, "weeklyRollup").mockImplementation(async (weekStart) => {
      const r = await real(weekStart);
      const days = r.days.map((d) => {
        const [spanSeconds, clockedSeconds] = porDia[d.date] ?? [0, 0];
        return { ...d, spanSeconds, clockedSeconds };
      });
      return {
        ...r,
        days,
        spanSeconds: days.reduce((a, d) => a + d.spanSeconds, 0),
        clockedSeconds: days.reduce((a, d) => a + d.clockedSeconds, 0),
      };
    });
  }

  it("sin paralelismo la review se ve como siempre", async () => {
    const [lunes, martes] = weekDates(new Date());
    const spy = withClock({ [lunes]: [3 * H, 3 * H], [martes]: [H, H] });
    mount();

    expect(await screen.findByText(/trabajado/)).toBeInTheDocument();
    expect(screen.queryByText(/jornada/)).toBeNull();
    expect(screen.queryByText(/en paralelo/)).toBeNull();
    expect(document.querySelector(".review__dia-jornada")).toBeNull();
    spy.mockRestore();
  });

  it("con paralelismo muestra la jornada y el × de la semana y de cada día", async () => {
    const [lunes, martes, miercoles] = weekDates(new Date());
    // Lunes 3h de jornada con 6h de reloj (×2,0); martes 1h sin solape. La
    // semana es Σ reloj ÷ Σ jornada = 7/4, no el promedio de los días (×1,5).
    const spy = withClock({ [lunes]: [3 * H, 6 * H], [martes]: [H, H] });
    mount();

    const jornada = await screen.findByText(/jornada$/, { selector: ".chip-cifra" });
    expect(within(jornada).getByText("4h")).toBeInTheDocument();
    const par = screen.getByText(/en paralelo/, { selector: ".chip-cifra" });
    expect(within(par).getByText("×1,8")).toBeInTheDocument();

    expect(screen.getByTestId(`jornada-${lunes}`)).toHaveTextContent("3h jornada · ×2,0");
    expect(screen.getByTestId(`jornada-${martes}`)).toHaveTextContent(/^1h jornada$/);
    // El slot está aunque el día no tenga nada: si no, las columnas se desalinean.
    expect(screen.getByTestId(`jornada-${miercoles}`)).toHaveTextContent(/^$/);
    spy.mockRestore();
  });

  it("un día paralelo en una semana que no lo es igual muestra su ×", async () => {
    // 8h con 9h de reloj (×1,1) diluidas en 40h de semana: la semana no pasa el
    // umbral, pero el día sí, y el shutdown de ese día lo mostró.
    const days = weekDates(new Date());
    const porDia = Object.fromEntries(
      days.slice(0, 5).map((d, i) => [d, i === 0 ? [8 * H, 9 * H] : [8 * H, 8 * H]]),
    ) as Record<string, [number, number]>;
    withClock(porDia);
    mount();

    expect(await screen.findByTestId(`jornada-${days[0]}`)).toHaveTextContent("8h jornada · ×1,1");
    expect(screen.queryByText(/en paralelo/, { selector: ".chip-cifra" })).toBeNull();
  });
});
