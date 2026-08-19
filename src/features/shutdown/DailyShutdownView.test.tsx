import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { DailyShutdownView } from "./DailyShutdownView";
import { DailyHighlightsView } from "./DailyHighlightsView";
import { api } from "../../lib/ipc";
import { todayISO } from "../../lib/date";
import { useAppStore } from "../../lib/store";

// El canvas de jsdom no implementa `getContext`.
const celebrate = vi.fn();
vi.mock("../../lib/confetti", () => ({ celebrate: () => celebrate() }));

function mount(path = "/daily-shutdown") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/daily-shutdown" element={<DailyShutdownView />} />
        <Route path="/daily-highlights" element={<DailyHighlightsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Una tarea cerrada hoy. */
async function cerradaHoy(title: string) {
  const t = await api.createTask({
    title: title,
    scheduledDate: todayISO(),
    estimatedMinutes: 30,
  });
  await api.setTaskStatus(t.id, "DONE");
  return t;
}

/**
 * OJO con el orden: el mock guarda la bitácora en memoria del módulo, así que el
 * caso que comprueba que el día arranca **sin cerrar** tiene que correr antes del
 * que lo cierra, y varios casos se apoyan en lo que subió el anterior.
 */
describe("DailyShutdownView", () => {
  it("el día arranca sin cerrar, y cerrar no es obligatorio", async () => {
    mount();

    expect(await screen.findByRole("button", { name: /Cerrar el día/ })).toBeInTheDocument();
    expect(screen.getByText(/queda como borrador/i)).toBeInTheDocument();
  });

  it("incluir sube la tarea a highlights y abre su resumen", async () => {
    // Incluir y escribir son gestos distintos: primero se sube, después se
    // escribe. Antes de subirla no hay dónde escribir.
    const t = await cerradaHoy("revisar el rollup");
    mount();

    expect(await screen.findByText("Otras actividades")).toBeInTheDocument();
    expect(screen.queryByLabelText(`Resumen de ${t.title}`)).toBeNull();

    // Hay más cerradas hoy en la semilla del mock: se aprieta el "Incluir" de
    // la fila de esta tarea, no el primero que aparezca.
    const fila = screen.getByText(t.title).closest("li")!;
    await userEvent.click(within(fila).getByRole("button", { name: /Incluir/ }));

    const field = await screen.findByLabelText(`Resumen de ${t.title}`);
    await userEvent.click(field);
    await userEvent.paste("costó más de lo que parecía");
    await userEvent.tab();

    await waitFor(async () => {
      const [day] = await api.dailyLog(todayISO(), 1);
      expect(day.done.find((h) => h.task.id === t.id)?.note).toBe("costó más de lo que parecía");
    });
  });

  it("vaciar el resumen no la baja de highlights; sacarla es aparte", async () => {
    const [previo] = await api.dailyLog(todayISO(), 1);
    const subida = previo.done.find((h) => h.note != null)!;
    mount();

    const field = await screen.findByLabelText(`Resumen de ${subida.task.title}`);
    await userEvent.clear(field);
    await userEvent.tab();

    // Sigue arriba, con el resumen vacío.
    await waitFor(async () => {
      const [d] = await api.dailyLog(todayISO(), 1);
      expect(d.done.find((h) => h.task.id === subida.task.id)?.note).toBe("");
    });

    await userEvent.click(
      screen.getByRole("button", { name: `Sacar ${subida.task.title} de los highlights` }),
    );

    await waitFor(async () => {
      const [d] = await api.dailyLog(todayISO(), 1);
      expect(d.done.find((h) => h.task.id === subida.task.id)?.note).toBeNull();
    });
  });

  it("el ánimo se elige de la grilla, y volver a elegirlo lo borra", async () => {
    mount();

    await userEvent.click(await screen.findByRole("button", { name: /Elegir el ánimo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Ánimo 🙂" }));

    await waitFor(async () => {
      const [d] = await api.dailyLog(todayISO(), 1);
      expect(d.mood).toBe("🙂");
    });

    // Es un toggle: el mismo emoji lo saca.
    await userEvent.click(screen.getByRole("button", { name: /Cambiar el ánimo/ }));
    await userEvent.click(screen.getByRole("button", { name: "Ánimo 🙂" }));

    await waitFor(async () => {
      const [d] = await api.dailyLog(todayISO(), 1);
      expect(d.mood).toBeNull();
    });
  });

  it("las pendientes se ven pero no se replanifican desde acá", async () => {
    // Mover una tarea es del daily planning: dos lugares para lo mismo obligan a
    // mantener la misma regla en dos sitios.
    await api.createTask({ title: "no alcancé", scheduledDate: todayISO() });
    mount();

    expect(await screen.findByText("no alcancé")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mandar no alcancé/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Pasar no alcancé/ })).toBeNull();
  });

  it("recargar no pisa una nota a medio escribir", async () => {
    // `load` corre con **cada** invalidación —tildar una tarea, incluir otra, un
    // aviso de la otra ventana—, y sembrar los campos desde el servidor borraba
    // lo que estabas escribiendo. Se invalida a mano y no con un click para que
    // el caso no dependa de qué botón dispara la recarga: lo que se prueba es la
    // recarga, no el botón.
    mount();

    const field = await screen.findByLabelText("Cómo estuvo el día");
    await userEvent.click(field);
    await userEvent.paste("a medio escribir");
    await act(async () => {
      useAppStore.getState().bumpData();
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Cómo estuvo el día")).toHaveValue("a medio escribir"),
    );
  });

  it("cerrar el día lo sella, tira confeti y lleva a la bitácora", async () => {
    mount();

    const field = await screen.findByLabelText("Cómo estuvo el día");
    await userEvent.click(field);
    // El caso anterior dejó texto guardado (su click en el botón hizo blur, y el
    // blur guarda): sin limpiar, esto se concatena.
    await userEvent.clear(field);
    await userEvent.paste("día largo pero salió");
    await userEvent.click(screen.getByRole("button", { name: /Cerrar el día/ }));

    await waitFor(() => expect(screen.getByText("Daily highlights")).toBeInTheDocument());
    expect(celebrate).toHaveBeenCalled();
    const [day] = await api.dailyLog(todayISO(), 1);
    expect(day.closedAt).not.toBeNull();
    expect(day.note).toBe("día largo pero salió");
  });

  it("un día ya cerrado ofrece reabrirlo en vez de volver a cerrarlo", async () => {
    // Lo cerró el caso anterior; el estado del mock es de módulo.
    mount();

    expect(await screen.findByText(/Cerraste este día/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cerrar el día/ })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Reabrir/ }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cerrar el día/ })).toBeInTheDocument(),
    );
  });
});

describe("DailyHighlightsView", () => {
  it("la bitácora muestra el día con lo cerrado y su timeline", async () => {
    const t = await cerradaHoy("algo con tiempo");
    await api.setActualSeconds(t.id, 1800);
    // Incluida, porque subir es lo que la vuelve un highlight (ver el caso
    // siguiente). Sin eso quedaría contada en "y N más".
    await api.includeInLog(todayISO(), t.id);

    mount("/daily-highlights");

    const today = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".dia");
      expect(el).not.toBeNull();
      return el!;
    });
    // Sale dos veces a propósito: como highlight a la izquierda y como tramo del
    // timeline a la derecha. Son dos preguntas distintas sobre la misma tarea.
    await waitFor(() =>
      expect(
        within(today.querySelector<HTMLElement>(".dia__izq")!).getByText("algo con tiempo"),
      ).toBeInTheDocument(),
    );
    const tl = today.querySelector<HTMLElement>(".dia__tl")!;
    expect(within(tl).getByText("algo con tiempo")).toBeInTheDocument();
    expect(within(tl).getByText("0:30")).toBeInTheDocument();
  });

  it("solo salen las incluidas, y las demás se cuentan", async () => {
    // Incluir es curar: en un día de ocho cerradas puede que solo cinco valgan
    // una línea. Lo que queda afuera **se dice**, no se esconde.
    await cerradaHoy("ésta no la sube");

    mount("/daily-highlights");

    const izq = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".dia__izq");
      expect(el).not.toBeNull();
      return el!;
    });
    await waitFor(() => expect(within(izq).getByText("algo con tiempo")).toBeInTheDocument());
    expect(within(izq).queryByText("ésta no la sube")).toBeNull();
    expect(within(izq).getByText(/más, sin resumen/)).toBeInTheDocument();
  });

  it("el donut de channels arranca plegado", async () => {
    // Fixture propia y no la de la semilla. La semilla pone su tiempo trabajado
    // en un día de la semana fijo, así que caer en hoy o en el pasado depende del
    // día en que corras los tests, y sin tiempo trabajado hoy el donut no existe
    // y no hay botón que plegar. Se caía de miércoles a domingo.
    const conChannel = await cerradaHoy("con channel");
    await api.updateTask(conChannel.id, { categoryId: 3 });
    await api.setActualSeconds(conChannel.id, 1800);

    mount("/daily-highlights");

    // Acotado al bloque de hoy: la bitácora dibuja un día por fecha con tiempo
    // trabajado, y cada uno trae su propio toggle. Buscar en toda la página
    // encuentra varios en cuanto hay más de un día con tiempo.
    const hoy = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".dia");
      expect(el).not.toBeNull();
      return el!;
    });
    const toggle = await within(hoy).findByRole("button", { name: /Channels/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(hoy.querySelector(".donut")).toBeNull();

    await userEvent.click(toggle);

    await waitFor(() => expect(hoy.querySelector(".donut")).not.toBeNull());
  });

  it("hacer click en un hito abre el detalle de la tarea", async () => {
    mount("/daily-highlights");

    await userEvent.click(await screen.findByRole("button", { name: /algo con tiempo/ }));

    expect(await screen.findByLabelText("Detalle de tarea")).toBeInTheDocument();
  });
});
