import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { WeeklyPlanningView } from "./WeeklyPlanningView";
import { api } from "../../lib/ipc";
import { isoWeekId, shiftWeeks, weekDates } from "../../lib/date";

function mount() {
  return render(
    <MemoryRouter>
      <WeeklyPlanningView />
    </MemoryRouter>,
  );
}

const estaSemana = () => isoWeekId(new Date());
const semanaPasada = () => isoWeekId(shiftWeeks(new Date(), -1));

describe("WeeklyPlanningView", () => {
  it("se puede mirar y editar otra semana, no solo la actual", async () => {
    // La vista anclaba en un `new Date()` congelado: los objetivos de cualquier
    // otra semana no se podían ni ver.
    await api.createObjective(semanaPasada(), "lo de la semana pasada");
    mount();

    expect(screen.queryByText("lo de la semana pasada")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Semana anterior" }));

    expect(await screen.findByText("lo de la semana pasada")).toBeInTheDocument();
    // Y el botón de volver deja de estar apagado.
    expect(screen.getByRole("button", { name: "Esta semana" })).toBeEnabled();
  });

  it("repartir minutos en un día crea la tarea de ese día colgada del objetivo", async () => {
    const o = await api.createObjective(estaSemana(), "estudiar Rust");
    mount();

    await userEvent.click(await screen.findByText("estudiar Rust"));
    const modal = await screen.findByRole("dialog", { name: /estudiar Rust/ });
    const dias = within(modal).getAllByRole("button", { name: /Repartir minutos del/ });
    await userEvent.click(dias[0]);
    // `formatMinutes` escribe "0:30", que es la convención del estimado en toda
    // la app (el mismo listado que ofrece el detalle de tarea).
    await userEvent.click(await screen.findByText("0:30"));

    await waitFor(async () => {
      const wk = weekDates(new Date());
      const tasks = await api.listTasksForRange(wk[0], wk[6]);
      const creada = tasks.find((t) => t.objectiveId === o.id);
      expect(creada).toBeDefined();
      // El título es el del objetivo, sin el día pegado atrás.
      expect(creada!.title).toBe("estudiar Rust");
      expect(creada!.scheduledDate).toBe(wk[0]);
      expect(creada!.estimatedMinutes).toBe(30);
    });
  });

  it("dejar un día sin tiempo no borra la tarea: la desliga y la deja en su día", async () => {
    // Precedente de DECISIONES §6 — la tarea puede tener tiempo trackeado que no
    // está en ningún otro lado, y borrar es caro de deshacer.
    const wk = weekDates(new Date());
    const o = await api.createObjective(estaSemana(), "cerrar Mej.15");
    const t = await api.createTask({
      // Un título distinto al del objetivo, para que la consulta del test no
      // tope con los dos.
      title: "leer el capítulo",
      scheduledDate: wk[0],
      estimatedMinutes: 30,
      objectiveId: o.id,
    });
    await api.setActualSeconds(t.id, 900);
    mount();

    await userEvent.click(await screen.findByText("cerrar Mej.15"));
    const modal = await screen.findByRole("dialog", { name: /cerrar Mej.15/ });
    await userEvent.click(
      within(modal).getAllByRole("button", { name: /Repartir minutos del/ })[0],
    );
    await userEvent.click(await screen.findByText("Sin tiempo"));

    await waitFor(async () => {
      const tasks = await api.listTasksForRange(wk[0], wk[6]);
      const sigue = tasks.find((x) => x.id === t.id);
      expect(sigue).toBeDefined();
      expect(sigue!.objectiveId).toBeNull();
      expect(sigue!.actualSeconds).toBe(900);
    });
  });

  it("un objetivo que quedó en una semana pasada se puede traer a ésta", async () => {
    const o = await api.createObjective(semanaPasada(), "quedó atrás");
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Semana anterior" }));
    await screen.findByText("quedó atrás");

    // Por su nombre exacto: otros tests dejaron objetivos en la misma semana.
    await userEvent.click(
      screen.getByRole("button", { name: "Traer quedó atrás a la semana actual" }),
    );

    await waitFor(async () => {
      expect((await api.listObjectives(estaSemana())).some((x) => x.id === o.id)).toBe(true);
      expect((await api.listObjectives(semanaPasada())).some((x) => x.id === o.id)).toBe(false);
    });
    // La vista se va con él: si no, el objetivo desaparecería de la pantalla y el
    // gesto se leería como un borrado.
    expect(await screen.findByText("quedó atrás")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Esta semana" })).toBeDisabled();
    // Y acá el botón de traer ya no está: no hay a dónde traerlo.
    expect(
      screen.queryByRole("button", { name: "Traer quedó atrás a la semana actual" }),
    ).toBeNull();
  });

  it("eliminar un objetivo pide confirmación antes de borrarlo", async () => {
    const o = await api.createObjective(estaSemana(), "borrable");
    mount();
    await screen.findByText("borrable");

    await userEvent.click(screen.getByRole("button", { name: "Eliminar borrable" }));
    // El primer click no borra nada: pregunta.
    expect(await screen.findByText("¿Eliminar este objetivo?")).toBeInTheDocument();
    expect((await api.listObjectives(estaSemana())).some((x) => x.id === o.id)).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Sí, eliminar" }));
    await waitFor(async () =>
      expect((await api.listObjectives(estaSemana())).some((x) => x.id === o.id)).toBe(false),
    );
  });

  it("borrar un objetivo desliga sus tareas en vez de llevárselas", async () => {
    // `ON DELETE SET NULL` en la DB, y el mock tiene que espejarlo: sin eso la
    // tarea queda apuntando a un id que ya no existe y la card sigue mostrando la
    // marca de objetivo de algo borrado.
    const wk = weekDates(new Date());
    const o = await api.createObjective(estaSemana(), "efímero");
    const t = await api.createTask({
      title: "sobrevive al objetivo",
      scheduledDate: wk[0],
      objectiveId: o.id,
    });

    await api.deleteObjective(o.id);

    const [leida] = (await api.listTasksForRange(wk[0], wk[6])).filter((x) => x.id === t.id);
    expect(leida).toBeDefined();
    expect(leida.objectiveId).toBeNull();
  });

  it("el channel del objetivo sale de los channels que ya existen", async () => {
    const cats = await api.listCategories();
    const o = await api.createObjective(estaSemana(), "con channel", cats[0].id);
    expect(o.categoryId).toBe(cats[0].id);

    mount();

    expect(await screen.findByText(`#${cats[0].name}`)).toBeInTheDocument();
  });
});
